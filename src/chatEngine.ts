import { Provider } from './types'
import type { AISettings, HexstrikeTool, Message, ToolCall } from './types'
import { executeHexstrikeTool } from './api'
import {
  truncateForBudget,
  isReasoningModel,
  suggestReasoningEffort,
  FailureTracker,
  readUsageFromChunk,
  type TokenUsage,
} from './agent'

export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; result: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done' }
  | { type: 'error'; error: string }

const MAX_AGENT_ROUNDS = 25

function toolResultBudget(settings: AISettings): number {
  const cw = settings.contextWindow || 128_000
  return Math.max(2000, Math.floor((cw * 0.4) / 4))
}

const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

function sanitizeTools(tools: HexstrikeTool[]): HexstrikeTool[] {
  return tools.filter((t) => VALID_TOOL_NAME.test(t.name)).slice(0, 64)
}

function buildOpenAITools(tools: HexstrikeTool[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Target hostname, IP address, URL, or file path' },
          options: { type: 'string', description: 'Additional tool options or parameters' },
        },
        required: ['target'],
      },
    },
  }))
}

function buildAnthropicTools(tools: HexstrikeTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target hostname, IP address, URL, or file path' },
        options: { type: 'string', description: 'Additional tool options or parameters' },
      },
      required: ['target'],
    },
  }))
}

function buildGoogleTools(tools: HexstrikeTool[]) {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: {
          target: { type: 'STRING', description: 'Target hostname, IP address, URL, or file path' },
          options: { type: 'STRING', description: 'Additional tool options or parameters' },
        },
        required: ['target'],
      },
    })),
  }]
}

async function* streamSSE(response: Response): AsyncGenerator<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data && data !== '[DONE]') yield data
      }
    }
  }
  if (buffer.startsWith('data: ')) {
    const data = buffer.slice(6).trim()
    if (data && data !== '[DONE]') yield data
  }
}

const DEFAULT_BASE: Record<string, string> = {
  [Provider.openai]:   'https://api.openai.com/v1',
  [Provider.groq]:     'https://api.groq.com/openai/v1',
  [Provider.mistral]:  'https://api.mistral.ai/v1',
  [Provider.lmstudio]: 'http://localhost:1234/v1',
  [Provider.ollama]:   'http://localhost:11434/v1',
}

function resolveBase(settings: AISettings): string {
  return (settings.baseUrl || DEFAULT_BASE[settings.provider] || '').replace(/\/+$/, '')
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      const msg =
        j?.error?.message ??
        j?.error?.msg ??
        j?.message ??
        j?.detail ??
        j?.msg ??
        text
      return String(msg)
    } catch {
      return text || res.statusText
    }
  } catch {
    return res.statusText
  }
}

interface ToolCallArgs {
  target?: string
  options?: string
  [key: string]: unknown
}

async function* openAIStream(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const base = resolveBase(settings)
  const openAIMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const safeTools = sanitizeTools(tools)
  let toolDefs = safeTools.length ? buildOpenAITools(safeTools) : undefined
  let withTools = !!toolDefs

  // Prepend the configured system prompt as a system-role message. OpenAI &
  // OpenAI-compatible providers take the system prompt via a `system`-role
  // message in `messages` (there is no top-level `system` field like
  // Anthropic). Without this, every OpenAI/Groq/Mistral/LM Studio/Ollama call
  // silently ignored the user's system prompt.
  const systemPrompt = settings.systemPrompt?.trim()
  let turnMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content?: string | unknown[]; tool_calls?: unknown[]; tool_call_id?: string }> = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...openAIMessages,
  ]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  let aborted = signal?.aborted ?? false
  if (signal && !aborted) {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
  }

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    if (aborted) {
      yield { type: 'error', error: 'Stopped by user.' }
      return
    }

    const body: Record<string, unknown> = {
      model: settings.model,
      messages: turnMessages,
      temperature: settings.temperature,
      stream: true,
      max_tokens: settings.maxTokens,
      max_completion_tokens: settings.maxTokens,
    }

    if (
      settings.provider === Provider.openai ||
      settings.provider === Provider.groq ||
      settings.provider === Provider.mistral ||
      settings.provider === Provider.custom
    ) {
      body.stream_options = { include_usage: true }
    }

    const effort = suggestReasoningEffort(settings)
    if (effort) body.reasoning_effort = effort

    if (withTools && toolDefs?.length) body.tools = toolDefs

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`

    let res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok && res.status === 400 && withTools) {
      withTools = false
      toolDefs = undefined
      const retryBody = { ...body }
      delete retryBody.tools
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify(retryBody),
      })
    }

    if (!res.ok) {
      const msg = await parseErrorBody(res)
      yield { type: 'error', error: `${res.status}: ${msg}` }
      return
    }

    let assistantText = ''
    const pendingToolCalls: Record<number, { id: string; name: string; argsRaw: string }> = {}

    for await (const raw of streamSSE(res)) {
      let chunk: unknown
      try { chunk = JSON.parse(raw) } catch { continue }
      const c = chunk as Record<string, unknown> | null
      if (c?.error) {
        yield { type: 'error', error: (c.error as Record<string, unknown>)?.message as string ?? JSON.stringify(c.error) }
        return
      }
      const usage = readUsageFromChunk(chunk)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }
      const choices = c?.choices as Array<Record<string, unknown>> | undefined
       const delta = choices?.[0]?.delta as { content?: string; tool_calls?: unknown[] } | undefined
      if (!delta) continue

      if (delta.content) {
        assistantText += delta.content
        yield { type: 'text', content: delta.content }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls as unknown[]) {
          const t = tc as { index?: number; id?: string; function?: { name?: string; arguments?: string } }
          const idx = t.index ?? 0
          if (!pendingToolCalls[idx]) pendingToolCalls[idx] = { id: '', name: '', argsRaw: '' }
          if (t.id) pendingToolCalls[idx].id = t.id
          if (t.function?.name) pendingToolCalls[idx].name += t.function.name
          if (t.function?.arguments) pendingToolCalls[idx].argsRaw += t.function.arguments
        }
      }
    }

    const toolCallList = Object.values(pendingToolCalls)
    if (!toolCallList.length) break

    turnMessages = [...turnMessages, {
      role: 'assistant',
      content: assistantText || undefined,
      tool_calls: toolCallList.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argsRaw },
      })),
    }]

    const callResults = await Promise.all(toolCallList.map(async (tc) => {
      let args: ToolCallArgs = {}
      try { args = JSON.parse(tc.argsRaw) } catch { args = {} }
      const callId = tc.id || String(Date.now())

      if (failures.shouldSkip(tc.name)) {
        return { tc, callId, args, resultStr: `Skipped: tool "${tc.name}" failed too many times this session.` }
      }

      try {
        const result = await executeHexstrikeTool(
          settings.hexstrikeUrl,
          tc.name,
          args.target ?? '',
          args.options ? { raw: String(args.options) } : undefined
        )
        const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        const resultStr = truncateForBudget(raw, budget)
        failures.reset(tc.name)
        return { tc, callId, args, resultStr }
      } catch (err) {
        failures.record(tc.name)
        const msg = err instanceof Error ? err.message : String(err)
        return { tc, callId, args, resultStr: `Tool error: ${msg}` }
      }
    }))

    for (const { tc, callId, args, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: callId as string, name: tc.name as string, arguments: args as Record<string, unknown>, status: 'running' } }
      yield { type: 'tool_result', toolCallId: callId as string, result: resultStr as string }
      turnMessages.push({ role: 'tool', tool_call_id: (tc.id || callId) as string, content: resultStr as string })
    }
  }

  yield { type: 'done' }
}

async function* anthropicStream(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const systemPrompt = settings.systemPrompt || 'You are HexStrike AI, an advanced cybersecurity assistant.'
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: [m.content] as unknown[] }))

  const safeTools = sanitizeTools(tools)
  const toolDefs = safeTools.length ? buildAnthropicTools(safeTools) : undefined
  let turnMessages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [...anthropicMessages]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  let aborted = signal?.aborted ?? false
  if (signal && !aborted) {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
  }

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    if (aborted) {
      yield { type: 'error', error: 'Stopped by user.' }
      return
    }
    const body: Record<string, unknown> = {
      model: settings.model,
      max_tokens: settings.maxTokens,
      system: systemPrompt,
      messages: turnMessages,
      stream: true,
    }
    if (toolDefs?.length) body.tools = toolDefs
    if (isReasoningModel(settings.model)) {
      body.thinking = { type: 'enabled', budget_tokens: 2000 }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const msg = await parseErrorBody(res)
      yield { type: 'error', error: `Anthropic ${res.status}: ${msg}` }
      return
    }

    let assistantText = ''
    const pendingToolCalls: Record<string, { id: string; name: string; inputRaw: string }> = {}
    let currentToolId = ''

    for await (const raw of streamSSE(res)) {
      let event: unknown
      try { event = JSON.parse(raw) } catch { continue }
      const evType = (event as Record<string, unknown>)?.type as string | undefined
      if (!evType) continue

      const usage = readUsageFromChunk(event)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }

      if (evType === 'content_block_start') {
        const block = (event as Record<string, unknown>)?.content_block as { type: string; id: string; name: string; input: unknown } | undefined
        if (block?.type === 'tool_use') {
          currentToolId = block.id
          pendingToolCalls[block.id] = { id: block.id, name: block.name, inputRaw: '' }
        }
      } else if (evType === 'content_block_delta') {
        const delta = (event as Record<string, unknown>)?.delta as
          | { type: 'text_delta'; text: string }
          | { type: 'input_json_delta'; partial_json: string }
          | undefined
        if (!delta) continue
        if (delta.type === 'text_delta') {
          assistantText += delta.text
          yield { type: 'text', content: delta.text }
        } else if (delta.type === 'input_json_delta' && currentToolId) {
          pendingToolCalls[currentToolId].inputRaw += delta.partial_json
        }
      } else if (evType === 'message_stop') {
        break
      } else if (evType === 'error') {
        const errEvent = event as Record<string, unknown>
        yield { type: 'error', error: (errEvent?.error as Record<string, unknown>)?.message as string ?? 'Anthropic stream error' }
        return
      }
    }

    const toolCallList = Object.values(pendingToolCalls)
    if (!toolCallList.length) break

    const assistantContent: unknown[] = []
    if (assistantText) assistantContent.push({ type: 'text', text: assistantText })
    for (const tc of toolCallList) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(tc.inputRaw) } catch { input = {} }
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
    }
    turnMessages = [...turnMessages, { role: 'assistant', content: assistantContent }]

    const callResults = await Promise.all(toolCallList.map(async (tc) => {
      let args: ToolCallArgs = {}
      try { args = JSON.parse(tc.inputRaw) } catch { args = {} }
      if (failures.shouldSkip(tc.name)) {
        return { tc, args, resultStr: `Skipped: tool "${tc.name}" failed too many times this session.` }
      }
      try {
        const params = args.options ? { raw: String(args.options) } : undefined
        const result = await executeHexstrikeTool(settings.hexstrikeUrl, tc.name, args.target ?? '', params)
        const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        const resultStr = truncateForBudget(raw, budget)
        failures.reset(tc.name)
        return { tc, args, resultStr }
      } catch (err) {
        failures.record(tc.name)
        const msg = err instanceof Error ? err.message : String(err)
        return { tc, args, resultStr: `Tool error: ${msg}` }
      }
    }))

    const toolResultContent: unknown[] = []
    for (const { tc, args, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args, status: 'running' } }
      yield { type: 'tool_result', toolCallId: tc.id, result: resultStr }
      toolResultContent.push({ type: 'tool_result', tool_use_id: tc.id, content: resultStr })
    }
    turnMessages = [...turnMessages, { role: 'user', content: toolResultContent }]
  }

  yield { type: 'done' }
}

async function* googleStream(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const model = settings.model || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${settings.apiKey}&alt=sse`

  const geminiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'assistant' ? ('model' as const) : ('user' as const)
      return { role, parts: [{ text: m.content }] as unknown[] }
    })

  const safeTools = sanitizeTools(tools)
  const toolDefs = safeTools.length ? buildGoogleTools(safeTools) : undefined
  let turnMessages: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [...geminiMessages]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  let aborted = signal?.aborted ?? false
  if (signal && !aborted) {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
  }

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    if (aborted) {
      yield { type: 'error', error: 'Stopped by user.' }
      return
    }
    const body: Record<string, unknown> = {
      contents: turnMessages,
      generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxTokens },
    }
    if (settings.systemPrompt) body.systemInstruction = { parts: [{ text: settings.systemPrompt }] }
    if (toolDefs?.length) body.tools = toolDefs

    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const msg = await parseErrorBody(res)
      yield { type: 'error', error: `Gemini ${res.status}: ${msg}` }
      return
    }

    let assistantText = ''
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = []

    for await (const raw of streamSSE(res)) {
      let chunk: unknown
      try { chunk = JSON.parse(raw) } catch { continue }
      const usage = readUsageFromChunk(chunk)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }
      const c = chunk as Record<string, unknown>
      const candidates = c.candidates as Array<Record<string, unknown>> | undefined
       const firstCandidate = candidates?.[0] as Record<string, unknown> | undefined
       const content = firstCandidate?.content as Record<string, unknown> | undefined
       const parts = (content?.parts as Array<Record<string, unknown>> | undefined) ?? []
      for (const part of parts) {
        if (part.text) {
          assistantText += part.text
          yield { type: 'text', content: String(part.text) }
        }
        if (part.functionCall) {
          const fcRecord = part.functionCall as Record<string, unknown>
          functionCalls.push({
            name: String(fcRecord.name),
            args: (fcRecord.args as Record<string, unknown>) ?? {},
          })
        }
      }
    }

    if (!functionCalls.length) break

    const modelParts: unknown[] = []
    if (assistantText) modelParts.push({ text: assistantText })
    for (const fc of functionCalls) modelParts.push({ functionCall: { name: fc.name, args: fc.args } })
    // Gemini requires the model's own turn to carry role 'model'. Using
    // 'user' here fed the model its own output as a user message and
    // corrupted multi-round tool-use history.
    turnMessages = [...turnMessages, { role: 'model', parts: modelParts }]

    const callResults = await Promise.all(functionCalls.map(async (fc) => {
      const tcId = `${fc.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      if (failures.shouldSkip(fc.name)) {
        return { fc, tcId, resultStr: `Skipped: tool "${fc.name}" failed too many times this session.` }
      }
      try {
        const params = fc.args.options ? { raw: String(fc.args.options) } : undefined
        const result = await executeHexstrikeTool(settings.hexstrikeUrl, fc.name, String(fc.args.target ?? ''), params)
        const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        const resultStr = truncateForBudget(raw, budget)
        failures.reset(fc.name)
        return { fc, tcId, resultStr }
      } catch (err) {
        failures.record(fc.name)
        const msg = err instanceof Error ? err.message : String(err)
        return { fc, tcId, resultStr: `Tool error: ${msg}` }
      }
    }))

    const functionResponseParts: unknown[] = []
    for (const { fc, tcId, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: tcId, name: fc.name, arguments: fc.args, status: 'running' } }
      yield { type: 'tool_result', toolCallId: tcId, result: resultStr }
      functionResponseParts.push({ functionResponse: { name: fc.name, response: { content: resultStr } } })
    }
    turnMessages = [...turnMessages, { role: 'user', parts: functionResponseParts }]
  }

  yield { type: 'done' }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(msg: Message): number {
  let tokens = estimateTokens(msg.content)
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(tc.name) + estimateTokens(JSON.stringify(tc.arguments)) + 20
      if (tc.result) tokens += estimateTokens(tc.result)
    }
  }
  return tokens
}

function trimMessagesToFit(
  messages: Message[],
  systemPrompt: string,
  contextWindow: number,
  maxTokens: number
): Message[] {
  const systemTokens = estimateTokens(systemPrompt)
  const availableForMessages = contextWindow - systemTokens - maxTokens - 500

  let totalTokens = 0
  const toKeep: Message[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i])
    if (totalTokens + msgTokens > availableForMessages) {
      if (toKeep.length === 0 && msgTokens > availableForMessages) {
        const maxContentTokens = availableForMessages - 100
        const maxContentChars = maxContentTokens * 4
        toKeep.push({
          ...messages[i],
          content: messages[i].content.slice(-maxContentChars) + '... [truncated]',
        })
      }
      break
    }
    totalTokens += msgTokens
    toKeep.unshift(messages[i])
  }

  if (toKeep.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    toKeep.push(lastMsg)
  }

  return toKeep
}

export async function* streamChat(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  if (!settings.model) {
    yield { type: 'error', error: 'No model selected — go to ⚙ Settings to configure your AI provider.' }
    return
  }
  if (!settings.apiKey && settings.provider !== Provider.lmstudio && settings.provider !== Provider.ollama) {
    yield { type: 'error', error: `No API key set for ${settings.provider} — go to ⚙ Settings to add your key.` }
    return
  }

  const trimmedMessages = trimMessagesToFit(
    messages,
    settings.systemPrompt,
    settings.contextWindow,
    settings.maxTokens
  )

  try {
    switch (settings.provider) {
      case Provider.anthropic: yield* anthropicStream(settings, trimmedMessages, tools, signal); break
      case Provider.google:    yield* googleStream(settings, trimmedMessages, tools, signal); break
      default:                 yield* openAIStream(settings, trimmedMessages, tools, signal); break
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      yield { type: 'error', error: 'Stopped by user.' }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
      yield { type: 'error', error: `Cannot reach ${settings.provider} API. Check your internet connection or base URL in Settings.` }
    } else {
      yield { type: 'error', error: msg }
    }
  }
}

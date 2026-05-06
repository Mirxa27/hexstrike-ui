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

// Maximum agent rounds (P3-10). Higher than the previous 10 because the
// reflective loop legitimately needs more turns; the FailureTracker
// guards against runaway tool-spam.
const MAX_AGENT_ROUNDS = 25

/**
 * Compute the per-tool-result token budget. We aim to keep no more
 * than ~40% of the model's context window occupied by tool output so
 * there's room for the model's final response.
 */
function toolResultBudget(settings: AISettings): number {
  const cw = settings.contextWindow || 128_000
  return Math.max(2000, Math.floor((cw * 0.4) / 4)) // chars budget, then tokens
}

// ─── Tool name validation ────────────────────────────────────────────────────
// All providers require function names matching ^[a-zA-Z0-9_-]{1,64}$

const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

function sanitizeTools(tools: HexstrikeTool[]): HexstrikeTool[] {
  return tools.filter((t) => VALID_TOOL_NAME.test(t.name)).slice(0, 64)
}

// ─── Tool definition helpers ─────────────────────────────────────────────────
// Lean schema — no nested optional objects that strict providers reject.

function buildOpenAITools(tools: HexstrikeTool[]) {
  return tools.map((t) => {
    // Enhance description with usage guidance
    let enhancedDescription = t.description

    // Add category context to description
    const category = t.category.toLowerCase()
    if (category.includes('osint') || category.includes('reconnaissance')) {
      enhancedDescription += ` Use for passive intelligence gathering and target discovery.`
    } else if (category.includes('web') || category.includes('application')) {
      enhancedDescription += ` Use for web application security testing and vulnerability assessment.`
    } else if (category.includes('vuln') || category.includes('exploitation')) {
      enhancedDescription += ` Use for vulnerability scanning and security testing.`
    } else if (category.includes('password') || category.includes('brute')) {
      enhancedDescription += ` Use for password auditing and authentication testing.`
    } else if (category.includes('forensic') || category.includes('analysis')) {
      enhancedDescription += ` Use for file analysis and digital forensics.`
    }

    return {
      type: 'function',
      function: {
        name: t.name,
        description: enhancedDescription,
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target hostname, IP address, URL, or file path' },
            options: { type: 'string', description: 'Additional tool options or parameters (e.g., "--threads 50", "-p-")' },
          },
          required: ['target'],
        },
      },
    }
  })
}

function buildAnthropicTools(tools: HexstrikeTool[]) {
  return tools.map((t) => {
    // Enhance description with usage guidance
    let enhancedDescription = t.description
    const category = t.category.toLowerCase()
    if (category.includes('osint') || category.includes('reconnaissance')) {
      enhancedDescription += ` Use for passive intelligence gathering and target discovery.`
    } else if (category.includes('web') || category.includes('application')) {
      enhancedDescription += ` Use for web application security testing and vulnerability assessment.`
    } else if (category.includes('vuln') || category.includes('exploitation')) {
      enhancedDescription += ` Use for vulnerability scanning and security testing.`
    } else if (category.includes('password') || category.includes('brute')) {
      enhancedDescription += ` Use for password auditing and authentication testing.`
    } else if (category.includes('forensic') || category.includes('analysis')) {
      enhancedDescription += ` Use for file analysis and digital forensics.`
    }

    return {
      name: t.name,
      description: enhancedDescription,
      input_schema: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Target hostname, IP address, URL, or file path' },
          options: { type: 'string', description: 'Additional tool options or parameters' },
        },
        required: ['target'],
      },
    }
  })
}

function buildGoogleTools(tools: HexstrikeTool[]) {
  return [{
    functionDeclarations: tools.map((t) => {
      // Enhance description with usage guidance
      let enhancedDescription = t.description
      const category = t.category.toLowerCase()
      if (category.includes('osint') || category.includes('reconnaissance')) {
        enhancedDescription += ` Use for passive intelligence gathering and target discovery.`
      } else if (category.includes('web') || category.includes('application')) {
        enhancedDescription += ` Use for web application security testing and vulnerability assessment.`
      } else if (category.includes('vuln') || category.includes('exploitation')) {
        enhancedDescription += ` Use for vulnerability scanning and security testing.`
      } else if (category.includes('password') || category.includes('brute')) {
        enhancedDescription += ` Use for password auditing and authentication testing.`
      } else if (category.includes('forensic') || category.includes('analysis')) {
        enhancedDescription += ` Use for file analysis and digital forensics.`
      }

      return {
        name: t.name,
        description: enhancedDescription,
        parameters: {
          type: 'OBJECT',
          properties: {
            target: { type: 'STRING', description: 'Target hostname, IP address, URL, or file path' },
            options: { type: 'STRING', description: 'Additional tool options or parameters' },
          },
          required: ['target'],
        },
      }
    }),
  }]
}

// ─── SSE stream parser ────────────────────────────────────────────────────────

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

// ─── Provider base URL resolution ────────────────────────────────────────────

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

// ─── Error body parser ────────────────────────────────────────────────────────

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const j = JSON.parse(text)
      // Common error shapes: {error: {message}}, {message}, {detail}
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

// ─── OpenAI-compatible streaming engine ──────────────────────────────────────
// Covers: openai, groq, mistral, lmstudio, ollama, custom
// Auto-retries without tools on 400 (provider doesn't support function calling).

async function* openAIStream(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const base = resolveBase(settings)
  const openAIMessages = buildOpenAIMessages(settings, messages)
  const safeTools = sanitizeTools(tools)
  let toolDefs = safeTools.length ? buildOpenAITools(safeTools) : undefined
  let withTools = !!toolDefs

  let turnMessages: any[] = [...openAIMessages]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const body: Record<string, any> = {
      model: settings.model,
      messages: turnMessages,
      temperature: settings.temperature,
      stream: true,
    }
    // Some providers use max_completion_tokens, others max_tokens — send both.
    body.max_tokens = settings.maxTokens
    body.max_completion_tokens = settings.maxTokens

    // Reasoning models (o1/o3) — surface effort knob (P3-8).
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

    // 400 with tools → retry bare (many providers don't support function calling)
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
      let chunk: any
      try { chunk = JSON.parse(raw) } catch { continue }
      if (chunk.error) {
        yield { type: 'error', error: chunk.error.message ?? JSON.stringify(chunk.error) }
        return
      }
      const usage = readUsageFromChunk(chunk)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if (delta.content) {
        assistantText += delta.content
        yield { type: 'text', content: delta.content }
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!pendingToolCalls[idx]) pendingToolCalls[idx] = { id: '', name: '', argsRaw: '' }
          if (tc.id) pendingToolCalls[idx].id = tc.id
          if (tc.function?.name) pendingToolCalls[idx].name += tc.function.name
          if (tc.function?.arguments) pendingToolCalls[idx].argsRaw += tc.function.arguments
        }
      }
    }

    const toolCallList = Object.values(pendingToolCalls)
    if (!toolCallList.length) break

    // Append assistant turn with tool_calls
    turnMessages = [...turnMessages, {
      role: 'assistant',
      content: assistantText || null,
      tool_calls: toolCallList.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argsRaw },
      })),
    }]

    // Execute tool calls in parallel (P3-4). The provider may emit
    // multiple calls in one response; running them serially throws away
    // that opportunity for concurrency.
    const callResults = await Promise.all(toolCallList.map(async (tc) => {
      let args: Record<string, any> = {}
      try { args = JSON.parse(tc.argsRaw) } catch { args = {} }
      const callId = tc.id || String(Date.now())

      // Backoff guard (P3-10)
      if (failures.shouldSkip(tc.name)) {
        return { tc, callId, args, resultStr: `Skipped: tool "${tc.name}" failed too many times this session.` }
      }

      try {
        const result = await executeHexstrikeTool(
          settings.hexstrikeUrl,
          tc.name,
          args.target ?? '',
          args.options ? { raw: args.options } : undefined
        )
        const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        const resultStr = truncateForBudget(raw, budget)
        failures.reset(tc.name)
        return { tc, callId, args, resultStr }
      } catch (err: any) {
        failures.record(tc.name)
        return { tc, callId, args, resultStr: `Tool error: ${err?.message ?? String(err)}` }
      }
    }))

    // Yield events in submission order so the UI renders the tool cards
    // in the same order the provider asked for them.
    for (const { tc, callId, args, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: callId, name: tc.name, arguments: args, status: 'running' } }
      yield { type: 'tool_result', toolCallId: callId, result: resultStr }
      turnMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr } as any)
    }
  }

  yield { type: 'done' }
}

// ─── Anthropic streaming engine ───────────────────────────────────────────────

async function* anthropicStream(
  settings: AISettings,
  messages: Message[],
  tools: HexstrikeTool[],
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const systemPrompt = settings.systemPrompt || 'You are HexStrike AI, an advanced cybersecurity assistant.'
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const safeTools = sanitizeTools(tools)
  const toolDefs = safeTools.length ? buildAnthropicTools(safeTools) : undefined
  let turnMessages: any[] = [...anthropicMessages]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const body: any = {
      model: settings.model,
      max_tokens: settings.maxTokens,
      system: systemPrompt,
      messages: turnMessages,
      stream: true,
    }
    if (toolDefs?.length) body.tools = toolDefs
    // Claude reasoning models: enable extended thinking but keep deltas hidden
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
      let event: any
      try { event = JSON.parse(raw) } catch { continue }
      const evType = event.type
      if (!evType) continue

      const usage = readUsageFromChunk(event)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }

      if (evType === 'content_block_start') {
        const block = event.content_block
        if (block?.type === 'tool_use') {
          currentToolId = block.id
          pendingToolCalls[block.id] = { id: block.id, name: block.name, inputRaw: '' }
        }
      } else if (evType === 'content_block_delta') {
        const delta = event.delta
        if (delta?.type === 'text_delta') {
          assistantText += delta.text
          yield { type: 'text', content: delta.text }
        } else if (delta?.type === 'input_json_delta' && currentToolId) {
          pendingToolCalls[currentToolId].inputRaw += delta.partial_json
        }
        // delta.type === 'thinking_delta' is intentionally not surfaced —
        // reasoning tokens stay hidden behind the "Show reasoning" toggle.
      } else if (evType === 'message_stop') {
        break
      } else if (evType === 'error') {
        yield { type: 'error', error: event.error?.message ?? 'Anthropic stream error' }
        return
      }
    }

    const toolCallList = Object.values(pendingToolCalls)
    if (!toolCallList.length) break

    const assistantContent: any[] = []
    if (assistantText) assistantContent.push({ type: 'text', text: assistantText })
    for (const tc of toolCallList) {
      let input: any = {}
      try { input = JSON.parse(tc.inputRaw) } catch { input = {} }
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
    }
    turnMessages = [...turnMessages, { role: 'assistant', content: assistantContent }]

    // Parallel tool execution (P3-4)
    const callResults = await Promise.all(toolCallList.map(async (tc) => {
      let args: Record<string, any> = {}
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
      } catch (err: any) {
        failures.record(tc.name)
        return { tc, args, resultStr: `Tool error: ${err?.message ?? String(err)}` }
      }
    }))

    const toolResultContent: any[] = []
    for (const { tc, args, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: tc.id, name: tc.name, arguments: args, status: 'running' } }
      yield { type: 'tool_result', toolCallId: tc.id, result: resultStr }
      toolResultContent.push({ type: 'tool_result', tool_use_id: tc.id, content: resultStr })
    }
    turnMessages = [...turnMessages, { role: 'user', content: toolResultContent }]
  }

  yield { type: 'done' }
}

// ─── Google Gemini streaming engine ──────────────────────────────────────────

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
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))

  const safeTools = sanitizeTools(tools)
  const toolDefs = safeTools.length ? buildGoogleTools(safeTools) : undefined
  let turnMessages: any[] = [...geminiMessages]
  const failures = new FailureTracker()
  const budget = toolResultBudget(settings)

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const body: any = {
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
    const functionCalls: Array<{ name: string; args: any }> = []

    for await (const raw of streamSSE(res)) {
      let chunk: any
      try { chunk = JSON.parse(raw) } catch { continue }
      const usage = readUsageFromChunk(chunk)
      if (usage) yield { type: 'usage', usage: { in: usage.in || 0, out: usage.out || 0 } }
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) { assistantText += part.text; yield { type: 'text', content: part.text } }
        if (part.functionCall) functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} })
      }
    }

    if (!functionCalls.length) break

    const modelParts: any[] = []
    if (assistantText) modelParts.push({ text: assistantText })
    for (const fc of functionCalls) modelParts.push({ functionCall: { name: fc.name, args: fc.args } })
    turnMessages = [...turnMessages, { role: 'model', parts: modelParts }]

    // Parallel execution (P3-4)
    const callResults = await Promise.all(functionCalls.map(async (fc) => {
      const tcId = `${fc.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      if (failures.shouldSkip(fc.name)) {
        return { fc, tcId, resultStr: `Skipped: tool "${fc.name}" failed too many times this session.` }
      }
      try {
        const params = fc.args.options ? { raw: String(fc.args.options) } : undefined
        const result = await executeHexstrikeTool(settings.hexstrikeUrl, fc.name, fc.args.target ?? '', params)
        const raw = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        const resultStr = truncateForBudget(raw, budget)
        failures.reset(fc.name)
        return { fc, tcId, resultStr }
      } catch (err: any) {
        failures.record(fc.name)
        return { fc, tcId, resultStr: `Tool error: ${err?.message ?? String(err)}` }
      }
    }))

    const functionResponseParts: any[] = []
    for (const { fc, tcId, resultStr } of callResults) {
      yield { type: 'tool_call', toolCall: { id: tcId, name: fc.name, arguments: fc.args, status: 'running' } }
      yield { type: 'tool_result', toolCallId: tcId, result: resultStr }
      functionResponseParts.push({ functionResponse: { name: fc.name, response: { result: resultStr } } })
    }
    turnMessages = [...turnMessages, { role: 'user', parts: functionResponseParts }]
  }

  yield { type: 'done' }
}

// ─── System message builder ───────────────────────────────────────────────────

function buildOpenAIMessages(settings: AISettings, messages: Message[]): any[] {
  const result: any[] = []
  if (settings.systemPrompt) result.push({ role: 'system', content: settings.systemPrompt })
  for (const msg of messages) {
    if (msg.role === 'system') continue
    result.push({ role: msg.role, content: msg.content })
  }
  return result
}

// ─── Public entry point ───────────────────────────────────────────────────────

// ─── Token estimation & context trimming ───────────────────────────────────────
// Rough token estimation: ~4 chars per token for English text

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
  // Reserve space for system prompt and max output tokens
  const systemTokens = estimateTokens(systemPrompt)
  const availableForMessages = contextWindow - systemTokens - maxTokens - 500 // 500 buffer

  let totalTokens = 0
  const toKeep: Message[] = []

  // Keep messages in reverse order (newest first) until we hit the limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i])
    if (totalTokens + msgTokens > availableForMessages) {
      // If this single message is too big, truncate it
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

  // Always keep at least the last user message
  if (toKeep.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    toKeep.push(lastMsg)
  }

  return toKeep
}

// ─── Public entry point ───────────────────────────────────────────────────────

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

  // Trim messages to fit within context window
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
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      yield { type: 'error', error: 'Stopped by user.' }
      return
    }
    const msg = err?.message ?? String(err)
    // Translate browser network errors into actionable messages
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
      yield { type: 'error', error: `Cannot reach ${settings.provider} API. Check your internet connection or base URL in Settings.` }
    } else {
      yield { type: 'error', error: msg }
    }
  }
}

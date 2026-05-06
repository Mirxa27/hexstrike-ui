/**
 * Advanced agent helpers.
 *
 * Centralises LLM-backed planning, inter-step variable piping,
 * token-budget truncation, entity extraction (used by the persistent
 * scratchpad), reasoning-model detection, and a small backoff helper —
 * all the cross-cutting building blocks the autonomous loop and the
 * chat engine need but that don't have a natural home elsewhere.
 */

import type { AISettings, HexstrikeTool, ToolExecution } from './types'
import { Provider } from './types'

// ─── Reasoning-model detection (P3-8) ──────────────────────────────────────

/** True for OpenAI `o1*` / `o3*` reasoning models and Anthropic `*-thinking`. */
export function isReasoningModel(model: string): boolean {
  if (!model) return false
  const m = model.toLowerCase()
  return (
    /^o[13](-|$)/.test(m) ||
    /thinking/.test(m) ||
    /^claude-.*-thinking/.test(m)
  )
}

/**
 * Suggest a `reasoning_effort` value for OpenAI reasoning models based on
 * the user's temperature slider (lower temp → less effort, higher → more).
 */
export function suggestReasoningEffort(settings: AISettings): 'low' | 'medium' | 'high' | undefined {
  if (!isReasoningModel(settings.model)) return undefined
  const t = settings.temperature ?? 0.7
  if (t <= 0.3) return 'low'
  if (t <= 0.8) return 'medium'
  return 'high'
}

// ─── Token-budget aware truncation (P3-5) ──────────────────────────────────

/** Cheap heuristic: ~4 chars per token. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate a long tool output so the model gets a useful summary without
 * blowing the context window. We keep the head + tail and replace the
 * middle with a `[…N bytes elided…]` marker — this preserves both the
 * "what was the command" preamble and the "exit code / final summary"
 * tail that real CLI tools tend to produce.
 */
export function truncateForBudget(text: string, maxTokens: number): string {
  if (!text) return text
  const tokens = approxTokens(text)
  if (tokens <= maxTokens) return text

  const maxChars = Math.max(800, maxTokens * 4)
  const headChars = Math.floor(maxChars * 0.6)
  const tailChars = Math.max(200, maxChars - headChars - 80)
  const head = text.slice(0, headChars)
  const tail = text.slice(-tailChars)
  const elided = text.length - head.length - tail.length
  return `${head}\n\n[…${elided.toLocaleString()} chars elided to fit context budget…]\n\n${tail}`
}

// ─── Entity extraction (P3-3 piping & P3-6 scratchpad) ─────────────────────

export interface ExtractedEntities {
  domains: string[]
  subdomains: string[]
  ips: string[]
  urls: string[]
  emails: string[]
  cves: string[]
  hashes: string[]
  ports: number[]
}

const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const URL_RE = /https?:\/\/[^\s)<>"']+/gi
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const CVE_RE = /\bCVE-\d{4}-\d{4,7}\b/gi
const HASH_RE = /\b[a-f0-9]{32,64}\b/gi
const PORT_RE = /\b(\d{1,5})\/(?:tcp|udp)\s+open/gi

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

export function extractEntities(text: string): ExtractedEntities {
  if (!text || typeof text !== 'string') {
    return { domains: [], subdomains: [], ips: [], urls: [], emails: [], cves: [], hashes: [], ports: [] }
  }
  const domainsRaw = uniq((text.match(DOMAIN_RE) || []).map((d) => d.toLowerCase()))
  const ips = uniq(text.match(IP_RE) || [])
  const urls = uniq(text.match(URL_RE) || [])
  const emails = uniq((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))
  const cves = uniq((text.match(CVE_RE) || []).map((c) => c.toUpperCase()))
  const hashes = uniq((text.match(HASH_RE) || []).map((h) => h.toLowerCase()))
  const ports: number[] = []
  let m: RegExpExecArray | null
  PORT_RE.lastIndex = 0
  while ((m = PORT_RE.exec(text)) !== null) {
    const p = Number(m[1])
    if (p > 0 && p < 65536 && !ports.includes(p)) ports.push(p)
  }

  // Subdomains = domains with > 2 labels
  const subdomains = domainsRaw.filter((d) => d.split('.').length >= 3)
  const domains = domainsRaw.filter((d) => d.split('.').length === 2)

  return { domains, subdomains, ips, urls, emails, cves, hashes, ports }
}

/** Merge two scratchpads, deduping each list. */
export function mergeEntities(a: ExtractedEntities, b: ExtractedEntities): ExtractedEntities {
  return {
    domains: uniq([...a.domains, ...b.domains]),
    subdomains: uniq([...a.subdomains, ...b.subdomains]),
    ips: uniq([...a.ips, ...b.ips]),
    urls: uniq([...a.urls, ...b.urls]),
    emails: uniq([...a.emails, ...b.emails]),
    cves: uniq([...a.cves, ...b.cves]),
    hashes: uniq([...a.hashes, ...b.hashes]),
    ports: Array.from(new Set([...a.ports, ...b.ports])).sort((x, y) => x - y),
  }
}

export function emptyScratchpad(): ExtractedEntities {
  return { domains: [], subdomains: [], ips: [], urls: [], emails: [], cves: [], hashes: [], ports: [] }
}

// ─── Inter-step variable piping (P3-3) ─────────────────────────────────────

/**
 * Substitute `${prev.<tool>.<field>}` and `${entities.<field>}` references
 * inside a string. Lookups are case-insensitive and missing values resolve
 * to an empty string (the engine will skip steps that depend on missing
 * variables).
 *
 * Examples:
 *   "${prev.subfinder_enum.subdomains}" → "a.x.com,b.x.com,c.x.com"
 *   "${entities.ips[0]}"                → "10.0.0.1"
 */
export function substituteVariables(
  template: string,
  context: { prev: Record<string, ExtractedEntities>; entities: ExtractedEntities }
): { value: string; missing: string[] } {
  if (typeof template !== 'string' || !template.includes('${')) {
    return { value: template, missing: [] }
  }
  const missing: string[] = []
  const value = template.replace(/\$\{([^}]+)\}/g, (_, raw: string) => {
    const path = raw.trim().split('.')
    let scope: any
    if (path[0] === 'prev') {
      const tool = path[1]
      const field = path[2]
      scope = context.prev[tool]?.[field as keyof ExtractedEntities]
    } else if (path[0] === 'entities') {
      const idxMatch = path[1]?.match(/^([a-z]+)(?:\[(\d+)\])?$/i)
      if (!idxMatch) {
        missing.push(raw)
        return ''
      }
      const field = idxMatch[1] as keyof ExtractedEntities
      const idx = idxMatch[2] !== undefined ? Number(idxMatch[2]) : null
      const arr = context.entities[field] as any[] | undefined
      scope = idx !== null ? arr?.[idx] : arr
    } else {
      missing.push(raw)
      return ''
    }
    if (scope === undefined || scope === null) {
      missing.push(raw)
      return ''
    }
    if (Array.isArray(scope)) return scope.slice(0, 32).join(',')
    return String(scope)
  })
  return { value, missing }
}

// ─── Backoff guard for repeated tool failures (P3-10) ──────────────────────

export class FailureTracker {
  private failures = new Map<string, number>()

  record(tool: string): number {
    const next = (this.failures.get(tool) || 0) + 1
    this.failures.set(tool, next)
    return next
  }

  reset(tool: string) { this.failures.delete(tool) }

  /** Should we skip this tool because it has failed too many times? */
  shouldSkip(tool: string, threshold = 3): boolean {
    return (this.failures.get(tool) || 0) >= threshold
  }

  /** Exponential backoff in ms, capped at 30 s. */
  backoffMs(tool: string): number {
    const n = this.failures.get(tool) || 0
    return Math.min(30000, 500 * Math.pow(2, n))
  }
}

// ─── LLM-backed planner (P3-1) ─────────────────────────────────────────────

export interface LLMPlanStep {
  step: number
  tool: string
  target: string
  options?: string
  reason: string
  dependsOn?: number[]
}

export interface LLMScanPlan {
  target: string
  strategy: string
  steps: LLMPlanStep[]
}

const PLANNER_SYSTEM = `You are HexStrike's autonomous scan planner.
Your job is to produce a JSON execution plan for a security assessment task.
Respond with ONLY a JSON object — no markdown fences, no commentary — matching this schema:

{
  "strategy": "<one paragraph describing the methodology>",
  "steps": [
    {
      "step": 1,
      "tool": "<exact tool name from availableTools>",
      "target": "<the target string, or a \\\${prev.<tool>.<field>} reference>",
      "options": "<optional flags, e.g. '-p- --top-ports 1000'>",
      "reason": "<one sentence>",
      "dependsOn": [<step numbers this step needs>]
    }
  ]
}

Rules:
- Use ONLY tool names that appear in the availableTools list. Never invent.
- Order steps so reconnaissance precedes exploitation.
- Reference prior step output via \\\${prev.<tool>.<field>} where field is one of:
  domains, subdomains, ips, urls, emails, cves, hashes, ports.
- Keep the plan focused: 4–10 steps is ideal.
- Output must parse with JSON.parse — no trailing commas, no comments.`

/**
 * Ask the configured LLM to produce a structured scan plan. Returns null
 * on any failure (no API key, network error, malformed JSON) — callers
 * should fall back to the heuristic planner in `aiAgent.ts`.
 */
export async function planWithLLM(
  settings: AISettings,
  target: string,
  availableTools: HexstrikeTool[],
  signal?: AbortSignal
): Promise<LLMScanPlan | null> {
  if (!settings.apiKey && settings.provider !== Provider.lmstudio && settings.provider !== Provider.ollama) {
    return null
  }
  if (!settings.model) return null

  // Compact tool catalog: name + first 80 chars of description.
  const catalog = availableTools.slice(0, 200).map((t) => ({
    name: t.name,
    category: t.category,
    description: (t.description || '').slice(0, 80),
  }))

  const userPrompt = `Target: ${target}

availableTools (${catalog.length}):
${JSON.stringify(catalog)}

Produce the JSON plan now.`

  try {
    const text = await singleShotCompletion(settings, PLANNER_SYSTEM, userPrompt, signal)
    if (!text) return null
    const parsed = parsePlanJSON(text)
    if (!parsed) return null
    // Filter out steps that reference unknown tools — defence-in-depth.
    const validNames = new Set(availableTools.map((t) => t.name))
    parsed.steps = parsed.steps.filter((s) => validNames.has(s.tool))
    if (!parsed.steps.length) return null
    parsed.target = target
    return parsed
  } catch {
    return null
  }
}

function parsePlanJSON(text: string): LLMScanPlan | null {
  // Try direct parse first; otherwise extract the first {...} block.
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj?.steps)) return obj as LLMScanPlan
  } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0])
    if (Array.isArray(obj?.steps)) return obj as LLMScanPlan
  } catch { /* ignore */ }
  return null
}

/**
 * Minimal one-shot completion that works across the OpenAI-compatible
 * providers we support. Anthropic / Google use slightly different bodies
 * but for the planning use-case OpenAI-shaped requests are sufficient
 * because (a) we only target accounts that have one of these set up,
 * and (b) the planner accepts text-out only.
 */
async function singleShotCompletion(
  settings: AISettings,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  const provider = settings.provider

  if (provider === Provider.anthropic) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  }

  if (provider === Provider.google) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  }

  // OpenAI-compatible
  const base = (settings.baseUrl || defaultBaseFor(provider)).replace(/\/+$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  }
  const effort = suggestReasoningEffort(settings)
  if (effort) body.reasoning_effort = effort
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? null
}

function defaultBaseFor(provider: Provider): string {
  switch (provider) {
    case Provider.openai:   return 'https://api.openai.com/v1'
    case Provider.groq:     return 'https://api.groq.com/openai/v1'
    case Provider.mistral:  return 'https://api.mistral.ai/v1'
    case Provider.lmstudio: return 'http://localhost:1234/v1'
    case Provider.ollama:   return 'http://localhost:11434/v1'
    default:                return ''
  }
}

// ─── Token usage accumulator (P3-9) ────────────────────────────────────────

export interface TokenUsage {
  in: number
  out: number
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return { in: a.in + (b.in || 0), out: a.out + (b.out || 0) }
}

/** Extract token usage from a provider response payload (best-effort). */
export function readUsageFromChunk(chunk: any): Partial<TokenUsage> | null {
  if (!chunk) return null
  // OpenAI / OpenAI-compatible: {usage: {prompt_tokens, completion_tokens}}
  if (chunk.usage) {
    return {
      in: chunk.usage.prompt_tokens || chunk.usage.input_tokens || 0,
      out: chunk.usage.completion_tokens || chunk.usage.output_tokens || 0,
    }
  }
  // Anthropic message_delta carries usage on usage.* under message_start
  if (chunk.message?.usage) {
    return { in: chunk.message.usage.input_tokens || 0, out: chunk.message.usage.output_tokens || 0 }
  }
  // Anthropic delta event
  if (chunk.type === 'message_delta' && chunk.usage) {
    return { in: chunk.usage.input_tokens || 0, out: chunk.usage.output_tokens || 0 }
  }
  // Gemini
  if (chunk.usageMetadata) {
    return { in: chunk.usageMetadata.promptTokenCount || 0, out: chunk.usageMetadata.candidatesTokenCount || 0 }
  }
  return null
}

// ─── Build entities-by-tool view from prior executions (P3-3) ──────────────

export function entitiesByTool(executions: ToolExecution[]): Record<string, ExtractedEntities> {
  const out: Record<string, ExtractedEntities> = {}
  for (const exec of executions) {
    if (!exec.result) continue
    const entities = extractEntities(exec.result)
    out[exec.toolName] = out[exec.toolName]
      ? mergeEntities(out[exec.toolName], entities)
      : entities
  }
  return out
}

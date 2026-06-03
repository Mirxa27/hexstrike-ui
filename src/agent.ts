
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
    let scope: string | number | string[] | number[] | undefined
    if (path[0] === 'prev') {
      // Tool keys in `context.prev` are normalized to lowercase (see
      // entitiesByTool) so `${prev.Subfinder_Enum.subdomains}` resolves the
      // same as `${prev.subfinder_enum.subdomains}`.
      const tool = path[1]?.toLowerCase()
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
       const arr = context.entities[field] as string[] | number[] | undefined
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
- For email or username targets, prefer OSINT, breach, and social-footprint tools before aggressive network exploitation when the task is identity-focused.
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

/** A plan is only usable if every step has at least a tool, target, and reason. */
function isValidPlanShape(record: Record<string, unknown> | null | undefined): record is Record<string, unknown> {
  if (!record || !Array.isArray(record.steps) || record.steps.length === 0) return false
  return record.steps.every((s) => {
    const step = s as Record<string, unknown>
    return (
      step != null &&
      typeof step.tool === 'string' && step.tool.trim().length > 0 &&
      typeof step.target === 'string' &&
      typeof step.reason === 'string'
    )
  })
}

function parsePlanJSON(text: string): LLMScanPlan | null {
  // Try direct parse first; otherwise extract the first {...} block.
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  }
  try {
    const record = JSON.parse(raw) as Record<string, unknown>
    if (isValidPlanShape(record)) return record as unknown as LLMScanPlan
  } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const record = JSON.parse(m[0]) as Record<string, unknown>
    if (isValidPlanShape(record)) return record as unknown as LLMScanPlan
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
    const data = await res.json() as Record<string, unknown>
    const content = data.content as Array<Record<string, unknown>> | undefined
    return content?.[0]?.text as string | null ?? null
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
    const data = await res.json() as Record<string, unknown>
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined
    const firstCandidate = candidates?.[0] as Record<string, unknown> | undefined
    const content = firstCandidate?.content as Record<string, unknown> | undefined
    const parts = content?.parts as Array<Record<string, unknown>> | undefined
    return parts?.[0]?.text as string | null ?? null
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
  const data = await res.json() as Record<string, unknown>
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const message = choices?.[0]?.message as Record<string, unknown> | undefined
  return message?.content as string | null ?? null
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
export function readUsageFromChunk(chunk: unknown): Partial<TokenUsage> | null {
  if (!chunk) return null
  const c = chunk as Record<string, unknown>
  // OpenAI / OpenAI-compatible: {usage: {prompt_tokens, completion_tokens}}
  if (c.usage) {
    const u = c.usage as Record<string, unknown>
    return {
      in: (u.prompt_tokens || u.input_tokens || 0) as number,
      out: (u.completion_tokens || u.output_tokens || 0) as number,
    }
  }
  // Anthropic message_delta carries usage on usage.* under message_start
  if (c.message && typeof c.message === 'object') {
    const m = c.message as Record<string, unknown>
    if (m.usage) {
      const u = m.usage as Record<string, unknown>
      return { in: (u.input_tokens || 0) as number, out: (u.output_tokens || 0) as number }
    }
  }
  // Anthropic delta event
  if (c.type === 'message_delta' && c.usage) {
    const u = c.usage as Record<string, unknown>
    return { in: (u.input_tokens || 0) as number, out: (u.output_tokens || 0) as number }
  }
  // Gemini
  if (c.usageMetadata) {
    const meta = c.usageMetadata as Record<string, unknown>
    return {
      in: (meta.promptTokenCount || 0) as number,
      out: (meta.candidatesTokenCount || 0) as number,
    }
  }
  return null
}

// ─── Build entities-by-tool view from prior executions (P3-3) ──────────────

export function entitiesByTool(executions: ToolExecution[]): Record<string, ExtractedEntities> {
  const out: Record<string, ExtractedEntities> = {}
  for (const exec of executions) {
    if (!exec.result) continue
    // Normalize the key so `${prev.<tool>...}` lookups are case-insensitive.
    const key = exec.toolName.toLowerCase()
    const entities = extractEntities(exec.result)
    out[key] = out[key] ? mergeEntities(out[key], entities) : entities
  }
  return out
}

// ─── Tool Installation & Build Support (P4-New) ────────────────────────

export interface ToolInstallPlan {
  canInstall: boolean
  missingTools: string[]
  installCommand: string | null
  packageManager: 'apt' | 'apk' | 'pip' | 'pip3' | 'npm' | null
  recommendedPackages: string[]
}

/**
 * Analyze which tools from the desired list are missing from the
 * available tools catalog, and generate an installation plan.
 */
export function analyzeToolAvailability(
  desiredToolNames: string[],
  availableTools: HexstrikeTool[],
  backendHealth: Record<string, unknown> | null
): ToolInstallPlan {
  const availableNames = new Set(availableTools.map((t) => t.name.toLowerCase()))
  const missingTools = desiredToolNames.filter((name) => !availableNames.has(name.toLowerCase()))

   // Check backend health for package manager info
   const health = (backendHealth || {}) as Record<string, unknown>
   const packageManagers = health.package_managers as Record<string, unknown> | undefined
   const osType = health.os_type as string | undefined
   const hasApt = !!packageManagers?.apt || (typeof osType === 'string' && osType.includes('linux'))
   const hasApk = !!packageManagers?.apk || (typeof osType === 'string' && osType.includes('alpine'))
   const hasPip = !!packageManagers?.pip

  let packageManager: ToolInstallPlan['packageManager'] = null
  if (hasApt) packageManager = 'apt'
  else if (hasApk) packageManager = 'apk'
  else if (hasPip) packageManager = 'pip3'

// Map common tools to their package names
   const toolToPackage: Record<string, string> = {
     // Network reconnaissance
     'nmap': 'nmap',
     'masscan': 'masscan',
     'rustscan': 'rustscan',
     'naabu': 'naabu',
     'smap': 'smap',
     'netdiscover': 'netdiscover',
     'arp-scan': 'arp-scan',
     'zgrab': 'zgrab',
     'zgrab2': 'zgrab2',
     'massdns': 'massdns',
     'dnsgen': 'dnsgen',
     'amass': 'amass',
     'subfinder': 'subfinder',
     'assetfinder': 'assetfinder',
     'findomain': 'findomain',
      'shuffledns': 'shuffledns',
      'dnsx': 'dnsx',
      'chaos': 'chaos',
      'crobat': 'crobat',
      'dnsprobe': 'dnsprobe',
      'dnsrecon': 'dnsrecon',
      'dnsenum': 'dnsenum',
      'fierce': 'fierce',
      'knockpy': 'knockpy',
      'sublist3r': 'sublist3r',
      // Web vulnerability scanning
      'nikto': 'nikto',
      'nuclei': 'nuclei',
      'gobuster': 'gobuster',
      'ffuf': 'ffuf',
      'feroxbuster': 'feroxbuster',
      'dirsearch': 'dirsearch',
      'wfuzz': 'wfuzz',
      'burpsuite': 'burpsuite',
      'zaproxy': 'zaproxy',
      'wpscan': 'wpscan',
      'joomscan': 'joomscan',
      'dalfox': 'dalfox',
      'arjun': 'arjun',
      'sqlmap': 'sqlmap',
      'commix': 'commix',
      'xsser': 'xsser',
      'skipfish': 'skipfish',
      'w3af': 'w3af',
      'arachni': 'arachni',
      'katana': 'katana',
      'gospider': 'gospider',
      'hakrawler': 'hakrawler',
      'parameth': 'parameth',
      'xsstrike': 'xsstrike',
      // HTTP / API testing
      'httpx': 'httpx',
      'attacknarwhal': 'attacknarwhal',
      // Network exploitation / LAN
      'smbclient': 'smbclient',
      'smbmap': 'smbmap',
      'enum4linux': 'enum4linux',
      'crackmapexec': 'crackmapexec',
      'smbscan': 'smbscan',
      'impacket': 'python3-impacket',
      'responder': 'responder',
      'metasploit': 'metasploit-framework',
      'msfconsole': 'metasploit-framework',
      'msfvenom': 'metasploit-framework',
      // OSINT / Email
      'theharvester': 'theharvester',
      'holehe': 'holehe',
      'h8mail': 'h8mail',
      'hibp': 'haveibeenpwned',
      'emailrep': 'emailrep',
      'trufflehog': 'trufflehog',
      'gitleaks': 'gitleaks',
      'reconng': 'recon-ng',
      'spiderfoot': 'spiderfoot',
      // Social media / username discovery
      'sherlock': 'sherlock-project',
      'maigret': 'maigret',
      'social-analyzer': 'social-analyzer',
      'snoop': 'snoop.py',
      'whatsmyname': 'whatsmyname',
      'userrecon': 'userrecon',
      'blackbird': 'blackbird',
      'osintgram': 'osintgram',
      'toutatis': 'toutatis',
      'ghunt': 'ghunt',
      'photon': 'photon',
      'sn0int': 'sn0int',
      'sociolis': 'sociolis',
      'socialscan': 'socialscan',
      'inky': 'inky',
      'moriarty': 'moriarty',
      // Archive / history
      'archivebox': 'archivebox',
      // DNS / network tools
      'dnstwist': 'dnstwist',
      'mapcidr': 'mapcidr',
      'ipcalc': 'ipcalc',
      'prips': 'prips',
      'subbrute': 'subbrute',
      'brutespr': 'brutespr',
      'host': 'dnsutils',
      'dig': 'dnsutils',
      'whois': 'whois',
      // Password attacks
     'hashcat': 'hashcat',
     'john': 'john',
     'hydra': 'hydra',
     'medusa': 'medusa',
     'ncrack': 'ncrack',
     'crowbar': 'crowbar',
     'crunch': 'crunch',
     'cewl': 'cewl',
     'patator': 'patator',
     'hashid': 'hashid',
     'cupp': 'cupp',
     'wordlistctl': 'wordlistctl',
     'rsmangler': 'rsmangler',
     // Wireless / Bluetooth
     'aircrack': 'aircrack-ng',
     'wifite': 'wifite',
     'reaver': 'reaver',
     'kismet': 'kismet',
     'bettercap': 'bettercap',
     'hcxtools': 'hcxtools',
     'hcxdumptool': 'hcxdumptool',
     'wifiphisher': 'wifiphisher',
     'fluxion': 'fluxion',
     'evilginx2': 'evilginx',
     'ubertooth': 'ubertooth',
     'bluetooth': 'bluez',
     'bleah': 'bleah',
     'gatttool': 'bluez',
     // Forensics
     'binwalk': 'binwalk',
     'exiftool': 'exiftool',
     'volatility': 'volatility3',
     'autopsy': 'autopsy',
     'sleuthkit': 'sleuthkit',
     'foremost': 'foremost',
     'photorec': 'testdisk',
     'scalpel': 'scalpel',
     'bulk_extractor': 'bulk_extractor',
     'dd': 'coreutils',
     'dc3dd': 'dc3dd',
     'guymager': 'guymager',
     // Memory / debugging
     'gdb': 'gdb',
     'pwndbg': 'pwndbg',
     'gef': 'gef',
     'radare2': 'radare2',
     'r2pipe': 'r2pipe',
     'lldb': 'lldb',
     'edb-debugger': 'edb-debugger',
     // Binary analysis / RE
      // Binary analysis / RE
      'objdump': 'binutils',
      'strings': 'binutils',
      'readelf': 'binutils',
      'nm': 'binutils',
      'ida': 'ida-free',
      'ghidra': 'ghidra',
      'binaryninja': 'binaryninja',
      'cutter': 'cutter',
      'x64dbg': 'x64dbg',
      'ollydbg': 'ollydbg',
      // Source code analysis / SAST
      'semgrep': 'semgrep',
      'bandit': 'bandit',
      'pylint': 'pylint',
      'eslint': 'eslint',
      'brakeman': 'brakeman',
      'findsecbugs': 'findsecbugs',
      'spotbugs': 'spotbugs',
      'checkmarx': 'checkmarx',
      'sonarqube': 'sonarqube-scanner',
      'codeql': 'codeql',
      // Exploitation
      'beef': 'beef-xss',
      'empire': 'powershell-empire',
      'covenant': 'covenant',
      'sliver': 'sliver',
      'pwncat': 'pwncat',
      'pupy': 'pupy',
      'nishang': 'nishang',
      // Privilege escalation / post-ex
      'linenum': 'linenum',
      'linpeas': 'linpeas',
      'winpeas': 'winpeas',
      'lse': 'lse',
      'mimikatz': 'mimikatz',
      'powerup': 'powerup',
      'privesccheck': 'privesccheck',
      'beacon': 'cobaltstrike',
      // Windows enumeration
      'powerview': 'powerview',
      'bloodhound': 'bloodhound',
      'sharpcollect': 'sharpcollect',
      'adfind': 'adfind',
      'ldapsearch': 'ldap-utils',
      'rpcclient': 'samba',
      'net': 'samba',
      'wmic': 'wmi-client',
     // Container / K8s
     'docker': 'docker',
     'docker-compose': 'docker-compose',
     'kubectl': 'kubectl',
     'kubelet': 'kubelet',
     'kustomize': 'kustomize',
     'helm': 'helm',
     'trivy': 'trivy',
     'clair': 'clair',
     'anchore': 'anchore-cli',
     'kube-score': 'kube-score',
     'kubesec': 'kubesec',
     'kubescape': 'kubescape',
     'falco': 'falco',
     'sysdig': 'sysdig',
     'grype': 'grype',
     // Mobile / WhatsApp
     'mobsf': 'mobsf',
     'mobsf-android': 'mobsf',
     'mobsf-ios': 'mobsf',
     'drozer': 'drozer',
     'frida': 'frida-tools',
     'objection': 'objection',
     'apktool': 'apktool',
     'jadx': 'jadx',
     'dex2jar': 'dex2jar',
     'enjarify': 'enjarify',
     'whatsapp-parser': 'whatsapp-parser',
     'wasware': 'wasware',
     'wazzap': 'wazzap',
     'smsbug': 'smsbug',
     // Cloud security
     'aws-cli': 'awscli',
     'awscli': 'awscli',
     'gcp-cli': 'google-cloud-cli',
     'azure-cli': 'azure-cli',
     'pacu': 'pacu',
     'cloudsploit': 'cloudsploit',
     'scoutSuite': 'scout-suite',
     'prowler': 'prowler',
     'enumerate-iam': 'enumerate-iam',
     'pmapper': 'pmapper',
     'cfr': 'cfr',
     'kelly': 'kelly',
     // Reverse engineering / Malware
     'yara': 'yara',
     'yargen': 'yargen',
     'pescanner': 'pescanner',
     'peframe': 'peframe',
     'floss': 'floss',
     'stringsifter': 'stringsifter',
     'cape': 'cape',
     'viper': 'viper',
     // IoT / SCADA
     'boofuzz': 'boofuzz',
     'sulley': 'sulley',
     'autosploit': 'autosploit',
     'iot-toolkit': 'iot-toolkit',
     ' firmadyne': 'firmadyne',
     'firmwalker': 'firmwalker',
     'firmware-mod-kit': 'firmware-mod-kit',
     // SOC / IR
     'velociraptor': 'velociraptor',
     'osquery': 'osquery',
     'apt32': 'apt32',
     'timesketch': 'timesketch',
     'log2timeline': 'plaso',
     'plaso': 'plaso',
     'wireshark': 'wireshark',
     'tshark': 'wireshark',
     'tcpdump': 'tcpdump',
     'ngrep': 'ngrep',
     'suricata': 'suricata',
     'snort': 'snort',
     'zeek': 'zeek',
     'securityonion': 'securityonion',
     // Additional tools from Awesome Hacking
     // Fuzzing
     'afl': 'afl++',
     'libfuzzer': 'libfuzzer',
     'honggfuzz': 'honggfuzz',
     'pwndev': 'pwndev',
     // Malware Analysis
     'cape-sandbox': 'cape',
     'cuckoo': 'cuckoo',
     'maltrail': 'maltrail',
     'clamav': 'clamav',
     // Threat Intelligence
     'misp': 'misp',
     'opencti': 'opencti',
     'yeti': 'yeti',
     'anubis': 'anubis',
     // Red Teaming
     'sliver-c2': 'sliver',
     'mythic': 'mythic',
     'caldera': 'caldera',
     'atomic-red-team': 'atomic-red-team',
     // Steganography
     'steghide': 'steghide',
     'zsteg': 'zsteg',
     'stegsolve': 'stegsolve',
     'outguess': 'outguess',
     // Web Proxies
     'mitmproxy': 'mitmproxy',
     'proxychains': 'proxychains',
     // Payload Generation
     'venom': 'venom',
     'shellnoob': 'shellnoob',
     // Android Tools
     'adb': 'android-tools-adb',
     'androguard': 'androguard',
     // iOS Tools
     'ideviceinstaller': 'libimobiledevice',
     'cycript': 'cycript',
     // Network Analysis
     'netsniff-ng': 'netsniff-ng',
     'passivedns': 'passivedns',
     'dnschef': 'dnschef',
     // Password Analysis
     'hash-identifier': 'hash-identifier',
     'john-jumbo': 'john',
     // Social Engineering
     'set': 'set',
     'gophish': 'gophish',
     'king-phisher': 'king-phisher',
     // Wireless
     'reaver-wps': 'reaver',
     'pixiewps': 'pixiewps',
     // Hardware Hacking
     'urh': 'urh',
     'rtl-sdr': 'rtl-sdr',
     'gnuradio': 'gnuradio',
   }

  const recommendedPackages = missingTools
    .map((t) => toolToPackage[t.toLowerCase()] || t)
    .filter(Boolean)

  return {
    canInstall: packageManager !== null && recommendedPackages.length > 0,
    missingTools,
    installCommand: packageManager && recommendedPackages.length > 0
      ? `${packageManager}:${recommendedPackages.join(',')}`
      : null,
    packageManager,
    recommendedPackages,
  }
}

/**
 * Check if a tool execution result indicates the tool is missing/not found,
 * and if so, return the tool name for installation.
 */
export function detectMissingToolFromError(errorOutput: string): string | null {
  if (!errorOutput || typeof errorOutput !== 'string') return null

  const lower = errorOutput.toLowerCase()

  // Common patterns for "tool not found" errors
  const notFoundPatterns = [
    // "bash: nmap: command not found" or "nmap: command not found"
    /(\S+):\s*command not found/i,
    // "command not found: nmap" (less common ordering)
    /command not found:?\s*([a-zA-Z0-9_.-]+)/i,
    // "/usr/bin/nmap: no such file or directory"
    /(\S+):\s*no such file or directory/i,
    // "no such file or directory: /usr/bin/nmap"
    /no such file or directory:?\s*([a-zA-Z0-9_.\/-]+)/i,
    // "tool 'subfinder' not found" or "tool subfinder not found"
    /tool\s+'?([a-zA-Z0-9_.-]+)'?\s+not found/i,
    // "package 'nuclei' is not installed"
    /package\s+'?([a-zA-Z0-9_.-]+)'?\s+is not installed/i,
    // "nmap: not found" (e.g. Termux/Android)
    /([a-zA-Z0-9_.-]+):\s*not found/i,
    // "unable to find nmap" or "could not find nmap"
    /unable to find\s+([a-zA-Z0-9_.-]+)/i,
    /could not find\s+([a-zA-Z0-9_.-]+)/i,
  ]

  for (const pattern of notFoundPatterns) {
    const match = lower.match(pattern)
    if (match && match[1]) {
      // Extract basename from paths like /usr/bin/nmap → nmap
      const raw = match[1].trim()
      const basename = raw.includes('/') ? raw.split('/').pop()! : raw
      return basename
    }
  }

  return null
}

/**
 * Generate an automatic tool installation step for the scan plan
 * when tools are detected as missing during execution.
 */
export function generateAutoInstallStep(
  missingTool: string,
  packageManager: ToolInstallPlan['packageManager']
): { step: number; tool: string; target: string; reason: string } | null {
  if (!packageManager) return null

const toolToPackage: Record<string, string> = {
      // Network reconnaissance
      'nmap': 'nmap',
      'masscan': 'masscan',
      'rustscan': 'rustscan',
      'naabu': 'naabu',
      'smap': 'smap',
      'netdiscover': 'netdiscover',
      'zgrab': 'zgrab',
      // Web vulnerability scanning
      'nikto': 'nikto',
      'nuclei': 'nuclei',
      'gobuster': 'gobuster',
      'ffuf': 'ffuf',
      'feroxbuster': 'feroxbuster',
      'dirsearch': 'dirsearch',
      'wpscan': 'wpscan',
      'dalfox': 'dalfox',
      'arjun': 'arjun',
      'sqlmap': 'sqlmap',
      'commix': 'commix',
      // Subdomain enumeration
      'subfinder': 'subfinder',
      'amass': 'amass',
      'assetfinder': 'assetfinder',
      'findomain': 'findomain',
      'shuffledns': 'shuffledns',
      'dnsx': 'dnsx',
     'chaos': 'chaos',
      // HTTP probing
      'httpx': 'httpx',
      // OSINT / Email
      'theharvester': 'theharvester',
      'holehe': 'holehe',
      'h8mail': 'h8mail',
      'trufflehog': 'trufflehog',
      'gitleaks': 'gitleaks',
      'reconng': 'recon-ng',
      // URL discovery
      'waybackurls': 'waybackurls',
      'gau': 'getallurls',
      // Social media / username discovery
      'sherlock': 'sherlock-project',
      'maigret': 'maigret',
      'social-analyzer': 'social-analyzer',
      'snoop': 'snoop.py',
      'whatsmyname': 'whatsmyname',
      'userrecon': 'userrecon',
      'blackbird': 'blackbird',
      'osintgram': 'osintgram',
      'toutatis': 'toutatis',
      'photon': 'photon',
      // DNS tools
      'dnstwist': 'dnstwist',
      // Password attacks
      'hashcat': 'hashcat',
      'john': 'john',
      'hydra': 'hydra',
      'medusa': 'medusa',
      // Wireless
      'aircrack': 'aircrack-ng',
      'wifite': 'wifite',
      // Forensics
      'binwalk': 'binwalk',
      'exiftool': 'exiftool',
      'volatility': 'volatility3',
      // Mobile / WhatsApp
      'mobsf': 'mobsf',
      'frida': 'frida-tools',
      'jadx': 'jadx',
      // Cloud
      'aws-cli': 'awscli',
      'pacu': 'pacu',
      'cloudsploit': 'cloudsploit',
      // Additional tools
      'wireshark': 'wireshark',
      'tshark': 'wireshark',
      'tcpdump': 'tcpdump',
      'burpsuite': 'burpsuite',
      'zaproxy': 'zaproxy',
      'metasploit': 'metasploit-framework',
      'msfconsole': 'metasploit-framework',
      'bloodhound': 'bloodhound',
      'impacket': 'python3-impacket',
      'responder': 'responder',
      'crackmapexec': 'crackmapexec',
      'linpeas': 'linpeas',
      'winpeas': 'winpeas',
      'mimikatz': 'mimikatz',
      'yara': 'yara',
      'ghidra': 'ghidra',
      'radare2': 'radare2',
      'gdb': 'gdb',
      'strings': 'binutils',
      'objdump': 'binutils',
    }

  const pkg = toolToPackage[missingTool.toLowerCase()] || missingTool

  return {
    step: 1,
    tool: 'hexstrike_install_packages',
    target: `${packageManager}:${pkg}`,
    reason: `Auto-install missing tool: ${missingTool}`,
  }
}

import { Provider } from './types'
import type { AISettings, HexstrikeCategory, HexstrikeTool } from './types'
import { validateTools, HexstrikeCategorySchema, validateHealth, OpenAIModelSchema } from './validation'

const DEFAULT_BASE_URLS: Record<string, string> = {
  [Provider.openai]: 'https://api.openai.com/v1',
  [Provider.groq]: 'https://api.groq.com/openai/v1',
  [Provider.mistral]: 'https://api.mistral.ai/v1',
  [Provider.lmstudio]: 'http://localhost:1234/v1',
  [Provider.ollama]: 'http://localhost:11434',
}

/**
 * Resolve an LM Studio base URL to its OpenAI-compatible `/v1` root.
 *
 * LM Studio's app shows the server address as `http://localhost:1234` (no
 * `/v1`), so users routinely paste that. Its OpenAI-compatible endpoints
 * (`/v1/models`, `/v1/chat/completions`) live under `/v1`. We append it when
 * missing and apply this uniformly to model listing, chat streaming, AND the
 * planner — previously "Fetch models" auto-added `/v1` but the chat stream did
 * not, so a bare host worked for the model list yet silently failed to chat.
 *
 * An empty input falls back to the LM Studio default. An existing `/vN`
 * suffix (any version) is preserved so custom builds aren't clobbered.
 */
export function ensureLmStudioApiBase(base: string | undefined | null): string {
  const b = (base || DEFAULT_BASE_URLS[Provider.lmstudio]).trim().replace(/\/+$/, '')
  return /\/v\d+$/.test(b) ? b : `${b}/v1`
}

// ─── Input validation & sanitization ─────────────────────────────────────────
// All tool invocations go through these guards before being sent to the
// HexStrike backend. The intent is defence-in-depth — the backend is
// expected to validate too, but the UI should never forward obviously
// malicious or malformed input.

export type TargetKind =
  | 'auto'
  | 'domain'
  | 'ip'
  | 'cidr'
  | 'url'
  | 'email'
  | 'username'
  | 'filepath'

export interface ValidationResult {
  ok: boolean
  /** The cleaned target ready to forward to the backend. */
  value: string
  /** Non-fatal advisories (e.g. "this is a private IP — proceed with caution"). */
  warnings: string[]
  /** Fatal validation failure message (only set when ok=false). */
  error?: string
}

const MAX_TARGET_LENGTH = 2048
const MAX_OPTIONS_LENGTH = 4096

// Characters that should never appear in a target string. Everything in
// here is either a shell metacharacter (which the backend should be
// quoting anyway, but defence-in-depth) or a control char.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TARGET_CHARS = /[\x00-\x1f\x7f`$;|&<>"'\\]/

// Allowed token shapes for the free-form `--key value` options string.
// Each token is either `--flag`, `-f`, `key=value`, or a positional
// alphanumeric/path-like value. Anything containing shell metacharacters
// is rejected outright.
const OPTION_TOKEN_RE = /^[A-Za-z0-9_./:=,@+\-]+$/

function isValidIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  for (let i = 1; i <= 4; i++) {
    const o = m[i]
    // Reject leading zeros (e.g. "01.02.03.04") and out-of-range octets.
    if (o.length > 1 && o.startsWith('0')) return false
    const n = +o
    if (n < 0 || n > 255) return false
  }
  return true
}

function isPrivateIPv4(ip: string): boolean {
  if (!isValidIPv4(ip)) return false
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)!
  const a = +m[1], b = +m[2]
  if (a === 0) return true   // unspecified
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  )
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/
const CIDR_RE = /^([0-9.]+|[0-9a-fA-F:]+)\/\d{1,3}$/
const DOMAIN_RE = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const USERNAME_RE = /^[A-Za-z0-9._-]{1,64}$/

export function detectTargetKind(target: string): Exclude<TargetKind, 'auto'> {
  const t = target.trim()
  if (!t) return 'domain'
  if (CIDR_RE.test(t)) return 'cidr'
  if (IPV4_RE.test(t)) return 'ip'
  if (t.startsWith('http://') || t.startsWith('https://')) return 'url'
  if (EMAIL_RE.test(t)) return 'email'
  if (DOMAIN_RE.test(t)) return 'domain'
  if (IPV6_RE.test(t) && t.includes(':')) return 'ip'
  if (t.startsWith('/') || /^[A-Za-z]:\\/.test(t)) return 'filepath'
  if (USERNAME_RE.test(t)) return 'username'
  return 'domain'
}

/**
 * Validate and sanitize a tool target.
 *
 * SSRF policy: we do NOT block private/loopback IPs by default, because
 * this is a self-hosted security tool where scanning your own LAN is a
 * legitimate use case. Instead, we surface a warning so the UI/operator
 * can make an informed choice. Set `blockPrivate: true` to opt in to
 * hard-blocking — appropriate for shared/multi-tenant deployments.
 */
export function validateTarget(
  target: string,
  kind: TargetKind = 'auto',
  opts: { blockPrivate?: boolean } = {}
): ValidationResult {
  const warnings: string[] = []
  if (typeof target !== 'string') {
    return { ok: false, value: '', warnings, error: 'Target must be a string' }
  }

  // Strip surrounding whitespace and any control chars defensively.
  // eslint-disable-next-line no-control-regex
  const cleaned = target.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()
  if (!cleaned) {
    return { ok: false, value: '', warnings, error: 'Target is empty' }
  }
  if (cleaned.length > MAX_TARGET_LENGTH) {
    return {
      ok: false,
      value: '',
      warnings,
      error: `Target exceeds maximum length (${MAX_TARGET_LENGTH} chars)`,
    }
  }
  if (FORBIDDEN_TARGET_CHARS.test(cleaned)) {
    return {
      ok: false,
      value: '',
      warnings,
      error: 'Target contains forbidden characters (shell metacharacters or control chars)',
    }
  }

  const detected = kind === 'auto' ? detectTargetKind(cleaned) : kind

  // Per-kind structural checks
  switch (detected) {
    case 'url': {
      let parsed: URL
      try {
        parsed = new URL(cleaned)
      } catch {
        return { ok: false, value: '', warnings, error: 'Invalid URL' }
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, value: '', warnings, error: 'Only http(s) URLs are allowed' }
      }
      if (parsed.hostname) {
        // Reject URLs whose host is a structurally-invalid IPv4 (e.g. 999.x.x.x).
        if (IPV4_RE.test(parsed.hostname) && !isValidIPv4(parsed.hostname)) {
          return { ok: false, value: '', warnings, error: 'URL host is an invalid IPv4 address' }
        }
        if (isPrivateIPv4(parsed.hostname) || isPrivateIPv6(parsed.hostname)) {
          if (opts.blockPrivate) {
            return { ok: false, value: '', warnings, error: 'URL points to a private/loopback address' }
          }
          warnings.push('URL points to a private/loopback address — proceed with caution.')
        }
      }
      break
    }
    case 'ip':
      if (IPV4_RE.test(cleaned)) {
        if (!isValidIPv4(cleaned)) {
          return { ok: false, value: '', warnings, error: 'Invalid IPv4 address (octet out of range)' }
        }
        if (isPrivateIPv4(cleaned)) {
          if (opts.blockPrivate) {
            return { ok: false, value: '', warnings, error: 'Refusing to scan private/loopback IP' }
          }
          warnings.push('Target is a private/loopback IP — proceed with caution.')
        }
      } else if (IPV6_RE.test(cleaned)) {
        if (isPrivateIPv6(cleaned)) {
          if (opts.blockPrivate) {
            return { ok: false, value: '', warnings, error: 'Refusing to scan private/loopback IPv6' }
          }
          warnings.push('Target is a private/loopback IPv6 address — proceed with caution.')
        }
      } else {
        return { ok: false, value: '', warnings, error: 'Invalid IP address' }
      }
      break
    case 'cidr': {
      const m = cleaned.match(/^([^/]+)\/(\d{1,3})$/)
      if (!m) {
        return { ok: false, value: '', warnings, error: 'Invalid CIDR notation' }
      }
      const addr = m[1]
      const prefix = +m[2]
      if (IPV4_RE.test(addr)) {
        if (!isValidIPv4(addr)) {
          return { ok: false, value: '', warnings, error: 'Invalid CIDR (IPv4 octet out of range)' }
        }
        if (prefix < 0 || prefix > 32) {
          return { ok: false, value: '', warnings, error: 'Invalid CIDR prefix (IPv4 must be 0–32)' }
        }
      } else if (IPV6_RE.test(addr) && addr.includes(':')) {
        if (prefix < 0 || prefix > 128) {
          return { ok: false, value: '', warnings, error: 'Invalid CIDR prefix (IPv6 must be 0–128)' }
        }
      } else {
        return { ok: false, value: '', warnings, error: 'Invalid CIDR address' }
      }
      break
    }
    case 'domain':
      if (!DOMAIN_RE.test(cleaned)) {
        return { ok: false, value: '', warnings, error: 'Invalid domain name' }
      }
      break
    case 'email':
      if (!EMAIL_RE.test(cleaned)) {
        return { ok: false, value: '', warnings, error: 'Invalid email address' }
      }
      break
    case 'username':
      if (!USERNAME_RE.test(cleaned)) {
        return { ok: false, value: '', warnings, error: 'Invalid username (alphanumerics / . _ - only, max 64 chars)' }
      }
      break
    case 'filepath':
      // We can't really verify a filepath from the browser; just enforce
      // the absence of newlines and shell chars (already done above).
      break
  }

  return { ok: true, value: cleaned, warnings }
}

/**
 * Sanitize a free-form `--key value --foo bar` options string.
 * Splits on whitespace, rejects tokens containing shell metacharacters,
 * and caps overall length. Returns the cleaned string ready to forward.
 */
export function sanitizeOptions(options: string | undefined | null): ValidationResult {
  if (!options) return { ok: true, value: '', warnings: [] }
  if (typeof options !== 'string') {
    return { ok: false, value: '', warnings: [], error: 'Options must be a string' }
  }
  if (options.length > MAX_OPTIONS_LENGTH) {
    return {
      ok: false,
      value: '',
      warnings: [],
      error: `Options exceed maximum length (${MAX_OPTIONS_LENGTH} chars)`,
    }
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = options.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()
  if (!cleaned) return { ok: true, value: '', warnings: [] }

  const tokens = cleaned.split(/\s+/)
  const warnings: string[] = []
  for (const t of tokens) {
    if (!OPTION_TOKEN_RE.test(t)) {
      return {
        ok: false,
        value: '',
        warnings,
        error: `Invalid option token: ${t.length > 30 ? t.slice(0, 30) + '…' : t} (no shell metacharacters allowed)`,
      }
    }
  }
  return { ok: true, value: tokens.join(' '), warnings }
}

export async function fetchModels(settings: AISettings): Promise<string[]> {
  const { provider, apiKey, baseUrl } = settings

  switch (provider) {
    case Provider.anthropic: {
      if (!apiKey) throw new Error('Anthropic API key is required')
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      })
      if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${res.statusText}`)
      const data = await res.json() as Record<string, unknown>
      const rawList = (data.data ?? data.models ?? []) as unknown[]
      const parsed: string[] = []
      for (const m of rawList) {
        const result = OpenAIModelSchema.safeParse(m)
        if (result.success) {
          parsed.push(result.data.id)
        }
      }
      if (parsed.length) return parsed
      return [
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5-20251001',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
      ]
    }

    case Provider.google: {
      if (!apiKey) throw new Error('Google API key is required')
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      )
      if (!res.ok) throw new Error(`Google error: ${res.status} ${res.statusText}`)
      const data = await res.json() as Record<string, unknown>
      const rawList = (data.models ?? []) as unknown[]
      const parsed: string[] = []
      for (const m of rawList) {
        const rec = m as Record<string, unknown>
        const name = (rec.name as string | undefined)?.replace(/^models\//, '')
        if (name) parsed.push(name)
      }
      if (parsed.length) return parsed
      return ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
    }

    case Provider.ollama: {
      const base = baseUrl || DEFAULT_BASE_URLS[Provider.ollama]
      const res = await fetch(`${base}/api/tags`)
      if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
      const data = await res.json() as Record<string, unknown>
      const rawTags = (data.models ?? data.tags ?? []) as unknown[]
      return rawTags
        .map((m) => {
          const rec = m as Record<string, unknown>
          return (rec.name ?? rec.id ?? (m != null ? String(m) : undefined)) as string | undefined
        })
        .filter(Boolean) as string[]
    }

    case Provider.lmstudio: {
      const base = ensureLmStudioApiBase(baseUrl)
      let res: Response
      try {
        res = await fetch(`${base}/models`)
      } catch {
        throw new Error(
          `Cannot reach LM Studio at ${base}. Start its local server (LM Studio → Developer → Start Server) and enable CORS in the server settings.`
        )
      }
      if (!res.ok) {
        throw new Error(`LM Studio error: ${res.status} ${res.statusText} (server reachable at ${base}?)`)
      }
      const data = await res.json() as Record<string, unknown>
      const rawList = (data.data ?? data.models ?? []) as unknown[]
      const models = rawList
        .map((m) => {
          const rec = m as Record<string, unknown>
          return (rec.id ?? rec.name) as string | undefined
        })
        .filter(Boolean) as string[]
      if (!models.length) {
        throw new Error(`LM Studio is reachable at ${base} but reports no models — load a model in LM Studio first.`)
      }
      return models
    }

    case Provider.custom: {
      const base = (baseUrl || '').replace(/\/+$/, '')
      if (!base) throw new Error('Base URL is required for custom provider')
      const headers: Record<string, string> = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const res = await fetch(`${base}/models`, { headers })
      if (!res.ok) throw new Error(`Custom provider error: ${res.status} ${res.statusText}`)
      const data = await res.json() as Record<string, unknown>
      const rawList = (data.data ?? data.models ?? []) as unknown[]
      return rawList
        .map((m) => {
          const rec = m as Record<string, unknown>
          return (rec.id ?? rec.name) as string | undefined
        })
        .filter(Boolean) as string[]
    }

    // openai-compatible: openai, groq, mistral
    default: {
      const base = (baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const res = await fetch(`${base}/models`, { headers })
      if (!res.ok) throw new Error(`Provider error: ${res.status} ${res.statusText}`)
      const data = await res.json() as Record<string, unknown>
      const rawList = (data.data ?? data.models ?? []) as unknown[]
      return rawList
        .map((m) => {
          const rec = m as Record<string, unknown>
          return (rec.id ?? rec.name) as string | undefined
        })
        .filter(Boolean) as string[]
    }
  }
}

/**
 * Normalize a configured HexStrike URL to a bare origin (no trailing
 * `/api`). Both styles are accepted in settings — `http://host:8888` or
 * `http://host:8888/api`, plus the in-container `/api` shorthand — and we
 * always re-append `/api/...` ourselves so callers can't end up with
 * `/api/api/tools` regressions.
 * Empty string means same-origin (e.g. Vite dev proxy or nginx `/api/`).
 */
export function normalizeHexstrikeBase(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api$/, '')
}

/**
 * Turn user-typed HexStrike URLs into something `fetch()` can use.
 * - Same-origin paths: `/api` (leading slash, no `://`)
 * - Full URLs: unchanged aside from trimming trailing slashes
 * - Bare `host:port` or `host:port/path`: prepends `http://` (browsers treat
 *   `127.0.0.1:8888/...` without a scheme as a **relative** path → HTML SPA).
 */
export function coerceHexstrikeUrlInput(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  if (u.startsWith('/')) {
    const noTrail = u.replace(/\/+$/, '')
    return noTrail === '' ? '/' : noTrail
  }
  if (/^https?:\/\//i.test(u)) {
    return u.replace(/\/+$/, '')
  }
  return `http://${u}`.replace(/\/+$/, '')
}

/** Extra context when /api/tools or /api/execute returns a non-OK status. */
function hexstrikeHttpErrorSuffix(status: number, bodyText: string): string {
  let fromBody = ''
  const trimmed = bodyText.trim()
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as { message?: string; error?: string }
      if (typeof j.message === 'string') fromBody = ` — ${j.message}`
      else if (typeof j.error === 'string') fromBody = ` — ${j.error}`
    } catch {
      /* ignore */
    }
  }
  if (status === 503) {
    return `${fromBody} — No HexStrike backend responded. With Docker UI only, start a backend (e.g. \`docker compose --profile backend up -d\` if you have an image) or run HexStrike on the host and set the URL to http://127.0.0.1:8888 with port 8888 reachable from your browser.`
  }
  return fromBody
}

/** Ordered v6 path segments to try under `/api/tools/<segment>` (hyphenated slug first, then suffix-stripped). */
export function toolRouteCandidates(tool: string): string[] {
  const lower = tool.trim().toLowerCase()
  const hyphenated = lower.replace(/_/gu, '-')
  const stripped = hyphenated.replace(
    /-(scan|enum|probing|templates|injection|api|tool|analysis)$/u,
    ''
  )
  const out: string[] = [hyphenated]
  if (stripped !== hyphenated && stripped.length > 0) out.push(stripped)
  return [...new Set(out)]
}

/** @deprecated Use toolRouteCandidates — returns last resort segment (suffix-stripped). */
export function legacyToolNameToRouteSegment(tool: string): string {
  const c = toolRouteCandidates(tool)
  return c[c.length - 1] ?? tool.trim().toLowerCase().replace(/_/gu, '-')
}

/**
 * HexStrike v6 `POST /api/tools/:slug` expects `domain` (not `target`) for some
 * subdomain / DNS enumeration tools — otherwise the server returns 400
 * "Domain parameter is required".
 */
export function hexstrikeV6UsesDomainField(tool: string): boolean {
  const t = tool.trim().toLowerCase().replace(/_/gu, '-')
  return /(^|-)(amass|subfinder|assetfinder|findomain)(-|$)/u.test(t)
}

function slugToCatalogToolName(slug: string): string {
  return slug.replace(/-/gu, '_')
}

function inferCategoryFromToolSlug(slug: string): string {
  const s = slug.toLowerCase()
  if (/^(nmap|masscan|rustscan|arp|ping|tcpdump|wireshark|tshark|netexec|responder|smbmap|rpcclient|enum4linux|naabu)/u.test(s))
    return 'network_reconnaissance'
  if (/^(sqlmap|ffuf|nikto|nuclei|gobuster|dirb|dirsearch|feroxbuster|wpscan|dalfox|wfuzz|httpx|burp|zaproxy|arjun|katana)/u.test(s))
    return 'web_application_security'
  if (/^(subfinder|amass|theharvester|sherlock|recon|whois|dig|dnsenum|fierce|assetfinder|censys|shodan|gau|wayback|holehe|maigret|h8mail|dnstwist|metagoofil|hibp|social-analyzer|social_analyzer)/u.test(s))
    return 'osint'
  if (/^(hashcat|john|hydra|medusa|patator|hash|crack)/u.test(s))
    return 'password_attacks'
  if (/^(binwalk|strings|exiftool|volatility|foremost|steghide|photorec|testdisk|scalpel|yara)/u.test(s))
    return 'forensics'
  if (/^(msf|metasploit|searchsploit|exploit)/u.test(s))
    return 'exploitation'
  if (/^(aircrack|wifite|reaver|kismet)/u.test(s))
    return 'wireless'
  if (/^(prowler|scoutsuite|pacu|steampipe|cloudsplaining|kube-hunter|trivy|falco|kube-bench)/u.test(s))
    return 'cloud_and_container_security'
  if (/^(trufflehog|gitleaks|git-secrets|checkov|terrascan)/u.test(s))
    return 'secrets_and_iac'
  if (/^(bloodhound|sharphound|crackmapexec|impacket|evil-winrm|kerbrute|rubeus|mimikatz)/u.test(s))
    return 'active_directory'
  if (/^(testssl|sslscan|sslyze|openssl)/u.test(s))
    return 'network_reconnaissance'
  if (/^hexstrike_/u.test(s)) return 'hexstrike_system'
  return 'general'
}

function catalogFromHealthPayload(health: Record<string, unknown>): {
  tools: HexstrikeTool[]
  categories: HexstrikeCategory[]
} {
  // Validate health payload (non-fatal)
  try {
    validateHealth(health)
  } catch {
    // continue; validation is advisory
  }

  const ts = health.tools_status
  if (!ts || typeof ts !== 'object' || Object.keys(ts as Record<string, unknown>).length === 0) {
    return { tools: [], categories: [] }
  }

  // Convert tools_status {tool_name: boolean} into HexstrikeTool array
  const tools: HexstrikeTool[] = Object.keys(ts as Record<string, boolean>).map((slug) => ({
    name: slugToCatalogToolName(slug),
    description: `HexStrike tool (${slug})`,
    category: inferCategoryFromToolSlug(slug),
  }))

  const catMap: Record<string, string[]> = {}
  for (const t of tools) {
    if (!catMap[t.category]) catMap[t.category] = []
    catMap[t.category].push(t.name)
  }
  const categories = Object.entries(catMap).map(([name, toolNames]) => {
    const result = HexstrikeCategorySchema.safeParse({
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tool_count: toolNames.length,
      tools: toolNames,
    })
    return result.success ? result.data : {
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tool_count: toolNames.length,
      tools: toolNames,
    }
  })
  return { tools, categories }
}

function normalizeCatalogPayload(data: unknown): { tools: HexstrikeTool[]; categories: HexstrikeCategory[] } {
  const { tools, categories } = validateTools(data)
  return { tools, categories }
}

async function executeHexstrikeV6(
  base: string,
  tool: string,
  targetValue: string,
  safeParams: Record<string, unknown> | undefined
): Promise<unknown> {
  const raw = typeof safeParams?.raw === 'string' ? safeParams.raw : ''
  const kind = detectTargetKind(targetValue)
  let prefersUrl =
    kind === 'url' ||
    targetValue.startsWith('http://') ||
    targetValue.startsWith('https://')
  let primaryValue = targetValue
  if (prefersUrl && hexstrikeV6UsesDomainField(tool)) {
    try {
      const host = new URL(targetValue).hostname
      if (host) {
        prefersUrl = false
        primaryValue = host
      }
    } catch {
      /* keep url payload below */
    }
  }
  const useDomain = !prefersUrl && hexstrikeV6UsesDomainField(tool)
  const body: Record<string, unknown> = prefersUrl
    ? { url: targetValue, additional_args: raw }
    : useDomain
      ? { domain: primaryValue, additional_args: raw }
      : { target: primaryValue, additional_args: raw }

  const segments = toolRouteCandidates(tool)
  let lastErr = ''
  for (const segment of segments) {
    const toolUrl = `${base}/api/tools/${encodeURIComponent(segment)}`
    const res = await fetch(toolUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      try {
        return await res.json()
      } catch {
        // 200 but unparseable body — record and try the next route candidate
        // (then /api/command) rather than aborting the whole execution.
        lastErr = `200 from /api/tools/${segment} but response body was not valid JSON`
        continue
      }
    }
    lastErr = await res.text().catch(() => res.statusText)
    if (res.status !== 404) {
      throw new Error(`HexStrike execute error (v6 tool route ${segment}): ${res.status} ${lastErr}`)
    }
  }

  const cmd = `${segments[0]} ${targetValue}${raw ? ` ${raw}` : ''}`.trim()
  const res = await fetch(`${base}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: cmd, use_cache: true }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => res.statusText)
    throw new Error(
      `HexStrike execute error (v6 fallback): tried ${segments.join(', ')} then /api/command — ${res.status} ${t}`
    )
  }
  return res.json()
}

export async function fetchHexstrikeTools(
  hexstrikeUrl: string
): Promise<{ tools: HexstrikeTool[]; categories: HexstrikeCategory[] }> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))

  // Prefer GET /health first when it exposes tools_status (HexStrike v6). That avoids a
  // noisy GET /api/tools → 404 in the browser for servers that never implemented /api/tools.
  let healthErrBody = ''
  const hRes = await fetch(`${base}/health`)
  if (hRes.ok) {
    // A 200 with a non-JSON body (e.g. an HTML SPA shell when the URL is
    // misconfigured) must NOT abort the whole catalog fetch — fall through
    // to the GET /api/tools attempt below instead of throwing.
    try {
      const health = (await hRes.json()) as Record<string, unknown>
      const ts = health.tools_status
      if (ts && typeof ts === 'object' && Object.keys(ts as Record<string, unknown>).length > 0) {
        return catalogFromHealthPayload(health)
      }
    } catch {
      healthErrBody = 'GET /health returned 200 but the body was not valid JSON'
    }
  } else {
    healthErrBody = await hRes.text().catch(() => '')
  }

  const res = await fetch(`${base}/api/tools`)
  if (res.ok) {
    const data = await res.json()
    return normalizeCatalogPayload(data)
  }

  const legacyErrBody = await res.text().catch(() => '')
  throw new Error(
    `HexStrike API error: GET /health ${hRes.ok ? 'had no tools_status (or empty)' : `failed (${hRes.status})`}. ` +
      `GET /api/tools failed (${res.status} ${res.statusText}). ` +
      `${legacyErrBody.trim().slice(0, 120)}${healthErrBody.trim() ? ` | ${healthErrBody.trim().slice(0, 120)}` : ''}`
  )
}

export class ToolValidationError extends Error {
  warnings: string[]
  constructor(message: string, warnings: string[] = []) {
    super(message)
    this.name = 'ToolValidationError'
    this.warnings = warnings
  }
}

/** Package managers supported for server-side installs via POST /api/command. */
export type HexstrikePackageManager = 'apt' | 'apk' | 'pip' | 'pip3' | 'npm'

export interface HexstrikePackageInstallSpec {
  manager: HexstrikePackageManager
  packages: string[]
}

const PKG_TOKEN_RE = /^@[a-zA-Z0-9][-a-zA-Z0-9._]*\/[a-zA-Z0-9][-a-zA-Z0-9._]*$|^[a-zA-Z0-9][-a-zA-Z0-9.+]*$/
const MAX_PACKAGES = 40

/** UI-side synthetic tools (merged into catalog in AppContext). Always server-bound. */
export const HEXSTRIKE_UI_SYNTHETIC_TOOLS: HexstrikeTool[] = [
  {
    name: 'hexstrike_install_packages',
    category: 'hexstrike_system',
    description:
      'Install packages on the HexStrike backend host through POST /api/command. Target format: manager:pkg1,pkg2 where manager is apt|apk|pip|pip3|npm (example: apt:nmap,nuclei or pip:requests). When this tool completes in chat, the UI refreshes the sidebar catalog automatically. Only use on infrastructure you own or are explicitly authorized to modify.',
  },
  {
    name: 'hexstrike_system_health',
    category: 'hexstrike_system',
    description:
      'Read backend GET /health (runtime metadata and tools_status map). Use to see which tools/binaries the server reports before or after installs.',
  },
  {
    name: 'hexstrike_refresh_catalog',
    category: 'hexstrike_system',
    description:
      'Re-fetch the tool catalog from the backend (same data as the sidebar refresh button). After this tool completes in chat, the UI reloads the sidebar tool list automatically.',
  },
  {
    name: 'hexstrike_target_profile',
    category: 'hexstrike_system',
    description:
      'Profile a target via POST /api/intelligence/analyze-target. Returns target type (domain/ip/url), tech stack guesses, suggested categories. Use as the first step before picking concrete tools.',
  },
  {
    name: 'hexstrike_smart_recon',
    category: 'hexstrike_system',
    description:
      'Run an automated multi-tool reconnaissance plan via POST /api/intelligence/smart-scan. Backend selects the best ordered tool chain for the target and runs it. Target should be a domain, URL, or IP. Optional params: {objective: "recon"|"vuln"|"comprehensive", max_tools: number}.',
  },
  {
    name: 'hexstrike_attack_chain',
    category: 'hexstrike_system',
    description:
      'Generate a candidate exploitation attack-chain for a target via POST /api/intelligence/create-attack-chain. Returns a sequenced plan (recon -> enumeration -> exploitation -> post-exploit) tailored to the detected target profile.',
  },
  {
    name: 'hexstrike_subdomain_sweep',
    category: 'hexstrike_system',
    description:
      'Composite subdomain discovery: runs subfinder, amass, assetfinder, and crt.sh in parallel via /api/tools/* and merges/dedupes the results. Target should be a registrable apex domain (example: example.com).',
  },
  {
    name: 'hexstrike_web_triage',
    category: 'hexstrike_system',
    description:
      'Composite web triage: probes target(s) with httpx for live HTTP, then runs nuclei (severity high+) for known CVE/misconfig templates. Target is a URL or comma-separated URL list. Use after subdomain sweep.',
  },
]

/**
 * Parse install spec from target `manager:pkg1,pkg2` or JSON in params.raw.
 */
export function parsePackageInstallSpec(
  target: string,
  params?: Record<string, unknown>
): HexstrikePackageInstallSpec {
  const fromTarget = parsePackageInstallFromTarget(target)
  if (fromTarget) return fromTarget
  const raw = params?.raw
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const j = JSON.parse(raw) as { manager?: string; packages?: unknown }
      if (j.manager && Array.isArray(j.packages) && j.packages.every((p) => typeof p === 'string')) {
        return normalizeInstallSpec(j.manager, j.packages as string[])
      }
    } catch {
      /* fall through */
    }
  }
  throw new ToolValidationError(
    'Invalid install request — use target format manager:pkg1,pkg2 (e.g. apt:nmap,nuclei) or JSON in options: {"manager":"apt","packages":["nmap"]}'
  )
}

function parsePackageInstallFromTarget(target: string): HexstrikePackageInstallSpec | null {
  const t = target.trim()
  const m = t.match(/^([a-z]+):([\s\S]+)$/i)
  if (!m) return null
  const mgrRaw = m[1].toLowerCase()
  const rest = m[2].trim()
  const pkgs = rest
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!pkgs.length) return null
  return normalizeInstallSpec(mgrRaw, pkgs)
}

function normalizeInstallSpec(managerRaw: string, packages: string[]): HexstrikePackageInstallSpec {
  const map: Record<string, HexstrikePackageManager> = {
    apt: 'apt',
    apk: 'apk',
    pip: 'pip',
    pip3: 'pip3',
    npm: 'npm',
  }
  const manager = map[managerRaw.toLowerCase()]
  if (!manager) {
    throw new ToolValidationError(`Unsupported package manager "${managerRaw}" — use apt, apk, pip, pip3, or npm`)
  }
  if (packages.length > MAX_PACKAGES) {
    throw new ToolValidationError(`Too many packages (max ${MAX_PACKAGES})`)
  }
  for (const p of packages) {
    if (p.length > 120 || !PKG_TOKEN_RE.test(p)) {
      throw new ToolValidationError(`Invalid package name: ${p}`)
    }
  }
  return { manager, packages }
}

/** Builds a single non-interactive command line (no shell metacharacters). */
export function buildPackageInstallCommand(spec: HexstrikePackageInstallSpec): string {
  const { manager, packages } = spec
  const joined = packages.join(' ')
  switch (manager) {
    case 'apt':
      return `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${joined}`
    case 'apk':
      return `apk add --no-cache ${joined}`
    case 'pip':
    case 'pip3':
      return `python3 -m pip install --no-cache-dir --upgrade ${joined}`
    case 'npm':
      return `npm install -g ${joined}`
    default:
      throw new ToolValidationError('Unsupported manager')
  }
}

async function postHexstrikeCommand(
  base: string,
  command: string,
  useCache = false
): Promise<unknown> {
  const res = await fetch(`${base}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, use_cache: useCache }),
  })
  const text = await res.text().catch(() => res.statusText)
  if (!res.ok) {
    throw new Error(`HexStrike /api/command failed (${res.status}): ${text.slice(0, 800)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text }
  }
}

/** Fetch GET /health from the HexStrike backend. */
export async function fetchHexstrikeHealth(hexstrikeUrl: string): Promise<unknown> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))
  const res = await fetch(`${base}/health`)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`GET /health failed (${res.status}): ${t.slice(0, 400)}`)
  }
  try {
    return await res.json()
  } catch {
    throw new Error('GET /health returned 200 but the response body was not valid JSON')
  }
}

/** After these tools finish in the chat agent, the UI should reload the HexStrike catalog (sidebar). */
export function hexstrikeToolTriggersCatalogRefresh(toolName: string): boolean {
  return toolName === 'hexstrike_install_packages' || toolName === 'hexstrike_refresh_catalog'
}

/** Re-query catalog counts (same network work as sidebar refresh). */
export async function refreshHexstrikeCatalogSummary(hexstrikeUrl: string): Promise<Record<string, unknown>> {
  const data = await fetchHexstrikeTools(hexstrikeUrl)
  return {
    ok: true,
    toolCount: data.tools.length,
    categoryCount: data.categories.length,
    toolsPreview: data.tools.slice(0, 32).map((t) => t.name),
    hint: 'The chat UI refreshes the sidebar catalog automatically after installs when using HexStrike System tools.',
  }
}

/**
 * POST a JSON body to a backend intelligence endpoint and return the parsed
 * JSON. Used by the synthetic `hexstrike_*` planning tools so they can lean
 * on the server's IntelligentDecisionEngine instead of duplicating the
 * tool-selection heuristics in the UI.
 */
async function runHexstrikeIntelligence(
  hexstrikeUrl: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`HexStrike intelligence error (${path}): ${res.status} ${t.slice(0, 240)}`)
  }
  try {
    return await res.json()
  } catch {
    throw new Error(`HexStrike intelligence error (${path}): 200 but response body was not valid JSON`)
  }
}

/**
 * Composite subdomain discovery — runs the four classic passive sources in
 * parallel and merges results client-side. Each subrequest hits an
 * independent /api/tools/<x> endpoint so a single failing tool doesn't take
 * down the whole sweep. Target must be a bare domain.
 */
async function runHexstrikeSubdomainSweep(
  hexstrikeUrl: string,
  domain: string
): Promise<unknown> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))
  const tools = ['subfinder', 'amass', 'assetfinder', 'crt']
  const results = await Promise.allSettled(
    tools.map((t) =>
      fetch(`${base}/api/tools/${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, target: domain, additional_args: '' }),
      }).then((r) => r.json())
    )
  )
  const found = new Set<string>()
  const perTool: Record<string, { ok: boolean; count: number; error?: string }> = {}
  for (let i = 0; i < tools.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      const stdout = (r.value as { stdout?: string }).stdout || ''
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim() && /[a-z0-9]\.[a-z]/i.test(l))
      lines.forEach((l) => found.add(l.trim().toLowerCase()))
      perTool[tools[i]] = { ok: true, count: lines.length }
    } else {
      perTool[tools[i]] = { ok: false, count: 0, error: String(r.reason).slice(0, 200) }
    }
  }
  return {
    target: domain,
    unique_subdomains: Array.from(found).sort(),
    total: found.size,
    tools_used: perTool,
  }
}

/**
 * Composite web-app triage: probe with httpx for live hosts, then nuclei
 * (severity high,critical) for known CVE/misconfig templates. ``target``
 * may be a single URL or a newline / comma-separated list — we pass it
 * straight through to httpx, which accepts stdin lists.
 */
async function runHexstrikeWebTriage(
  hexstrikeUrl: string,
  target: string,
  extraArgs: string
): Promise<unknown> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))
  const httpxRes = await fetch(`${base}/api/tools/httpx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, additional_args: '-silent -title -tech-detect -status-code' }),
  }).then((r) => r.json()).catch((e: Error) => ({ error: e.message }))
  const nucleiRes = await fetch(`${base}/api/tools/nuclei`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, severity: 'high,critical', additional_args: extraArgs || '-silent' }),
  }).then((r) => r.json()).catch((e: Error) => ({ error: e.message }))
  return { target, httpx: httpxRes, nuclei: nucleiRes }
}

/**
 * Run a validated package install on the backend via POST /api/command.
 */
export async function runHexstrikePackageInstall(
  hexstrikeUrl: string,
  target: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const spec = parsePackageInstallSpec(target, params)
  const cmd = buildPackageInstallCommand(spec)
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))
  return postHexstrikeCommand(base, cmd, false)
}

/**
 * Execute a HexStrike tool. Validates and sanitizes both the target and
 * the free-form `params.raw` options string before sending. Throws a
 * `ToolValidationError` when either fails validation; this is distinct
 * from a backend execution error and should be surfaced to the user.
 */
export async function executeHexstrikeTool(
  hexstrikeUrl: string,
  tool: string,
  target: string,
  params?: Record<string, string | boolean | number | null | undefined> | undefined
): Promise<unknown> {
  const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(hexstrikeUrl))

  if (!tool || typeof tool !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(tool)) {
    throw new ToolValidationError(`Invalid tool name: ${tool}`)
  }

  const toolKey = tool.trim()
  if (toolKey === 'hexstrike_install_packages') {
    return runHexstrikePackageInstall(hexstrikeUrl, target, params)
  }
  if (toolKey === 'hexstrike_system_health') {
    return fetchHexstrikeHealth(hexstrikeUrl)
  }
  if (toolKey === 'hexstrike_refresh_catalog') {
    return refreshHexstrikeCatalogSummary(hexstrikeUrl)
  }
  if (toolKey === 'hexstrike_target_profile') {
    return runHexstrikeIntelligence(hexstrikeUrl, '/api/intelligence/analyze-target', { target })
  }
  if (toolKey === 'hexstrike_smart_recon') {
    const objective = (params?.objective as string) || 'recon'
    const maxTools = Number(params?.max_tools) || 8
    return runHexstrikeIntelligence(hexstrikeUrl, '/api/intelligence/smart-scan', {
      target, objective, max_tools: maxTools,
    })
  }
  if (toolKey === 'hexstrike_attack_chain') {
    const objective = (params?.objective as string) || 'comprehensive'
    return runHexstrikeIntelligence(hexstrikeUrl, '/api/intelligence/create-attack-chain', { target, objective })
  }
  if (toolKey === 'hexstrike_subdomain_sweep') {
    return runHexstrikeSubdomainSweep(hexstrikeUrl, target)
  }
  if (toolKey === 'hexstrike_web_triage') {
    return runHexstrikeWebTriage(hexstrikeUrl, target, (params?.raw as string) || '')
  }

  const targetCheck = validateTarget(target, 'auto')
  if (!targetCheck.ok) {
    throw new ToolValidationError(targetCheck.error || 'Invalid target', targetCheck.warnings)
  }

  let safeParams = params
  if (params && typeof params.raw === 'string') {
    const optsCheck = sanitizeOptions(params.raw)
    if (!optsCheck.ok) {
      throw new ToolValidationError(optsCheck.error || 'Invalid options', optsCheck.warnings)
    }
    safeParams = { ...params, raw: optsCheck.value }
  }

  const res = await fetch(`${base}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, target: targetCheck.value, params: safeParams ?? {} }),
  })
  if (res.ok) {
    try {
      return await res.json()
    } catch {
      // 200 but non-JSON (most backends don't implement /api/execute and an
      // HTML shell can sneak through) — fall through to the v6 route flow.
      return executeHexstrikeV6(base, tool, targetCheck.value, safeParams)
    }
  }

  const legacyText = await res.text().catch(() => res.statusText)
  if (res.status !== 404 && res.status !== 405) {
    throw new Error(
      `HexStrike execute error: ${res.status} ${legacyText}${hexstrikeHttpErrorSuffix(res.status, legacyText)}`
    )
  }

  return executeHexstrikeV6(base, tool, targetCheck.value, safeParams)
}

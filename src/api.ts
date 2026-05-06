import { Provider } from './types'
import type { AISettings, HexstrikeCategory, HexstrikeTool } from './types'

const DEFAULT_BASE_URLS: Record<string, string> = {
  [Provider.openai]: 'https://api.openai.com/v1',
  [Provider.groq]: 'https://api.groq.com/openai/v1',
  [Provider.mistral]: 'https://api.mistral.ai/v1',
  [Provider.lmstudio]: 'http://localhost:1234/v1',
  [Provider.ollama]: 'http://localhost:11434',
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

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = +m[1], b = +m[2]
  if ([a, b, +m[3], +m[4]].some((x) => x < 0 || x > 255)) return false
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
      if (parsed.hostname && (isPrivateIPv4(parsed.hostname) || isPrivateIPv6(parsed.hostname))) {
        if (opts.blockPrivate) {
          return { ok: false, value: '', warnings, error: 'URL points to a private/loopback address' }
        }
        warnings.push('URL points to a private/loopback address — proceed with caution.')
      }
      break
    }
    case 'ip':
      if (IPV4_RE.test(cleaned)) {
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
    case 'cidr':
      if (!CIDR_RE.test(cleaned)) {
        return { ok: false, value: '', warnings, error: 'Invalid CIDR notation' }
      }
      break
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
    case Provider.anthropic:
      return [
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5-20251001',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
      ]

    case Provider.google:
      return [
        'gemini-2.0-flash',
        'gemini-2.0-pro',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
      ]

    case Provider.ollama: {
      const base = baseUrl || DEFAULT_BASE_URLS[Provider.ollama]
      const res = await fetch(`${base}/api/tags`)
      if (!res.ok) throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
      const data = await res.json()
      const tags = data.models ?? data.tags ?? []
      return tags.map((m: any) => m.name ?? m.id ?? String(m)).filter(Boolean)
    }

    case Provider.lmstudio: {
      const base = (baseUrl || DEFAULT_BASE_URLS[Provider.lmstudio]).replace(/\/+$/, '')
      const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`LM Studio error: ${res.status} ${res.statusText}`)
      const data = await res.json()
      return (data.data ?? []).map((m: any) => m.id ?? m.name).filter(Boolean)
    }

    case Provider.custom: {
      const base = (baseUrl || '').replace(/\/+$/, '')
      if (!base) throw new Error('Base URL is required for custom provider')
      const headers: Record<string, string> = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const res = await fetch(`${base}/models`, { headers })
      if (!res.ok) throw new Error(`Custom provider error: ${res.status} ${res.statusText}`)
      const data = await res.json()
      return (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean)
    }

    // openai-compatible: openai, groq, mistral
    default: {
      const base = (baseUrl || DEFAULT_BASE_URLS[provider] || '').replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const res = await fetch(`${base}/models`, { headers })
      if (!res.ok) throw new Error(`Provider error: ${res.status} ${res.statusText}`)
      const data = await res.json()
      return (data.data ?? data.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean)
    }
  }
}

export async function fetchHexstrikeTools(
  hexstrikeUrl: string
): Promise<{ tools: HexstrikeTool[]; categories: HexstrikeCategory[] }> {
  const base = hexstrikeUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/tools`)
  if (!res.ok) throw new Error(`HexStrike API error: ${res.status} ${res.statusText}`)
  const data = await res.json()

  // Normalise various response shapes
  const tools: HexstrikeTool[] = (data.tools ?? data ?? []).map((t: any) => ({
    name: t.name ?? t.id ?? '',
    description: t.description ?? '',
    category: t.category ?? 'uncategorized',
  }))

  // Build categories from tools if not provided explicitly
  let categories: HexstrikeCategory[] = data.categories ?? []
  if (!categories.length && tools.length) {
    const catMap: Record<string, string[]> = {}
    for (const t of tools) {
      if (!catMap[t.category]) catMap[t.category] = []
      catMap[t.category].push(t.name)
    }
    categories = Object.entries(catMap).map(([name, toolNames]) => ({
      name,
      display_name: name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      tool_count: toolNames.length,
      tools: toolNames,
    }))
  }

  return { tools, categories }
}

export class ToolValidationError extends Error {
  warnings: string[]
  constructor(message: string, warnings: string[] = []) {
    super(message)
    this.name = 'ToolValidationError'
    this.warnings = warnings
  }
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
  params?: Record<string, any>
): Promise<any> {
  const base = hexstrikeUrl.replace(/\/+$/, '')

  if (!tool || typeof tool !== 'string' || !/^[A-Za-z0-9_-]+$/.test(tool)) {
    throw new ToolValidationError(`Invalid tool name: ${tool}`)
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
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HexStrike execute error: ${res.status} ${text}`)
  }
  return res.json()
}

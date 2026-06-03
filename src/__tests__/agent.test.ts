import { describe, it, expect } from 'vitest'
import {
  approxTokens,
  truncateForBudget,
  extractEntities,
  mergeEntities,
  emptyScratchpad,
  substituteVariables,
  FailureTracker,
  isReasoningModel,
  suggestReasoningEffort,
  readUsageFromChunk,
  addUsage,
  analyzeToolAvailability,
  detectMissingToolFromError,
  generateAutoInstallStep,
  entitiesByTool,
} from '../agent'
import { Provider } from '../types'

describe('truncateForBudget', () => {
  it('returns input unchanged when under budget', () => {
    expect(truncateForBudget('hello', 1000)).toBe('hello')
  })

  it('truncates with head + tail markers when over budget', () => {
    const text = 'A'.repeat(20_000)
    const out = truncateForBudget(text, 100)
    expect(out.length).toBeLessThan(text.length)
    expect(out).toMatch(/\[…\d/)
  })

  it('approxTokens is roughly chars/4', () => {
    expect(approxTokens('abcd')).toBe(1)
    expect(approxTokens('a'.repeat(100))).toBe(25)
  })
})

describe('extractEntities', () => {
  it('pulls IPs, domains, URLs, emails, CVEs, hashes', () => {
    const text = `Found 10.0.0.1 and 192.168.1.50 with admin@example.com
      Subdomain api.example.com via https://api.example.com/v1
      Vulnerability: CVE-2024-1234 confirmed
      MD5: d41d8cd98f00b204e9800998ecf8427e
      Open ports: 80/tcp open  443/tcp open`
    const e = extractEntities(text)
    expect(e.ips).toContain('10.0.0.1')
    expect(e.ips).toContain('192.168.1.50')
    expect(e.subdomains).toContain('api.example.com')
    expect(e.urls.length).toBeGreaterThan(0)
    expect(e.emails).toContain('admin@example.com')
    expect(e.cves).toContain('CVE-2024-1234')
    expect(e.hashes).toContain('d41d8cd98f00b204e9800998ecf8427e')
    expect(e.ports).toContain(80)
    expect(e.ports).toContain(443)
  })

  it('handles empty input', () => {
    const e = extractEntities('')
    expect(e).toEqual(emptyScratchpad())
  })
})

describe('mergeEntities', () => {
  it('dedupes across both inputs', () => {
    const a = { ...emptyScratchpad(), domains: ['x.com'], ports: [80] }
    const b = { ...emptyScratchpad(), domains: ['x.com', 'y.com'], ports: [443, 80] }
    const merged = mergeEntities(a, b)
    expect(merged.domains).toEqual(['x.com', 'y.com'])
    expect(merged.ports).toEqual([80, 443])
  })
})

describe('substituteVariables', () => {
  const ctx = {
    prev: {
      subfinder: { ...emptyScratchpad(), subdomains: ['a.x.com', 'b.x.com'] },
    },
    entities: { ...emptyScratchpad(), ips: ['10.0.0.1', '10.0.0.2'] },
  }

  it('substitutes prev.<tool>.<field> arrays', () => {
    const r = substituteVariables('${prev.subfinder.subdomains}', ctx)
    expect(r.value).toBe('a.x.com,b.x.com')
    expect(r.missing).toEqual([])
  })

  it('substitutes entities[index]', () => {
    const r = substituteVariables('${entities.ips[0]}', ctx)
    expect(r.value).toBe('10.0.0.1')
  })

  it('reports missing references', () => {
    const r = substituteVariables('${prev.unknown.subdomains}', ctx)
    expect(r.missing).toContain('prev.unknown.subdomains')
  })

  it('passes through strings without templates', () => {
    expect(substituteVariables('plain', ctx).value).toBe('plain')
  })
})

describe('FailureTracker', () => {
  it('skips after threshold and resets on success', () => {
    const t = new FailureTracker()
    t.record('nmap')
    t.record('nmap')
    expect(t.shouldSkip('nmap', 3)).toBe(false)
    t.record('nmap')
    expect(t.shouldSkip('nmap', 3)).toBe(true)
    t.reset('nmap')
    expect(t.shouldSkip('nmap', 3)).toBe(false)
  })

  it('exponential backoff caps at 30s', () => {
    const t = new FailureTracker()
    for (let i = 0; i < 20; i++) t.record('x')
    expect(t.backoffMs('x')).toBe(30000)
  })
})

describe('reasoning model heuristics', () => {
  it('detects o1/o3/thinking', () => {
    expect(isReasoningModel('o1-preview')).toBe(true)
    expect(isReasoningModel('o3-mini')).toBe(true)
    expect(isReasoningModel('claude-3-5-sonnet-thinking')).toBe(true)
    expect(isReasoningModel('gpt-4o')).toBe(false)
  })

  it('suggests effort scaled by temperature', () => {
    const base = {
      provider: Provider.openai,
      apiKey: 'k',
      model: 'o1-preview',
      models: [],
      baseUrl: '',
      temperature: 0.1,
      maxTokens: 1000,
      contextWindow: 100_000,
      systemPrompt: '',
      hexstrikeUrl: '',
    }
    expect(suggestReasoningEffort(base)).toBe('low')
    expect(suggestReasoningEffort({ ...base, temperature: 0.5 })).toBe('medium')
    expect(suggestReasoningEffort({ ...base, temperature: 1.5 })).toBe('high')
    expect(suggestReasoningEffort({ ...base, model: 'gpt-4o' })).toBeUndefined()
  })
})

describe('usage accounting', () => {
  it('reads OpenAI usage shape', () => {
    expect(readUsageFromChunk({ usage: { prompt_tokens: 10, completion_tokens: 7 } })).toEqual({ in: 10, out: 7 })
  })
  it('reads Anthropic message_delta usage shape', () => {
    expect(readUsageFromChunk({ type: 'message_delta', usage: { input_tokens: 3, output_tokens: 4 } })).toEqual({ in: 3, out: 4 })
  })
  it('reads Gemini usageMetadata', () => {
    expect(readUsageFromChunk({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9 } })).toEqual({ in: 5, out: 9 })
  })
  it('addUsage accumulates', () => {
    expect(addUsage({ in: 1, out: 2 }, { in: 3, out: 4 })).toEqual({ in: 4, out: 6 })
  })
})

describe('analyzeToolAvailability', () => {
  it('detects missing tools from available catalog', () => {
    const available = [
      { name: 'nmap_scan', description: 'Port scanner', category: 'network_reconnaissance' },
      { name: 'nuclei_templates', description: 'Vuln scanner', category: 'web_application_security' },
    ]
    const result = analyzeToolAvailability(['nmap_scan', 'subfinder_enum', 'nuclei_templates'], available, null)
    expect(result.missingTools).toContain('subfinder_enum')
    expect(result.missingTools).not.toContain('nmap_scan')
    expect(result.missingTools).not.toContain('nuclei_templates')
  })

  it('returns empty missing when all tools available', () => {
    const available = [
      { name: 'nmap_scan', description: 'Port scanner', category: 'network_reconnaissance' },
    ]
    const result = analyzeToolAvailability(['nmap_scan'], available, null)
    expect(result.missingTools).toEqual([])
  })

  it('detects package manager from health info', () => {
    const available: { name: string; description: string; category: string }[] = []
    const health = { package_managers: { apt: true }, os_type: 'linux' }
    const result = analyzeToolAvailability(['nmap'], available, health)
    expect(result.packageManager).toBe('apt')
  })

  it('prefers apt over apk when both present', () => {
    const available: { name: string; description: string; category: string }[] = []
    const health = { package_managers: { apt: true, apk: true }, os_type: 'linux' }
    const result = analyzeToolAvailability(['nmap'], available, health)
    expect(result.packageManager).toBe('apt')
  })

  it('falls back to pip when no apt/apk', () => {
    const available: { name: string; description: string; category: string }[] = []
    const health = { package_managers: { pip: true }, os_type: 'unknown' }
    const result = analyzeToolAvailability(['nmap'], available, health)
    expect(result.packageManager).toBe('pip3')
  })

  it('returns null package manager when nothing available', () => {
    const available: { name: string; description: string; category: string }[] = []
    const result = analyzeToolAvailability(['nmap'], available, null)
    expect(result.packageManager).toBeNull()
    expect(result.canInstall).toBe(false)
  })
})

describe('detectMissingToolFromError', () => {
  it('detects "command not found" pattern', () => {
    expect(detectMissingToolFromError('bash: nmap: command not found')).toBe('nmap')
  })

  it('detects "no such file" pattern', () => {
    expect(detectMissingToolFromError('/usr/bin/nmap: no such file or directory')).toBe('nmap')
  })

  it('detects "tool not found" pattern', () => {
    expect(detectMissingToolFromError("tool 'subfinder' not found")).toBe('subfinder')
  })

  it('detects "package not installed" pattern', () => {
    expect(detectMissingToolFromError("package 'nuclei' is not installed")).toBe('nuclei')
  })

  it('returns null for empty input', () => {
    expect(detectMissingToolFromError('')).toBeNull()
  })

  it('returns null for unrelated errors', () => {
    expect(detectMissingToolFromError('connection timeout')).toBeNull()
  })
})

describe('generateAutoInstallStep', () => {
  it('generates install step for known tools', () => {
    const step = generateAutoInstallStep('nmap', 'apt')
    expect(step).not.toBeNull()
    expect(step!.tool).toBe('hexstrike_install_packages')
    expect(step!.target).toBe('apt:nmap')
    expect(step!.reason).toContain('nmap')
  })

  it('returns null when no package manager available', () => {
    const step = generateAutoInstallStep('nmap', null)
    expect(step).toBeNull()
  })

  it('covers extended tool list', () => {
    const tools = ['subfinder', 'amass', 'httpx', 'ffuf', 'sqlmap', 'hashcat']
    for (const tool of tools) {
      const step = generateAutoInstallStep(tool, 'apt')
      expect(step).not.toBeNull()
      expect(step!.target).toContain('apt:')
    }
  })

  it('uses tool name as package when no mapping exists', () => {
    const step = generateAutoInstallStep('custom_tool', 'apt')
    expect(step).not.toBeNull()
    expect(step!.target).toBe('apt:custom_tool')
  })

  it('generates apk-based install steps', () => {
    const step = generateAutoInstallStep('nmap', 'apk')
    expect(step).not.toBeNull()
    expect(step!.target).toBe('apk:nmap')
  })
})

describe('entitiesByTool', () => {
  it('extracts entities grouped by tool name', () => {
    const executions = [
      {
        id: '1',
        toolName: 'nmap_scan',
        target: 'example.com',
        status: 'done' as const,
        result: '10.0.0.1 80/tcp open\n10.0.0.2 443/tcp open',
        timestamp: Date.now(),
      },
    ]
    const result = entitiesByTool(executions)
    expect(result.nmap_scan.ips).toContain('10.0.0.1')
    expect(result.nmap_scan.ips).toContain('10.0.0.2')
    expect(result.nmap_scan.ports).toContain(80)
    expect(result.nmap_scan.ports).toContain(443)
  })

  it('skips executions without results', () => {
    const executions = [
      {
        id: '1',
        toolName: 'nmap_scan',
        target: 'example.com',
        status: 'error' as const,
        result: undefined,
        timestamp: Date.now(),
      },
    ]
    const result = entitiesByTool(executions)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('merges entities from multiple executions of same tool', () => {
    const executions = [
      {
        id: '1',
        toolName: 'nmap_scan',
        target: 'example.com',
        status: 'done' as const,
        result: '10.0.0.1 80/tcp open',
        timestamp: Date.now(),
      },
      {
        id: '2',
        toolName: 'nmap_scan',
        target: 'example.com',
        status: 'done' as const,
        result: '10.0.0.2 443/tcp open',
        timestamp: Date.now(),
      },
    ]
    const result = entitiesByTool(executions)
    expect(result.nmap_scan.ips).toContain('10.0.0.1')
    expect(result.nmap_scan.ips).toContain('10.0.0.2')
    expect(result.nmap_scan.ports).toContain(80)
    expect(result.nmap_scan.ports).toContain(443)
  })
})

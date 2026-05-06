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

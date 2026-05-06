import { describe, it, expect } from 'vitest'
import { detectTargetType } from '../aiAgent'

describe('detectTargetType', () => {
  it('classifies IPv4 addresses', () => {
    expect(detectTargetType('192.168.1.1')).toBe('ip')
    expect(detectTargetType('10.0.0.0/24')).toBe('ip')
  })

  it('classifies URLs', () => {
    expect(detectTargetType('https://example.com')).toBe('url')
    expect(detectTargetType('http://foo.bar/baz')).toBe('url')
  })

  it('classifies emails', () => {
    expect(detectTargetType('alice@example.com')).toBe('email')
  })

  it('classifies bare usernames as username', () => {
    expect(detectTargetType('admin')).toBe('username')
    expect(detectTargetType('john_doe')).toBe('username')
  })

  it('falls back to domain for hostnames with dots', () => {
    expect(detectTargetType('example.com')).toBe('domain')
    expect(detectTargetType('sub.example.co.uk')).toBe('domain')
  })
})

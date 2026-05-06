import { describe, it, expect } from 'vitest'
import { getContextWindowForModel } from '../store'

describe('getContextWindowForModel', () => {
  it('reports 200k+ for Claude 3.5 Sonnet', () => {
    expect(getContextWindowForModel('claude-3-5-sonnet-20241022')).toBeGreaterThanOrEqual(200_000)
  })

  it('reports 128k for gpt-4o', () => {
    expect(getContextWindowForModel('gpt-4o')).toBe(128_000)
  })

  it('reports 1M+ for Gemini 1.5/2.0', () => {
    expect(getContextWindowForModel('gemini-1.5-pro')).toBeGreaterThanOrEqual(1_000_000)
  })

  it('falls back to a safe default for unknown models', () => {
    const w = getContextWindowForModel('totally-unknown-model-xyz')
    expect(w).toBeGreaterThan(0)
  })
})

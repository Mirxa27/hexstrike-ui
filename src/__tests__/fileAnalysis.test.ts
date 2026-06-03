import { describe, it, expect } from 'vitest'
import {
  analyzeFileClientSide,
  decodeBase64DataUrl,
  extractPrintableStrings,
  detectFileCategory,
} from '../fileAnalysis'
import type { UploadedFile } from '../fileAnalysis'

function makeFile(content: string, over: Partial<UploadedFile> = {}): UploadedFile {
  const b64 = btoa(content)
  return {
    id: 'f1',
    name: 'sample.txt',
    size: content.length,
    type: 'text/plain',
    category: 'document',
    data: `data:text/plain;base64,${b64}`,
    ...over,
  }
}

describe('decodeBase64DataUrl', () => {
  it('round-trips ASCII from a data URL', () => {
    expect(decodeBase64DataUrl(`data:text/plain;base64,${btoa('hello world')}`)).toBe('hello world')
  })
  it('returns empty string for empty input', () => {
    expect(decodeBase64DataUrl('')).toBe('')
  })
})

describe('extractPrintableStrings', () => {
  it('finds printable runs of at least the minimum length', () => {
    const result = extractPrintableStrings('AB\x00\x01HELLOWORLD\x00xx', 5)
    expect(result).toContain('HELLOWORLD')
    expect(result).not.toContain('xx')
  })
})

describe('analyzeFileClientSide', () => {
  it('extracts URLs, emails, and valid IPs while rejecting invalid octets', () => {
    const content =
      'Visit https://evil.example.com/login or email admin@example.com host 10.0.0.5 invalid 999.999.999.999'
    const { findings, extractedData } = analyzeFileClientSide(makeFile(content))

    expect(extractedData.urls).toContain('https://evil.example.com/login')
    expect(extractedData.emails).toContain('admin@example.com')
    expect(extractedData.ips).toContain('10.0.0.5')
    expect(extractedData.ips).not.toContain('999.999.999.999')
    expect(findings.some((f) => f.title.includes('URLs'))).toBe(true)
  })

  it('flags potential hardcoded secrets', () => {
    const content = 'app config api_key=ABCDEF1234567890SECRETVALUE other stuff'
    const { findings } = analyzeFileClientSide(makeFile(content))
    expect(findings.some((f) => f.category === 'Security Concern')).toBe(true)
  })

  it('detects file type from magic bytes', () => {
    const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + 'IHDRchunkdata'
    const { findings } = analyzeFileClientSide(
      makeFile(png, { name: 'image.png', type: 'image/png', category: 'image' })
    )
    expect(findings.some((f) => f.category === 'File Type')).toBe(true)
  })

  it('always returns basic metadata', () => {
    const { metadata } = analyzeFileClientSide(makeFile('hi'))
    expect(metadata.basic.filename).toBe('sample.txt')
    expect(metadata.basic.category).toBe('document')
  })
})

describe('detectFileCategory', () => {
  it('classifies by extension when mime is generic', () => {
    const f = new File(['x'], 'capture.pcap', { type: '' })
    expect(detectFileCategory(f)).toBe('network')
  })
})

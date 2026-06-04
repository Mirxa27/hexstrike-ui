import { describe, it, expect } from 'vitest'
import {
  enrichToolDescription,
  getToolPrimaryParam,
  selectRelevantTools,
  buildToolMenu,
  detectTargetType,
} from '../toolCatalog'
import type { HexstrikeTool } from '../types'

const makeTool = (name: string, desc = ''): HexstrikeTool => ({ name, description: desc, category: 'test' })

// Realistic backend tool list (subset of what the full image provides)
const TOOLS: HexstrikeTool[] = [
  makeTool('nmap'),
  makeTool('subfinder'),
  makeTool('httpx'),
  makeTool('nuclei'),
  makeTool('gobuster'),
  makeTool('sherlock'),
  makeTool('holehe'),
  makeTool('maigret'),
  makeTool('socialscan'),
  makeTool('social_analyzer'),
  makeTool('exiftool'),
  makeTool('binwalk'),
  makeTool('whois'),
  makeTool('sqlmap'),
  makeTool('ffuf'),
  makeTool('katana'),
  makeTool('dalfox'),
  makeTool('h8mail'),
  makeTool('ghunt'),
  makeTool('hashcat'),
  makeTool('hydra'),
  makeTool('hexstrike_system_health'),
  makeTool('hexstrike_subdomain_sweep'),
  makeTool('hexstrike_web_triage'),
  makeTool('amass'),
]

describe('detectTargetType', () => {
  it('classifies IP', () => expect(detectTargetType('192.168.1.1')).toBe('ip'))
  it('classifies URL', () => expect(detectTargetType('https://example.com')).toBe('url'))
  it('classifies email', () => expect(detectTargetType('user@example.com')).toBe('email'))
  it('classifies domain', () => expect(detectTargetType('example.com')).toBe('domain'))
  it('classifies username (no dot, short)', () => expect(detectTargetType('octocat')).toBe('username'))
})

describe('enrichToolDescription', () => {
  it('gives nmap a specific, actionable description', () => {
    const d = enrichToolDescription(makeTool('nmap'))
    expect(d).toContain('Port scan')
    expect(d.length).toBeGreaterThan(20)
  })
  it('gives subfinder the domain-specific description', () => {
    const d = enrichToolDescription(makeTool('subfinder'))
    expect(d.toLowerCase()).toContain('subdomain')
  })
  it('gives sherlock a username-focused description', () => {
    const d = enrichToolDescription(makeTool('sherlock'))
    expect(d.toLowerCase()).toContain('username')
  })
  it('falls back gracefully for an unknown tool', () => {
    const d = enrichToolDescription(makeTool('some-custom-tool', ''))
    expect(d).toContain('some-custom-tool')
  })
  it('uses the backend description when it is informative', () => {
    const d = enrichToolDescription(makeTool('some-custom-tool', 'Fancy custom scanner for XYZ'))
    expect(d).toContain('Fancy custom scanner')
  })
})

describe('getToolPrimaryParam', () => {
  it('subfinder needs domain', () => expect(getToolPrimaryParam('subfinder')).toBe('domain'))
  it('gobuster needs url', () => expect(getToolPrimaryParam('gobuster')).toBe('url'))
  it('exiftool needs filepath', () => expect(getToolPrimaryParam('exiftool')).toBe('filepath'))
  it('holehe needs email', () => expect(getToolPrimaryParam('holehe')).toBe('email'))
  // sherlock takes the username as a positional arg mapped to 'target'
  it('sherlock uses target (username passed as positional)', () => expect(getToolPrimaryParam('sherlock')).toBe('target'))
  it('nmap falls back to target', () => expect(getToolPrimaryParam('nmap')).toBe('target'))
  it('unknown tool falls back to target', () => expect(getToolPrimaryParam('foobar')).toBe('target'))
})

describe('selectRelevantTools', () => {
  it('domain target: puts subfinder + httpx in the top 10', () => {
    const selected = selectRelevantTools(TOOLS, 'example.com', 'recon example.com', 12)
    const names = selected.map((t) => t.name)
    expect(names).toContain('subfinder')
    expect(names).toContain('httpx')
    expect(selected.length).toBeLessThanOrEqual(12)
  })

  it('IP target: puts nmap first', () => {
    const selected = selectRelevantTools(TOOLS, '192.168.1.1', 'scan 192.168.1.1', 10)
    const names = selected.map((t) => t.name)
    expect(names[0]).toBe('nmap')
  })

  it('email target: puts holehe + h8mail high', () => {
    const selected = selectRelevantTools(TOOLS, 'test@gmail.com', 'lookup email test@gmail.com', 10)
    const names = selected.map((t) => t.name)
    expect(names.slice(0, 5)).toContain('holehe')
  })

  it('username target: puts sherlock high', () => {
    const selected = selectRelevantTools(TOOLS, 'octocat', 'find username octocat', 10)
    const names = selected.map((t) => t.name)
    expect(names.slice(0, 5)).toContain('sherlock')
  })

  it('URL target: puts nuclei + gobuster + sqlmap high', () => {
    const selected = selectRelevantTools(TOOLS, 'https://target.com', 'test https://target.com', 10)
    const names = selected.map((t) => t.name)
    expect(names).toContain('nuclei')
    expect(names).toContain('gobuster')
  })

  it('never exceeds maxTools', () => {
    const selected = selectRelevantTools(TOOLS, 'example.com', 'recon', 5)
    expect(selected.length).toBeLessThanOrEqual(5)
  })

  it('task text keyword override: face/image task picks file tools', () => {
    const selected = selectRelevantTools(TOOLS, '', 'analyze face in photo.jpg', 10)
    const names = selected.map((t) => t.name)
    expect(names).toContain('exiftool')
    expect(names).toContain('binwalk')
  })
})

describe('buildToolMenu', () => {
  it('produces one line per tool with the name', () => {
    const selected = TOOLS.slice(0, 4)
    const menu = buildToolMenu(selected, 'example.com')
    const lines = menu.split('\n').filter(Boolean)
    expect(lines.length).toBe(4)
    expect(lines[0]).toContain('nmap')
  })

  it('shows the guessed target in each tool call', () => {
    const menu = buildToolMenu([makeTool('subfinder')], 'test.com')
    expect(menu).toContain('test.com')
  })

  it('returns empty string for an empty tool list', () => {
    expect(buildToolMenu([], 'example.com')).toBe('')
  })
})

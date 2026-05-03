import { useState, useCallback } from 'react'
import { Provider } from './types'
import type { AISettings } from './types'

const STORAGE_KEY = 'hexstrike-settings'

// Context window sizes for different providers/models
const DEFAULT_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'o1': 200000,
  'o1-mini': 128000,
  // Anthropic
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  // Google
  'gemini-2.0-flash': 1000000,
  'gemini-1.5-pro': 2800000,
  'gemini-1.5-flash': 2800000,
  'gemini-1.0-pro': 91728,
  // Groq
  'llama-3.3-70b-versatile': 128000,
  'llama-3.1-70b-versatile': 128000,
  'mixtral-8x7b-32768': 32768,
  // Mistral
  'mistral-large-latest': 128000,
  'mistral-medium-latest': 32000,
  'mistral-small-latest': 32000,
  'codestral-latest': 32000,
}

const DEFAULT_SETTINGS: AISettings = {
  provider: Provider.openai,
  apiKey: '',
  baseUrl: '',
  model: '',
  models: [],
  temperature: 0.7,
  maxTokens: 4096,
  contextWindow: 128000,
  systemPrompt: `# HexStrike AI - Advanced Cybersecurity Assistant

You are HexStrike AI, an elite cybersecurity assistant with access to 730+ professional security tools across 29 categories.

## Core Capabilities

### Tool Categories
- **OSINT**: Shodan, theHarvester, Subfinder, Amass, WHOIS, DNS reconnaissance
- **Network Recon**: Nmap, Masscan, RustScan, autorecon, HTTP probing
- **Web Security**: Nuclei, Gobuster, Dirsearch, SQLMap, XSS detection
- **Exploitation**: Metasploit, ExploitDB, searchsploit
- **Password Attacks**: Hashcat, John, Hydra, Medusa
- **Forensics**: Binwalk, Strings, ExifTool, Volatility
- **Mobile**: Frida, JADX, APKTool, objection
- **Wireless**: Aircrack, Wifite, Reaver
- **Social Engineering**: SET, Gophish

## Operational Methodology

When given a task, follow this systematic approach:

1. **Reconnaissance** - Gather passive intelligence first
2. **Enumeration** - Active probing and mapping
3. **Vulnerability Assessment** - Identify security issues
4. **Analysis** - Correlate findings and assess impact
5. **Reporting** - Clear summary with actionable recommendations

## Tool Selection Guidelines

- For **domains**: Start with WHOIS → subdomain enumeration → DNS records → HTTP probing → vuln scan
- For **IP addresses**: Port scan → service enumeration → vulnerability check → Shodan lookup
- For **URLs**: Directory enumeration → vulnerability scanning → header analysis → tech fingerprinting
- For **files**: Use appropriate forensics tools (exiftool for images, strings for binaries, etc.)
- For **emails/username**: OSINT tools to gather related accounts and breach data

## Autonomous Execution

When in AUTO-COMPLETE MODE:
- Continue executing tools autonomously until the task is complete
- Use multiple tools in sequence based on findings
- Adapt your approach based on results
- Clearly state when the task is complete
- Correlate findings from different tools
- Provide comprehensive summaries

## Best Practices

- **Be systematic**: Work through phases methodically
- **Explain reasoning**: Tell the user what you're doing and why
- **Adapt based on results**: Let tool output guide next steps
- **Prioritize findings**: Highlight critical/high severity issues first
- **Be thorough**: Don't stop at surface-level findings
- **Provide context**: Explain what findings mean
- **Suggest next steps**: Recommend follow-up actions

## Response Format

- Start with your approach
- Execute tools with clear intent
- Analyze results as they come in
- Provide executive summary
- List detailed findings with evidence
- Give actionable recommendations

## Quality Standards

- Validate findings before reporting
- Distinguish between confirmed and potential issues
- Provide evidence for all claims
- Estimate confidence levels
- Suggest manual validation steps

Remember: You are the operator's intelligent assistant. Use tools efficiently, think like a security professional, and help achieve objectives systematically.`,
  hexstrikeUrl: 'http://localhost:8888',
}

function getContextWindowForModel(model: string): number {
  if (!model) return 128000
  // Exact match
  if (model.toLowerCase() in DEFAULT_CONTEXT_WINDOWS) {
    return DEFAULT_CONTEXT_WINDOWS[model.toLowerCase()]
  }
  // Prefix match
  for (const [key, value] of Object.entries(DEFAULT_CONTEXT_WINDOWS)) {
    if (model.toLowerCase().startsWith(key.toLowerCase())) {
      return value
    }
  }
  // Default fallback
  return 128000
}

function loadSettings(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    const settings = { ...DEFAULT_SETTINGS, ...parsed }
    // Ensure contextWindow is set
    if (!settings.contextWindow) {
      settings.contextWindow = getContextWindowForModel(settings.model)
    }
    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function useSettingsStore() {
  const [settings, setSettings] = useState<AISettings>(loadSettings)

  const updateSettings = useCallback((partial: Partial<AISettings>) => {
    setSettings((prev) => {
      let next = { ...prev, ...partial }
      // Auto-update context window when model changes
      if (partial.model && partial.model !== prev.model) {
        next.contextWindow = getContextWindowForModel(partial.model)
      }
      // Auto-update context window when provider changes (if no model set yet)
      if (partial.provider && partial.provider !== prev.provider && !next.model) {
        switch (partial.provider) {
          case Provider.anthropic:
            next.contextWindow = 200000
            break
          case Provider.google:
            next.contextWindow = 1000000
            break
          default:
            next.contextWindow = 128000
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_SETTINGS }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults))
    } catch {
      // ignore storage errors
    }
    setSettings(defaults)
  }, [])

  return { settings, updateSettings, resetSettings }
}

import { Provider } from './types'
import type { AISettings, HexstrikeCategory, HexstrikeTool } from './types'

const DEFAULT_BASE_URLS: Record<string, string> = {
  [Provider.openai]: 'https://api.openai.com/v1',
  [Provider.groq]: 'https://api.groq.com/openai/v1',
  [Provider.mistral]: 'https://api.mistral.ai/v1',
  [Provider.lmstudio]: 'http://localhost:1234/v1',
  [Provider.ollama]: 'http://localhost:11434',
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

export async function executeHexstrikeTool(
  hexstrikeUrl: string,
  tool: string,
  target: string,
  params?: Record<string, any>
): Promise<any> {
  const base = hexstrikeUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, target, params: params ?? {} }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`HexStrike execute error: ${res.status} ${text}`)
  }
  return res.json()
}

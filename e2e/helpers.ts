import type { Page } from '@playwright/test'

/**
 * Shared E2E helpers. All network the app touches is intercepted here so the
 * suite is hermetic — no real HexStrike backend and no real LLM API keys.
 */

export interface SeedSettings {
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  models?: string[]
  hexstrikeUrl?: string
  autocomplete?: boolean
}

/** Seed localStorage BEFORE the app boots so the store loads our settings. */
export async function seedSettings(page: Page, s: SeedSettings = {}): Promise<void> {
  const settings = {
    provider: s.provider ?? 'openai',
    apiKey: s.apiKey ?? 'sk-test-key',
    baseUrl: s.baseUrl ?? '',
    model: s.model ?? 'gpt-4o',
    models: s.models ?? ['gpt-4o', 'gpt-4o-mini'],
    temperature: 0.7,
    maxTokens: 1024,
    contextWindow: 128000,
    systemPrompt: 'You are HexStrike AI test harness.',
    hexstrikeUrl: s.hexstrikeUrl ?? '',
  }
  const autocomplete = s.autocomplete ?? false
  await page.addInitScript(
    ([settingsJson, autoJson]) => {
      localStorage.setItem('hexstrike-settings', settingsJson as string)
      localStorage.setItem('hexstrike-autocomplete', autoJson as string)
    },
    [JSON.stringify(settings), JSON.stringify(autocomplete)] as const
  )
}

const DEFAULT_TOOLS: Record<string, boolean> = {
  nmap: true,
  subfinder: true,
  httpx: true,
  nuclei: true,
  sqlmap: true,
  gobuster: true,
  whois: true,
  exiftool: true,
}

/** Mock a healthy HexStrike backend that reports the given tools_status map. */
export async function mockBackendHealthy(page: Page, tools: Record<string, boolean> = DEFAULT_TOOLS): Promise<void> {
  await page.route('**/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'operational',
        version: '6.0-test',
        tools_status: tools,
        os_type: 'linux',
        package_managers: { apt: true, pip: true },
      }),
    })
  )
  // Any /api/* call (execute, tools, command) → deterministic stub.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, stdout: 'mocked tool output\nopen 80/tcp', stderr: '', returncode: 0 }),
    })
  )
}

/** Mock an unreachable backend (nginx 503 / connection refused shape). */
export async function mockBackendDown(page: Page): Promise<void> {
  await page.route('**/health', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }))
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }))
}

/** Build an OpenAI-style SSE stream body for the chat-completions endpoint. */
function openAISSE(chunks: string[]): string {
  const events = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`)
  events.push(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}`
  )
  events.push('data: [DONE]')
  return events.join('\n\n') + '\n\n'
}

/** Mock the OpenAI chat-completions streaming endpoint to return `reply`. */
export async function mockOpenAIChat(page: Page, reply: string): Promise<void> {
  await page.route('https://api.openai.com/v1/chat/completions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      // Split into two chunks to exercise the streaming accumulator.
      body: openAISSE([reply.slice(0, Math.ceil(reply.length / 2)), reply.slice(Math.ceil(reply.length / 2))]),
    })
  )
}

/** Mock OpenAI /models for the Settings "Fetch models" flow. */
export async function mockOpenAIModels(page: Page, models: string[] = ['gpt-4o', 'gpt-4o-mini', 'o1']): Promise<void> {
  await page.route('https://api.openai.com/v1/models', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: models.map((id) => ({ id, object: 'model' })) }),
    })
  )
}

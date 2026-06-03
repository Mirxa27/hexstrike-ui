import { test, expect } from '@playwright/test'
import { seedSettings, mockBackendHealthy, mockOpenAIChat, mockLmStudioChat } from './helpers'

test.describe('Chat flow (mocked LLM)', () => {
  test('sends a message and renders the streamed assistant reply', async ({ page }) => {
    await seedSettings(page, { provider: 'openai', model: 'gpt-4o', autocomplete: false })
    await mockBackendHealthy(page)
    await mockOpenAIChat(page, 'Recon summary: 3 open ports found on the target host.')

    await page.goto('/')

    const input = page.getByPlaceholder('Message HexStrike…')
    await input.fill('Scan example.com for open ports')
    await input.press('Enter')

    // Scope to <main> — the same text also appears as the auto-saved chat
    // title in the history sidebar, which would trip strict mode otherwise.
    const main = page.getByRole('main')
    // User bubble shows what we typed.
    await expect(main.getByText('Scan example.com for open ports')).toBeVisible()
    // Streamed assistant reply renders (markdown). Allow extra time for the
    // first run against a freshly-started preview server (cold bundle load).
    await expect(main.getByText('Recon summary: 3 open ports found on the target host.')).toBeVisible({ timeout: 15_000 })

    // Streaming finished: composer is interactive again.
    await expect(input).toBeEnabled()
  })

  test('surfaces a clear error when no model is configured', async ({ page }) => {
    // Empty model → chatEngine should yield a configuration error, not crash.
    await seedSettings(page, { model: '', apiKey: '' })
    await mockBackendHealthy(page)
    await page.goto('/')

    const input = page.getByPlaceholder('Message HexStrike…')
    await input.fill('hello')
    await input.press('Enter')

    // The error renders in the transcript (scope to <main>; the specific text
    // avoids strict-mode collisions with the composer's "Configure a model" hint).
    await expect(page.getByRole('main').getByText(/No model selected/i)).toBeVisible()
  })

  test('LM Studio: a bare host URL (no /v1) still chats — /v1 is auto-added', async ({ page }) => {
    // The user pastes the address LM Studio shows them: no /v1.
    await seedSettings(page, {
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      model: 'local-model',
      apiKey: '',
      autocomplete: false,
    })
    await mockBackendHealthy(page)
    // Mock ONLY the correct /v1 path — if the app failed to normalize, the
    // request would hit /chat/completions (unmocked) and no reply would render.
    await mockLmStudioChat(page, 'Local model reply: recon queued on the target.')

    await page.goto('/')
    const input = page.getByPlaceholder('Message HexStrike…')
    await input.fill('hello local model')
    await input.press('Enter')

    await expect(page.getByRole('main').getByText('Local model reply: recon queued on the target.')).toBeVisible({ timeout: 15_000 })
  })

  test('example prompt populates the composer', async ({ page }) => {
    await seedSettings(page)
    await mockBackendHealthy(page)
    await page.goto('/')

    await page.getByText('What subdomains does example.com have?').click()
    await expect(page.getByPlaceholder('Message HexStrike…')).toHaveValue('What subdomains does example.com have?')
  })
})

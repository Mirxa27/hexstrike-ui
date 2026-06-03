import { test, expect } from '@playwright/test'
import { seedSettings, mockBackendHealthy, mockBackendDown, mockOpenAIModels } from './helpers'

test.describe('App shell & navigation', () => {
  test('landing page renders the hero and example prompts', async ({ page }) => {
    await seedSettings(page)
    await mockBackendHealthy(page)
    await page.goto('/')

    // Brand header is always present.
    await expect(page.getByRole('banner').getByText('HexStrike', { exact: true })).toBeVisible()
    // Empty-state hero + at least one starter prompt.
    await expect(page.getByRole('heading', { name: 'HexStrike AI' })).toBeVisible()
    await expect(page.getByText('Scan example.com for open ports and services')).toBeVisible()
    // Composer textarea is present and enabled.
    await expect(page.getByPlaceholder('Message HexStrike…')).toBeEnabled()
  })

  test('connects to a healthy backend and populates the tool catalog', async ({ page }) => {
    await seedSettings(page)
    await mockBackendHealthy(page)
    await page.goto('/')

    // Connection indicator shows a tool count once /health resolves.
    await expect(page.getByText(/\d+ tools/)).toBeVisible()
    // Inferred categories appear in the sidebar.
    await expect(page.getByText('Network Reconnaissance')).toBeVisible()
    await expect(page.getByText('HexStrike System')).toBeVisible()
  })

  test('shows a graceful disconnected state when the backend is down', async ({ page }) => {
    await seedSettings(page)
    await mockBackendDown(page)
    await page.goto('/')

    await expect(page.getByText('disconnected')).toBeVisible()
    await expect(page.getByText('Backend unreachable')).toBeVisible()
    // Retry affordance is offered.
    await expect(page.getByRole('button', { name: /Retry connection/i })).toBeVisible()
  })

  test('switches between workspace tabs', async ({ page }) => {
    await seedSettings(page)
    await mockBackendHealthy(page)
    await page.goto('/')

    await page.getByTitle('Network', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Network Reconnaissance' })).toBeVisible()

    await page.getByTitle('Files', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'File Investigation' })).toBeVisible()

    await page.getByTitle('Autonomous', { exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Autonomous Intelligence' })).toBeVisible()

    await page.getByTitle('AI Chat', { exact: true }).click()
    await expect(page.getByPlaceholder('Message HexStrike…')).toBeVisible()
  })

  test('Settings page renders and fetches models', async ({ page }) => {
    await seedSettings(page)
    await mockBackendHealthy(page)
    await mockOpenAIModels(page, ['gpt-4o', 'gpt-4o-mini', 'o1'])
    await page.goto('/settings')

    await expect(page.getByRole('heading', { name: 'AI Provider Configuration' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Anthropic' })).toBeVisible()

    // Fetch models populates the select with the mocked list.
    await page.getByRole('button', { name: 'Fetch' }).click()
    await expect(page.locator('select option', { hasText: 'o1' }).first()).toBeAttached()
  })
})

test.describe('Mobile web', () => {
  test('has no horizontal overflow at mobile width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile-only check')
    await seedSettings(page)
    await mockBackendHealthy(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'HexStrike AI' })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    // Allow a 1px rounding tolerance.
    expect(overflow).toBeLessThanOrEqual(1)

    // Composer + send control remain reachable on small screens.
    await expect(page.getByPlaceholder('Message HexStrike…')).toBeVisible()
  })
})

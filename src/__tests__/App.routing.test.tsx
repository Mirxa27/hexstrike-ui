import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { AppProvider } from '../AppContext'
import { ToasterProvider } from '../components/Toaster'

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToasterProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToasterProvider>
    </MemoryRouter>
  )
}

describe('App routing', () => {
  const origFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/api/tools')) {
        return new Response(JSON.stringify({ tools: [], categories: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    vi.restoreAllMocks()
  })

  it('renders chat workspace on /', async () => {
    renderWithRouter('/')
    expect(await screen.findByPlaceholderText(/Message HexStrike/i)).toBeInTheDocument()
  })

  it('renders settings on /settings', async () => {
    renderWithRouter('/settings')
    expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument()
  })
})

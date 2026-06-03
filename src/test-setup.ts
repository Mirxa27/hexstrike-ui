// Vitest setup: pulls in jest-dom matchers so tests can use
// .toBeInTheDocument(), .toHaveTextContent(), etc. against rendered
// React components.
import '@testing-library/jest-dom/vitest'

// Mock localStorage for test environment
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    key: (index: number) => Object.keys(store)[index] || null,
    length: Object.keys(store).length,
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock other browser APIs that might be missing
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

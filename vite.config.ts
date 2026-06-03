/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    env.VITE_DEV_PROXY_TARGET ||
    `http://${env.VITE_DEV_BACKEND_HOST || '127.0.0.1'}:${env.VITE_DEV_BACKEND_PORT || '8888'}`

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/health': {
          target: proxyTarget,
          changeOrigin: true,
        },
        // Mirror Docker nginx: browser calls same-origin `/api/*`, Vite forwards to HexStrike.
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    // Production hardening (P3-15): no source maps in prod, give the
    // chunker the heavy node_modules to split out, and bump the warning
    // threshold to a realistic value for an app of this size.
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('mdast-') || id.includes('hast-')) {
              return 'vendor-markdown'
            }
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('react-router')) return 'vendor-router'
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            return undefined
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})

/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle, AlertTriangle, Info, XCircle, X } from 'lucide-react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  /** ms until auto-dismiss; 0 = sticky. Default 4000. */
  ttl?: number
  /** Optional action label/handler (e.g. "Retry"). */
  action?: { label: string; onClick: () => void }
}

interface ToasterApi {
  toast: (t: Omit<Toast, 'id'>) => string
  success: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message' | 'variant'>>) => string
  error: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message' | 'variant'>>) => string
  warning: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message' | 'variant'>>) => string
  info: (message: string, opts?: Partial<Omit<Toast, 'id' | 'message' | 'variant'>>) => string
  dismiss: (id: string) => void
}

const ToasterContext = createContext<ToasterApi | null>(null)

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: ReactNode; text: string; bg: string }> = {
  success: {
    border: 'border-l-[#00ff41] border-r-transparent border-t-transparent border-b-transparent',
    text: 'text-[#00ff41]',
    bg: 'bg-gradient-to-r from-[#0f0f1a]/95 to-[#0f0f1a]/80',
    icon: <CheckCircle size={14} strokeWidth={2.5} />,
  },
  error: {
    border: 'border-l-[#e63946] border-r-transparent border-t-transparent border-b-transparent',
    text: 'text-[#e63946]',
    bg: 'bg-gradient-to-r from-[#0f0f1a]/95 to-[#0f0f1a]/80',
    icon: <XCircle size={14} strokeWidth={2.5} />,
  },
  warning: {
    border: 'border-l-[#f59e0b] border-r-transparent border-t-transparent border-b-transparent',
    text: 'text-[#f59e0b]',
    bg: 'bg-gradient-to-r from-[#0f0f1a]/95 to-[#0f0f1a]/80',
    icon: <AlertTriangle size={14} strokeWidth={2.5} />,
  },
  info: {
    border: 'border-l-[#00d4ff] border-r-transparent border-t-transparent border-b-transparent',
    text: 'text-[#00d4ff]',
    bg: 'bg-gradient-to-r from-[#0f0f1a]/95 to-[#0f0f1a]/80',
    icon: <Info size={14} strokeWidth={2.5} />,
  },
}

export function ToasterProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const handle = timersRef.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timersRef.current.delete(id)
    }
  }, [])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ttl = t.ttl ?? 4000
    setToasts((prev) => [...prev, { ...t, id }])
    if (ttl > 0) {
      const handle = setTimeout(() => dismiss(id), ttl)
      timersRef.current.set(id, handle)
    }
    return id
  }, [dismiss])

  const api: ToasterApi = {
    toast,
    success: (message, opts) => toast({ message, variant: 'success', ...opts }),
    error: (message, opts) => toast({ message, variant: 'error', ttl: 6000, ...opts }),
    warning: (message, opts) => toast({ message, variant: 'warning', ttl: 5000, ...opts }),
    info: (message, opts) => toast({ message, variant: 'info', ...opts }),
    dismiss,
  }

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  return (
    <ToasterContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t, idx) => {
          const v = VARIANT_STYLES[t.variant]
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg bg-gradient-to-br from-[#0f0f1a] to-[#0a0a0f] text-xs font-mono shadow-2xl border-l border-r-0 border-t-0 border-b-0 max-w-[420px] animate-slide-in
                ${v.border} ${v.text}`}
              style={{
                animationDelay: `${idx * 50}ms`,
                boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset',
              }}
            >
              <span className={`shrink-0 mt-0.5 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]`}>{v.icon}</span>
              <span className="flex-1 text-[#e2e8f0] leading-relaxed whitespace-pre-wrap break-words">
                {t.message}
              </span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    dismiss(t.id)
                  }}
                  className={`shrink-0 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider border ${v.border} ${v.text} hover:brightness-125 transition-all active:scale-95`}
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-[#6b7280] hover:text-[#e2e8f0] transition-colors p-0.5 rounded-full hover:bg-white/5"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </ToasterContext.Provider>
  )
}

let warnedNoProvider = false

/** Warn once, at call time (not during render), that there's no provider. */
function warnNoToasterProvider(): void {
  if (warnedNoProvider) return
  warnedNoProvider = true
  console.warn('useToaster() called outside <ToasterProvider> — toast calls are no-ops.')
}

export function useToaster(): ToasterApi {
  const ctx = useContext(ToasterContext)
  if (!ctx) {
    // Keep a no-op fallback so components remain usable in isolation (e.g.
    // unit tests render them without a provider). The no-ops warn the first
    // time they're actually invoked so a missing <ToasterProvider> isn't
    // silently swallowed — the side effect runs in a handler, not in render.
    return {
      toast: () => { warnNoToasterProvider(); return '' },
      success: () => { warnNoToasterProvider(); return '' },
      error: () => { warnNoToasterProvider(); return '' },
      warning: () => { warnNoToasterProvider(); return '' },
      info: () => { warnNoToasterProvider(); return '' },
      dismiss: () => { warnNoToasterProvider() },
    }
  }
  return ctx
}


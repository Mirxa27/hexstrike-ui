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

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: ReactNode; text: string }> = {
  success: {
    border: 'border-[#00ff41]/50',
    text: 'text-[#00ff41]',
    icon: <CheckCircle size={14} />,
  },
  error: {
    border: 'border-[#e63946]/50',
    text: 'text-[#e63946]',
    icon: <XCircle size={14} />,
  },
  warning: {
    border: 'border-[#f59e0b]/50',
    text: 'text-[#f59e0b]',
    icon: <AlertTriangle size={14} />,
  },
  info: {
    border: 'border-[#00d4ff]/50',
    text: 'text-[#00d4ff]',
    icon: <Info size={14} />,
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
        {toasts.map((t) => {
          const v = VARIANT_STYLES[t.variant]
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-lg border bg-[#0f0f1a] text-xs font-mono shadow-lg max-w-md animate-fade-in ${v.border}`}
            >
              <span className={`shrink-0 mt-0.5 ${v.text}`}>{v.icon}</span>
              <span className="flex-1 text-[#e2e8f0] leading-snug whitespace-pre-wrap">
                {t.message}
              </span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick()
                    dismiss(t.id)
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${v.border} ${v.text} hover:bg-[#1a1a2e]`}
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-[#6b7280] hover:text-[#e2e8f0]"
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

export function useToaster(): ToasterApi {
  const ctx = useContext(ToasterContext)
  if (!ctx) {
    // Allow callers outside the provider to no-op rather than crash.
    return {
      toast: () => '',
      success: () => '',
      error: () => '',
      warning: () => '',
      info: () => '',
      dismiss: () => {},
    }
  }
  return ctx
}

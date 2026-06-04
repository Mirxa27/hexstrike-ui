
import type { ChatSession, Message } from './types'

const HISTORY_KEY = 'hexstrike-chat-history'
const MAX_SESSIONS = 50

export interface ChatHistoryStore {
  sessions: ChatSession[]
  currentSessionId: string | null
  loadSessions: () => ChatSession[]
  saveSession: (session: ChatSession) => void
  deleteSession: (id: string) => void
  clearAll: () => void
  getSession: (id: string) => ChatSession | null
  createSession: (title?: string) => ChatSession
  updateSession: (id: string, messages: Message[], title?: string) => void
  exportSessions: () => string
  importSessions: (json: string) => { success: boolean; imported: number }
}

function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Browser event name AppContext listens on to surface storage-quota toasts. */
export const STORAGE_QUOTA_EVENT = 'hexstrike:storage-quota'

function notifyQuota(recovered: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_QUOTA_EVENT, { detail: { recovered } }))
}

/** True for the various browser spellings of "localStorage is full". */
function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
  )
}

/** Shape-validate an untrusted imported session before trusting it. */
function isValidSession(s: unknown): s is ChatSession {
  const sess = s as Partial<ChatSession> | null
  return (
    !!sess &&
    typeof sess.id === 'string' &&
    typeof sess.title === 'string' &&
    Array.isArray(sess.messages) &&
    typeof sess.createdAt === 'number' &&
    typeof sess.updatedAt === 'number'
  )
}

function generateTitle(messages: Message[]): string {
  const userMsg = messages.find((m) => m.role === 'user')
  if (!userMsg) return 'New Chat'
  const content = userMsg.content.trim()
  return content.slice(0, 50) + (content.length > 50 ? '...' : '')
}

/**
 * Drop heavyweight payloads (notably base64 file bytes attached via
 * `file_attach` tool calls) from a message list before it's persisted to
 * localStorage. The bytes only need to live for the duration of the
 * in-memory conversation; persisting them would saturate the browser's
 * ~5 MB per-origin quota after a single near-limit upload.
 */
function sanitizeMessagesForStorage(messages: Message[]): Message[] {
  // Minimal file metadata kept after stripping base64 `data`
  type FileMeta = { id: string; name: string; category: string }

  return messages.map((m) => {
    if (!m.toolCalls?.length) return m
    return {
      ...m,
      toolCalls: m.toolCalls.map((tc) => {
        if (tc?.name !== 'file_attach' || !tc.arguments?.files) return tc
        const files = (tc.arguments.files as FileMeta[]).map((f) => ({
          id: f.id,
          name: f.name,
          category: f.category,
          // intentionally drop `data` — the base64 blob is too big for
          // localStorage and isn't useful after the message is sent.
        }))
        return { ...tc, arguments: { ...tc.arguments, files } }
      }),
    }
  })
}

export function createChatHistoryStore(): ChatHistoryStore {
  let sessions: ChatSession[] = []
  let currentSessionId: string | null = null

  // Load from localStorage
  const loadSessions = (): ChatSession[] => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) {
        const loaded = JSON.parse(raw) as ChatSession[]
        sessions = loaded.sort((a, b) => b.updatedAt - a.updatedAt)
        return sessions
      }
    } catch (e) {
      console.error('Failed to load chat history:', e)
    }
    sessions = []
    return sessions
  }

  // Save to localStorage
  const saveToStorage = () => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions))
    } catch (e) {
      // Quota exceeded must NOT silently lose data. Self-heal by dropping the
      // oldest sessions and retrying so recent chats still persist, then
      // notify the UI so it can warn the user.
      if (isQuotaError(e)) {
        while (sessions.length > 1) {
          const keep = Math.max(1, Math.floor(sessions.length / 2))
          sessions = sessions.slice(0, keep)
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions))
            notifyQuota(true)
            return
          } catch {
            /* still too big — keep trimming */
          }
        }
        notifyQuota(false)
      }
      console.error('Failed to save chat history:', e)
    }
  }

  // Create new session
  const createSession = (title?: string): ChatSession => {
    const session: ChatSession = {
      id: generateId(),
      title: title || 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
    }
    sessions.unshift(session)
    // Limit sessions
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions.slice(0, MAX_SESSIONS)
    }
    saveToStorage()
    currentSessionId = session.id
    return session
  }

  // Save/update session
  const saveSession = (session: ChatSession) => {
    const idx = sessions.findIndex((s) => s.id === session.id)
    if (idx >= 0) {
      sessions[idx] = { ...session, updatedAt: Date.now() }
    } else {
      sessions.unshift({ ...session, updatedAt: Date.now() })
    }
    // Re-sort by updated time
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions.slice(0, MAX_SESSIONS)
    }
    saveToStorage()
  }

  // Update session messages
  const updateSession = (id: string, messages: Message[], title?: string) => {
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx >= 0) {
      // Strip large in-memory blobs (e.g. base64 file payloads from
      // file_attach tool calls) before persisting to localStorage —
      // keeping them would blow the ~5 MB browser quota and silently
      // break save/export/import.
      sessions[idx].messages = sanitizeMessagesForStorage(messages)
      sessions[idx].updatedAt = Date.now()
      if (title) sessions[idx].title = title
      else if (sessions[idx].title === 'New Chat' || sessions[idx].title.startsWith('New Chat')) {
        sessions[idx].title = generateTitle(messages)
      }
      saveToStorage()
    }
  }

  // Get session by ID
  const getSession = (id: string): ChatSession | null => {
    return sessions.find((s) => s.id === id) || null
  }

  // Delete session
  const deleteSession = (id: string) => {
    sessions = sessions.filter((s) => s.id !== id)
    if (currentSessionId === id) {
      currentSessionId = null
    }
    saveToStorage()
  }

  // Clear all sessions
  const clearAll = () => {
    sessions = []
    currentSessionId = null
    saveToStorage()
  }

  // Export sessions as JSON
  const exportSessions = (): string => {
    return JSON.stringify({ sessions, exportedAt: Date.now() }, null, 2)
  }

  // Import sessions from JSON
  const importSessions = (json: string): { success: boolean; imported: number } => {
    try {
      const data = JSON.parse(json)
      if (!Array.isArray(data.sessions)) {
        return { success: false, imported: 0 }
      }
      // Only trust sessions that actually have the required shape — a
      // malformed entry (missing id/messages/timestamps) would crash the
      // history UI (e.g. `key={chat.id}`) once rendered.
      const imported: ChatSession[] = (data.sessions as unknown[]).filter(isValidSession)
      if (data.sessions.length > 0 && imported.length === 0) {
        return { success: false, imported: 0 }
      }
      for (const session of imported) {
        const existing = sessions.findIndex((s) => s.id === session.id)
        if (existing >= 0) {
          sessions[existing] = session
        } else {
          sessions.push(session)
        }
      }
      sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(0, MAX_SESSIONS)
      }
      saveToStorage()
      return { success: true, imported: imported.length }
    } catch (e) {
      return { success: false, imported: 0 }
    }
  }

  // Initialize
  loadSessions()

  return {
    // `sessions` previously captured the array reference at construction
    // time, so any subsequent reassignment inside the closure (load,
    // import, clear, delete) would leave callers reading a stale list.
    // Use a getter so each access returns the live in-memory list.
    get sessions() { return sessions },
    get currentSessionId() { return currentSessionId },
    set currentSessionId(id: string | null) { currentSessionId = id },
    loadSessions,
    saveSession,
    deleteSession,
    clearAll,
    getSession,
    createSession,
    updateSession,
    exportSessions,
    importSessions,
  }
}

// Singleton instance
export const chatHistory = createChatHistoryStore()

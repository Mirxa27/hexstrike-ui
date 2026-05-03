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

function generateTitle(messages: Message[]): string {
  const userMsg = messages.find((m) => m.role === 'user')
  if (!userMsg) return 'New Chat'
  const content = userMsg.content.trim()
  return content.slice(0, 50) + (content.length > 50 ? '...' : '')
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
      sessions[idx].messages = messages
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
      const imported: ChatSession[] = data.sessions
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
    sessions,
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

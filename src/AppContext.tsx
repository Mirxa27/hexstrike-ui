import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { AISettings, HexstrikeCategory, HexstrikeTool, WorkspaceType, ToolExecution, QuickAction } from './types'
import { useSettingsStore } from './store'
import { fetchHexstrikeTools } from './api'
import { chatHistory } from './chatHistory'
import { useToaster } from './components/Toaster'

interface AppContextValue {
  settings: AISettings
  updateSettings: (partial: Partial<AISettings>) => void
  resetSettings: () => void
  /** Wipe API key + base URL from stored settings (P1-5). */
  clearAllSecrets: () => void
  tools: HexstrikeTool[]
  categories: HexstrikeCategory[]
  activeCategories: Set<string>
  toggleCategory: (name: string) => void
  setAllCategories: (active: boolean) => void
  activeTools: HexstrikeTool[]
  hexstrikeConnected: boolean
  hexstrikeError: string | null
  hexstrikeLoading: boolean
  refreshHexstrike: () => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  // Chat History
  loadChatHistory: () => void
  saveCurrentChat: (messages: any[], title?: string) => void
  chatHistory: any[]
  currentChatId: string | null
  setCurrentChatId: (id: string | null) => void
  deleteChat: (id: string) => void
  clearAllChats: () => void
  exportChats: () => string
  importChats: (json: string) => { success: boolean; imported: number }
  // Workspace
  activeWorkspace: WorkspaceType
  setActiveWorkspace: (type: WorkspaceType) => void
  workspaceExecutions: ToolExecution[]
  addWorkspaceExecution: (exec: Omit<ToolExecution, 'id' | 'timestamp'>) => void
  setWorkspaceExecutions: (execs: ToolExecution[]) => void
  clearWorkspaceExecutions: () => void
  recentTools: string[]
  addRecentTool: (toolName: string) => void
  quickActions: QuickAction[]
  // Token usage meter (P3-9)
  sessionUsage: { in: number; out: number }
  addSessionUsage: (delta: { in?: number; out?: number }) => void
  resetSessionUsage: () => void
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'quick-nmap', label: 'Quick Port Scan', toolName: 'nmap_scan', params: { target: '' }, category: 'network_reconnaissance' },
  { id: 'quick-subdomain', label: 'Subdomain Enum', toolName: 'subfinder_enum', params: { target: '' }, category: 'network_reconnaissance' },
  { id: 'quick-httpx', label: 'HTTP Probe', toolName: 'httpx_probing', params: { target: '' }, category: 'web_application_security' },
  { id: 'quick-nuclei', label: 'Vuln Scan', toolName: 'nuclei_templates', params: { target: '' }, category: 'web_application_security' },
  { id: 'quick-sqlmap', label: 'SQL Injection Test', toolName: 'sqlmap_injection', params: { target: '' }, category: 'sql_injection' },
  { id: 'quick-shodan', label: 'Shodan Search', toolName: 'shodan_api', params: { target: '' }, category: 'osint' },
]

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings, resetSettings } = useSettingsStore()
  const toaster = useToaster()
  const [tools, setTools] = useState<HexstrikeTool[]>([])
  const [categories, setCategories] = useState<HexstrikeCategory[]>([])
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set())
  const [hexstrikeConnected, setHexstrikeConnected] = useState(false)
  const [hexstrikeError, setHexstrikeError] = useState<string | null>(null)
  const [hexstrikeLoading, setHexstrikeLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Chat History State
  const [chatHistoryList, setChatHistoryList] = useState<any[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)

  // Workspace State
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceType>('chat')
  const [workspaceExecutions, setWorkspaceExecutions] = useState<ToolExecution[]>([])
  const [recentTools, setRecentTools] = useState<string[]>([])
  // Per-session token usage (P3-9). Reset whenever the user starts a new chat.
  const [sessionUsage, setSessionUsage] = useState<{ in: number; out: number }>({ in: 0, out: 0 })
  const addSessionUsage = useCallback((delta: { in?: number; out?: number }) => {
    setSessionUsage((prev) => ({
      in: prev.in + (delta.in || 0),
      out: prev.out + (delta.out || 0),
    }))
  }, [])
  const resetSessionUsage = useCallback(() => setSessionUsage({ in: 0, out: 0 }), [])

  // Track previous connection state so we only toast on state transitions.
  const wasConnectedRef = useRef<boolean | null>(null)

  const refreshHexstrike = useCallback(async () => {
    setHexstrikeLoading(true)
    try {
      setHexstrikeError(null)
      const data = await fetchHexstrikeTools(settings.hexstrikeUrl)
      setTools(data.tools)
      setCategories(data.categories)
      setActiveCategories(new Set(data.categories.map((c) => c.name)))
      setHexstrikeConnected(true)
      if (wasConnectedRef.current === false) {
        toaster.success(`HexStrike connected — ${data.tools.length} tools available`)
      }
      wasConnectedRef.current = true
    } catch (err: any) {
      setHexstrikeConnected(false)
      const msg = err?.message ?? 'Connection failed'
      setHexstrikeError(msg)
      if (wasConnectedRef.current !== false) {
        toaster.error(`HexStrike unreachable: ${msg}`, {
          action: { label: 'Retry', onClick: () => { void refreshHexstrike() } },
        })
      }
      wasConnectedRef.current = false
    } finally {
      setHexstrikeLoading(false)
    }
  }, [settings.hexstrikeUrl, toaster])

  const clearAllSecrets = useCallback(() => {
    updateSettings({ apiKey: '', baseUrl: '' })
    toaster.success('All stored API keys & base URLs have been cleared.')
  }, [updateSettings, toaster])

  useEffect(() => {
    refreshHexstrike()
  }, [refreshHexstrike])

  // Load chat history on mount
  useEffect(() => {
    setChatHistoryList(chatHistory.sessions)
    if (chatHistory.sessions.length > 0 && !currentChatId) {
      setCurrentChatId(chatHistory.sessions[0].id)
    }
  }, [])

  const toggleCategory = useCallback((name: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const setAllCategories = useCallback(
    (active: boolean) => {
      if (active) setActiveCategories(new Set(categories.map((c) => c.name)))
      else setActiveCategories(new Set())
    },
    [categories]
  )

  // Chat History Functions
  const loadChatHistory = useCallback(() => {
    const sessions = chatHistory.loadSessions()
    setChatHistoryList(sessions)
  }, [])

  const saveCurrentChat = useCallback((messages: any[], title?: string) => {
    let sessionId = currentChatId
    if (!sessionId) {
      const session = chatHistory.createSession(title)
      sessionId = session.id
      setCurrentChatId(sessionId)
    }
    chatHistory.updateSession(sessionId, messages, title)
    setChatHistoryList([...chatHistory.sessions])
  }, [currentChatId])

  const deleteChat = useCallback((id: string) => {
    chatHistory.deleteSession(id)
    setChatHistoryList([...chatHistory.sessions])
    if (currentChatId === id) {
      setCurrentChatId(null)
    }
  }, [currentChatId])

  const clearAllChats = useCallback(() => {
    chatHistory.clearAll()
    setChatHistoryList([])
    setCurrentChatId(null)
  }, [])

  const exportChats = useCallback(() => {
    return chatHistory.exportSessions()
  }, [])

  const importChats = useCallback((json: string) => {
    const result = chatHistory.importSessions(json)
    setChatHistoryList([...chatHistory.sessions])
    return result
  }, [])

  // Workspace Functions
  const addWorkspaceExecution = useCallback((exec: Omit<ToolExecution, 'id' | 'timestamp'>) => {
    const newExec: ToolExecution = {
      ...exec,
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    }
    // Single setter that both appends and trims to the most recent 50.
    // The previous implementation called setWorkspaceExecutions twice —
    // under React 18+ batching, the second call's `prev` could be the
    // *pre-append* array, silently dropping the new exec.
    setWorkspaceExecutions((prev) => {
      const merged = [...prev, newExec]
      return merged.length > 50 ? merged.slice(-50) : merged
    })
  }, [])

  const clearWorkspaceExecutions = useCallback(() => {
    setWorkspaceExecutions([])
  }, [])

  const addRecentTool = useCallback((toolName: string) => {
    setRecentTools((prev) => {
      const filtered = prev.filter((t) => t !== toolName)
      return [toolName, ...filtered].slice(0, 20)
    })
  }, [])

  // Tools have display category names ("Network Reconnaissance") but activeCategories
  // uses internal snake_case keys ("network_reconnaissance") — normalize before comparing.
  const normCat = (s: string) => s.toLowerCase().replace(/[\s&]+/g, '_').replace(/[^a-z0-9_]/g, '')

  const activeTools =
    activeCategories.size === 0
      ? tools
      : tools.filter((t) => activeCategories.has(normCat(t.category)))

  return (
    <AppContext.Provider
      value={{
        settings,
        updateSettings,
        resetSettings,
        clearAllSecrets,
        tools,
        categories,
        activeCategories,
        toggleCategory,
        setAllCategories,
        activeTools,
        hexstrikeConnected,
        hexstrikeError,
        hexstrikeLoading,
        refreshHexstrike,
        sidebarOpen,
        setSidebarOpen,
        // Chat History
        loadChatHistory,
        saveCurrentChat,
        chatHistory: chatHistoryList,
        currentChatId,
        setCurrentChatId,
        deleteChat,
        clearAllChats,
        exportChats,
        importChats,
        // Workspace
        activeWorkspace,
        setActiveWorkspace,
        workspaceExecutions,
        addWorkspaceExecution,
        setWorkspaceExecutions,
        clearWorkspaceExecutions,
        recentTools,
        addRecentTool,
        quickActions: QUICK_ACTIONS,
        sessionUsage,
        addSessionUsage,
        resetSessionUsage,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}


import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  MessageSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  Zap,
  CheckSquare,
  Square,
  RefreshCw,
  History,
  Network,
  Globe,
  Shield,
  Key,
  FileSearch,
  Smartphone,
  Wifi,
  Users,
  Brain,
  Upload,
} from 'lucide-react'
import { useApp } from '../AppContext'

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
import { ChatHistorySidebar } from './ChatHistory'
import { WorkspacePanel } from './WorkspacePanel'
import { AutonomousWorkspace } from './AutonomousWorkspace'
import { FileInvestigation } from './FileInvestigation'
import type { WorkspaceType } from '../types'

function HexStrikeLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" stroke="#e63946" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="4" fill="#e63946" />
      <line x1="16" y1="2" x2="16" y2="8" stroke="#e63946" strokeWidth="1.5" />
      <line x1="16" y1="24" x2="16" y2="30" stroke="#e63946" strokeWidth="1.5" />
      <line x1="2" y1="16" x2="8" y2="16" stroke="#e63946" strokeWidth="1.5" />
      <line x1="24" y1="16" x2="30" y2="16" stroke="#e63946" strokeWidth="1.5" />
      {/* Skull */}
      <ellipse cx="16" cy="15" rx="4.5" ry="4" fill="#0a0a0f" stroke="#e63946" strokeWidth="0.8" />
      <circle cx="14.2" cy="14.5" r="1.2" fill="#e63946" />
      <circle cx="17.8" cy="14.5" r="1.2" fill="#e63946" />
      <path d="M14 17.5 h4 M14.5 17.5 v1 M17.5 17.5 v1 M16 17.5 v1" stroke="#e63946" strokeWidth="0.7" />
    </svg>
  )
}

const WORKSPACE_TABS: { type: WorkspaceType; icon: React.ElementType; label: string }[] = [
  { type: 'chat', icon: MessageSquare, label: 'AI Chat' },
  { type: 'autonomous', icon: Brain, label: 'Autonomous' },
  { type: 'files', icon: Upload, label: 'Files' },
  { type: 'osint', icon: Search, label: 'OSINT' },
  { type: 'network', icon: Network, label: 'Network' },
  { type: 'web', icon: Globe, label: 'Web' },
  { type: 'exploitation', icon: Shield, label: 'Exploit' },
  { type: 'password', icon: Key, label: 'Password' },
  { type: 'forensics', icon: FileSearch, label: 'Forensics' },
  { type: 'mobile', icon: Smartphone, label: 'Mobile' },
  { type: 'wireless', icon: Wifi, label: 'Wireless' },
  { type: 'social', icon: Users, label: 'Social' },
]

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    categories,
    activeCategories,
    toggleCategory,
    setAllCategories,
    hexstrikeConnected,
    hexstrikeError,
    hexstrikeLoading,
    refreshHexstrike,
    tools,
    sidebarOpen,
    setSidebarOpen,
    activeWorkspace,
    setActiveWorkspace,
    sessionUsage,
    resetSessionUsage,
    chatMessages,
    setChatMessages,
  } = useApp()
  const isSettingsPage = location.pathname === '/settings'

  const [search, setSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const filtered = search.trim()
    ? categories.filter(
        (c) =>
          c.display_name.toLowerCase().includes(search.toLowerCase()) ||
          c.tools.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : categories

  const allActive = categories.length > 0 && activeCategories.size === categories.length

  return (
      <div className="flex flex-col h-screen bg-hex-bg text-hex-text font-mono overflow-hidden">
      {/* ── Top Navbar ── */}
        <header className="flex items-center justify-between px-4 h-12 border-b border-hex-border bg-hex-surface z-20 shrink-0">
        <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 rounded hover:bg-hex-border transition-colors text-hex-text-dim hover:text-hex-text"
              title="Toggle sidebar"
            >
            {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="flex items-center gap-2">
            <HexStrikeLogo size={24} />
            <span className="text-hex-accent font-bold text-sm tracking-widest uppercase">
              HexStrike
            </span>
            <span className="text-hex-text-dim text-xs tracking-widest">AI</span>
          </div>
        </div>

        {/* Workspace Tabs — scroll horizontally on narrow screens */}
        <div className="flex-1 min-w-0 flex justify-center px-1">
          <div
            className="flex items-center gap-0.5 overflow-x-auto max-w-full py-1 px-1 rounded-lg bg-hex-bg/80 border border-hex-border/60 scroll-smooth touch-pan-x"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
          {WORKSPACE_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeWorkspace === tab.type
            return (
              <button
                key={tab.type}
                onClick={() => {
                  setActiveWorkspace(tab.type)
                  // Only navigate if we're on settings page
                  if (location.pathname === '/settings' && tab.type === 'chat') {
                    navigate('/')
                  }
                }}
                className={`flex items-center gap-1 sm:gap-1.5 shrink-0 px-2 sm:px-2.5 py-1.5 rounded-md text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-hex-accent/25 text-[#ff6b7a] shadow-[0_0_12px_-2px_rgba(230,57,70,0.35)]'
                    : 'text-hex-muted hover:text-hex-text hover:bg-hex-border/80'
                }`}
                title={tab.label}
              >
                <Icon size={13} className="shrink-0 opacity-90" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* History Toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded transition-colors ${
              showHistory
                ? 'bg-hex-accent/20 text-hex-accent'
                : 'text-hex-text-dim hover:text-hex-text hover:bg-hex-border'
            }`}
            title="Chat history"
          >
            <History size={14} />
          </button>

          {/* Token usage meter (P3-9) — clicking resets the per-session counter */}
          {(sessionUsage.in > 0 || sessionUsage.out > 0) && (
            <button
              onClick={resetSessionUsage}
              className="ml-2 flex items-center gap-1 text-[10px] font-mono text-hex-muted hover:text-hex-text px-2 py-1 border border-hex-border rounded"
              title={`Click to reset. Session: ${sessionUsage.in} in / ${sessionUsage.out} out tokens`}
            >
              <span className="text-[#00d4ff]">↑{formatTokenCount(sessionUsage.in)}</span>
              <span className="text-[#94a3b8]">/</span>
              <span className="text-[#00ff41]">↓{formatTokenCount(sessionUsage.out)}</span>
            </button>
          )}

          {/* Settings */}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `p-1.5 rounded transition-colors ${
                isActive
                  ? 'bg-hex-accent/20 text-hex-accent'
                  : 'text-hex-text-dim hover:text-hex-text hover:bg-hex-border'
              }`
            }
            title="Settings"
          >
            <Settings size={14} />
          </NavLink>

          {/* Connection status */}
          <div className="flex items-center gap-2 ml-2">
            <div className="flex items-center gap-1.5 text-xs">
              <div
                className={`w-2 h-2 rounded-full ${
                  hexstrikeConnected ? 'bg-hex-green animate-pulse' : 'bg-hex-accent'
                }`}
              />
              <span className={hexstrikeConnected ? 'text-hex-green' : 'text-hex-accent'}>
                {hexstrikeConnected ? `${tools.length} tools` : 'disconnected'}
              </span>
            </div>
            <button
              onClick={refreshHexstrike}
              className="p-1 rounded hover:bg-[#1a1a2e] text-[#94a3b8] hover:text-[#00d4ff] transition-colors"
              title={hexstrikeError ?? 'Refresh connection'}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Tools Sidebar ── */}
        <aside
          className={`shrink-0 flex flex-col border-r border-hex-border bg-hex-surface overflow-hidden transition-all duration-200 ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
        >
          <div className="flex flex-col h-full min-w-[280px]">
            {/* Search */}
            <div className="p-3 border-b border-hex-border">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-hex-muted"
                />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-hex-bg border border-hex-border rounded px-3 py-1.5 pl-8 text-xs text-hex-text placeholder-hex-muted focus:outline-none focus:border-hex-accent/50 input-field"
                />
              </div>
            </div>

            {/* Toggle all */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-hex-border">
              <span className="text-[10px] text-hex-muted uppercase tracking-wider">
                Tool Categories
              </span>
              <button
                onClick={() => setAllCategories(!allActive)}
                className="flex items-center gap-1 text-[10px] text-hex-text-dim hover:text-hex-text transition-colors"
              >
                {allActive ? <CheckSquare size={11} /> : <Square size={11} />}
                {allActive ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {/* Category list */}
            <div className="flex-1 overflow-y-auto py-2">
              {hexstrikeLoading && categories.length === 0 ? (
                // Skeleton loading state while initial fetch is in flight
                <div className="px-3 py-2 space-y-2" aria-busy="true" aria-label="Loading tool categories">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-7 rounded bg-hex-border/40 animate-pulse"
                      style={{ animationDelay: `${i * 80}ms` }}
                    />
                  ))}
                </div>
              ) : !hexstrikeConnected && hexstrikeError ? (
                <div className="px-4 py-6 text-center space-y-3">
                  <Zap size={24} className="mx-auto text-hex-accent" />
                  <div>
                    <p className="text-xs font-medium text-hex-accent mb-1">Backend unreachable</p>
                    <p className="text-[10px] text-hex-muted break-words">{hexstrikeError}</p>
                  </div>
                  <button
                    onClick={refreshHexstrike}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-hex-accent/40 text-hex-accent hover:bg-hex-accent/10 transition-colors"
                  >
                    <RefreshCw size={12} />
                    Retry connection
                  </button>
                </div>
              ) : categories.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Zap size={24} className="mx-auto mb-2 text-hex-border" />
                  <p className="text-xs text-hex-muted">
                    {hexstrikeConnected ? 'No categories found' : 'Connect to HexStrike to see tools'}
                  </p>
                </div>
              ) : (
                filtered.map((cat) => {
                  const isActive = activeCategories.has(cat.name)
                  return (
                    <button
                      key={cat.name}
                      onClick={() => toggleCategory(cat.name)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-hex-border/50 ${
                        isActive ? 'text-hex-text' : 'text-hex-muted'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-2 h-2 rounded-sm shrink-0 transition-colors ${
                            isActive ? 'bg-hex-accent' : 'bg-hex-border'
                          }`}
                        />
                        <span className="text-xs truncate">{cat.display_name}</span>
                      </div>
                      <span
                        className={`text-[10px] shrink-0 ml-2 px-1.5 py-0.5 rounded ${
                          isActive
                            ? 'bg-hex-accent/20 text-hex-accent'
                            : 'bg-hex-border text-hex-muted'
                        }`}
                      >
                        {cat.tool_count}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-[#1a1a2e]">
              <p className="text-[10px] text-[#6b7280] text-center">
                {activeCategories.size}/{categories.length} categories active
              </p>
            </div>
          </div>
        </aside>

        {/* ── Chat History Sidebar ── */}
        <ChatHistorySidebar
          open={showHistory}
          onClose={() => setShowHistory(false)}
          onLoadChat={(loaded) => {
            setChatMessages(loaded)
            setActiveWorkspace('chat')
            navigate('/')
          }}
          currentMessages={chatMessages}
        />

        {/* ── Main content ── */}
        <main className="flex-1 overflow-hidden">
          {isSettingsPage ? (
            <Outlet />
          ) : activeWorkspace === 'chat' ? (
            <Outlet />
          ) : activeWorkspace === 'autonomous' ? (
            <AutonomousWorkspace workspaceType={activeWorkspace} tools={tools} />
          ) : activeWorkspace === 'files' ? (
            <FileInvestigation />
          ) : (
            <WorkspacePanel workspaceType={activeWorkspace} tools={tools} />
          )}
        </main>
      </div>
    </div>
  )
}

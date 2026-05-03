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

const WORKSPACE_TABS: { type: WorkspaceType; icon: any; label: string }[] = [
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
    refreshHexstrike,
    tools,
    sidebarOpen,
    setSidebarOpen,
    activeWorkspace,
    setActiveWorkspace,
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
    <div className="flex flex-col h-screen bg-[#0a0a0f] text-[#e2e8f0] font-mono overflow-hidden">
      {/* ── Top Navbar ── */}
      <header className="flex items-center justify-between px-4 h-12 border-b border-[#1a1a2e] bg-[#0f0f1a] z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-[#1a1a2e] transition-colors text-[#94a3b8] hover:text-[#e2e8f0]"
            title="Toggle sidebar"
          >
            {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="flex items-center gap-2">
            <HexStrikeLogo size={24} />
            <span className="text-[#e63946] font-bold text-sm tracking-widest uppercase">
              HexStrike
            </span>
            <span className="text-[#94a3b8] text-xs tracking-widest">AI</span>
          </div>
        </div>

        {/* Workspace Tabs */}
        <div className="flex items-center gap-1 px-2">
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[#e63946]/20 text-[#e63946]'
                    : 'text-[#6b7280] hover:text-[#e2e8f0] hover:bg-[#1a1a2e]'
                }`}
                title={tab.label}
              >
                <Icon size={13} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* History Toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded transition-colors ${
              showHistory
                ? 'bg-[#e63946]/20 text-[#e63946]'
                : 'text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1a1a2e]'
            }`}
            title="Chat history"
          >
            <History size={14} />
          </button>

          {/* Settings */}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `p-1.5 rounded transition-colors ${
                isActive
                  ? 'bg-[#e63946]/20 text-[#e63946]'
                  : 'text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1a1a2e]'
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
                  hexstrikeConnected ? 'bg-[#00ff41] animate-pulse' : 'bg-[#e63946]'
                }`}
              />
              <span className={hexstrikeConnected ? 'text-[#00ff41]' : 'text-[#e63946]'}>
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
          className={`shrink-0 flex flex-col border-r border-[#1a1a2e] bg-[#0f0f1a] overflow-hidden transition-all duration-200 ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
        >
          <div className="flex flex-col h-full min-w-[280px]">
            {/* Search */}
            <div className="p-3 border-b border-[#1a1a2e]">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6b7280]"
                />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded px-3 py-1.5 pl-8 text-xs text-[#e2e8f0] placeholder-[#6b7280] focus:outline-none focus:border-[#e63946]/50"
                />
              </div>
            </div>

            {/* Toggle all */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a2e]">
              <span className="text-[10px] text-[#6b7280] uppercase tracking-wider">
                Tool Categories
              </span>
              <button
                onClick={() => setAllCategories(!allActive)}
                className="flex items-center gap-1 text-[10px] text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
              >
                {allActive ? <CheckSquare size={11} /> : <Square size={11} />}
                {allActive ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            {/* Category list */}
            <div className="flex-1 overflow-y-auto py-2">
              {categories.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Zap size={24} className="mx-auto mb-2 text-[#1a1a2e]" />
                  <p className="text-xs text-[#6b7280]">
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
                      className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[#1a1a2e]/50 ${
                        isActive ? 'text-[#e2e8f0]' : 'text-[#6b7280]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={`w-2 h-2 rounded-sm shrink-0 transition-colors ${
                            isActive ? 'bg-[#e63946]' : 'bg-[#1a1a2e]'
                          }`}
                        />
                        <span className="text-xs truncate">{cat.display_name}</span>
                      </div>
                      <span
                        className={`text-[10px] shrink-0 ml-2 px-1.5 py-0.5 rounded ${
                          isActive
                            ? 'bg-[#e63946]/20 text-[#e63946]'
                            : 'bg-[#1a1a2e] text-[#6b7280]'
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
          onLoadChat={() => navigate('/')}
          currentMessages={[]}
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

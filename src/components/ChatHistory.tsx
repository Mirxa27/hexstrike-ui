import { useState, useRef, useEffect } from 'react'
import {
  MessageSquare,
  Trash2,
  Download,
  Upload,
  Search,
  Plus,
  X,
  Clock,
} from 'lucide-react'
import type { Message } from '../types'
import { useApp } from '../AppContext'
import { useToaster } from './Toaster'

interface ChatHistorySidebarProps {
  open: boolean
  onClose: () => void
  onLoadChat: (messages: Message[]) => void
  currentMessages: Message[]
}

export function ChatHistorySidebar({ open, onClose, onLoadChat, currentMessages }: ChatHistorySidebarProps) {
  const {
    chatHistory,
    currentChatId,
    setCurrentChatId,
    deleteChat,
    clearAllChats,
    exportChats,
    importChats,
    saveCurrentChat,
  } = useApp()

  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toaster = useToaster()

  // Auto-save current chat when messages change
  useEffect(() => {
    if (currentMessages.length > 0) {
      const timeout = setTimeout(() => {
        saveCurrentChat(currentMessages)
      }, 1000)
      return () => clearTimeout(timeout)
    }
  }, [currentMessages, saveCurrentChat])

  const filteredHistory = chatHistory.filter((chat: any) => {
    const query = searchQuery.toLowerCase()
    return (
      chat.title?.toLowerCase().includes(query) ||
      chat.messages?.some((m: Message) => m.content.toLowerCase().includes(query))
    )
  })

  const handleLoadChat = (chat: any) => {
    setCurrentChatId(chat.id)
    onLoadChat(chat.messages)
    onClose()
  }

  const handleNewChat = () => {
    setCurrentChatId(null)
    onLoadChat([])
    onClose()
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirm('Delete this chat?')) {
      deleteChat(id)
    }
  }

  const handleClearAll = () => {
    if (confirm('Delete all chat history? This cannot be undone.')) {
      clearAllChats()
    }
  }

  const handleExport = () => {
    const json = exportChats()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hexstrike-chats-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      try {
        const result = importChats(content)
        if (result.success) {
          toaster.success(`Imported ${result.imported} chat${result.imported === 1 ? '' : 's'}`)
        } else {
          toaster.error('Failed to import chats — file may be corrupt or in an unsupported format')
        }
      } catch (err: any) {
        toaster.error(`Import failed: ${err?.message ?? 'unknown error'}`)
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.onerror = () => {
      toaster.error('Could not read the selected file')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.readAsText(file)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full bg-[#0a0a0f] border-r border-[#1a1a2e] z-50 transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${open ? 'w-80' : 'w-0'} lg:translate-x-0 lg:w-72 lg:static lg:z-0`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-[#1a1a2e]">
            <h2 className="text-sm font-semibold text-[#e2e8f0]">Chat History</h2>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 hover:bg-[#1a1a2e] rounded text-[#6b7280]"
            >
              <X size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full bg-[#0f0f1a] border border-[#1a1a2e] rounded-lg pl-9 pr-3 py-2 text-sm text-[#e2e8f0] placeholder-[#6b7280] focus:border-[#e63946]/60 focus:outline-none"
              />
            </div>
          </div>

          {/* New Chat Button */}
          <div className="px-4 pb-3">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-[#e63946] hover:bg-[#c1121f] text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              New Chat
            </button>
          </div>

          {/* Actions */}
          <div className="px-4 pb-3 flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#0f0f1a] hover:bg-[#1a1a2e] border border-[#1a1a2e] rounded text-xs text-[#94a3b8] transition-colors"
            >
              <Download size={12} />
              Export
            </button>
            <button
              onClick={handleImport}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#0f0f1a] hover:bg-[#1a1a2e] border border-[#1a1a2e] rounded text-xs text-[#94a3b8] transition-colors"
            >
              <Upload size={12} />
              Import
            </button>
            {chatHistory.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-1.5 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-colors"
                title="Clear all"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {filteredHistory.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare size={32} className="text-[#1a1a2e] mx-auto mb-3" />
                <p className="text-sm text-[#6b7280]">
                  {searchQuery ? 'No chats found' : 'No chat history yet'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHistory.map((chat: any) => (
                  <div
                    key={chat.id}
                    onClick={() => handleLoadChat(chat)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors group ${
                      currentChatId === chat.id
                        ? 'bg-[#e63946]/10 border border-[#e63946]/30'
                        : 'bg-[#0f0f1a] border border-[#1a1a2e] hover:border-[#1a1a2e]/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-[#e2e8f0] truncate">
                          {chat.title || 'New Chat'}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock size={10} className="text-[#6b7280]" />
                          <span className="text-[10px] text-[#6b7280]">
                            {formatDate(chat.updatedAt)}
                          </span>
                          <span className="text-[#1a1a2e]">•</span>
                          <span className="text-[10px] text-[#6b7280]">
                            {chat.messages?.length || 0} messages
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, chat.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[#1a1a2e]">
            <div className="text-[10px] text-[#6b7280] text-center">
              {chatHistory.length} chats stored locally
            </div>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        className="hidden"
      />
    </>
  )
}

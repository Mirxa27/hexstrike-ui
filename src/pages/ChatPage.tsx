/* eslint-disable no-shadow-restricted-names */
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import {
  Send,
  Trash2,
  Terminal,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Zap,
  Shield,
  Bug,
  Flag,
  Search,
  Infinity,
  StopCircle,
  Play,
  Save,
  Keyboard,
  Sparkles,
  Bot,
  MessageCircle,
} from 'lucide-react'
import type { Message, ToolCall } from '../types'
import type { UploadedFile } from '../fileAnalysis'
import { useApp } from '../AppContext'
import { normalizeHexstrikeBase, coerceHexstrikeUrlInput, hexstrikeToolTriggersCatalogRefresh } from '../api'
import { streamChat } from '../chatEngine'
import { ChatFileAttachments } from '../components/ChatFileAttachments'
import { useToaster } from '../components/Toaster'
import { useTTS } from '../hooks/useTTS'
import { TTSControls } from '../components/TTSControls'

// ── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="typing-dot w-2 h-2 rounded-full bg-[#e63946] inline-block" />
      <span className="typing-dot w-2 h-2 rounded-full bg-[#e63946] inline-block" />
      <span className="typing-dot w-2 h-2 rounded-full bg-[#e63946] inline-block" />
    </div>
  )
}

// ── Auto-complete progress indicator ─────────────────────────────────────────

function AutoProgress({ iteration, maxIteration, status }: { iteration: number; maxIteration: number; status: string }) {
  const progress = (iteration / maxIteration) * 100
  return (
    <div className="flex flex-col gap-3 px-4 py-4 rounded-xl bg-gradient-to-r from-[#0f172a]/90 to-hex-bg border border-hex-green/25 shadow-[0_0_24px_-8px_rgba(0,255,65,0.25)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Infinity size={14} className="text-hex-green animate-pulse shrink-0" />
          <span className="text-xs font-semibold text-hex-green">Agent loop</span>
        </div>
        <div className="flex-1 flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 h-1.5 bg-hex-border rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-hex-green to-hex-cyan transition-all duration-300"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-hex-muted tabular-nums shrink-0">
            {iteration}/{maxIteration}
          </span>
        </div>
        {status ? (
          <div className="text-[10px] text-hex-text-dim max-w-full sm:max-w-[280px] truncate w-full sm:w-auto">
            {status}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Dedicated agent activity surface (runs continuously while Auto is on) ───

function AgentActivityPanel({
  isStreaming,
  autoComplete,
  autoIteration,
  maxIteration,
  autoStatus,
  currentToolExecution,
  messages,
}: {
  isStreaming: boolean
  autoComplete: boolean
  autoIteration: number
  maxIteration: number
  autoStatus: string
  currentToolExecution: string | null
  messages: Message[]
}) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const toolCalls = lastAssistant?.toolCalls ?? []

  const showIntro = messages.length === 0 && !isStreaming

  if (showIntro) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[240px] px-5 py-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#e63946]/25 to-[#6366f1]/20 flex items-center justify-center mb-5 shadow-lg ring-1 ring-white/10">
          <Bot size={30} className="text-[#fda4af]" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-semibold text-[#f1f5f9] mb-2">Agent run</h2>
        <p className="text-sm text-[#94a3b8] max-w-sm leading-relaxed">
          Turn on <span className="text-[#86efac] font-medium">Auto</span> if you want chained tool runs, then send a task.
          Live iterations and tools appear here — use the <span className="text-[#cbd5e1]">Messages</span> tab for the full
          transcript.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 py-5 space-y-4 w-full">
      {autoComplete && isStreaming && (
        <AutoProgress
          iteration={autoIteration}
          maxIteration={maxIteration}
          status={
            currentToolExecution
              ? `Running: ${currentToolExecution}`
              : autoStatus || 'Thinking…'
          }
        />
      )}

      <div className="rounded-xl border border-[#2a2a3d]/80 bg-[#101018]/90 backdrop-blur-sm p-4">
        <h3 className="text-[10px] uppercase tracking-widest text-[#64748b] mb-3 flex items-center gap-2">
          <Sparkles size={12} className="text-[#fbbf24]" />
          Tool activity
        </h3>
        {toolCalls.length === 0 ? (
          <p className="text-sm text-[#64748b]">
            {isStreaming ? 'Waiting for tool calls from the model…' : 'No tools in the last assistant turn yet.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {toolCalls.map((tc) => (
              <li
                key={tc.id}
                className="flex flex-wrap items-center gap-2 text-xs font-mono rounded-lg bg-[#0a0a12]/80 px-3 py-2 border border-[#1e1e2e]"
              >
                {tc.status === 'running' ? (
                  <Loader2 size={12} className="text-amber-400 animate-spin shrink-0" />
                ) : tc.status === 'done' ? (
                  <CheckCircle size={12} className="text-emerald-400 shrink-0" />
                ) : tc.status === 'error' ? (
                  <XCircle size={12} className="text-red-400 shrink-0" />
                ) : (
                  <Terminal size={12} className="text-sky-400 shrink-0" />
                )}
                <span className="text-sky-300 font-medium">{tc.name}</span>
                {(tc.arguments.target || tc.arguments.domain) != null && (
                  <span className="text-[#64748b] truncate max-w-[min(100%,220px)]">
                    → {String(tc.arguments.target ?? tc.arguments.domain)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-[#475569] text-center px-2">
        Auto mode chains up to {maxIteration} assistant turns. Press Stop or Escape to end early.
      </p>
    </div>
  )
}

// ── Tool call card ───────────────────────────────────────────────────────────

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = () => {
    switch (toolCall.status) {
      case 'running':
        return <Loader2 size={12} className="text-[#fbbf24] animate-spin" />
      case 'done':
        return <CheckCircle size={12} className="text-[#00ff41]" />
      case 'error':
        return <XCircle size={12} className="text-[#e63946]" />
      default:
        return <Loader2 size={12} className="text-[#94a3b8]" />
    }
  }

  const borderClass =
    toolCall.status === 'running'
      ? 'tool-running border-[#1a1a2e]'
      : toolCall.status === 'done'
      ? 'border-[#00ff41]/30'
      : toolCall.status === 'error'
      ? 'border-[#e63946]/30'
      : 'border-[#1a1a2e]'

  return (
    <div className={`mt-2 rounded border ${borderClass} bg-[#0a0a0f] text-xs font-mono`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1a2e]/30 transition-colors text-left"
      >
        {statusIcon()}
        <Terminal size={11} className="text-[#00d4ff]" />
        <span className="text-[#00d4ff] font-medium">{toolCall.name}</span>
        {(toolCall.arguments.target || toolCall.arguments.domain) ? (
          <span className="text-[#6b7280] truncate max-w-[200px]">
            → {String(toolCall.arguments.target ?? toolCall.arguments.domain)}
          </span>
        ) : null}
        <span className="ml-auto">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#1a1a2e] px-3 py-2 space-y-2">
          {/* Arguments */}
          <div>
            <p className="text-[#6b7280] text-[10px] uppercase tracking-wider mb-1">Arguments</p>
            <pre className="text-[#e2e8f0] whitespace-pre-wrap break-all text-[11px] leading-relaxed">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {toolCall.result !== undefined && (
            <div>
              <p className="text-[#6b7280] text-[10px] uppercase tracking-wider mb-1">Result</p>
              <pre
                className={`whitespace-pre-wrap break-all text-[11px] leading-relaxed max-h-64 overflow-y-auto ${
                  toolCall.status === 'error' ? 'text-[#e63946]' : 'text-[#00ff41]'
                }`}
              >
                {toolCall.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Single message bubble ────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
        <div
          className={`max-w-[85%] sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Role label */}
        <div
          className={`text-[10px] mb-1 font-medium tracking-wider uppercase ${
            isUser ? 'text-right text-hex-accent' : 'text-hex-text-dim'
          }`}
        >
          {isUser ? 'You' : 'Assistant'}
        </div>

        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg ${
            isUser
              ? 'bg-gradient-to-br from-hex-accent to-hex-accent-dim text-white ring-1 ring-white/10'
              : 'bg-[#12121c]/95 border border-hex-border/80 text-hex-text backdrop-blur-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose-hex">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{message.content}</ReactMarkdown>
            </div>
          )}

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.toolCalls.map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="text-[10px] text-[#6b7280] mt-1">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  { icon: Search, text: 'Scan example.com for open ports and services', label: 'Port Scan' },
  { icon: Shield, text: 'Find vulnerabilities on https://example.com', label: 'Vuln Scan' },
  { icon: Bug, text: 'Run a full bug bounty recon on target.com', label: 'Recon' },
  { icon: Flag, text: 'Help me solve this CTF web challenge: [describe]', label: 'CTF Help' },
  { icon: Zap, text: 'What subdomains does example.com have?', label: 'Subdomain Enum' },
  { icon: Terminal, text: 'Check for SQL injection vulnerabilities on this URL', label: 'SQLi Check' },
]

function EmptyState({ onPrompt }: { onPrompt: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-16 text-center">
      {/* Logo */}
      <div className="mb-6">
        <svg width="64" height="64" viewBox="0 0 32 32" fill="none" className="mx-auto mb-3">
          <circle cx="16" cy="16" r="14" stroke="#e63946" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="4" fill="#e63946" />
          <line x1="16" y1="2" x2="16" y2="8" stroke="#e63946" strokeWidth="1.5" />
          <line x1="16" y1="24" x2="16" y2="30" stroke="#e63946" strokeWidth="1.5" />
          <line x1="2" y1="16" x2="8" y2="16" stroke="#e63946" strokeWidth="1.5" />
          <line x1="24" y1="16" x2="30" y2="16" stroke="#e63946" strokeWidth="1.5" />
          <ellipse cx="16" cy="15" rx="4.5" ry="4" fill="#0a0a0f" stroke="#e63946" strokeWidth="0.8" />
          <circle cx="14.2" cy="14.5" r="1.2" fill="#e63946" />
          <circle cx="17.8" cy="14.5" r="1.2" fill="#e63946" />
          <path d="M14 17.5 h4 M14.5 17.5 v1 M17.5 17.5 v1 M16 17.5 v1" stroke="#e63946" strokeWidth="0.7" />
        </svg>
        <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-[#ff6b7a] to-[#e63946] bg-clip-text text-transparent tracking-tight">
          HexStrike AI
        </h1>
        <p className="text-[#94a3b8] text-sm mt-2 max-w-md mx-auto leading-relaxed">
          Your security copilot — powered by your tools. Ask anything, attach files, or pick a starter below.
        </p>
      </div>

      {/* Example prompts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 max-w-2xl w-full mt-6">
        {EXAMPLE_PROMPTS.map(({ icon: Icon, text, label }) => (
          <button
            key={label}
            onClick={() => onPrompt(text)}
            className="flex items-start gap-3 p-3 sm:p-3.5 rounded-xl border border-[#2a2a3d]/60 bg-[#12121c]/60 hover:border-[#e63946]/40 hover:bg-[#e63946]/5 transition-all text-left group backdrop-blur-sm"
          >
            <Icon size={14} className="text-[#e63946] shrink-0 mt-0.5 group-hover:animate-pulse" />
            <div>
              <p className="text-[10px] text-[#e63946] font-medium uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-xs text-[#94a3b8] leading-snug">{text}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ChatPage ────────────────────────────────────────────────────────────

const MAX_AUTO_ITERATIONS = 25
const TASK_COMPLETION_MARKERS = [
  'task complete',
  'task completed',
  'successfully completed',
  'all done',
  'scan complete',
  'reconnaissance complete',
  'finished scanning',
  'objective complete',
  'mission complete',
  // NOTE: deliberately NOT including bare 'results:' / 'summary:' — those words
  // appear constantly in normal tool output (e.g. "the scan results:") and
  // would terminate the autonomous loop prematurely. Use decisive phrases only.
  'final summary:',
  'assessment complete',
]

function isTaskComplete(content: string): boolean {
  const lower = content.toLowerCase()
  return TASK_COMPLETION_MARKERS.some((marker) => lower.includes(marker))
}

export function ChatPage() {
  const {
    settings,
    activeTools,
    saveCurrentChat,
    setCurrentChatId,
    addSessionUsage,
    refreshHexstrike,
    chatMessages: messages,
    setChatMessages: setMessages,
  } = useApp()
  const toaster = useToaster()
  const tts = useTTS()
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  /** Messages vs live agent activity — keeps autonomous runs visible without losing the transcript */
  const [surfaceTab, setSurfaceTab] = useState<'messages' | 'agent'>('messages')

  // Load auto-complete preference from localStorage
  const [autoComplete, setAutoComplete] = useState(() => {
    const saved = localStorage.getItem('hexstrike-autocomplete')
    return saved ? JSON.parse(saved) : true
  })
  const [autoIteration, setAutoIteration] = useState(0)
  const [autoStatus, setAutoStatus] = useState<string>('')
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [currentToolExecution, setCurrentToolExecution] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // Auto-scroll transcript when on Messages tab
  useEffect(() => {
    if (surfaceTab !== 'messages') return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, surfaceTab])

  // During autonomous runs, surface the live agent tab automatically
  useEffect(() => {
    if (isStreaming && autoComplete) setSurfaceTab('agent')
  }, [isStreaming, autoComplete])

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [input, resizeTextarea])

  // Persist auto-complete preference
  useEffect(() => {
    localStorage.setItem('hexstrike-autocomplete', JSON.stringify(autoComplete))
  }, [autoComplete])

  const toggleAutoComplete = useCallback(() => {
    setAutoComplete((prevOn: boolean) => {
      const newValue = !prevOn
      if (!newValue && isStreaming) {
        abortRef.current?.()
      }
      return newValue
    })
  }, [isStreaming])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K: Focus input
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        textareaRef.current?.focus()
      }
      // Escape: Stop generation if streaming
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault()
        abortRef.current?.()
      }
      // Ctrl/Cmd + Shift + A: Toggle auto-complete
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        toggleAutoComplete()
      }
      // Ctrl/Cmd + /: Show keyboard shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setShowKeyboardShortcuts((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isStreaming, toggleAutoComplete])

  const runAssistantTurn = useCallback(async (
    currentMessages: Message[],
    iteration: number,
    signal?: AbortSignal
  ): Promise<{ messages: Message[], shouldContinue: boolean, lastContent: string }> => {
    const assistantId = `assistant-${Date.now()}-${iteration}`
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
    }

    // Add assistant placeholder
    const updatedMessages = [...currentMessages, assistantMsg]
    setMessages(updatedMessages)

    let aborted = signal?.aborted ?? false
    if (signal && !aborted) {
      signal.addEventListener('abort', () => {
        aborted = true
      }, { once: true })
    }
    let lastContent = ''
    const toolCallMap: Record<string, ToolCall> = {}

    // Add auto-complete context to settings for this turn
    const autoSettings = autoComplete ? {
      ...settings,
      systemPrompt: `${settings.systemPrompt}\n\nYou are in AUTO-COMPLETE MODE. Continue executing tools autonomously until the task is complete. Use multiple tools in sequence if needed. When you have achieved the objective, clearly state "task complete" or similar.`
    } : settings

    try {
    const gen = streamChat(autoSettings, currentMessages, activeTools, signal)

      for await (const event of gen) {
        if (aborted) break

        if (event.type === 'text') {
          lastContent += event.content
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + event.content } : m
            )
          )
          // Update auto status with current activity
          setAutoStatus(event.content.slice(0, 100))
        } else if (event.type === 'tool_call') {
          const tc = event.toolCall
          toolCallMap[tc.id] = tc
          setCurrentToolExecution(tc.name)
          setAutoStatus(`Running: ${tc.name}`)
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              const existing = m.toolCalls ?? []
              const idx = existing.findIndex((x) => x.id === tc.id)
              if (idx >= 0) {
                const updated = [...existing]
                updated[idx] = tc
                return { ...m, toolCalls: updated }
              }
              return { ...m, toolCalls: [...existing, tc] }
            })
          )
        } else if (event.type === 'tool_result') {
          const { toolCallId, result } = event
          setCurrentToolExecution(null)
          const finishedTool = toolCallMap[toolCallId]?.name
          if (finishedTool && hexstrikeToolTriggersCatalogRefresh(finishedTool)) {
            void refreshHexstrike().then((ok) => {
              if (ok) toaster.success('HexStrike tool catalog updated')
            })
          }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m
              const updated = (m.toolCalls ?? []).map((tc) =>
                tc.id === toolCallId
                  ? { ...tc, result, status: 'done' as const }
                  : tc
              )
              return { ...m, toolCalls: updated }
            })
          )
        } else if (event.type === 'error') {
          const errorContent = `${lastContent}\n\n**Error:** ${event.error}`
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: errorContent } : m
            )
          )
          // Return the messages WITH the error baked into the assistant turn
          // (not the empty placeholder) so the subsequent auto-save persists
          // the error and it isn't wiped when the session reloads.
          const erroredMessages = updatedMessages.map((m) =>
            m.id === assistantId ? { ...m, content: errorContent } : m
          )
          return { messages: erroredMessages, shouldContinue: false, lastContent: errorContent }
        } else if (event.type === 'usage') {
          addSessionUsage(event.usage)
        } else if (event.type === 'done') {
          break
        }
      }

      // Build final assistant message with all tool results
      const finalMessages = updatedMessages.map((m) => {
        if (m.id !== assistantId) return m
        return { ...m, content: lastContent }
      })

      // Determine if we should continue
      const toolsUsed = Object.keys(toolCallMap).length
      const taskComplete = isTaskComplete(lastContent)
      const reachedMaxIteration = iteration >= MAX_AUTO_ITERATIONS
      const hasMoreWork = lastContent.toLowerCase().includes('next') ||
                         lastContent.toLowerCase().includes('continu') ||
                         lastContent.toLowerCase().includes('further') ||
                         lastContent.toLowerCase().includes('addition')
      const shouldContinue = autoComplete && !taskComplete && !reachedMaxIteration && (toolsUsed > 0 || hasMoreWork)

       return { messages: finalMessages, shouldContinue, lastContent }
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err)
       const errorMsg = `**Error:** ${msg}`
       setMessages((prev) =>
         prev.map((m) =>
           m.id === assistantId ? { ...m, content: errorMsg } : m
         )
       )
       const erroredMessages = updatedMessages.map((m) =>
         m.id === assistantId ? { ...m, content: errorMsg } : m
       )
       return { messages: erroredMessages, shouldContinue: false, lastContent: errorMsg }
     }
   }, [settings, activeTools, autoComplete, addSessionUsage, refreshHexstrike, toaster])

  const handleSubmit = useCallback(async (override?: { content?: string; attachments?: UploadedFile[] }) => {
    const content = (override?.content ?? input).trim()
    const sendAttachments = override?.attachments ?? attachments
    if ((!content && sendAttachments.length === 0) || isStreaming) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    // Build message content with file info
    let messageContent = content
    if (sendAttachments.length > 0) {
      const fileInfo = sendAttachments.map((f) => `- ${f.name} (${f.category}, ${(f.size / 1024).toFixed(1)} KB)`).join('\n')
      messageContent = content ? `${content}\n\n**Attached files:**\n${fileInfo}` : `**Attached files for analysis:**\n${fileInfo}`
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      toolCalls: sendAttachments.length > 0 ? [{
        id: `file-attach-${Date.now()}`,
        name: 'file_attach',
        arguments: { files: sendAttachments.map((f) => ({ id: f.id, name: f.name, category: f.category, data: f.data })) },
        status: 'done',
        result: `Attached ${sendAttachments.length} file(s) for analysis`,
      }] : undefined,
    }

    setMessages((prev) => [...prev, userMsg])
    setAttachments([]) // Clear attachments after sending
    setIsStreaming(true)
    setAutoIteration(0)

    // AbortController forwards Stop both to in-flight `fetch()` (LLM stream)
    // and to a best-effort backend cancel POST (P3-7).
    const controller = new AbortController()
    let aborted = false
    abortRef.current = () => {
      aborted = true
      controller.abort()
      // Best-effort: tell the backend to cancel any running scans for this
      // session. If the endpoint doesn't exist (most won't), the catch is
      // silent — there's nothing useful we can do for the user about it.
      try {
        const base = normalizeHexstrikeBase(coerceHexstrikeUrlInput(settings.hexstrikeUrl || ''))
        const url = `${base}/api/v1/cancel`
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'user_stop' }),
        }).catch(() => undefined)
      } catch { /* ignore */ }
    }

    let currentMessages = [...messages, userMsg]
    let iteration = 0

    try {
      // Main auto-completion loop
      while (!aborted && iteration < MAX_AUTO_ITERATIONS) {
        setAutoIteration(iteration + 1)

        const result = await runAssistantTurn(currentMessages, iteration, controller.signal)
        currentMessages = result.messages

        if (!result.shouldContinue) {
          if (autoComplete && iteration < MAX_AUTO_ITERATIONS - 1 && !isTaskComplete(result.lastContent)) {
            setAutoStatus('Task appears complete - no more tools needed')
          }
          break
        }

        // Add a continuation prompt for the next turn
        const continuationMsg: Message = {
          id: `continuation-${Date.now()}`,
          role: 'user',
          content: 'Continue with the next steps. Use more tools if needed to complete the task.',
          timestamp: Date.now(),
        }
        currentMessages = [...currentMessages, continuationMsg]
        setMessages(currentMessages)

        iteration++

        // Brief pause between iterations
        await new Promise(resolve => setTimeout(resolve, 500))
      }

       // Auto-save chat after completion
       if (currentMessages.length > 0) {
         saveCurrentChat(currentMessages)
       }
       
       // TTS Autoplay - speak the last assistant response (skip if the user
       // stopped the run; speaking a half-finished/aborted reply is jarring).
       if (!aborted && tts.settings.autoplay && tts.settings.enabled) {
         const lastAssistantMessage = currentMessages.filter(m => m.role === 'assistant').pop()
         if (lastAssistantMessage?.content) {
           // Strip markdown for cleaner speech
           const cleanText = lastAssistantMessage.content
             .replace(/\*\*/g, '')
             .replace(/__/g, '')
             .replace(/`/g, '')
             .replace(/#{1,6}\s/g, '')
             .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
           tts.speak(cleanText)
         }
       }
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err)
       setMessages((prev) => [
         ...prev,
         {
           id: `error-${Date.now()}`,
           role: 'assistant',
           content: `**Error:** ${msg}`,
           timestamp: Date.now(),
         }
       ])
     } finally {
      setIsStreaming(false)
      setAutoStatus('')
      setCurrentToolExecution(null)
      abortRef.current = null
    }
  }, [input, isStreaming, messages, runAssistantTurn, autoComplete, saveCurrentChat, attachments, tts, settings])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const clearChat = () => {
    if (isStreaming) {
      abortRef.current?.()
      setIsStreaming(false)
      setAutoComplete(false)
      setAutoIteration(0)
      setAutoStatus('')
    }
    setMessages([])
    setCurrentChatId(null)
  }

  const handleAddAttachments = (files: UploadedFile[]) => {
    setAttachments((prev) => [...prev, ...files])
  }

  const handleRemoveAttachment = (fileId: string) => {
    setAttachments((prev) => prev.filter((f) => f.id !== fileId))
  }

  const lastMsg = messages[messages.length - 1]
  const showTyping = isStreaming && lastMsg?.role === 'assistant' && !lastMsg.content && !lastMsg.toolCalls?.length
  const lastAssistantFailed =
    !isStreaming &&
    lastMsg?.role === 'assistant' &&
    typeof lastMsg.content === 'string' &&
    lastMsg.content.includes('**Error:**')

  const retryLastTurn = useCallback(() => {
    // Drop the failed assistant message and re-submit the previous user input.
    const idx = [...messages].reverse().findIndex((m) => m.role === 'user')
    if (idx < 0) return
    const userMsgPos = messages.length - 1 - idx
    const userMsg = messages[userMsgPos]
    if (!userMsg) return

     // Recover any attachments the original turn carried so the retry
     // includes the same files (the assistant just failed to process them).
     const attachToolCall = (userMsg.toolCalls ?? []).find(
       (tc): tc is ToolCall & { arguments: { files?: UploadedFile[] } } =>
         tc.name === 'file_attach' && typeof tc.arguments === 'object'
     )
     const restoredAttachments: UploadedFile[] = (attachToolCall?.arguments?.files ?? [])
       .filter((f): f is UploadedFile => f != null && typeof f.data === 'string')

     // File bytes are stripped from persisted history (chatHistory sanitizes
     // them), so a retry after a reload can't re-send the originals. Warn
     // instead of silently retrying with no attachments.
     const hadFiles = (attachToolCall?.arguments?.files ?? []).length > 0
     if (hadFiles && restoredAttachments.length === 0) {
       toaster.warning('Attached files were cleared after reload and can\'t be re-sent — please re-attach them.')
     }

    // Keep only messages up to (but not including) the failed assistant turn.
    setMessages(messages.slice(0, userMsgPos))
    const restoredContent = typeof userMsg.content === 'string' ? userMsg.content : ''
    // Pass content + attachments explicitly so we don't depend on the
    // post-setState input/attachments state (which is async).
    void handleSubmit({ content: restoredContent, attachments: restoredAttachments })

  }, [messages, handleSubmit, toaster])

  return (
    <div className="flex flex-col h-full min-h-0 bg-gradient-to-b from-[#0d0d16] via-hex-bg to-[#080810]">
      {/* Messages vs Agent — dual surface for transcript + live autonomous loop */}
      <div className="shrink-0 border-b border-white/[0.06] bg-hex-surface/95 backdrop-blur-md px-3 sm:px-4 py-2.5">
        <div className="max-w-4xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex rounded-xl bg-hex-bg/90 p-1 border border-hex-border/90 gap-1 w-full sm:w-auto shadow-inner"
              role="tablist"
              aria-label="Chat surfaces"
            >
              <button
                type="button"
                role="tab"
                aria-selected={surfaceTab === 'messages'}
                onClick={() => setSurfaceTab('messages')}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[44px] sm:min-h-0 ${
                  surfaceTab === 'messages'
                    ? 'bg-hex-accent/20 text-[#fecaca] shadow-[inset_0_0_0_1px_rgba(230,57,70,0.35)]'
                    : 'text-[#64748b] hover:text-[#cbd5e1] hover:bg-white/[0.04]'
                }`}
              >
              <MessageCircle size={15} className="shrink-0 opacity-90" />
              <span>Messages</span>
              {messages.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1e1e2e] text-[#94a3b8] tabular-nums font-mono">
                  {messages.length}
                </span>
              )}
            </button>
              <button
                type="button"
                role="tab"
                aria-selected={surfaceTab === 'agent'}
                onClick={() => setSurfaceTab('agent')}
                className={`relative flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[44px] sm:min-h-0 ${
                  surfaceTab === 'agent'
                    ? 'bg-hex-green/15 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]'
                    : 'text-[#64748b] hover:text-[#cbd5e1] hover:bg-white/[0.04]'
                }`}
              >
              <Bot size={15} className="shrink-0 opacity-90" />
              <span>Agent run</span>
              {isStreaming && autoComplete ? (
                <span
                  className="absolute top-2 right-2 sm:right-3 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"
                  aria-label="Agent active"
                />
              ) : null}
            </button>
          </div>

          {messages.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 justify-between sm:justify-end sm:gap-3">
              <div className="flex items-center gap-2 text-[11px] text-hex-text-dim min-w-0 max-w-[55%] sm:max-w-none">
                <Terminal size={12} className="text-sky-400 shrink-0" />
                <span className="truncate">
                  {messages.filter((m) => m.role === 'user').length} turns · {activeTools.length} tools
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <TTSControls />
                <button
                  type="button"
                  onClick={() => setShowKeyboardShortcuts(true)}
                  className="flex items-center justify-center sm:gap-1.5 text-[11px] text-[#64748b] hover:text-sky-300 transition-colors px-2 py-2 rounded-lg hover:bg-sky-500/10 min-h-[40px] min-w-[40px] sm:min-w-0"
                  title="Shortcuts (⌘/)"
                >
                  <Keyboard size={13} />
                  <span className="hidden md:inline">Shortcuts</span>
                </button>
                <button
                  type="button"
                  onClick={() => saveCurrentChat(messages)}
                  className="flex items-center justify-center sm:gap-1.5 text-[11px] text-[#64748b] hover:text-emerald-400 transition-colors px-2 py-2 rounded-lg hover:bg-emerald-500/10 min-h-[40px] min-w-[40px] sm:min-w-0"
                  title="Save chat"
                >
                  <Save size={13} />
                  <span className="hidden md:inline">Save</span>
                </button>
                <button
                  type="button"
                  onClick={toggleAutoComplete}
                  disabled={isStreaming}
                  className={`flex items-center justify-center sm:gap-1.5 text-[11px] transition-colors px-2 py-2 rounded-lg min-h-[40px] sm:px-2.5 ${
                    autoComplete
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'text-[#64748b] hover:text-[#cbd5e1] border border-transparent hover:bg-white/[0.04]'
                  }`}
                  title={autoComplete ? 'Auto mode on' : 'Enable Auto mode'}
                >
                  {autoComplete ? <Infinity size={13} /> : <Play size={13} />}
                  <span className="hidden sm:inline">{autoComplete ? 'Auto' : 'Auto off'}</span>
                </button>
                <button
                  type="button"
                  onClick={clearChat}
                  className="flex items-center justify-center sm:gap-1.5 text-[11px] text-[#64748b] hover:text-red-400 transition-colors px-2 py-2 rounded-lg hover:bg-red-500/10 min-h-[40px] min-w-[40px] sm:min-w-0"
                  title="Clear conversation"
                >
                  <Trash2 size={13} />
                  <span className="hidden md:inline">Clear</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {surfaceTab === 'messages' ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {messages.length === 0 ? (
              <EmptyState onPrompt={(t) => setInput(t)} />
            ) : (
              <div className="max-w-4xl mx-auto px-3 sm:px-4 py-5">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {showTyping && (
                  <div className="flex justify-start mb-4">
                    <div className="rounded-2xl border border-[#2a2a3d]/80 bg-[#12121c]/90 backdrop-blur-sm px-3 py-2">
                      <TypingIndicator />
                    </div>
                  </div>
                )}
                {lastAssistantFailed && (
                  <div className="flex justify-start mb-4">
                    <button
                      type="button"
                      onClick={retryLastTurn}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-xl border border-red-500/35 text-red-300 hover:bg-red-500/10 transition-colors"
                    >
                      <Loader2 size={12} />
                      Retry last message
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <AgentActivityPanel
              isStreaming={isStreaming}
              autoComplete={autoComplete}
              autoIteration={autoIteration}
              maxIteration={MAX_AUTO_ITERATIONS}
              autoStatus={autoStatus}
              currentToolExecution={currentToolExecution}
              messages={messages}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-white/[0.06] bg-hex-surface/95 backdrop-blur-md pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-4xl mx-auto px-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-white/[0.04]">
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-[#64748b] min-w-0">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${settings.model ? 'bg-hex-green' : 'bg-hex-accent'}`} />
              {settings.model ? (
                <span className="truncate font-mono">
                  <span className="text-hex-text-dim">{settings.provider}</span>
                  <span className="mx-1 text-[#334155]">/</span>
                  <span className="text-sky-300">{settings.model}</span>
                </span>
              ) : (
                <span className="text-hex-accent">Configure a model in Settings</span>
              )}
            </div>
            {autoComplete && !isStreaming && (
              <div className="flex items-center gap-1 text-[10px] text-hex-green/90 ml-auto">
                <Infinity size={10} />
                <span className="hidden sm:inline">Auto chains tools until done</span>
                <span className="sm:hidden">Auto on</span>
              </div>
            )}
          </div>

          <ChatFileAttachments
            attachments={attachments}
            onAdd={handleAddAttachments}
            onRemove={handleRemoveAttachment}
            disabled={isStreaming}
          />

          <div className="flex gap-2 sm:gap-3 items-end py-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message HexStrike…"
              rows={1}
              className="flex-1 resize-none bg-hex-bg/90 border border-hex-border rounded-xl px-3 sm:px-4 py-3 text-sm text-hex-text placeholder-hex-muted focus:outline-none focus:ring-2 focus:ring-hex-accent/35 focus:border-hex-accent/50 font-mono leading-relaxed input-field"
              style={{ minHeight: '48px', maxHeight: '200px' }}
              disabled={isStreaming}
              aria-label="Chat message"
            />
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={(!input.trim() && attachments.length === 0) || isStreaming}
              className="shrink-0 h-12 w-12 sm:w-14 flex items-center justify-center rounded-xl bg-gradient-to-br from-hex-accent to-hex-accent-dim hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-hex-accent/20 btn-primary"
              title={isStreaming ? 'Working…' : 'Send'}
            >
              {isStreaming ? (
                <Loader2 size={18} className="animate-spin text-white" />
              ) : (
                <Send size={18} className="text-white" />
              )}
            </button>
            {isStreaming && autoComplete && (
              <button
                type="button"
                onClick={() => abortRef.current?.()}
                className="shrink-0 h-12 px-3 sm:px-4 flex items-center gap-2 rounded-xl border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors text-xs font-semibold"
                title="Stop agent"
              >
                <StopCircle size={15} />
                <span className="hidden sm:inline">Stop</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts modal */}
      {showKeyboardShortcuts && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowKeyboardShortcuts(false)}
        >
          <div
            className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#e2e8f0] flex items-center gap-2">
                <Keyboard size={14} className="text-[#e63946]" />
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setShowKeyboardShortcuts(false)}
                className="text-[#6b7280] hover:text-[#e2e8f0]"
              >
                <XCircle size={16} />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {[
                { key: 'Ctrl + K', desc: 'Focus input field' },
                { key: 'Ctrl + Enter', desc: 'Send message' },
                { key: 'Shift + Enter', desc: 'New line in input' },
                { key: 'Escape', desc: 'Stop generation' },
                { key: 'Ctrl + Shift + A', desc: 'Toggle auto-complete' },
                { key: 'Ctrl + /', desc: 'Show this help' },
              ].map(({ key, desc }) => (
                <div key={key} className="flex items-center justify-between py-2 px-3 rounded bg-[#0a0a0f] border border-[#1a1a2e]">
                  <span className="text-[#94a3b8]">{desc}</span>
                  <kbd className="text-[10px] font-mono text-[#e63946] bg-[#1a1a2e] px-2 py-1 rounded">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#6b7280] mt-4 text-center">
              Auto-complete is enabled by default for autonomous operation
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

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
} from 'lucide-react'
import type { Message, ToolCall } from '../types'
import type { UploadedFile } from '../fileAnalysis'
import { useApp } from '../AppContext'
import { streamChat } from '../chatEngine'
import { ChatFileAttachments } from '../components/ChatFileAttachments'

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
    <div className="flex items-center gap-3 px-4 py-3 bg-[#0f0f1a] border border-[#00ff41]/30 rounded-lg">
      <div className="flex items-center gap-2">
        <Infinity size={14} className="text-[#00ff41] animate-pulse" />
        <span className="text-xs font-medium text-[#00ff41]">Auto-complete mode</span>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-[#1a1a2e] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#00ff41] to-[#00d4ff] transition-all duration-300"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <span className="text-[10px] text-[#6b7280]">{iteration}/{maxIteration}</span>
      </div>
      {status && (
        <div className="text-[10px] text-[#94a3b8] max-w-[200px] truncate">{status}</div>
      )}
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
        {toolCall.arguments.target ? (
          <span className="text-[#6b7280] truncate max-w-[200px]">
            → {String(toolCall.arguments.target)}
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
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Role label */}
        <div
          className={`text-[10px] mb-1 font-medium tracking-wider uppercase ${
            isUser ? 'text-right text-[#e63946]' : 'text-[#94a3b8]'
          }`}
        >
          {isUser ? 'You' : 'HexStrike AI'}
        </div>

        {/* Bubble */}
        <div
          className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#e63946] text-white'
              : 'bg-[#0f0f1a] border border-[#1a1a2e] text-[#e2e8f0]'
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
        <h1 className="text-2xl font-bold text-[#e63946] tracking-widest uppercase">HexStrike AI</h1>
        <p className="text-[#94a3b8] text-sm mt-1">Advanced cybersecurity assistant with 730+ tools • Auto-complete enabled • Press Ctrl+/ for shortcuts</p>
      </div>

      {/* Example prompts */}
      <div className="grid grid-cols-2 gap-2 max-w-2xl w-full mt-4">
        {EXAMPLE_PROMPTS.map(({ icon: Icon, text, label }) => (
          <button
            key={label}
            onClick={() => onPrompt(text)}
            className="flex items-start gap-3 p-3 rounded-lg border border-[#1a1a2e] bg-[#0f0f1a] hover:border-[#e63946]/50 hover:bg-[#e63946]/5 transition-colors text-left group"
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
  'summary:',
  'conclusion:',
  'results:',
]

function isTaskComplete(content: string): boolean {
  const lower = content.toLowerCase()
  return TASK_COMPLETION_MARKERS.some((marker) => lower.includes(marker))
}

export function ChatPage() {
  const { settings, activeTools, saveCurrentChat, setCurrentChatId, addSessionUsage } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

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

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
  }, [isStreaming])

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

    let aborted = false
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
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + `\n\n**Error:** ${event.error}` }
                : m
            )
          )
          return { messages: updatedMessages, shouldContinue: false, lastContent: lastContent + `\n\n**Error:** ${event.error}` }
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
    } catch (err: any) {
      const errorMsg = `**Error:** ${err?.message ?? String(err)}`
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: errorMsg } : m
        )
      )
      return { messages: updatedMessages, shouldContinue: false, lastContent: errorMsg }
    }
  }, [settings, activeTools, autoComplete, addSessionUsage])

  const handleSubmit = useCallback(async () => {
    const content = input.trim()
    if ((!content && attachments.length === 0) || isStreaming) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    // Build message content with file info
    let messageContent = content
    if (attachments.length > 0) {
      const fileInfo = attachments.map((f) => `- ${f.name} (${f.category}, ${(f.size / 1024).toFixed(1)} KB)`).join('\n')
      messageContent = content ? `${content}\n\n**Attached files:**\n${fileInfo}` : `**Attached files for analysis:**\n${fileInfo}`
    }

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: Date.now(),
      toolCalls: attachments.length > 0 ? [{
        id: `file-attach-${Date.now()}`,
        name: 'file_attach',
        arguments: { files: attachments.map((f) => ({ id: f.id, name: f.name, category: f.category, data: f.data })) },
        status: 'done',
        result: `Attached ${attachments.length} file(s) for analysis`,
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
        const url = settings.hexstrikeUrl?.replace(/\/+$/, '') + '/api/v1/cancel'
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
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `**Error:** ${err?.message ?? String(err)}`,
          timestamp: Date.now(),
        }
      ])
      // Save even on error
      saveCurrentChat(messages)
    } finally {
      setIsStreaming(false)
      setAutoStatus('')
      setCurrentToolExecution(null)
      abortRef.current = null
    }
  }, [input, isStreaming, messages, runAssistantTurn, autoComplete, saveCurrentChat])

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

  const toggleAutoComplete = () => {
    const newValue = !autoComplete
    setAutoComplete(newValue)
    if (!newValue && isStreaming) {
      abortRef.current?.()
    }
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
    // Keep only messages up to (but not including) the failed assistant turn.
    setMessages(messages.slice(0, userMsgPos))
    setInput(typeof userMsg.content === 'string' ? userMsg.content : '')
    // Defer submit so state settles.
    setTimeout(() => { void handleSubmit() }, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      {messages.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a2e] bg-[#0f0f1a] shrink-0">
          <div className="flex items-center gap-3 text-xs text-[#94a3b8]">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-[#00d4ff]" />
              <span>{messages.filter((m) => m.role === 'user').length} exchanges</span>
              <span className="text-[#1a1a2e]">|</span>
              <span>{activeTools.length} tools active</span>
            </div>

            {/* Auto-complete status */}
            {isStreaming && autoComplete && (
              <div className="flex items-center gap-2 text-[#00ff41]">
                <Infinity size={12} className="animate-pulse" />
                <span>Auto: {autoIteration}/{MAX_AUTO_ITERATIONS}</span>
                {currentToolExecution && (
                  <>
                    <span className="text-[#1a1a2e]">•</span>
                    <span className="text-[#00d4ff] font-medium">{currentToolExecution}</span>
                  </>
                )}
                {autoStatus && !currentToolExecution && (
                  <span className="text-[#6b7280] max-w-[200px] truncate">— {autoStatus}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Keyboard shortcuts */}
            <button
              onClick={() => setShowKeyboardShortcuts(true)}
              className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#00d4ff] transition-colors px-2 py-1 rounded hover:bg-[#00d4ff]/10"
              title="Keyboard shortcuts (Ctrl+/)"
            >
              <Keyboard size={12} />
            </button>
            {/* Save button */}
            <button
              onClick={() => saveCurrentChat(messages)}
              className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#00ff41] transition-colors px-2 py-1 rounded hover:bg-[#00ff41]/10"
              title="Save chat"
            >
              <Save size={12} />
            </button>
            {/* Auto-complete toggle */}
            <button
              onClick={toggleAutoComplete}
              disabled={isStreaming}
              className={`flex items-center gap-1.5 text-xs transition-colors px-2 py-1 rounded ${
                autoComplete
                  ? 'bg-[#00ff41]/10 text-[#00ff41] border border-[#00ff41]/30'
                  : 'text-[#6b7280] hover:text-[#00d4ff] hover:bg-[#00d4ff]/10 border border-transparent'
              }`}
              title={autoComplete ? 'Auto-complete enabled' : 'Enable auto-complete'}
            >
              {autoComplete ? <Infinity size={12} /> : <Play size={12} />}
              {autoComplete ? 'Auto ON' : 'Auto'}
            </button>
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 text-xs text-[#6b7280] hover:text-[#e63946] transition-colors px-2 py-1 rounded hover:bg-[#e63946]/10"
            >
              <Trash2 size={12} />
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Message area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState onPrompt={(t) => setInput(t)} />
        ) : (
          <div className="max-w-4xl mx-auto px-4 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {showTyping && (
              <div className="flex justify-start mb-4">
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-lg">
                  <TypingIndicator />
                </div>
              </div>
            )}
            {isStreaming && autoComplete && (
              <div className="flex justify-start mb-4">
                <AutoProgress
                  iteration={autoIteration}
                  maxIteration={MAX_AUTO_ITERATIONS}
                  status={autoStatus}
                />
              </div>
            )}
            {lastAssistantFailed && (
              <div className="flex justify-start mb-4">
                <button
                  onClick={retryLastTurn}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded border border-[#e63946]/40 text-[#e63946] hover:bg-[#e63946]/10 transition-colors"
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

      {/* Input area */}
      <div className="shrink-0 border-t border-[#1a1a2e] bg-[#0f0f1a]">
        <div className="max-w-4xl mx-auto">
          {/* Model indicator */}
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2 text-[10px] text-[#6b7280]">
              <div className={`w-1.5 h-1.5 rounded-full ${settings.model ? 'bg-[#00ff41]' : 'bg-[#e63946]'}`} />
              {settings.model ? (
                <>
                  <span className="text-[#94a3b8]">{settings.provider}</span>
                  <span className="text-[#1a1a2e]">/</span>
                  <span className="text-[#00d4ff]">{settings.model}</span>
                </>
              ) : (
                <span className="text-[#e63946]">No model configured — go to Settings</span>
              )}
            </div>

            {/* Auto-complete hint */}
            {autoComplete && !isStreaming && (
              <div className="flex items-center gap-1 text-[10px] text-[#00ff41]">
                <Infinity size={10} />
                <span>Auto-complete enabled — agent will run until task is complete</span>
              </div>
            )}
          </div>

          {/* File attachments */}
          <ChatFileAttachments
            attachments={attachments}
            onAdd={handleAddAttachments}
            onRemove={handleRemoveAttachment}
            disabled={isStreaming}
          />

          <div className="px-4 pb-3">
            <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask HexStrike AI anything... (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="flex-1 resize-none bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-4 py-3 text-sm text-[#e2e8f0] placeholder-[#6b7280] focus:outline-none focus:border-[#e63946]/60 font-mono leading-relaxed"
              style={{ minHeight: '48px', maxHeight: '200px' }}
              disabled={isStreaming}
            />
            <button
              onClick={handleSubmit}
              disabled={(!input.trim() && attachments.length === 0) || isStreaming}
              className="shrink-0 h-12 w-12 flex items-center justify-center rounded-lg bg-[#e63946] hover:bg-[#c1121f] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={isStreaming ? 'Processing...' : attachments.length > 0 && !input.trim() ? 'Send files' : 'Send message'}
            >
              {isStreaming ? (
                <Loader2 size={16} className="animate-spin text-white" />
              ) : (
                <Send size={16} className="text-white" />
              )}
            </button>
            {isStreaming && autoComplete && (
              <button
                onClick={() => abortRef.current?.()}
                className="shrink-0 h-12 px-4 flex items-center gap-2 rounded-lg border border-[#e63946]/50 text-[#e63946] hover:bg-[#e63946]/10 transition-colors"
                title="Stop auto-complete"
              >
                <StopCircle size={14} />
                <span className="text-xs font-medium">STOP</span>
              </button>
            )}
          </div>
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

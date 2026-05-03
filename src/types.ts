// Provider as a const object + type (compatible with erasableSyntaxOnly)
export const Provider = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  groq: 'groq',
  mistral: 'mistral',
  lmstudio: 'lmstudio',
  ollama: 'ollama',
  custom: 'custom',
} as const

export type Provider = (typeof Provider)[keyof typeof Provider]

export interface AISettings {
  provider: Provider
  apiKey: string
  baseUrl: string
  model: string
  models: string[]
  temperature: number
  maxTokens: number
  contextWindow: number
  systemPrompt: string
  hexstrikeUrl: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
}

export interface HexstrikeCategory {
  name: string
  display_name: string
  tool_count: number
  tools: string[]
}

export interface HexstrikeTool {
  name: string
  description: string
  category: string
}

// ─── Chat History ─────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  tags?: string[]
}

// ─── Workspaces ────────────────────────────────────────────────────────────────

export type WorkspaceType =
  | 'chat'
  | 'autonomous'
  | 'files'
  | 'osint'
  | 'network'
  | 'web'
  | 'exploitation'
  | 'password'
  | 'forensics'
  | 'mobile'
  | 'wireless'
  | 'social'

export interface WorkspaceTab {
  id: string
  type: WorkspaceType
  title: string
  icon?: string
  tools?: HexstrikeTool[]
}

export interface ToolExecution {
  id: string
  toolName: string
  target: string
  options?: string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: string
  timestamp: number
}

export interface WorkspaceState {
  activeTab: WorkspaceType
  tabs: WorkspaceTab[]
  executions: ToolExecution[]
  recentTools: string[]
}

// ─── Quick Actions ─────────────────────────────────────────────────────────────

export interface QuickAction {
  id: string
  label: string
  toolName: string
  params: Record<string, string>
  category: string
}

// ─── AI Analysis & Reports ───────────────────────────────────────────────────────

export interface AIAnalysisResult {
  findings: {
    category: string
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
    finding: string
    evidence: string[]
    tools: string[]
  }[]
  correlations: {
    title: string
    description: string
    relatedFindings: number[]
  }[]
  summary: string
  nextSteps: string[]
}

export interface OSINTReport {
  title: string
  target: string
  generatedAt: number
  executiveSummary: string
  sections: {
    id: string
    title: string
    content: string
    findings: {
      title: string
      description: string
      evidence: string[]
      impact: string
      references?: string[]
    }[]
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  }[]
  timeline: {
    time: string
    event: string
    category: string
  }[]
  recommendations: string[]
  appendices: {
    title: string
    content: string
    type: 'code' | 'table' | 'list' | 'json'
  }[]
  markdown: string
}

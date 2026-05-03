import { useState } from 'react'
import {
  Play,
  Copy,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Terminal,
  Clock,
  Target,
  Plus,
  Minus,
} from 'lucide-react'
import type { ToolExecution, HexstrikeTool, WorkspaceType } from '../types'
import { useApp } from '../AppContext'
import { executeHexstrikeTool } from '../api'

interface WorkspacePanelProps {
  workspaceType: Exclude<WorkspaceType, 'autonomous' | 'chat' | 'files'>
  tools: HexstrikeTool[]
}

interface ToolForm {
  toolName: string
  target: string
  options: string
  advancedOptions: Record<string, string>
}

// Category-specific configurations
const WORKSPACE_CONFIGS: Record<
  Exclude<WorkspaceType, 'autonomous' | 'chat' | 'files'>, {
  title: string
  description: string
  color: string
  placeholder: string
  commonTools: string[]
  presets: Array<{ name: string; target: string; options?: string }>
}> = {
  osint: {
    title: 'OSINT Workspace',
    description: 'Open Source Intelligence gathering',
    color: '#3b82f6',
    placeholder: 'Enter target domain, IP, email, username...',
    commonTools: ['shodan_api', 'theharvester_osint', 'subfinder_enum', 'amass_enum', 'whois_lookup'],
    presets: [
      { name: 'Full Recon', target: '', options: '--full --recursive' },
      { name: 'Email Harvest', target: '', options: '--emails --deep' },
      { name: 'Subdomain Enum', target: '', options: '--threads 50' },
    ],
  },
  network: {
    title: 'Network Reconnaissance',
    description: 'Port scanning, service enumeration, network mapping',
    color: '#10b981',
    placeholder: 'Enter target IP, hostname, or CIDR...',
    commonTools: ['nmap_scan', 'masscan_scan', 'rustscan_scan', 'autorecon_scan', 'nmap_aggressive'],
    presets: [
      { name: 'Quick Scan', target: '', options: '-T4 -F' },
      { name: 'Full Port Scan', target: '', options: '-p-' },
      { name: 'Aggressive Scan', target: '', options: '-A -T4' },
    ],
  },
  web: {
    title: 'Web Security',
    description: 'Web application security testing',
    color: '#f59e0b',
    placeholder: 'Enter target URL...',
    commonTools: ['nuclei_templates', 'gobuster_enum', 'dirsearch_discovery', 'sqlmap_injection', 'dalfox_xss'],
    presets: [
      { name: 'Full Web Scan', target: '', options: '--deep --threads 20' },
      { name: 'Directory Enum', target: '', options: '--wordlist big' },
      { name: 'Vuln Scan', target: '', options: '--severity critical,high' },
    ],
  },
  exploitation: {
    title: 'Exploitation Framework',
    description: 'Penetration testing and exploitation tools',
    color: '#ef4444',
    placeholder: 'Enter target address...',
    commonTools: ['metasploit_framework', 'exploitdb_search', 'searchsploit_local'],
    presets: [
      { name: 'Auto Exploit', target: '', options: '--auto-pwn' },
      { name: 'CVE Search', target: '', options: '--cve-all' },
    ],
  },
  password: {
    title: 'Password Attacks',
    description: 'Password cracking and brute force attacks',
    color: '#8b5cf6',
    placeholder: 'Enter target hash or service...',
    commonTools: ['hashcat_crack', 'john_hash', 'hydra_brute', 'medusa_parallel'],
    presets: [
      { name: 'Wordlist Attack', target: '', options: '--wordlist rockyou.txt' },
      { name: 'Brute Force', target: '', options: '--brute --max-len 10' },
    ],
  },
  forensics: {
    title: 'Digital Forensics',
    description: 'File analysis, memory forensics, data recovery',
    color: '#06b6d4',
    placeholder: 'Enter file path or evidence location...',
    commonTools: ['binwalk_analysis', 'strings_extract', 'exiftool_meta', 'volatility_memory'],
    presets: [
      { name: 'Extract All', target: '', options: '--extract-all --recursive' },
      { name: 'Metadata', target: '', options: '--full-meta' },
    ],
  },
  mobile: {
    title: 'Mobile Security',
    description: 'iOS and Android application security',
    color: '#ec4899',
    placeholder: 'Enter APK/IPA path or package name...',
    commonTools: ['objection_runtime', 'frida_mobile', 'jadx_android', 'apktool_mobile'],
    presets: [
      { name: 'Full Analysis', target: '', options: '--deep-analysis' },
      { name: 'Runtime Hook', target: '', options: '--hook-all' },
    ],
  },
  wireless: {
    title: 'Wireless Security',
    description: 'WiFi and wireless network security',
    color: '#14b8a6',
    placeholder: 'Enter interface or target BSSID...',
    commonTools: ['aircrack_suite', 'wifite_auto', 'reaver_wps'],
    presets: [
      { name: 'Scan Networks', target: '', options: '--scan-all' },
      { name: 'WPA2 Crack', target: '', options: '--wpa2 --wordlist' },
    ],
  },
  social: {
    title: 'Social Engineering',
    description: 'Phishing and social engineering tools',
    color: '#f97316',
    placeholder: 'Enter target or campaign details...',
    commonTools: ['set_toolkit', 'gophish_phish', 'king_phisher'],
    presets: [
      { name: 'Quick Phish', target: '', options: '--template generic' },
      { name: 'Credential Harvester', target: '', options: '--harvest' },
    ],
  },
}

export function WorkspacePanel({ workspaceType, tools }: WorkspacePanelProps) {
  const config = WORKSPACE_CONFIGS[workspaceType]
  const { addWorkspaceExecution, addRecentTool, workspaceExecutions, setWorkspaceExecutions } = useApp()

  const [forms, setForms] = useState<ToolForm[]>([
    { toolName: config.commonTools[0] || '', target: '', options: '', advancedOptions: {} },
  ])
  const [running, setRunning] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<Record<number, string>>({})

  // Filter tools for this workspace
  const workspaceTools = tools.filter((t) => {
    const cat = t.category.toLowerCase().replace(/[\s&]+/g, '_').replace(/[^a-z0-9_]/g, '')
    const type = workspaceType.toLowerCase()
    return cat.includes(type) || cat === `${type}_reconnaissance` || cat === `${type}_security`
  })

  const addForm = () => {
    setForms([...forms, { toolName: config.commonTools[0] || '', target: '', options: '', advancedOptions: {} }])
  }

  const removeForm = (index: number) => {
    if (forms.length > 1) {
      setForms(forms.filter((_, i) => i !== index))
    }
  }

  const updateForm = (index: number, field: keyof ToolForm, value: string) => {
    const newForms = [...forms]
    if (field === 'advancedOptions') {
      // Don't update advancedOptions via this function
      return
    }
    newForms[index][field] = value
    setForms(newForms)
  }

  const executeTool = async (index: number) => {
    const form = forms[index]
    if (!form.toolName || !form.target) return

    setRunning((prev) => new Set(prev).add(index))
    setResults((prev) => ({ ...prev, [index]: '' }))

    const exec: Omit<ToolExecution, 'id' | 'timestamp'> = {
      toolName: form.toolName,
      target: form.target,
      options: form.options,
      status: 'running',
    }
    addWorkspaceExecution(exec)
    addRecentTool(form.toolName)

    try {
      const params = form.options ? { raw: form.options } : undefined
      const result = await executeHexstrikeTool(
        'http://localhost:8888',
        form.toolName,
        form.target,
        params
      )
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      setResults((prev) => ({ ...prev, [index]: resultStr }))
      addWorkspaceExecution({
        ...exec,
        status: 'done',
        result: resultStr,
      })
    } catch (err: any) {
      const errorStr = `Error: ${err?.message ?? String(err)}`
      setResults((prev) => ({ ...prev, [index]: errorStr }))
      addWorkspaceExecution({
        ...exec,
        status: 'error',
        result: errorStr,
      })
    } finally {
      setRunning((prev) => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    }
  }

  const executeAll = async () => {
    for (let i = 0; i < forms.length; i++) {
      if (forms[i].toolName && forms[i].target) {
        await executeTool(i)
      }
    }
  }

  const applyPreset = (index: number, preset: { name: string; target: string; options?: string }) => {
    updateForm(index, 'options', preset.options || '')
  }

  const copyResult = (index: number) => {
    navigator.clipboard.writeText(results[index] || '')
  }

  const clearResult = (index: number) => {
    setResults((prev) => ({ ...prev, [index]: '' }))
  }

  // Quick action presets
  const quickTargets = [
    { label: 'IP', value: '192.168.1.1' },
    { label: 'Domain', value: 'example.com' },
    { label: 'URL', value: 'https://example.com' },
    { label: 'Email', value: 'target@example.com' },
    { label: 'Username', value: 'target_user' },
  ]

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-[#1a1a2e] bg-[#0f0f1a] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[#e2e8f0] flex items-center gap-2">
              <Terminal size={20} className="text-[${config.color}]}" />
              {config.title}
            </h2>
            <p className="text-sm text-[#6b7280] mt-1">{config.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={executeAll}
              disabled={forms.every((f) => !f.toolName || !f.target)}
              className="flex items-center gap-2 px-4 py-2 bg-[#e63946] hover:bg-[#c1121f] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Play size={14} />
              Execute All
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Quick Target Insert */}
          <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-[#6b7280] mb-3">
                <Target size={12} />
                <span>Quick Target Insert</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickTargets.map((qt) => (
                  <button
                    key={qt.label}
                    onClick={() => {
                      const firstEmpty = forms.findIndex((f) => !f.target)
                      if (firstEmpty >= 0) {
                        updateForm(firstEmpty, 'target', qt.value)
                      }
                    }}
                    className="px-3 py-1.5 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 border border-[#1a1a2e] hover:border-[#e63946]/50 rounded text-xs text-[#94a3b8] transition-colors"
                  >
                    {qt.label}
                  </button>
                ))}
              </div>
            </div>

          {/* Tool Forms */}
          {forms.map((form, index) => (
            <div key={index} className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[#e63946]">#{index + 1}</span>
                  <select
                    value={form.toolName}
                    onChange={(e) => updateForm(index, 'toolName', e.target.value)}
                    className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] focus:border-[#e63946]/60 focus:outline-none min-w-[200px]"
                  >
                    <option value="">Select tool...</option>
                    {workspaceTools.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {config.presets.length > 0 && (
                    <div className="flex items-center gap-1">
                      {config.presets.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => applyPreset(index, preset)}
                          className="px-2 py-1 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 rounded text-xs text-[#6b7280] hover:text-[#e63946] transition-colors"
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {forms.length > 1 && (
                    <button
                      onClick={() => removeForm(index)}
                      className="p-1.5 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-colors"
                    >
                      <Minus size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Target */}
                <div className="md:col-span-2">
                  <label className="block text-xs text-[#6b7280] mb-1.5">Target</label>
                  <input
                    type="text"
                    value={form.target}
                    onChange={(e) => updateForm(index, 'target', e.target.value)}
                    placeholder={config.placeholder}
                    className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#6b7280] focus:border-[#e63946]/60 focus:outline-none font-mono"
                  />
                </div>

                {/* Execute */}
                <div className="flex items-end">
                  <button
                    onClick={() => executeTool(index)}
                    disabled={!form.toolName || !form.target || running.has(index)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#e63946] hover:bg-[#c1121f] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {running.has(index) ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play size={14} />
                        Execute
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Options */}
              <div className="mt-4">
                <label className="block text-xs text-[#6b7280] mb-1.5">Options</label>
                <input
                  type="text"
                  value={form.options}
                  onChange={(e) => updateForm(index, 'options', e.target.value)}
                  placeholder="--option1 value1 --option2 value2"
                  className="w-full bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-[#e2e8f0] placeholder-[#6b7280] focus:border-[#e63946]/60 focus:outline-none font-mono"
                />
              </div>

              {/* Result */}
              {results[index] && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                      <Terminal size={12} />
                      <span>Output</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyResult(index)}
                        className="p-1.5 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#00ff41] transition-colors"
                        title="Copy"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        onClick={() => clearResult(index)}
                        className="p-1.5 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-colors"
                        title="Clear"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <pre className="bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg p-3 text-xs text-[#00ff41] font-mono overflow-x-auto max-h-64 overflow-y-auto">
                    {results[index]}
                  </pre>
                </div>
              )}
            </div>
          ))}

          {/* Add Another Button */}
          <button
            onClick={addForm}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[#1a1a2e] hover:border-[#e63946]/50 rounded-xl text-[#6b7280] hover:text-[#e63946] transition-colors"
          >
            <Plus size={16} />
            Add Another Tool
          </button>

          {/* Recent Executions */}
          {workspaceExecutions.length > 0 && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                  <Clock size={12} />
                  <span>Recent Executions</span>
                  <span className="text-[#1a1a2e]">|</span>
                  <span>{workspaceExecutions.length} total</span>
                </div>
                <button
                  onClick={() => setWorkspaceExecutions([])}
                  className="text-xs text-[#6b7280] hover:text-[#e63946] transition-colors"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {workspaceExecutions.slice(-10).reverse().map((exec) => (
                  <div
                    key={exec.id}
                    className="flex items-center gap-3 p-3 bg-[#0a0a0f] rounded-lg border border-[#1a1a2e]"
                  >
                    {exec.status === 'running' && <Loader2 size={12} className="text-[#fbbf24] animate-spin" />}
                    {exec.status === 'done' && <CheckCircle size={12} className="text-[#00ff41]" />}
                    {exec.status === 'error' && <XCircle size={12} className="text-[#e63946]" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#e2e8f0]">{exec.toolName}</span>
                        <span className="text-[#1a1a2e]">→</span>
                        <span className="text-xs text-[#94a3b8] truncate">{exec.target}</span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#6b7280]">
                      {new Date(exec.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

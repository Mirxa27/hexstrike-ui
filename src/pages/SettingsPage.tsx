
import { useState, useCallback, useEffect } from 'react'
import {
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle,
  XCircle,
  ChevronDown,
  Loader2,
  Server,
  Cpu,
  Sliders,
  Terminal,
  Palette,
  Zap,
  Trash2,
} from 'lucide-react'
import { Provider } from '../types'
import type { AISettings } from '../types'
import { useApp } from '../AppContext'
import { fetchModels, fetchHexstrikeTools, coerceHexstrikeUrlInput } from '../api'
import { useToaster } from '../components/Toaster'

// ── Provider definitions ─────────────────────────────────────────────────────

interface ProviderDef {
  id: Provider
  label: string
  color: string
  local?: boolean
  noKey?: boolean
}

const PROVIDERS: ProviderDef[] = [
  { id: Provider.openai, label: 'OpenAI', color: '#10b981' },
  { id: Provider.anthropic, label: 'Anthropic', color: '#f97316' },
  { id: Provider.google, label: 'Google', color: '#3b82f6' },
  { id: Provider.groq, label: 'Groq', color: '#8b5cf6' },
  { id: Provider.mistral, label: 'Mistral', color: '#14b8a6' },
  { id: Provider.lmstudio, label: 'LM Studio', color: '#00d4ff', local: true, noKey: true },
  { id: Provider.ollama, label: 'Ollama', color: '#94a3b8', local: true, noKey: true },
  { id: Provider.custom, label: 'Custom', color: '#e2e8f0' },
]

const DEFAULT_BASE_PLACEHOLDER: Record<string, string> = {
  [Provider.openai]: 'https://api.openai.com/v1',
  [Provider.groq]: 'https://api.groq.com/openai/v1',
  [Provider.mistral]: 'https://api.mistral.ai/v1',
  [Provider.lmstudio]: 'http://localhost:1234/v1',
  [Provider.ollama]: 'http://localhost:11434',
  [Provider.custom]: 'https://your-api-endpoint.com/v1',
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[#e2e8f0] mb-5 border-l-2 border-[#e63946] pl-3">
        <Icon size={15} className="text-[#e63946]" />
        {title}
      </h2>
      {children}
    </div>
  )
}

// ── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-[#94a3b8] font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[#6b7280]">{hint}</p>}
    </div>
  )
}

// ── Main SettingsPage ────────────────────────────────────────────────────────

export function SettingsPage() {
  const { settings, updateSettings, resetSettings, refreshHexstrike, clearAllSecrets } = useApp()
  const toaster = useToaster()

  // Local draft state
  const [draft, setDraft] = useState<AISettings>({ ...settings })
  const [showKey, setShowKey] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{
    ok: boolean
    message: string
    latencyMs?: number
  } | null>(null)
  const [verifyingKey, setVerifyingKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null)

  // Sync draft if settings change externally
  useEffect(() => {
    setDraft({ ...settings })
  }, [settings])

  const patch = (partial: Partial<AISettings>) => setDraft((d) => ({ ...d, ...partial }))

  const currentProvider = PROVIDERS.find((p) => p.id === draft.provider)

  // Fetch models
   const handleFetchModels = useCallback(async () => {
     setFetchingModels(true)
     setModelError(null)
     try {
       const models = await fetchModels(draft)
       patch({ models, model: models[0] ?? draft.model })
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err)
       setModelError(msg)
     } finally {
       setFetchingModels(false)
     }
   }, [draft])

   // Test HexStrike connection
   const handleTestConnection = useCallback(async () => {
     setTestingConnection(true)
     setConnectionStatus(null)
     const t0 = performance.now()
     const hex = coerceHexstrikeUrlInput(draft.hexstrikeUrl)
     if (hex !== draft.hexstrikeUrl) patch({ hexstrikeUrl: hex })
     try {
       const data = await fetchHexstrikeTools(hex)
       const latencyMs = Math.round(performance.now() - t0)
       setConnectionStatus({
         ok: true,
         message: `Connected — ${data.tools.length} tools, ${data.categories.length} categories (${latencyMs} ms)`,
         latencyMs,
       })
     } catch (err) {
       const latencyMs = Math.round(performance.now() - t0)
       const msg = err instanceof Error ? err.message : 'Connection failed'
       setConnectionStatus({
         ok: false,
         message: `${msg} (${latencyMs} ms)`,
         latencyMs,
       })
    } finally {
      setTestingConnection(false)
    }
  }, [draft])

  // Verify the configured API key by issuing a model-list request to the
  // currently selected provider. Successful round-trip means the key is
  // accepted; failure means it's rejected, missing, or the endpoint is
  // unreachable. Local providers (lmstudio/ollama) skip the key check.
  const handleVerifyKey = useCallback(async () => {
    setVerifyingKey(true)
    setKeyStatus(null)
     try {
       const t0 = performance.now()
       const models = await fetchModels(draft)
       const latencyMs = Math.round(performance.now() - t0)
       setKeyStatus({
         ok: true,
         message: `API key accepted — ${models.length} models reachable (${latencyMs} ms)`,
       })
     } catch (err) {
       const msg = err instanceof Error ? err.message : 'API key verification failed'
       setKeyStatus({ ok: false, message: msg })
     } finally {
      setVerifyingKey(false)
    }
  }, [draft])

  // Save
  const handleSave = () => {
    const hex = coerceHexstrikeUrlInput(draft.hexstrikeUrl)
    const toSave = { ...draft, hexstrikeUrl: hex }
    setDraft(toSave)
    updateSettings(toSave)
    refreshHexstrike()
    toaster.success('Settings saved')
  }

  // Reset
  const handleReset = () => {
    resetSettings()
    toaster.info('Settings reset to defaults')
  }

  const inputClass =
    'w-full bg-[#0a0a0f] border border-[#1a1a2e] text-[#e2e8f0] rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-[#e63946]/60 placeholder-[#6b7280]'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-lg font-bold text-[#e63946] uppercase tracking-widest">Settings</h1>
          <p className="text-xs text-[#6b7280] mt-1">Configure AI provider, tools, and appearance</p>
        </div>

        {/* ─── AI Provider Configuration ─── */}
        <Section icon={Cpu} title="AI Provider Configuration">
          <div className="space-y-5">
            {/* Provider selector */}
            <Field label="Provider">
              <div className="grid grid-cols-4 gap-2">
                {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => patch({ provider: p.id, model: '', models: [] })}
                  className={`relative flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border text-xs font-medium transition-all ${
                    draft.provider === p.id
                      ? 'border-hex-accent bg-hex-accent/10 text-hex-text'
                      : 'border-hex-border bg-hex-bg text-hex-muted hover:border-hex-border/80 hover:text-hex-text-dim'
                  }`}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span>{p.label}</span>
                  {p.local && (
                    <span className="text-[9px] text-hex-muted -mt-0.5">local</span>
                  )}
                  {draft.provider === p.id && (
                    <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-hex-accent" />
                  )}
                </button>
                ))}
              </div>
            </Field>

            {/* API Key */}
            {!currentProvider?.noKey && (
              <Field
                label="API Key"
                hint="⚠️  Stored in your browser's localStorage and sent directly from the browser to the provider. Anyone with XSS access to this origin can exfiltrate it. Do not paste production keys on shared machines."
              >
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    placeholder={`Enter your ${currentProvider?.label ?? ''} API key`}
                    className={`${inputClass} pr-10`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-[#94a3b8]"
                    title={showKey ? 'Hide API key (recommended for screenshots)' : 'Reveal API key'}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <button
                    type="button"
                    onClick={handleVerifyKey}
                    disabled={verifyingKey || !draft.apiKey}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-hex-bg border border-hex-border rounded text-[11px] text-hex-text-dim hover:text-hex-text hover:border-hex-cyan/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {verifyingKey ? (
                      <Loader2 size={11} className="animate-spin text-[#00d4ff]" />
                    ) : (
                      <Zap size={11} className="text-[#00d4ff]" />
                    )}
                    Verify API key
                  </button>
                  {keyStatus && (
                    <span
                      className={`text-[11px] flex items-center gap-1 ${
                        keyStatus.ok ? 'text-[#00ff41]' : 'text-[#e63946]'
                      }`}
                    >
                      {keyStatus.ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
                      {keyStatus.message}
                    </span>
                  )}
                </div>
              </Field>
            )}

            {/* Base URL */}
            {(currentProvider?.local || draft.provider === Provider.custom) && (
              <Field
                label="Base URL"
                hint={
                  draft.provider === Provider.ollama
                    ? 'Default: http://localhost:11434 — run `ollama serve` first.'
                    : draft.provider === Provider.lmstudio
                    ? 'http://localhost:1234 (/v1 auto-added) — start LM Studio via Developer → Start Server, load a model, and ENABLE CORS. Running the Docker UI? Use "/lmstudio" instead to proxy same-origin (no CORS needed).'
                    : 'Full base URL for your API endpoint'
                }
              >
                <input
                  type="text"
                  value={draft.baseUrl}
                  onChange={(e) => patch({ baseUrl: e.target.value })}
                  placeholder={DEFAULT_BASE_PLACEHOLDER[draft.provider] ?? ''}
                  className={inputClass}
                />
              </Field>
            )}

            {/* Model selection */}
            <Field label="Model">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    value={draft.model}
                    onChange={(e) => patch({ model: e.target.value })}
                    className={`${inputClass} appearance-none pr-8 cursor-pointer`}
                  >
                    {!draft.model && (
                      <option value="">— select a model —</option>
                    )}
                    {draft.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {/* Allow manual entry even if not in list */}
                    {draft.model && !draft.models.includes(draft.model) && (
                      <option value={draft.model}>{draft.model}</option>
                    )}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6b7280] pointer-events-none"
                  />
                </div>
                <button
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#0a0a0f] border border-[#1a1a2e] rounded text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#e63946]/50 transition-colors disabled:opacity-50"
                >
                  {fetchingModels ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  Fetch
                </button>
              </div>
              {/* Manual model entry */}
              <input
                type="text"
                value={draft.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder="Or type model name manually..."
                className={`${inputClass} mt-2 text-xs`}
              />
              {modelError && (
                <p className="text-[11px] text-[#e63946] flex items-center gap-1 mt-1">
                  <XCircle size={11} />
                  {modelError}
                </p>
              )}
            </Field>
          </div>
        </Section>

        {/* ─── Model Parameters ─── */}
        <Section icon={Sliders} title="Model Parameters">
          <div className="space-y-5">
            {/* Temperature */}
            <Field
              label={`Temperature: ${draft.temperature.toFixed(1)}`}
              hint="Controls randomness. Lower = more deterministic, higher = more creative."
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[#6b7280] w-4">0</span>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={draft.temperature}
                  onChange={(e) => patch({ temperature: parseFloat(e.target.value) })}
                  className="flex-1 h-1.5 appearance-none bg-[#1a1a2e] rounded-full cursor-pointer accent-[#e63946]"
                />
                <span className="text-[10px] text-[#6b7280] w-4">2</span>
                <span className="text-xs text-[#e63946] font-medium w-8 text-right">
                  {draft.temperature.toFixed(1)}
                </span>
              </div>
            </Field>

            {/* Max tokens */}
            <Field label="Max Tokens" hint="Maximum number of tokens in the response (100–32000).">
              <input
                type="number"
                min={100}
                max={32000}
                step={100}
                value={draft.maxTokens}
                onChange={(e) => patch({ maxTokens: parseInt(e.target.value, 10) || 4096 })}
                className={inputClass}
              />
            </Field>

            {/* Context window */}
            <Field
              label="Context Window"
              hint="Maximum tokens for input + output. Auto-detected from model (8k–2M)."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1000}
                  max={2000000}
                  step={1000}
                  value={draft.contextWindow}
                  onChange={(e) => patch({ contextWindow: parseInt(e.target.value, 10) || 128000 })}
                  className={inputClass}
                />
                <span className="text-[10px] text-[#6b7280]">
                  {draft.contextWindow >= 1000000
                    ? `${(draft.contextWindow / 1000000).toFixed(1)}M`
                    : draft.contextWindow >= 1000
                    ? `${(draft.contextWindow / 1000).toFixed(0)}K`
                    : draft.contextWindow}
                </span>
              </div>
            </Field>

            {/* System prompt */}
            <Field
              label="System Prompt"
              hint="Instructions given to the AI at the start of every conversation."
            >
              <textarea
                value={draft.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                rows={5}
                className={`${inputClass} resize-y leading-relaxed`}
                placeholder="You are HexStrike AI, an advanced cybersecurity assistant..."
              />
            </Field>
          </div>
        </Section>

        {/* ─── HexStrike Configuration ─── */}
        <Section icon={Server} title="HexStrike Configuration">
          <div className="space-y-5">
            <Field
              label="HexStrike Server URL"
              hint="Docker / nginx: use /api (same origin). Local backend: http://127.0.0.1:8888. Host:port without http:// is fixed automatically on blur or Test / Save."
            >
              <input
                type="text"
                value={draft.hexstrikeUrl}
                onChange={(e) => patch({ hexstrikeUrl: e.target.value })}
                onBlur={() => {
                  const hex = coerceHexstrikeUrlInput(draft.hexstrikeUrl)
                  if (hex !== draft.hexstrikeUrl) patch({ hexstrikeUrl: hex })
                }}
                placeholder="/api or http://127.0.0.1:8888"
                className={inputClass}
              />
            </Field>

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="flex items-center gap-2 px-4 py-2 bg-[#0a0a0f] border border-[#1a1a2e] rounded text-xs text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[#00d4ff]/50 transition-colors disabled:opacity-50"
              >
                {testingConnection ? (
                  <Loader2 size={12} className="animate-spin text-[#00d4ff]" />
                ) : (
                  <Zap size={12} className="text-[#00d4ff]" />
                )}
                Test Connection
              </button>

              {connectionStatus && (
                <div
                  className={`flex items-center gap-1.5 text-xs ${
                    connectionStatus.ok ? 'text-[#00ff41]' : 'text-[#e63946]'
                  }`}
                >
                  {connectionStatus.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
                  {connectionStatus.message}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ─── Appearance ─── */}
        <Section icon={Palette} title="Appearance">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Background', color: '#0a0a0f', name: 'hex-bg' },
              { label: 'Surface', color: '#0f0f1a', name: 'hex-surface' },
              { label: 'Border', color: '#1a1a2e', name: 'hex-border' },
              { label: 'Accent', color: '#e63946', name: 'hex-accent' },
              { label: 'Cyan', color: '#00d4ff', name: 'hex-cyan' },
              { label: 'Green', color: '#00ff41', name: 'hex-green' },
              { label: 'Purple', color: '#8b5cf6', name: 'hex-purple' },
              { label: 'Text', color: '#e2e8f0', name: 'hex-text' },
            ].map(({ label, color, name }) => (
              <div
                key={name}
                className="flex items-center gap-3 px-3 py-2 rounded border border-[#1a1a2e] bg-[#0a0a0f]"
              >
                <div
                  className="w-4 h-4 rounded border border-[#1a1a2e] shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div>
                  <p className="text-xs text-[#e2e8f0]">{label}</p>
                  <p className="text-[10px] text-[#6b7280] font-mono">{color}</p>
                </div>
                <code className="ml-auto text-[9px] text-[#6b7280]">{name}</code>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#6b7280] mt-3 flex items-center gap-1">
            <Terminal size={11} />
            Theme: Cyberpunk Dark — system monospace
          </p>
        </Section>

        {/* ─── Action buttons ─── */}
        <div className="flex items-center justify-between pb-8 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 border border-[#1a1a2e] rounded text-xs text-[#6b7280] hover:text-[#e2e8f0] hover:border-[#e63946]/30 transition-colors"
            >
              <RotateCcw size={13} />
              Reset to defaults
            </button>
            <button
              onClick={() => {
                if (confirm('Wipe stored API key and base URL from this browser? This cannot be undone.')) {
                  clearAllSecrets()
                  setDraft((d) => ({ ...d, apiKey: '', baseUrl: '' }))
                  setKeyStatus(null)
                }
              }}
              className="flex items-center gap-2 px-4 py-2 border border-[#1a1a2e] rounded text-xs text-[#e63946] hover:bg-[#e63946]/10 transition-colors"
              title="Remove API key + base URL from localStorage"
            >
              <Trash2 size={13} />
              Clear all secrets
            </button>
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2 bg-[#e63946] hover:bg-[#c1121f] rounded text-sm text-white font-medium transition-colors"
          >
            <Save size={14} />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}

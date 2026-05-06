import { useState, useEffect, useRef } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  FileText,
  Download,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Brain,
  Target,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  Zap,
} from 'lucide-react'
import type { ToolExecution, HexstrikeTool, OSINTReport } from '../types'
import { useApp } from '../AppContext'
import { executeHexstrikeTool } from '../api'
import { generateScanPlanSmart, detectTargetType, analyzeResults, type AIScanPlan } from '../aiAgent'
import { entitiesByTool, substituteVariables, FailureTracker } from '../agent'
import { generateOSINTReport, generateNarrativeReport } from '../reportGenerator'

interface AutonomousWorkspaceProps {
  workspaceType: string
  tools: HexstrikeTool[]
}

export function AutonomousWorkspace({ workspaceType, tools }: AutonomousWorkspaceProps) {
  const { addWorkspaceExecution, addRecentTool, hexstrikeLoading, hexstrikeConnected, settings } = useApp()

  const [target, setTarget] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [scanPlan, setScanPlan] = useState<AIScanPlan | null>(null)
  const [completedExecutions, setCompletedExecutions] = useState<ToolExecution[]>([])
  const [showPlan, setShowPlan] = useState(true)
  const [generatedReport, setGeneratedReport] = useState<OSINTReport | null>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [showNarrative, setShowNarrative] = useState(false)

  // Persistent failure tracker across the scan run (P3-10).
  const failureTrackerRef = useRef(new FailureTracker())

  // Generate scan plan when target changes (LLM-backed when possible, P3-1)
  useEffect(() => {
    if (target.length > 3) {
      let cancelled = false
      void generateScanPlanSmart(target, tools, settings).then(({ plan }) => {
        if (!cancelled) setScanPlan(plan)
      })
      return () => { cancelled = true }
    } else {
      setScanPlan(null)
    }
  }, [target, tools, settings])

  // Auto-execute logic
  useEffect(() => {
    if (!isRunning || isPaused || !scanPlan || currentStep >= scanPlan.recommendations.length) {
      return
    }

    const executeNext = async () => {
      const recommendation = scanPlan.recommendations[currentStep]
      if (!recommendation) return

      // Backoff guard: skip tools that have failed too many times (P3-10).
      if (failureTrackerRef.current.shouldSkip(recommendation.tool.name)) {
        setCompletedExecutions((prev) => [
          ...prev,
          {
            id: `auto-${Date.now()}`,
            toolName: recommendation.tool.name,
            target,
            status: 'error',
            result: `Skipped after repeated failures (backoff)`,
            timestamp: Date.now(),
          },
        ])
        setCurrentStep((prev) => prev + 1)
        return
      }

      // Inter-step variable piping (P3-3): the recommendation may use
      // `${prev.<tool>.<field>}` references in its target/options string,
      // resolved against entities extracted from earlier executions.
      // Use the per-step target from the plan (which is where the LLM
      // places the placeholders); fall back to the top-level target.
      const ctx = {
        prev: entitiesByTool(completedExecutions),
        entities: { domains: [], subdomains: [], ips: [], urls: [], emails: [], cves: [], hashes: [], ports: [] },
      }
      const stepTarget = recommendation.target ?? target
      const targetRes = substituteVariables(stepTarget, ctx)
      const resolvedTarget = targetRes.value || target
      const optsRaw = recommendation.options
        ? substituteVariables(recommendation.options, ctx).value
        : ''

      try {
        const result = await executeHexstrikeTool(
          settings.hexstrikeUrl || 'http://localhost:8888',
          recommendation.tool.name,
          resolvedTarget,
          { raw: optsRaw }
        )

        const execution: ToolExecution = {
          id: `auto-${Date.now()}`,
          toolName: recommendation.tool.name,
          target: resolvedTarget,
          status: 'done',
          result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          timestamp: Date.now(),
        }

        setCompletedExecutions(prev => [...prev, execution])
        addWorkspaceExecution(execution)
        addRecentTool(recommendation.tool.name)
        failureTrackerRef.current.reset(recommendation.tool.name)

        // Move to next step
        setCurrentStep(prev => prev + 1)
      } catch (err: any) {
        failureTrackerRef.current.record(recommendation.tool.name)
        const execution: ToolExecution = {
          id: `auto-${Date.now()}`,
          toolName: recommendation.tool.name,
          target: resolvedTarget,
          status: 'error',
          result: `Error: ${err?.message ?? String(err)}`,
          timestamp: Date.now(),
        }
        setCompletedExecutions(prev => [...prev, execution])
        addWorkspaceExecution(execution)
        setCurrentStep(prev => prev + 1)
      }
    }

    executeNext()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, isPaused, currentStep, scanPlan, target])

  // Generate analysis when execution completes
  useEffect(() => {
    if (completedExecutions.length > 0 && currentStep >= (scanPlan?.recommendations.length || 0)) {
      const aiAnalysis = analyzeResults(completedExecutions, target)
      setAnalysis(aiAnalysis)

      const report = generateOSINTReport(target, completedExecutions, aiAnalysis, workspaceType)
      setGeneratedReport(report)
    }
  }, [completedExecutions, currentStep, scanPlan])

  const startAutonomousScan = () => {
    if (!target || !scanPlan) return
    // A new scan is a clean slate — clear any failure history from
    // previous runs so a tool that failed for `acme.com` isn't skipped
    // when the user moves on to `example.com`.
    failureTrackerRef.current = new FailureTracker()
    setIsRunning(true)
    setIsPaused(false)
    setCurrentStep(0)
    setCompletedExecutions([])
    setGeneratedReport(null)
  }

  const pauseScan = () => {
    setIsPaused(!isPaused)
  }

  const stopScan = () => {
    setIsRunning(false)
    setIsPaused(false)
  }

  const resetScan = () => {
    failureTrackerRef.current = new FailureTracker()
    setIsRunning(false)
    setIsPaused(false)
    setCurrentStep(0)
    setCompletedExecutions([])
    setGeneratedReport(null)
  }

  const downloadReport = () => {
    if (!generatedReport) return

    const blob = new Blob([generatedReport.markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `osint-report-${target}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadNarrative = () => {
    if (!generatedReport || !analysis) return

    const narrative = generateNarrativeReport(target, analysis, completedExecutions)
    const blob = new Blob([narrative], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `osint-narrative-${target}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const targetType = target ? detectTargetType(target) : null
  const progress = scanPlan ? (currentStep / scanPlan.recommendations.length) * 100 : 0
  const isComplete = scanPlan && currentStep >= scanPlan.recommendations.length

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-[#1a1a2e] bg-[#0f0f1a] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#e63946]/10 rounded-lg">
              <Brain className="text-[#e63946]" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#e2e8f0]">Autonomous Intelligence</h2>
              <p className="text-xs text-[#6b7280]">AI-driven reconnaissance and analysis</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {generatedReport && (
              <>
                <button
                  onClick={() => setShowNarrative(!showNarrative)}
                  className="flex items-center gap-2 px-3 py-2 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 border border-[#1a1a2e] rounded-lg text-xs text-[#94a3b8] transition-colors"
                >
                  <FileText size={14} />
                  {showNarrative ? 'Show Report' : 'Show Narrative'}
                </button>
                <button
                  onClick={downloadNarrative}
                  className="flex items-center gap-2 px-3 py-2 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 border border-[#1a1a2e] rounded-lg text-xs text-[#94a3b8] transition-colors"
                  title="Download narrative story"
                >
                  <Sparkles size={14} />
                  Story
                </button>
                <button
                  onClick={downloadReport}
                  className="flex items-center gap-2 px-3 py-2 bg-[#10b981] hover:bg-[#059669] rounded-lg text-xs text-white transition-colors"
                  title="Download markdown report"
                >
                  <Download size={14} />
                  Export
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Loading / connection states */}
          {hexstrikeLoading && tools.length === 0 && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center gap-3">
                <Loader2 size={16} className="text-[#00d4ff] animate-spin" />
                <span className="text-sm text-[#94a3b8]">Loading tool catalog…</span>
              </div>
            </div>
          )}
          {!hexstrikeLoading && !hexstrikeConnected && tools.length === 0 && (
            <div className="bg-[#0f0f1a] border border-[#e63946]/30 rounded-xl p-5">
              <div className="flex items-center gap-2 text-[#e63946] text-sm font-medium mb-1">
                <AlertTriangle size={14} />
                HexStrike backend not reachable
              </div>
              <p className="text-xs text-[#94a3b8]">
                The autonomous planner needs the HexStrike API to enumerate tools.
                Configure the URL in <span className="text-[#e63946]">Settings</span> and retry.
              </p>
            </div>
          )}
          {/* Pre-target prompt — distinct from "no tools" */}
          {!target && tools.length > 0 && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5 text-center">
              <Target size={28} className="mx-auto text-[#e63946]/60 mb-2" />
              <p className="text-sm text-[#e2e8f0]">Enter a target below to generate an AI scan plan.</p>
              <p className="text-[11px] text-[#6b7280] mt-1">
                Domains, IPs, URLs, emails and usernames are auto-detected.
              </p>
            </div>
          )}

          {/* Target Input */}
          <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target size={16} className="text-[#e63946]" />
              <h3 className="text-sm font-semibold text-[#e2e8f0]">Target Selection</h3>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Enter domain, IP, URL, email, or username..."
                className="flex-1 bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg px-4 py-3 text-sm text-[#e2e8f0] placeholder-[#6b7280] focus:border-[#e63946]/60 focus:outline-none font-mono"
              />
              <div className="flex items-center gap-2">
                {!isRunning ? (
                  <button
                    onClick={startAutonomousScan}
                    disabled={!target || !scanPlan}
                    className="flex items-center gap-2 px-6 py-3 bg-[#e63946] hover:bg-[#c1121f] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Sparkles size={16} />
                    Start Autonomous Scan
                  </button>
                ) : (
                  <>
                    <button
                      onClick={pauseScan}
                      className="flex items-center gap-2 px-4 py-3 bg-[#f59e0b] hover:bg-[#d97706] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {isPaused ? <Play size={16} /> : <Pause size={16} />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      onClick={stopScan}
                      className="flex items-center gap-2 px-4 py-3 bg-[#ef4444] hover:bg-[#dc2626] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <XCircle size={16} />
                      Stop
                    </button>
                  </>
                )}
                {(completedExecutions.length > 0 || isRunning) && (
                  <button
                    onClick={resetScan}
                    className="flex items-center gap-2 px-4 py-3 bg-[#1a1a2e] hover:bg-[#1a1a2e]/80 border border-[#1a1a2e] rounded-lg text-sm text-[#94a3b8] transition-colors"
                  >
                    <RotateCcw size={16} />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Target Type Detection */}
            {targetType && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-[#6b7280]">Detected type:</span>
                <span className="px-2 py-1 bg-[#e63946]/10 border border-[#e63946]/30 rounded text-xs text-[#e63946] font-medium uppercase">
                  {targetType}
                </span>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {isRunning && scanPlan && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap size={16} className="text-[#00ff41] animate-pulse" />
                  <span className="text-sm font-medium text-[#e2e8f0]">
                    {isComplete ? 'Scan Complete' : 'Autonomous Scan in Progress'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                  <Clock size={12} />
                  <span>{currentStep}/{scanPlan.recommendations.length} steps</span>
                </div>
              </div>
              <div className="w-full bg-[#0a0a0f] rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#e63946] to-[#00ff41] transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* AI Scan Plan */}
          {scanPlan && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowPlan(!showPlan)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#1a1a2e]/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Brain size={16} className="text-[#e63946]" />
                  <h3 className="text-sm font-semibold text-[#e2e8f0]">AI-Generated Scan Plan</h3>
                  <span className="px-2 py-0.5 bg-[#e63946]/10 border border-[#e63946]/30 rounded text-xs text-[#e63946]">
                    {scanPlan.recommendations.length} tools
                  </span>
                </div>
                {showPlan ? <ChevronDown size={16} className="text-[#6b7280]" /> : <ChevronRight size={16} className="text-[#6b7280]" />}
              </button>

              {showPlan && (
                <div className="px-5 pb-5 border-t border-[#1a1a2e]">
                  <div className="mt-4 p-4 bg-[#0a0a0f] rounded-lg">
                    <p className="text-xs text-[#94a3b8] leading-relaxed">{scanPlan.strategy}</p>
                  </div>

                  <div className="mt-4 space-y-2">
                    {scanPlan.recommendations.map((rec, idx) => {
                      const isExecuted = idx < currentStep
                      const isCurrent = idx === currentStep && isRunning && !isPaused
                      void (idx > currentStep) // isPending

                      return (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                            isExecuted
                              ? 'bg-[#00ff41]/5 border-[#00ff41]/20'
                              : isCurrent
                                ? 'bg-[#e63946]/10 border-[#e63946]/30'
                                : 'bg-[#0a0a0f] border-[#1a1a2e]'
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {isExecuted ? (
                              <CheckCircle2 size={14} className="text-[#00ff41]" />
                            ) : isCurrent ? (
                              <Loader2 size={14} className="text-[#e63946] animate-spin" />
                            ) : (
                              <Clock size={14} className="text-[#6b7280]" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[#e2e8f0]">{rec.tool.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                                rec.priority === 'critical' ? 'bg-[#e63946]/20 text-[#e63946]' :
                                rec.priority === 'high' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' :
                                rec.priority === 'medium' ? 'bg-[#3b82f6]/20 text-[#3b82f6]' :
                                'bg-[#6b7280]/20 text-[#6b7280]'
                              }`}>
                                {rec.priority}
                              </span>
                              <span className="text-[10px] text-[#6b7280]">~{rec.estimatedTime}</span>
                            </div>
                            <p className="text-xs text-[#94a3b8] mt-1">{rec.reason}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Execution Results */}
          {completedExecutions.length > 0 && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Eye size={16} className="text-[#e63946]" />
                  <h3 className="text-sm font-semibold text-[#e2e8f0]">Execution Results</h3>
                </div>
                <span className="text-xs text-[#6b7280]">{completedExecutions.length} completed</span>
              </div>
              <div className="space-y-3">
                {completedExecutions.slice(-5).reverse().map((exec) => (
                  <div
                    key={exec.id}
                    className="p-3 bg-[#0a0a0f] border border-[#1a1a2e] rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-[#e2e8f0]">{exec.toolName}</span>
                      <div className="flex items-center gap-1">
                        {exec.status === 'done' ? (
                          <CheckCircle2 size={12} className="text-[#00ff41]" />
                        ) : (
                          <XCircle size={12} className="text-[#e63946]" />
                        )}
                      </div>
                    </div>
                    {exec.result && (
                      <pre className="text-[10px] text-[#94a3b8] font-mono bg-[#0a0a0f] rounded p-2 overflow-x-auto max-h-20 overflow-y-auto">
                        {exec.result.slice(0, 500)}{exec.result.length > 500 ? '...' : ''}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Analysis */}
          {analysis && !showNarrative && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-[#e63946]" />
                <h3 className="text-sm font-semibold text-[#e2e8f0]">AI Analysis</h3>
              </div>

              {analysis.findings.length > 0 ? (
                <div className="space-y-3">
                  {analysis.findings.map((finding: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg border ${
                        finding.severity === 'critical'
                          ? 'bg-[#e63946]/10 border-[#e63946]/30'
                          : finding.severity === 'high'
                            ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30'
                            : finding.severity === 'medium'
                              ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30'
                              : 'bg-[#6b7280]/10 border-[#6b7280]/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {finding.severity === 'critical' && <AlertTriangle size={14} className="text-[#e63946]" />}
                        <span className="text-sm font-medium text-[#e2e8f0]">{finding.category}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                          finding.severity === 'critical' ? 'bg-[#e63946]/30 text-[#e63946]' :
                          finding.severity === 'high' ? 'bg-[#f59e0b]/30 text-[#f59e0b]' :
                          finding.severity === 'medium' ? 'bg-[#3b82f6]/30 text-[#3b82f6]' :
                          'bg-[#6b7280]/30 text-[#6b7280]'
                        }`}>
                          {finding.severity}
                        </span>
                      </div>
                      <p className="text-xs text-[#94a3b8]">{finding.finding}</p>
                      {finding.evidence?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] text-[#6b7280] mb-1">Evidence:</p>
                          <div className="flex flex-wrap gap-1">
                            {finding.evidence.slice(0, 5).map((ev: string, i: number) => (
                              <span key={i} className="px-2 py-1 bg-[#0a0a0f] rounded text-[10px] text-[#94a3b8] font-mono">
                                {ev.length > 30 ? ev.slice(0, 30) + '...' : ev}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#6b7280]">No significant findings detected yet.</p>
              )}
            </div>
          )}

          {/* Narrative Report */}
          {showNarrative && generatedReport && analysis && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={16} className="text-[#e63946]" />
                <h3 className="text-sm font-semibold text-[#e2e8f0]">Intelligence Report</h3>
              </div>
              <div className="prose prose-invert prose-sm max-w-none">
                <div className="text-xs text-[#94a3b8] leading-relaxed whitespace-pre-wrap">
                  {generateNarrativeReport(target, analysis, completedExecutions)}
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {analysis?.nextSteps && analysis.nextSteps.length > 0 && (
            <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={16} className="text-[#e63946]" />
                <h3 className="text-sm font-semibold text-[#e2e8f0]">Recommended Next Steps</h3>
              </div>
              <div className="space-y-2">
                {analysis.nextSteps.map((step: string, idx: number) => (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-[#0a0a0f] rounded-lg">
                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-[#e63946] rounded text-[10px] font-bold text-white">
                      {idx + 1}
                    </span>
                    <p className="text-xs text-[#94a3b8]">{step}</p>
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

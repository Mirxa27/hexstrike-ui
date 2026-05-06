
import { useState, useRef } from 'react'
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Package,
  Database,
  Network,
  Trash2,
  Download,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  FileCode,
  ChevronDown,
  ChevronRight,
  Zap,
} from 'lucide-react'
import type { FileAnalysis, UploadedFile, FileFinding, FileMetadata, ExtractedData } from '../fileAnalysis'
import {
  detectFileCategory,
  getFileAnalysisTools,
  parseToolOutput,
  generateFileNarrative,
} from '../fileAnalysis'
import { useApp } from '../AppContext'
import { executeHexstrikeTool } from '../api'

const FILE_ICONS: Record<string, any> = {
  image: ImageIcon,
  document: FileText,
  executable: Package,
  network: Network,
  archive: Archive,
  audio: Music,
  video: Film,
  database: Database,
  memory: FileCode,
  unknown: FileText,
}

export function FileInvestigation() {
  const { tools } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [analyses, setAnalyses] = useState<Map<string, FileAnalysis>>(new Map())
  const [selectedAnalysis, setSelectedAnalysis] = useState<FileAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview] = useState(true)

  // Handle file upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const newFiles: UploadedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const category = detectFileCategory(file)

      // Read file as base64
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string)
        reader.readAsDataURL(file)
      })
      const base64 = await base64Promise

      // Generate preview for images
      let preview: string | undefined
      if (category === 'image') {
        preview = base64
      }

      newFiles.push({
        id: `file-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type || 'unknown',
        category,
        data: base64,
        preview,
      })
    }

    setUploadedFiles((prev) => [...prev, ...newFiles])

    // Create initial analysis entries
    newFiles.forEach((file) => {
      setAnalyses((prev) => {
        const next = new Map(prev)
        next.set(file.id, {
          id: file.id,
          file,
          status: 'pending',
          findings: [],
          metadata: {
            basic: {
              filename: file.name,
              size: `${(file.size / 1024).toFixed(2)} KB`,
              mimeType: file.type || 'unknown',
              category: file.category,
            },
          },
          extractedData: {},
          recommendations: [],
          narrative: '',
        })
        return next
      })
    })
  }

  // Start analysis for a file
  const startAnalysis = async (file: UploadedFile) => {
    setIsAnalyzing((prev) => new Set(prev).add(file.id))

    const analysisTools = getFileAnalysisTools(file, tools)
    const findings: FileFinding[] = []
    const metadata: FileMetadata = {
      basic: {
        filename: file.name,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        mimeType: file.type || 'unknown',
        category: file.category,
      },
    }
    const extractedData: ExtractedData = {}

    // Update analysis status
    setAnalyses((prev) => {
      const next = new Map(prev)
      const existing = next.get(file.id)
      if (existing) {
        next.set(file.id, {
          ...existing,
          status: 'analyzing',
          startedAt: Date.now(),
        })
      }
      return next
    })

    // Execute tools sequentially
    for (const { tool, reason } of analysisTools) {
      try {
        const result = await executeHexstrikeTool(
          'http://localhost:8888',
          tool.name,
          file.name,
          { file: file.data, reason }
        )

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2)

        // Parse output and extract findings
        const toolFindings = parseToolOutput(tool.name, resultStr, file.category)
        findings.push(...toolFindings)

        // Extract metadata from EXIF tool output
        if (tool.name.toLowerCase().includes('exif') && resultStr) {
          const exifData: Record<string, string> = {}
          resultStr.split('\n').forEach((line) => {
            const match = line.match(/^([A-Z][^:]+)\s*:\s*(.+)$/)
            if (match) {
              exifData[match[1]] = match[2].trim()
            }
          })
          if (Object.keys(exifData).length > 0) {
            metadata.exif = exifData
          }
        }

        // Extract strings/data
        if (tool.name.toLowerCase().includes('string') && resultStr) {
          extractedData.urls = resultStr.match(/https?:\/\/[^\s]+/g) || []
          extractedData.emails = resultStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
          extractedData.ips = resultStr.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []
        }
      } catch (err: any) {
        console.error(`Tool ${tool.name} failed:`, err)
      }
    }

    // Generate recommendations
    const recommendations = generateRecommendations(findings, file)

    // Generate narrative
    const narrative = generateFileNarrative(file, findings, metadata)

    // Update analysis with results
    setAnalyses((prev) => {
      const next = new Map(prev)
      const existing = next.get(file.id)
      if (existing) {
        next.set(file.id, {
          ...existing,
          status: 'complete',
          findings,
          metadata,
          extractedData,
          recommendations,
          narrative,
          completedAt: Date.now(),
        })
      }
      return next
    })

    setIsAnalyzing((prev) => {
      const next = new Set(prev)
      next.delete(file.id)
      return next
    })
  }

  // Generate recommendations based on findings
  const generateRecommendations = (findings: FileFinding[], file: UploadedFile): string[] => {
    const recommendations: string[] = []

    const criticalFindings = findings.filter((f) => f.severity === 'critical')
    const highFindings = findings.filter((f) => f.severity === 'high')

    if (criticalFindings.length > 0) {
      recommendations.push('CRITICAL: This file exhibits characteristics consistent with malicious content. Do not execute or distribute.')
    }

    if (highFindings.length > 0) {
      recommendations.push('HIGH: Further analysis recommended to validate security concerns.')
    }

    if (findings.some((f) => f.category === 'Geolocation')) {
      recommendations.push('Location data found - sanitize metadata before sharing.')
    }

    if (findings.some((f) => f.category === 'Personal Information')) {
      recommendations.push('Personal information detected - handle according to data protection policies.')
    }

    if (findings.some((f) => f.category === 'Security Concern')) {
      recommendations.push('Potential secrets or credentials found - rotate any exposed credentials.')
    }

    if (file.category === 'executable' && findings.length === 0) {
      recommendations.push('Unknown executable - run in sandboxed environment before allowing in production.')
    }

    if (recommendations.length === 0) {
      recommendations.push('No significant security concerns detected. File appears safe for normal handling.')
    }

    return recommendations
  }

  // Remove file
  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
    setAnalyses((prev) => {
      const next = new Map(prev)
      next.delete(fileId)
      return next
    })
    if (selectedAnalysis?.id === fileId) {
      setSelectedAnalysis(null)
    }
  }

  // Download report
  const downloadReport = (analysis: FileAnalysis) => {
    const blob = new Blob([analysis.narrative], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `file-analysis-${analysis.file.name}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Analyze all files
  const analyzeAll = () => {
    uploadedFiles.forEach((file) => {
      const analysis = analyses.get(file.id)
      if (analysis?.status === 'pending') {
        startAnalysis(file)
      }
    })
  }

  const totalFiles = uploadedFiles.length
  const completedAnalyses = Array.from(analyses.values()).filter((a) => a.status === 'complete').length
  const criticalFindings = Array.from(analyses.values())
    .flatMap((a) => a.findings)
    .filter((f) => f.severity === 'critical').length

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-[#1a1a2e] bg-[#0f0f1a] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#e63946]/10 rounded-lg">
              <Search className="text-[#e63946]" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#e2e8f0]">File Investigation</h2>
              <p className="text-xs text-[#6b7280]">Upload files for forensic analysis and intelligence extraction</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {uploadedFiles.length > 0 && (
              <>
                <button
                  onClick={analyzeAll}
                  disabled={isAnalyzing.size > 0}
                  className="flex items-center gap-2 px-4 py-2 bg-[#e63946] hover:bg-[#c1121f] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {isAnalyzing.size > 0 ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Analyzing ({isAnalyzing.size})
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Analyze All
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left Panel - File Upload and List */}
        <div className={`flex flex-col border-r border-[#1a1a2e] bg-[#0f0f1a] transition-all duration-300 ${
          selectedAnalysis ? 'w-80' : 'flex-1'
        }`}>
          {/* Upload Area */}
          <div className="p-6 border-b border-[#1a1a2e]">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#1a1a2e] hover:border-[#e63946]/50 rounded-xl p-8 text-center cursor-pointer transition-colors"
            >
              <Upload size={32} className="mx-auto mb-3 text-[#6b7280]" />
              <p className="text-sm text-[#e2e8f0] mb-1">Drop files here or click to upload</p>
              <p className="text-xs text-[#6b7280]">Supports images, documents, executables, PCAPs, archives, and more</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
          </div>

          {/* Stats */}
          {uploadedFiles.length > 0 && (
            <div className="px-6 py-3 border-b border-[#1a1a2e]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#6b7280]">{totalFiles} files uploaded</span>
                <span className="text-[#6b7280]">{completedAnalyses} analyzed</span>
                {criticalFindings > 0 && (
                  <span className="text-[#e63946] font-medium">{criticalFindings} critical findings</span>
                )}
              </div>
            </div>
          )}

          {/* File List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {uploadedFiles.length === 0 ? (
              <div className="text-center py-12">
                <FileText size={48} className="mx-auto mb-3 text-[#1a1a2e]" />
                <p className="text-sm text-[#6b7280]">No files uploaded yet</p>
              </div>
            ) : (
              uploadedFiles.map((file) => {
                const analysis = analyses.get(file.id)
                const Icon = FILE_ICONS[file.category] || FileText
                const isSelected = selectedAnalysis?.id === file.id
                const fileIsAnalyzing = isAnalyzing.has(file.id)

                return (
                  <div
                    key={file.id}
                    onClick={() => analysis?.status === 'complete' && setSelectedAnalysis(analysis!)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors border ${
                      isSelected
                        ? 'bg-[#e63946]/10 border-[#e63946]/30'
                        : 'bg-[#0a0a0f] border-[#1a1a2e] hover:border-[#1a1a2e]/80'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon size={18} className="text-[#e63946] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-[#e2e8f0] truncate">{file.name}</p>
                          {fileIsAnalyzing && <Loader2 size={12} className="text-[#f59e0b] animate-spin" />}
                          {analysis?.status === 'complete' && <CheckCircle2 size={12} className="text-[#00ff41]" />}
                          {analysis?.status === 'error' && <XCircle size={12} className="text-[#e63946]" />}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-[#6b7280]">{file.category}</span>
                          <span className="text-[#1a1a2e]">•</span>
                          <span className="text-[10px] text-[#6b7280]">{(file.size / 1024).toFixed(1)} KB</span>
                          {analysis?.findings && analysis.findings.length > 0 && (
                            <>
                              <span className="text-[#1a1a2e]">•</span>
                              <span className={`text-[10px] font-medium ${
                                analysis.findings.some((f) => f.severity === 'critical')
                                  ? 'text-[#e63946]'
                                  : analysis.findings.some((f) => f.severity === 'high')
                                    ? 'text-[#f59e0b]'
                                    : 'text-[#00ff41]'
                              }`}>
                                {analysis.findings.length} findings
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFile(file.id)
                        }}
                        className="p-1 hover:bg-[#1a1a2e] rounded text-[#6b7280] hover:text-[#e63946] transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Quick Actions */}
                    {analysis?.status === 'pending' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startAnalysis(file)
                        }}
                        className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 bg-[#e63946]/10 hover:bg-[#e63946]/20 border border-[#e63946]/30 rounded text-[10px] text-[#e63946] transition-colors"
                      >
                        <Sparkles size={10} />
                        Analyze
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Panel - Analysis Details */}
        {selectedAnalysis && (
          <div className="flex-1 overflow-y-auto bg-[#0a0a0f]">
            <div className="p-6 max-w-4xl mx-auto space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-[#e2e8f0]">{selectedAnalysis.file.name}</h3>
                  <div className="flex items-center gap-3 mt-2 text-xs text-[#6b7280]">
                    <span>{selectedAnalysis.metadata.basic.size}</span>
                    <span>•</span>
                    <span className="uppercase">{selectedAnalysis.metadata.basic.category}</span>
                    <span>•</span>
                    <span>{selectedAnalysis.metadata.basic.mimeType}</span>
                  </div>
                </div>
                <button
                  onClick={() => downloadReport(selectedAnalysis)}
                  className="flex items-center gap-2 px-3 py-2 bg-[#10b981] hover:bg-[#059669] rounded-lg text-xs text-white transition-colors"
                >
                  <Download size={14} />
                  Export Report
                </button>
              </div>

              {/* Preview */}
              {selectedAnalysis.file.preview && showPreview && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-[#e2e8f0]">Preview</span>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="text-[#6b7280] hover:text-[#e2e8f0] text-xs"
                    >
                      Hide
                    </button>
                  </div>
                  <img
                    src={selectedAnalysis.file.preview}
                    alt={selectedAnalysis.file.name}
                    className="max-w-full max-h-64 rounded-lg mx-auto"
                  />
                </div>
              )}

              {/* Status Badge */}
              <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border ${
                selectedAnalysis.status === 'complete'
                  ? 'bg-[#00ff41]/5 border-[#00ff41]/20'
                  : selectedAnalysis.status === 'analyzing'
                    ? 'bg-[#f59e0b]/5 border-[#f59e0b]/20'
                    : 'bg-[#1a1a2e] border-[#1a1a2e]'
              }`}>
                {selectedAnalysis.status === 'complete' && <CheckCircle2 size={16} className="text-[#00ff41]" />}
                {selectedAnalysis.status === 'analyzing' && <Loader2 size={16} className="text-[#f59e0b] animate-spin" />}
                <span className="text-xs font-medium text-[#e2e8f0]">
                  {selectedAnalysis.status === 'complete'
                    ? 'Analysis Complete'
                    : selectedAnalysis.status === 'analyzing'
                      ? 'Analyzing...'
                      : 'Pending Analysis'}
                </span>
              </div>

              {/* Recommendations */}
              {selectedAnalysis.recommendations.length > 0 && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} className="text-[#f59e0b]" />
                    <span className="text-sm font-semibold text-[#e2e8f0]">Recommendations</span>
                  </div>
                  <div className="space-y-2">
                    {selectedAnalysis.recommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg text-xs ${
                          rec.includes('CRITICAL')
                            ? 'bg-[#e63946]/10 border border-[#e63946]/30 text-[#e63946]'
                            : rec.includes('HIGH')
                              ? 'bg-[#f59e0b]/10 border border-[#f59e0b]/30 text-[#f59e0b]'
                              : 'bg-[#1a1a2e] text-[#94a3b8]'
                        }`}
                      >
                        {rec}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Findings */}
              {selectedAnalysis.findings.length > 0 && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Search size={16} className="text-[#e63946]" />
                    <span className="text-sm font-semibold text-[#e2e8f0]">Findings ({selectedAnalysis.findings.length})</span>
                  </div>
                  <div className="space-y-3">
                    {selectedAnalysis.findings.map((finding, idx) => (
                      <FindingCard key={idx} finding={finding} />
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              {selectedAnalysis.metadata.exif && Object.keys(selectedAnalysis.metadata.exif).length > 0 && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText size={16} className="text-[#e63946]" />
                    <span className="text-sm font-semibold text-[#e2e8f0]">Metadata</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(selectedAnalysis.metadata.exif).slice(0, 20).map(([key, value]) => (
                      <div key={key} className="p-2 bg-[#0a0a0f] rounded">
                        <span className="text-[#6b7280]">{key}:</span>{' '}
                        <span className="text-[#e2e8f0]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted Data */}
              {(selectedAnalysis.extractedData.urls?.length ||
                selectedAnalysis.extractedData.emails?.length ||
                selectedAnalysis.extractedData.ips?.length) && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap size={16} className="text-[#e63946]" />
                    <span className="text-sm font-semibold text-[#e2e8f0]">Extracted Data</span>
                  </div>

                  {selectedAnalysis.extractedData.urls && selectedAnalysis.extractedData.urls.length > 0 && (
                    <div className="mb-4">
                      <span className="text-xs text-[#6b7280] mb-2 block">URLs ({selectedAnalysis.extractedData.urls.length})</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedAnalysis.extractedData.urls.slice(0, 10).map((url, idx) => (
                          <span key={idx} className="px-2 py-1 bg-[#0a0a0f] rounded text-[10px] text-[#94a3b8] font-mono truncate max-w-[200px]">
                            {url}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedAnalysis.extractedData.emails && selectedAnalysis.extractedData.emails.length > 0 && (
                    <div className="mb-4">
                      <span className="text-xs text-[#6b7280] mb-2 block">Emails ({selectedAnalysis.extractedData.emails.length})</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedAnalysis.extractedData.emails.slice(0, 10).map((email, idx) => (
                          <span key={idx} className="px-2 py-1 bg-[#0a0a0f] rounded text-[10px] text-[#94a3b8] font-mono">
                            {email}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedAnalysis.extractedData.ips && selectedAnalysis.extractedData.ips.length > 0 && (
                    <div>
                      <span className="text-xs text-[#6b7280] mb-2 block">IP Addresses ({selectedAnalysis.extractedData.ips.length})</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedAnalysis.extractedData.ips.slice(0, 10).map((ip, idx) => (
                          <span key={idx} className="px-2 py-1 bg-[#0a0a0f] rounded text-[10px] text-[#94a3b8] font-mono">
                            {ip}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Narrative Report */}
              {selectedAnalysis.narrative && (
                <div className="bg-[#0f0f1a] border border-[#1a1a2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <FileText size={16} className="text-[#e63946]" />
                    <span className="text-sm font-semibold text-[#e2e8f0]">Investigation Narrative</span>
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <pre className="text-xs text-[#94a3b8] whitespace-pre-wrap font-sans">
                      {selectedAnalysis.narrative}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FindingCard({ finding }: { finding: FileFinding }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`p-3 rounded-lg border ${
        finding.severity === 'critical'
          ? 'bg-[#e63946]/10 border-[#e63946]/30'
          : finding.severity === 'high'
            ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30'
            : finding.severity === 'medium'
              ? 'bg-[#3b82f6]/10 border-[#3b82f6]/30'
              : 'bg-[#6b7280]/10 border-[#6b7280]/30'
      }`}
    >
      <div
        className="flex items-start justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {finding.severity === 'critical' && <AlertTriangle size={12} className="text-[#e63946]" />}
            <span className="text-xs font-medium text-[#e2e8f0]">{finding.title}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
              finding.severity === 'critical'
                ? 'bg-[#e63946]/30 text-[#e63946]'
                : finding.severity === 'high'
                  ? 'bg-[#f59e0b]/30 text-[#f59e0b]'
                  : finding.severity === 'medium'
                    ? 'bg-[#3b82f6]/30 text-[#3b82f6]'
                    : 'bg-[#6b7280]/30 text-[#6b7280]'
            }`}>
              {finding.severity}
            </span>
          </div>
          <p className="text-[10px] text-[#94a3b8] mt-1">{finding.description}</p>
        </div>
        {expanded ? <ChevronDown size={14} className="text-[#6b7280]" /> : <ChevronRight size={14} className="text-[#6b7280]" />}
      </div>

      {expanded && finding.evidence.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1a1a2e]">
          <span className="text-[10px] text-[#6b7280] mb-2 block">Evidence:</span>
          <div className="space-y-1">
            {finding.evidence.map((ev, idx) => (
              <div key={idx} className="p-2 bg-[#0a0a0f] rounded text-[10px] text-[#94a3b8] font-mono truncate">
                {ev}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

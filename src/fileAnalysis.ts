import type { HexstrikeTool } from './types'

export interface FileAnalysis {
  id: string
  file: UploadedFile
  status: 'pending' | 'analyzing' | 'complete' | 'error'
  findings: FileFinding[]
  metadata: FileMetadata
  extractedData: ExtractedData
  recommendations: string[]
  narrative: string
  startedAt?: number
  completedAt?: number
}

export interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  category: FileCategory
  data: string // base64 encoded
  preview?: string
}

export type FileCategory =
  | 'image'
  | 'document'
  | 'executable'
  | 'network'
  | 'archive'
  | 'audio'
  | 'video'
  | 'database'
  | 'memory'
  | 'unknown'

export interface FileFinding {
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  evidence: string[]
  tools: string[]
}

export interface FileMetadata {
  basic: {
    filename: string
    size: string
    mimeType: string
    category: FileCategory
  }
  technical?: {
    format: string
    version?: string
    dimensions?: string
    duration?: string
    bitrate?: string
    codec?: string
  }
  exif?: Record<string, string>
  headers?: Record<string, string>
  hashes?: {
    md5?: string
    sha256?: string
  }
}

export interface ExtractedData {
  strings?: string[]
  urls?: string[]
  emails?: string[]
  ips?: string[]
  domains?: string[]
  embeddedFiles?: string[]
  certificates?: string[]
  secrets?: Array<{ type: string; value: string; context: string }>
  macros?: string[]
}

// Detect file category from mime type and extension
export function detectFileCategory(file: File): FileCategory {
  const mimeType = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  // Images
  if (mimeType.startsWith('image/')) return 'image'

  // Audio
  if (mimeType.startsWith('audio/')) return 'audio'

  // Video
  if (mimeType.startsWith('video/')) return 'video'

  // Documents
  if (
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('text') ||
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('office') ||
    name.endsWith('.pdf') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.ppt') ||
    name.endsWith('.pptx') ||
    name.endsWith('.odt') ||
    name.endsWith('.rtf') ||
    name.endsWith('.txt')
  ) {
    return 'document'
  }

  // Executables
  if (
    mimeType.includes('executable') ||
    mimeType.includes('application/x-dosexec') ||
    mimeType.includes('application/x-msdownload') ||
    mimeType.includes('application/x-elf') ||
    mimeType.includes('application/x-mach-binary') ||
    name.endsWith('.exe') ||
    name.endsWith('.dll') ||
    name.endsWith('.so') ||
    name.endsWith('.dylib') ||
    name.endsWith('.app') ||
    name.endsWith('.elf') ||
    name.endsWith('.bin') ||
    name.endsWith('.run')
  ) {
    return 'executable'
  }

  // Network captures
  if (
    mimeType.includes('pcap') ||
    name.endsWith('.pcap') ||
    name.endsWith('.pcapng') ||
    name.endsWith('.cap') ||
    name.endsWith('.dump')
  ) {
    return 'network'
  }

  // Archives
  if (
    mimeType.includes('zip') ||
    mimeType.includes('rar') ||
    mimeType.includes('tar') ||
    mimeType.includes('gzip') ||
    mimeType.includes('7z') ||
    name.endsWith('.zip') ||
    name.endsWith('.rar') ||
    name.endsWith('.tar') ||
    name.endsWith('.gz') ||
    name.endsWith('.7z') ||
    name.endsWith('.bz2')
  ) {
    return 'archive'
  }

  // Databases
  if (
    mimeType.includes('sqlite') ||
    name.endsWith('.db') ||
    name.endsWith('.sqlite') ||
    name.endsWith('.sql')
  ) {
    return 'database'
  }

  // Memory dumps
  if (
    name.endsWith('.dmp') ||
    name.endsWith('.mem') ||
    name.endsWith('.vmem') ||
    name.endsWith('.img')
  ) {
    return 'memory'
  }

  return 'unknown'
}

// Get appropriate tools for file analysis
export function getFileAnalysisTools(file: UploadedFile, availableTools: HexstrikeTool[]): Array<{
  tool: HexstrikeTool
  reason: string
  priority: number
  params?: Record<string, string>
}> {
  const tools: Array<{ tool: HexstrikeTool; reason: string; priority: number; params?: Record<string, string> }> = []

  // Common forensics tools
  const binwalk = availableTools.find(t => t.name.toLowerCase().includes('binwalk'))
  const strings = availableTools.find(t => t.name.toLowerCase().includes('strings') || t.name.toLowerCase().includes('string'))
  const exiftool = availableTools.find(t => t.name.toLowerCase().includes('exiftool'))
  const volatility = availableTools.find(t => t.name.toLowerCase().includes('volatility'))
  const bulkExtractor = availableTools.find(t => t.name.toLowerCase().includes('bulk'))

  // Network analysis tools
  const tcpdump = availableTools.find(t => t.name.toLowerCase().includes('tcpdump'))
  const tshark = availableTools.find(t => t.name.toLowerCase().includes('tshark'))
  void availableTools.find(t => t.name.toLowerCase().includes('wireshark')) // wireshark - available for future use

  // Document analysis
  const oletools = availableTools.find(t => t.name.toLowerCase().includes('ole') || t.name.toLowerCase().includes('oledump'))
  const pdfid = availableTools.find(t => t.name.toLowerCase().includes('pdf'))
  void availableTools.find(t => t.name.toLowerCase().includes('docx')) // docx - available for future use

  // Executable analysis
  void availableTools.find(t => t.name.toLowerCase().includes('strings')) // stringsTool - already defined above
  const objdump = availableTools.find(t => t.name.toLowerCase().includes('objdump'))
  void availableTools.find(t => t.name.toLowerCase().includes('ghidra')) // ghidra - available for future use
  void availableTools.find(t => t.name.toLowerCase().includes('r2') || t.name.toLowerCase().includes('radare')) // radare2 - available for future use

  switch (file.category) {
    case 'image':
      if (exiftool) {
        tools.push({
          tool: exiftool,
          reason: 'Extract EXIF metadata, GPS coordinates, and camera information',
          priority: 1,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract readable strings that may contain hidden data',
          priority: 3,
        })
      }
      if (binwalk) {
        tools.push({
          tool: binwalk,
          reason: 'Check for hidden files or data embedded in the image',
          priority: 2,
        })
      }
      break

    case 'document':
      if (exiftool) {
        tools.push({
          tool: exiftool,
          reason: 'Extract document metadata and author information',
          priority: 1,
        })
      }
      if (file.name.toLowerCase().endsWith('.pdf') && pdfid) {
        tools.push({
          tool: pdfid,
          reason: 'Analyze PDF structure and detect potential threats',
          priority: 2,
        })
      }
      if ((file.name.toLowerCase().includes('doc') || file.name.toLowerCase().includes('xls') || file.name.toLowerCase().includes('ppt')) && oletools) {
        tools.push({
          tool: oletools,
          reason: 'Extract and analyze macros for potential malicious code',
          priority: 2,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract embedded URLs, emails, and sensitive data',
          priority: 3,
        })
      }
      break

    case 'executable':
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract readable strings, URLs, and indicators',
          priority: 1,
        })
      }
      if (binwalk) {
        tools.push({
          tool: binwalk,
          reason: 'Analyze binary structure and embedded components',
          priority: 2,
        })
      }
      if (objdump) {
        tools.push({
          tool: objdump,
          reason: 'Disassemble executable to analyze functionality',
          priority: 3,
        })
      }
      if (exiftool) {
        tools.push({
          tool: exiftool,
          reason: 'Extract binary metadata and build information',
          priority: 4,
        })
      }
      break

    case 'network':
      if (tshark) {
        tools.push({
          tool: tshark,
          reason: 'Deep packet inspection and protocol analysis',
          priority: 1,
        })
      }
      if (tcpdump) {
        tools.push({
          tool: tcpdump,
          reason: 'Extract packets and analyze network traffic',
          priority: 2,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract URLs, domains, and data from packet captures',
          priority: 3,
        })
      }
      break

    case 'archive':
      if (binwalk) {
        tools.push({
          tool: binwalk,
          reason: 'Analyze archive structure and detect embedded files',
          priority: 1,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract filenames and data from archive',
          priority: 2,
        })
      }
      break

    case 'memory':
      if (volatility) {
        tools.push({
          tool: volatility,
          reason: 'Analyze memory dump for processes, network connections, and artifacts',
          priority: 1,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract sensitive data from memory dump',
          priority: 2,
        })
      }
      if (bulkExtractor) {
        tools.push({
          tool: bulkExtractor,
          reason: 'Extract URLs, emails, and other artifacts from memory',
          priority: 3,
        })
      }
      break

    case 'audio':
    case 'video':
      if (exiftool) {
        tools.push({
          tool: exiftool,
          reason: 'Extract media metadata and encoder information',
          priority: 1,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract hidden data or watermarks from media file',
          priority: 2,
        })
      }
      break

    case 'database':
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract data and schema from database file',
          priority: 1,
        })
      }
      if (binwalk) {
        tools.push({
          tool: binwalk,
          reason: 'Analyze database structure and format',
          priority: 2,
        })
      }
      break

    default:
      if (exiftool) {
        tools.push({
          tool: exiftool,
          reason: 'Extract file metadata',
          priority: 1,
        })
      }
      if (strings) {
        tools.push({
          tool: strings,
          reason: 'Extract readable content from unknown file type',
          priority: 2,
        })
      }
      if (binwalk) {
        tools.push({
          tool: binwalk,
          reason: 'Analyze file structure and contents',
          priority: 3,
        })
      }
  }

  // Sort by priority
  return tools.sort((a, b) => a.priority - b.priority)
}

// Parse tool output and extract findings
export function parseToolOutput(toolName: string, output: string, _fileCategory: FileCategory): FileFinding[] {
  const findings: FileFinding[] = []

  // EXIF tool parsing
  if (toolName.toLowerCase().includes('exif')) {
    if (output.includes('GPS')) {
      findings.push({
        category: 'Geolocation',
        severity: 'high',
        title: 'GPS Coordinates Found',
        description: 'Image contains GPS coordinates that reveal the location where the photo was taken',
        evidence: output.match(/GPS.*$/gim) || [],
        tools: [toolName],
      })
    }

    if (output.includes('Camera') || output.includes('Model')) {
      findings.push({
        category: 'Device Information',
        severity: 'info',
        title: 'Camera/Device Details',
        description: 'Image contains device information that may identify the photographer',
        evidence: output.match(/(Camera|Model|Make).*$/gim) || [],
        tools: [toolName],
      })
    }

    if (output.includes('Date') || output.includes('Time')) {
      findings.push({
        category: 'Temporal Data',
        severity: 'info',
        title: 'Timestamp Information',
        description: 'Image contains creation and modification timestamps',
        evidence: output.match(/(?:Date|Time).*$/gim) || [],
        tools: [toolName],
      })
    }
  }

  // Strings parsing
  if (toolName.toLowerCase().includes('string')) {
    const urls = output.match(/https?:\/\/[^\s]+/g) || []
    const emails = output.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
    const ips = output.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []

    if (urls.length > 0) {
      findings.push({
        category: 'Network Indicators',
        severity: 'medium',
        title: 'URLs Discovered',
        description: `Found ${urls.length} URLs embedded in the file`,
        evidence: urls.slice(0, 10),
        tools: [toolName],
      })
    }

    if (emails.length > 0) {
      findings.push({
        category: 'Personal Information',
        severity: 'medium',
        title: 'Email Addresses Found',
        description: `Found ${emails.length} email addresses in the file`,
        evidence: emails.slice(0, 10),
        tools: [toolName],
      })
    }

    if (ips.length > 0) {
      findings.push({
        category: 'Network Indicators',
        severity: 'info',
        title: 'IP Addresses Discovered',
        description: `Found ${ips.length} IP addresses in the file`,
        evidence: ips.slice(0, 10),
        tools: [toolName],
      })
    }

    // Check for potential secrets
    const potentialSecrets = output.match(/(?:api[_-]?key|password|secret|token|auth)[\s:=]+[^\s]{10,}/gi) || []
    if (potentialSecrets.length > 0) {
      findings.push({
        category: 'Security Concern',
        severity: 'high',
        title: 'Potential Secrets Detected',
        description: 'File may contain hardcoded credentials or API keys',
        evidence: potentialSecrets.slice(0, 5),
        tools: [toolName],
      })
    }
  }

  // Binwalk parsing
  if (toolName.toLowerCase().includes('binwalk')) {
    const embeddedFiles = output.match(/\d+\s+0x[0-9A-F]+\s+\S+/g) || []
    if (embeddedFiles.length > 0) {
      findings.push({
        category: 'Embedded Content',
        severity: 'info',
        title: 'Embedded Files Detected',
        description: `File contains ${embeddedFiles.length} embedded or hidden data sections`,
        evidence: embeddedFiles.slice(0, 10),
        tools: [toolName],
      })
    }
  }

  // Macro/Oletools parsing
  if (toolName.toLowerCase().includes('ole') || toolName.toLowerCase().includes('macro')) {
    if (output.toLowerCase().includes('macro') || output.toLowerCase().includes('vba')) {
      findings.push({
        category: 'Malware Indicator',
        severity: 'high',
        title: 'Macros Detected',
        description: 'Document contains macros that could execute malicious code',
        evidence: ['Macros/VBA code present in document'],
        tools: [toolName],
      })
    }

    if (output.toLowerCase().includes('autoexec') || output.toLowerCase().includes('auto_open')) {
      findings.push({
        category: 'Suspicious Behavior',
        severity: 'critical',
        title: 'Auto-Execute Macros',
        description: 'Document contains macros configured to run automatically on open',
        evidence: ['Auto-executing macro triggers detected'],
        tools: [toolName],
      })
    }
  }

  return findings
}

// Generate narrative report for file analysis
export function generateFileNarrative(file: UploadedFile, findings: FileFinding[], metadata: FileMetadata): string {
  let narrative = `# File Investigation Report: ${file.name}\n\n`
  narrative += `*Comprehensive forensic analysis and intelligence extraction*\n\n`
  narrative += `---\n\n`

  narrative += `## Executive Summary\n\n`
  narrative += `This document presents the findings of a comprehensive forensic analysis conducted on **${file.name}** `
  narrative += `(${(file.size / 1024).toFixed(2)} KB, ${file.category.toUpperCase()} category). `
  narrative += `The investigation utilized automated forensic tools to extract metadata, analyze content, and identify potential security concerns.\n\n`

  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const highCount = findings.filter(f => f.severity === 'high').length

  if (criticalCount > 0 || highCount > 0) {
    narrative += `## Risk Assessment\n\n`
    narrative += `The analysis identified **${criticalCount} critical** and **${highCount} high-severity** findings `
    narrative += `that require immediate attention. These findings may indicate security risks, privacy concerns, or malicious content.\n\n`
  }

  narrative += `## File Characteristics\n\n`
  narrative += `- **Filename:** ${file.name}\n`
  narrative += `- **Size:** ${(file.size / 1024).toFixed(2)} KB\n`
  narrative += `- **Type:** ${file.type || 'Unknown'}\n`
  narrative += `- **Category:** ${file.category.toUpperCase()}\n\n`

  if (metadata.exif && Object.keys(metadata.exif).length > 0) {
    narrative += `## Metadata Analysis\n\n`
    narrative += `The file contains embedded metadata that provides additional context:\n\n`
    Object.entries(metadata.exif).slice(0, 10).forEach(([key, value]) => {
      narrative += `- **${key}:** ${value}\n`
    })
    narrative += '\n'
  }

  if (findings.length > 0) {
    narrative += `## Detailed Findings\n\n`
    findings.forEach((finding, idx) => {
      narrative += `### ${idx + 1}. ${finding.title}\n\n`
      narrative += `**Category:** ${finding.category}\n`
      narrative += `**Severity:** ${finding.severity.toUpperCase()}\n\n`
      narrative += `${finding.description}\n\n`

      if (finding.evidence.length > 0) {
        narrative += `**Evidence:**\n\`\`\`\n${finding.evidence.join('\n')}\n\`\`\`\n\n`
      }

      narrative += `**Tools Used:** ${finding.tools.join(', ')}\n\n`
    })
  }

  narrative += `## Recommendations\n\n`

  if (criticalCount > 0 || highCount > 0) {
    narrative += `1. **IMMEDIATE REVIEW:** This file contains indicators that suggest it may be malicious or compromise sensitive information.\n`
    narrative += `2. **ISOLATE:** If this file was received from an untrusted source, isolate it and do not execute or open it.\n`
    narrative += `3. **INVESTIGATE:** Further manual analysis is recommended to validate automated findings.\n`
  }

  if (findings.some(f => f.category === 'Geolocation')) {
    narrative += `4. **PRIVACY CONCERN:** This file contains location data. Consider sanitizing metadata before sharing.\n`
  }

  if (findings.some(f => f.category === 'Personal Information')) {
    narrative += `5. **DATA PROTECTION:** This file contains personal information. Handle according to data protection policies.\n`
  }

  narrative += `\n## Investigation Narrative\n\n`

  narrative += `The forensic analysis of ${file.name} revealed several layers of information. `
  narrative += `At the surface level, the file appears to be a standard ${file.category} file. `
  narrative += `However, deeper investigation using automated forensic tools uncovered additional data not visible through normal file operations.\n\n`

  if (findings.some(f => f.category === 'Embedded Content')) {
    narrative += `### Hidden Content Discovery\n\n`
    narrative += `Binary analysis revealed that the file contains embedded or hidden data beyond its primary content. `
    narrative += `This is a common technique used in steganography, malware distribution, or data hiding. `
    narrative += `The embedded content may contain additional files, modified data, or concealed information.\n\n`
  }

  if (findings.some(f => f.category === 'Security Concern') || findings.some(f => f.category === 'Malware Indicator')) {
    narrative += `### Security Implications\n\n`
    narrative += `The analysis identified security-related concerns within the file. `
    narrative += `These findings suggest the file may be designed to execute unexpected behavior, `
    narrative += `compromise system security, or exfiltrate data. Such indicators are commonly associated with:\n\n`
    narrative += `- Malware delivery mechanisms\n`
    narrative += `- Social engineering attempts\n`
    narrative += `- Data harvesting operations\n`
    narrative += `- Unauthorized system access\n\n`
  }

  if (findings.some(f => f.category === 'Network Indicators')) {
    narrative += `### Network Exposure\n\n`
    narrative += `The file contains network indicators such as URLs, IP addresses, or domain names. `
    narrative += `These may represent:\n\n`
    narrative += `- Command and control (C2) infrastructure\n`
    narrative += `- Data exfiltration endpoints\n`
    narrative += `- Resource references\n`
    narrative += `- Embedded links or dependencies\n\n`
  }

  narrative += `## Conclusion\n\n`
  narrative += `The investigation of ${file.name} has produced ${findings.length} findings across various categories. `
  narrative += `Each finding represents a piece of intelligence that, when combined with other data, `
  narrative += `contributes to a comprehensive understanding of the file's purpose, origin, and potential impact.\n\n`

  narrative += `---\n\n`
  narrative += `*This report was generated by HexStrike AI automated file analysis. `

  return narrative
}

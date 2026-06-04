
import type { ToolExecution, AIAnalysisResult, OSINTReport } from './types'

// Generate comprehensive OSINT report
export function generateOSINTReport(
  target: string,
  executions: ToolExecution[],
  analysis: AIAnalysisResult,
  scanType: string = 'comprehensive'
): OSINTReport {
  const generatedAt = Date.now()
  const title = `OSINT Intelligence Report: ${target}`

  // Build executive summary
  const executiveSummary = generateExecutiveSummary(target, analysis, scanType)

  // Build sections
  const sections = buildReportSections(executions, analysis, target)

  // Build timeline
  const timeline = buildTimeline(executions)

  // Build recommendations
  const recommendations = buildRecommendations(analysis)

  // Build appendices
  const appendices = buildAppendices(executions)

  // Generate markdown
  const markdown = generateMarkdown(title, executiveSummary, sections, timeline, recommendations, appendices, target, generatedAt)

  return {
    title,
    target,
    generatedAt,
    executiveSummary,
    sections,
    timeline,
    recommendations,
    appendices,
    markdown,
  }
}

function generateExecutiveSummary(target: string, analysis: AIAnalysisResult, scanType: string): string {
  const criticalCount = analysis.findings.filter((f) => f.severity === 'critical').length
  const highCount = analysis.findings.filter((f) => f.severity === 'high').length
  const totalFindings = analysis.findings.length

  let summary = `# Executive Summary\n\n`
  summary += `This report presents the findings of a ${scanType} Open Source Intelligence (OSINT) investigation conducted against **${target}**. `
  summary += `The investigation utilized automated reconnaissance tools to gather publicly available information and assess the security posture of the target.\n\n`

  summary += `## Investigation Overview\n\n`
  summary += `- **Target:** ${target}\n`
  summary += `- **Investigation Date:** ${new Date().toLocaleDateString()}\n`
  summary += `- **Total Findings:** ${totalFindings}\n`
  summary += `- **Critical Issues:** ${criticalCount}\n`
  summary += `- **High-Severity Issues:** ${highCount}\n\n`

  if (criticalCount > 0 || highCount > 0) {
    summary += `## Risk Assessment\n\n`
    summary += `The investigation identified **${criticalCount + highCount} significant security concerns** that require immediate attention. `
    summary += `These findings present opportunities for malicious actors and should be addressed promptly to reduce risk.\n\n`
  }

  summary += `## Key Findings\n\n`
  analysis.findings.slice(0, 5).forEach((finding, idx) => {
    summary += `${idx + 1}. **${finding.category}** (${finding.severity.toUpperCase()}): ${finding.finding}\n`
  })

  summary += `\n## Narrative\n\n`
  summary += analysis.summary

  return summary
}

function buildReportSections(
  _executions: ToolExecution[],
  analysis: AIAnalysisResult,
  target: string
): OSINTReport['sections'] {
  const sections: OSINTReport['sections'] = []

  // Section 1: Target Identification
  sections.push({
    id: 'target-identification',
    title: 'Target Identification & Scope',
    content: `The target ${target} was subjected to automated OSINT gathering. The investigation focused on publicly accessible information and services that could be discovered without authentication.`,
    findings: [],
    severity: 'info',
  })

  // Section 2: Asset Discovery
  const assetFindings = analysis.findings.filter((f) => f.category === 'Asset Discovery')
  if (assetFindings.length > 0) {
    const details = assetFindings.map((f) => ({
      title: f.finding,
      description: `During the reconnaissance phase, we discovered ${f.evidence.length} unique assets associated with the target. These assets expand the potential attack surface and provide additional vectors for security assessment.`,
      evidence: f.evidence,
      impact: 'Each discovered asset represents a potential entry point. Subdomains may have different security configurations than the main domain, creating opportunities for lateral movement or data exposure.',
    }))
    sections.push({
      id: 'asset-discovery',
      title: 'Asset Discovery',
      content: `The investigation revealed ${assetFindings.reduce((sum, f) => sum + f.evidence.length, 0)} assets associated with the target, including subdomains, web services, and related infrastructure.`,
      findings: details,
      severity: assetFindings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'high' : 'info',
    })
  }

  // Section 3: Network Exposure
  const networkFindings = analysis.findings.filter((f) => f.category === 'Network Exposure')
  if (networkFindings.length > 0) {
    const details = networkFindings.map((f) => ({
      title: f.finding,
      description: 'Network services were discovered that are accessible from the internet. Each service represents a potential attack surface and should be evaluated for security vulnerabilities.',
      evidence: f.evidence,
      impact: 'Exposed network services can be targeted with brute force attacks, exploit attempts, or denial-of-service. Services that should not be publicly accessible should be firewalled.',
      references: ['CWE-285: Improper Authorization', 'CWE-287: Improper Authentication'],
    }))
    sections.push({
      id: 'network-exposure',
      title: 'Network Exposure Analysis',
      content: 'Port scanning and service enumeration revealed exposed services that could be targeted by malicious actors.',
      findings: details,
      severity: networkFindings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'high' : 'medium',
    })
  }

  // Section 4: Vulnerability Detection
  const vulnFindings = analysis.findings.filter((f) => f.category === 'Vulnerability Detection')
  if (vulnFindings.length > 0) {
    const details = vulnFindings.map((f) => ({
      title: f.finding,
      description: 'Automated vulnerability scanning identified potential security issues that could be exploited by attackers. These findings should be validated and remediated.',
      evidence: f.evidence,
      impact: 'The identified vulnerabilities could allow for unauthorized access, data exposure, or service disruption. Prompt remediation is recommended.',
      references: ['OWASP Top 10', 'CVE Database'],
    }))
    sections.push({
      id: 'vulnerability-detection',
      title: 'Vulnerability Assessment',
      content: 'Security scanning revealed potential vulnerabilities that require investigation and potential remediation.',
      findings: details,
      severity: vulnFindings.some((f) => f.severity === 'critical') ? 'critical' : 'high',
    })
  }

  // Section 5: Intelligence Correlations
  if (analysis.correlations.length > 0) {
    sections.push({
      id: 'intelligence-correlations',
      title: 'Intelligence Correlations',
      content: 'Analysis of gathered intelligence reveals patterns and connections that provide deeper insight into the target\'s security posture.',
      findings: analysis.correlations.map((c) => ({
        title: c.title,
        description: c.description,
        evidence: [],
        impact: 'Understanding these correlations enables more focused security assessment and helps prioritize remediation efforts.',
      })),
      severity: 'info',
    })
  }

  return sections
}

function buildTimeline(executions: ToolExecution[]): OSINTReport['timeline'] {
  return executions
    .filter((e) => e.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({
      time: new Date(e.timestamp).toLocaleTimeString(),
      event: `${e.toolName} executed against ${e.target}`,
      category: e.toolName.split('_')[0],
    }))
}

function buildRecommendations(analysis: AIAnalysisResult): string[] {
  const recommendations: string[] = []

  // Prioritized recommendations based on findings
  const hasCriticalVulns = analysis.findings.some((f) => f.severity === 'critical')
  const hasHighVulns = analysis.findings.some((f) => f.severity === 'high')
  const hasExposedServices = analysis.findings.some((f) => f.category === 'Network Exposure')
  const hasWebAssets = analysis.findings.some(
    (f) => f.category === 'Asset Discovery' || f.category === 'Web Services'
  )

  if (hasCriticalVulns) {
    recommendations.push(
      'IMMEDIATE: Address critical vulnerabilities discovered during scanning. These represent the highest risk to the organization.'
    )
  }

  if (hasHighVulns) {
    recommendations.push(
      'HIGH PRIORITY: Remediate high-severity security issues to reduce the attack surface and prevent potential exploitation.'
    )
  }

  if (hasExposedServices) {
    recommendations.push(
      'Review all exposed network services and disable any that are not required for business operations.'
    )
    recommendations.push(
      'Implement network segmentation to separate critical services from public-facing infrastructure.'
    )
    recommendations.push(
      'Ensure all exposed services are properly configured and patched.'
    )
  }

  if (hasWebAssets) {
    recommendations.push('Conduct regular security assessments of all web-facing assets.')
    recommendations.push(
      'Implement Web Application Firewall (WAF) protection for public web services.'
    )
    recommendations.push(
      'Establish a process for regular security patching of web applications.'
    )
  }

  recommendations.push(
    'Implement continuous security monitoring to detect new vulnerabilities and exposures.'
  )
  recommendations.push(
    'Conduct regular penetration testing to identify security issues before malicious actors can exploit them.'
  )
  recommendations.push(
    'Establish a vulnerability disclosure program or bug bounty program.'
  )
  recommendations.push(
    'Maintain an inventory of all digital assets and conduct regular asset discovery exercises.'
  )

  return [...new Set(recommendations)]
}

function buildAppendices(executions: ToolExecution[]): OSINTReport['appendices'] {
  const appendices: OSINTReport['appendices'] = []

  // Tool outputs
  const successfulExecs = executions.filter((e) => e.status === 'done' && e.result)
  if (successfulExecs.length > 0) {
    appendices.push({
      title: 'Raw Tool Outputs',
      content: successfulExecs
        .map((e) => `### ${e.toolName}\n\nTarget: ${e.target}\n\n\`\`\`\n${e.result}\n\`\`\`\n`)
        .join('\n'),
      type: 'code',
    })
  }

  // Execution log
  appendices.push({
    title: 'Execution Log',
    content: executions
      .map((e) => {
        const status = e.status === 'done' ? '✓' : e.status === 'error' ? '✗' : '○'
        return `${status} ${e.toolName} - ${e.target} (${new Date(e.timestamp).toLocaleString()})`
      })
      .join('\n'),
    type: 'list',
  })

  return appendices
}

function generateMarkdown(
  title: string,
  executiveSummary: string,
  sections: OSINTReport['sections'],
  timeline: OSINTReport['timeline'],
  recommendations: string[],
  appendices: OSINTReport['appendices'],
  target: string,
  generatedAt: number
): string {
  let md = `# ${title}\n\n`
  md += `> Generated: ${new Date(generatedAt).toLocaleString()}\n`
  md += `> Target: ${target}\n\n`
  md += `---\n\n`

  // Executive Summary
  md += `${executiveSummary}\n\n`
  md += `---\n\n`

  // Detailed Findings
  md += `# Detailed Findings\n\n`
  for (const section of sections) {
    md += `## ${section.title}\n\n`
    md += `${section.content}\n\n`

    if (section.findings.length > 0) {
      for (const finding of section.findings) {
        md += `### ${finding.title}\n\n`
        md += `${finding.description}\n\n`

        if (finding.evidence.length > 0) {
          md += `**Evidence:**\n\`\`\`\n${finding.evidence.join('\n')}\n\`\`\`\n\n`
        }

        if (finding.impact) {
          md += `**Impact:** ${finding.impact}\n\n`
        }

        if (finding.references && finding.references.length > 0) {
          md += `**References:**\n`
          finding.references.forEach((ref) => {
            md += `- ${ref}\n`
          })
          md += '\n'
        }
      }
    }
    md += '\n'
  }

  // Timeline
  if (timeline.length > 0) {
    md += `# Investigation Timeline\n\n`
    md += `| Time | Event | Category |\n`
    md += `|------|-------|----------|\n`
    timeline.forEach((event) => {
      md += `| ${event.time} | ${event.event} | ${event.category} |\n`
    })
    md += '\n'
  }

  // Recommendations
  md += `# Recommendations\n\n`
  recommendations.forEach((rec, idx) => {
    md += `${idx + 1}. ${rec}\n`
  })
  md += '\n'

  // Appendices
  if (appendices.length > 0) {
    md += `# Appendices\n\n`
    for (const appendix of appendices) {
      md += `## ${appendix.title}\n\n`
      md += `${appendix.content}\n\n`
    }
  }

  // Footer
  md += `---\n\n`
  md += `*This report was automatically generated by HexStrike AI. Findings should be manually verified before taking action.*\n`

  return md
}

// Generate narrative story about findings
export function generateNarrativeReport(
  target: string,
  analysis: AIAnalysisResult,
  _executions: ToolExecution[]
): string {
  let narrative = `# The Investigation: ${target}\n\n`
  narrative += `*A comprehensive OSINT intelligence story*\n\n`
  narrative += `---\n\n`

  narrative += `## Introduction\n\n`
  narrative += `On ${new Date().toLocaleDateString()}, an automated intelligence gathering operation was initiated against ${target}. `
  narrative += `What follows is a detailed account of the discoveries made, the connections uncovered, and the security implications revealed.\n\n`

  narrative += `## The Beginning: Initial Reconnaissance\n\n`
  narrative += `The investigation began with passive information gathering, seeking to understand the digital footprint without directly engaging with the target. `

  // Build narrative based on findings
  const assetFindings = analysis.findings.filter((f) => f.category === 'Asset Discovery')
  if (assetFindings.length > 0) {
    const assetCount = assetFindings.reduce((sum, f) => sum + f.evidence.length, 0)
    narrative += `Almost immediately, the scope expanded. What began as a single target blossomed into ${assetCount} discrete assets—`
    narrative += `subdomains, web services, and related infrastructure that, when mapped together, revealed an attack surface far larger than initially anticipated.\n\n`

    narrative += `Each discovered asset represented not just a potential entry point, but a story. `
    narrative += `Some assets appeared to be development environments, forgotten in subdirectories. Others were production services, `
    narrative += `securely configured but exposing their existence to anyone who cared to look.\n\n`
  }

  const networkFindings = analysis.findings.filter((f) => f.category === 'Network Exposure')
  if (networkFindings.length > 0) {
    narrative += `## Network Exposure: The Open Doors\n\n`
    narrative += `As the investigation deepened, network reconnaissance revealed exposed services—doors left ajar in the digital perimeter. `
    const portCount = networkFindings.reduce((sum, f) => sum + f.evidence.length, 0)
    narrative += `${portCount} open ports were discovered, each telling its own story about the target's infrastructure.\n\n`

    narrative += `The implications are clear: each exposed service is a potential vector. `
    narrative += `To a security professional, these are items to be addressed. To an attacker, they are opportunities. `
    narrative += `The difference lies only in perspective and intent.\n\n`
  }

  const vulnFindings = analysis.findings.filter((f) => f.category === 'Vulnerability Detection')
  if (vulnFindings.length > 0) {
    narrative += `## Vulnerability Discovery: The Cracks in the Armor\n\n`
    narrative += `Automated security scanning revealed potential vulnerabilities—cracks in the digital armor that, if left unaddressed, `
    narrative += `could be exploited by malicious actors. The findings ranged from informational to critical severity.\n\n`

    narrative += `What makes these findings significant is not just their existence, but their discoverability. `
    narrative += `These vulnerabilities are not hidden behind authentication or buried in complex systems—`
    narrative += `they are exposed to the internet, discoverable by anyone with the motivation to look.\n\n`
  }

  narrative += `## The Big Picture: Intelligence Correlation\n\n`
  if (analysis.correlations.length > 0) {
    analysis.correlations.forEach((correlation) => {
      narrative += `### ${correlation.title}\n\n`
      narrative += `${correlation.description}\n\n`
    })
  }

  narrative += `When viewed individually, each finding is a data point. When correlated, they form a picture—`
  narrative += `a comprehensive view of the target's security posture that is greater than the sum of its parts.\n\n`

  narrative += `## Conclusion and Next Steps\n\n`
  narrative += `This investigation has gathered significant intelligence about ${target}. `
  narrative += `The findings present both immediate concerns and opportunities for security improvement.\n\n`

  narrative += `### What Happens Next\n\n`
  analysis.nextSteps.forEach((step, idx) => {
    narrative += `${idx + 1}. ${step}\n`
  })

  narrative += `\n### The Story Continues\n\n`
  narrative += `Security is not a destination—it's a journey. The findings in this report represent a snapshot in time, `
  narrative += `capturing the state of ${target}'s digital footprint on this particular date. `
  narrative += `As infrastructure changes and new services are deployed, this footprint will evolve.\n\n`

  narrative += `Continuous monitoring and regular security assessments ensure that as the story of ${target} continues, `
  narrative += `its security posture keeps pace with the threats it faces.\n\n`

  narrative += `---\n\n`
  narrative += `*This narrative was generated by HexStrike AI based on automated OSINT findings. Validate high-impact items manually before acting on them.*\n`

  return narrative
}

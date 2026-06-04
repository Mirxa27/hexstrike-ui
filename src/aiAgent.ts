
import type { HexstrikeTool, ToolExecution, AISettings } from './types'
import { planWithLLM, type LLMScanPlan } from './agent'

/** Matched case-insensitively against catalog tool names to classify OSINT tooling. */
const OSINT_NAME_HINTS = [
  // Search / API engines
  'shodan', 'censys', 'fullhunt', 'zoomeye', 'binaryedge', 'intelx',
  'securitytrails', 'criminalip', 'hunterio', 'haveibeenpwned',
  // Recon frameworks
  'theharvester', 'subfinder', 'amass', 'whois', 'dnsrecon', 'nslookup',
  'dnsenum', 'assetfinder', 'findomain', 'shuffledns', 'dnsx',
  // Email / breach
  'holehe', 'h8mail', 'hibp', 'emailrep', 'emailfinder', 'skypebuster',
  // URL discovery
  'wayback', 'gau', 'getallurls', 'crt', 'fierce',
  // Git / secrets
  'metagoofil', 'trufflehog', 'gitleaks', 'gitrob', 'gitscanner',
  // Social / username discovery
  'sherlock', 'maigret', 'social-analyzer', 'social_analyzer', 'whatsmyname',
  'userrecon', 'blackbird', 'snoop', 'osintgram', 'toutatis', 'ghunt',
  'photon', 'sn0int', 'sociolis', 'socialscan', 'inky',
  // Frameworks
  'spiderfoot', 'reconng', 'pagodo',
] as const

/** Username / social presence discovery — explicit fragments to limit false positives. */
function matchesSocialMediaCatalogTool(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('sherlock') ||
    n.includes('maigret') ||
    n.includes('whatsmyname') ||
    n.includes('userrecon') ||
    n.includes('blackbird') ||
    n.includes('osintgram') ||
    n.includes('toutatis') ||
    n.includes('ghunt') ||
    n.includes('snoop') ||
    n.includes('sociolis') ||
    n.includes('socialscan') ||
    n.includes('inky') ||
    (n.includes('social') && (n.includes('analyzer') || n.includes('analyser')))
  )
}

export interface AIRecommendation {
  tool: HexstrikeTool
  reason: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  estimatedTime: string
  dependsOn?: string[]
  /** Per-step target (may include `${prev...}` piping). Defaults to plan target. */
  target?: string
  /** Optional `--key value` flag string to forward to the backend. */
  options?: string
}

export interface AIScanPlan {
  target: string
  targetType: 'domain' | 'ip' | 'url' | 'email' | 'username' | 'organization'
  recommendations: AIRecommendation[]
  strategy: string
  estimatedTotalTime: string
}

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

// Detect target type
export function detectTargetType(target: string): AIScanPlan['targetType'] {
  // IP address
  if (/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(target)) {
    return 'ip'
  }
  // URL
  if (target.match(/^https?:\/\//i)) {
    return 'url'
  }
  // Email
  if (target.includes('@') && target.includes('.')) {
    return 'email'
  }
  // Username (common patterns)
  if (target.match(/^[a-zA-Z0-9_\-\.]{3,30}$/) && !target.includes('.')) {
    return 'username'
  }
  // Default to domain
  return 'domain'
}

// Generate AI-powered tool recommendations
export function generateScanPlan(target: string, availableTools: HexstrikeTool[]): AIScanPlan {
  const targetType = detectTargetType(target)
  const recommendations: AIRecommendation[] = []

  // Categorize tools
  const osintTools = availableTools.filter(
    (t) =>
      t.category.toLowerCase().includes('osint') ||
      OSINT_NAME_HINTS.some((k) => t.name.toLowerCase().includes(k))
  )

  const socialMediaTools = availableTools.filter((t) => matchesSocialMediaCatalogTool(t.name))

  const reconTools = availableTools.filter(t =>
    t.category.toLowerCase().includes('reconnaissance') ||
    ['nmap', 'masscan', 'rustscan', 'httpx', 'assetfinder', 'naabu', 'autorecon', 'enum4linux', 'netexec', 'crackmapexec', 'arp-scan'].some(k => t.name.toLowerCase().includes(k))
  )

  const webTools = availableTools.filter(t =>
    t.category.toLowerCase().includes('web') ||
    ['nuclei', 'gobuster', 'dirsearch', 'sqlmap', 'dalfox', 'ffuf', 'feroxbuster', 'katana', 'arjun', 'nikto', 'wpscan', 'httpx'].some(k => t.name.toLowerCase().includes(k))
  )

  const vulnTools = availableTools.filter(t =>
    t.category.toLowerCase().includes('vuln') ||
    ['nikto', 'wpscan', 'joomscan', 'smb-vuln', 'zaproxy', 'zap', 'burp', 'nessus', 'openvas'].some(k => t.name.toLowerCase().includes(k))
  )

  // Generate recommendations based on target type
  switch (targetType) {
    case 'domain':
      // Domain reconnaissance flow
      const whoisTool = osintTools.find(t => t.name.toLowerCase().includes('whois'))
      if (whoisTool) {
        recommendations.push({
          tool: whoisTool,
          reason: 'Start by gathering domain ownership and registration details',
          priority: 'high',
          estimatedTime: '30s',
        })
      }

      const subdomainTool = osintTools.find(t => t.name.toLowerCase().includes('subfinder') || t.name.toLowerCase().includes('amass'))
      if (subdomainTool) {
        recommendations.push({
          tool: subdomainTool,
          reason: 'Discover all subdomains to expand attack surface',
          priority: 'critical',
          estimatedTime: '2-5m',
          dependsOn: whoisTool ? [whoisTool.name] : [],
        })
      }

      const dnsTool = osintTools.find(t => t.name.toLowerCase().includes('dns'))
      if (dnsTool) {
        recommendations.push({
          tool: dnsTool,
          reason: 'Enumerate DNS records for additional targets',
          priority: 'high',
          estimatedTime: '1m',
        })
      }

      const harvesterDomain = osintTools.find(t => t.name.toLowerCase().includes('theharvester'))
      if (harvesterDomain) {
        recommendations.push({
          tool: harvesterDomain,
          reason: 'Harvest emails, hosts, and subdomains from search engines and public data sources',
          priority: 'high',
          estimatedTime: '2-6m',
        })
      }

      const assetfinderTool = reconTools.find(t => t.name.toLowerCase().includes('assetfinder'))
      if (assetfinderTool && (!subdomainTool || assetfinderTool.name !== subdomainTool.name)) {
        recommendations.push({
          tool: assetfinderTool,
          reason: 'Passive subdomain discovery from certificate and passive DNS sources',
          priority: 'high',
          estimatedTime: '1-3m',
        })
      }

      const crtTool = osintTools.find(
        t => t.name.toLowerCase().includes('crt') && !t.name.toLowerCase().includes('nuclei')
      )
      if (crtTool) {
        recommendations.push({
          tool: crtTool,
          reason: 'Map infrastructure and hostnames from certificate transparency logs',
          priority: 'high',
          estimatedTime: '1-2m',
        })
      }

      const fierceTool = osintTools.find(t => t.name.toLowerCase().includes('fierce'))
      if (fierceTool) {
        recommendations.push({
          tool: fierceTool,
          reason: 'DNS brute force and zone transfer checks for non-obvious hostnames',
          priority: 'medium',
          estimatedTime: '3-8m',
        })
      }

      const metagoofilTool = osintTools.find(t => t.name.toLowerCase().includes('metagoofil'))
      if (metagoofilTool) {
        recommendations.push({
          tool: metagoofilTool,
          reason: 'Discover indexed documents and metadata that may leak users or internal paths',
          priority: 'medium',
          estimatedTime: '3-10m',
        })
      }

      const gauTool = osintTools.find(
        t =>
          t.name.toLowerCase().includes('gau') ||
          t.name.toLowerCase().includes('getallurls')
      )
      if (gauTool) {
        recommendations.push({
          tool: gauTool,
          reason: 'Enumerate historical URLs from passive web archives for forgotten endpoints',
          priority: 'medium',
          estimatedTime: '2-4m',
          dependsOn: subdomainTool ? [subdomainTool.name] : [],
        })
      }

      const waybackTool = osintTools.find(
        t =>
          t.name.toLowerCase().includes('wayback') ||
          t.name.toLowerCase().includes('waybackurls')
      )
      if (waybackTool && (!gauTool || waybackTool.name !== gauTool.name)) {
        recommendations.push({
          tool: waybackTool,
          reason: 'Recover archived paths and content from the Wayback Machine',
          priority: 'medium',
          estimatedTime: '2-5m',
          dependsOn: subdomainTool ? [subdomainTool.name] : [],
        })
      }

      const dnstwistTool = osintTools.find(t => t.name.toLowerCase().includes('dnstwist'))
      if (dnstwistTool) {
        recommendations.push({
          tool: dnstwistTool,
          reason: 'Find typo-squat and lookalike domains used for phishing or brand abuse',
          priority: 'medium',
          estimatedTime: '2-4m',
        })
      }

      const httpxTool = reconTools.find(t => t.name.toLowerCase().includes('httpx'))
      if (httpxTool) {
        recommendations.push({
          tool: httpxTool,
          reason: 'Probe discovered subdomains for active HTTP/HTTPS services',
          priority: 'critical',
          estimatedTime: '2-3m',
          dependsOn: subdomainTool ? [subdomainTool.name] : [],
        })
      }

      const nucleiTool = webTools.find(t => t.name.toLowerCase().includes('nuclei'))
      if (nucleiTool) {
        recommendations.push({
          tool: nucleiTool,
          reason: 'Scan for vulnerabilities using template-based detection',
          priority: 'high',
          estimatedTime: '5-10m',
          dependsOn: httpxTool ? [httpxTool.name] : [],
        })
      }

      const shodanTool = osintTools.find(t => t.name.toLowerCase().includes('shodan'))
      if (shodanTool) {
        recommendations.push({
          tool: shodanTool,
          reason: 'Check Shodan for known exposed services and vulnerabilities',
          priority: 'high',
          estimatedTime: '1m',
        })
      }

      const censysTool = osintTools.find(t => t.name.toLowerCase().includes('censys'))
      if (censysTool) {
        recommendations.push({
          tool: censysTool,
          reason: 'Cross-check certificate and host exposure via internet-wide telemetry',
          priority: 'medium',
          estimatedTime: '1-2m',
        })
      }

      const ffufDomain = webTools.find(t => t.name.toLowerCase().includes('ffuf'))
      if (ffufDomain && httpxTool) {
        recommendations.push({
          tool: ffufDomain,
          reason: 'Fuzz directories and VHosts on live hosts once endpoints are confirmed',
          priority: 'medium',
          estimatedTime: '3-8m',
          dependsOn: [httpxTool.name],
        })
      }

      const feroxDomain = webTools.find(t => t.name.toLowerCase().includes('feroxbuster'))
      if (feroxDomain && httpxTool && (!ffufDomain || feroxDomain.name !== ffufDomain.name)) {
        recommendations.push({
          tool: feroxDomain,
          reason: 'Recursive content discovery where deep crawling is needed',
          priority: 'medium',
          estimatedTime: '5-12m',
          dependsOn: [httpxTool.name],
        })
      }
      break

    case 'ip':
      // IP reconnaissance flow
      const nmapTool = reconTools.find(t => t.name.toLowerCase().includes('nmap'))
      if (nmapTool) {
        recommendations.push({
          tool: nmapTool,
          reason: 'Perform comprehensive port scan and service detection',
          priority: 'critical',
          estimatedTime: '3-10m',
        })
      }

      const masscanTool = reconTools.find(t => t.name.toLowerCase().includes('masscan'))
      if (masscanTool) {
        recommendations.push({
          tool: masscanTool,
          reason: 'Fast port scan to discover all open ports',
          priority: 'high',
          estimatedTime: '2-5m',
        })
      }

      const rustscanTool = reconTools.find(t => t.name.toLowerCase().includes('rustscan'))
      if (rustscanTool) {
        recommendations.push({
          tool: rustscanTool,
          reason: 'High-speed port discovery to prioritize deeper service enumeration',
          priority: 'high',
          estimatedTime: '1-3m',
        })
      }

      const tlsProbe = availableTools.find(t =>
        ['sslscan', 'testssl', 'sslyze'].some(k => t.name.toLowerCase().includes(k))
      )
      if (tlsProbe) {
        recommendations.push({
          tool: tlsProbe,
          reason: 'Evaluate TLS versions, ciphers, and certificate issues on HTTPS services',
          priority: 'medium',
          estimatedTime: '2-4m',
          dependsOn: nmapTool ? [nmapTool.name] : [],
        })
      }

      const shodanIpTool = osintTools.find(t => t.name.toLowerCase().includes('shodan'))
      if (shodanIpTool) {
        recommendations.push({
          tool: shodanIpTool,
          reason: 'Query Shodan for known vulnerabilities and services on this IP',
          priority: 'high',
          estimatedTime: '30s',
        })
      }
      break

    case 'url':
      // Web application reconnaissance
      const gobusterTool = webTools.find(t => t.name.toLowerCase().includes('gobuster'))
      if (gobusterTool) {
        recommendations.push({
          tool: gobusterTool,
          reason: 'Discover hidden directories and files',
          priority: 'high',
          estimatedTime: '3-5m',
        })
      }

      const nucleiUrlTool = webTools.find(t => t.name.toLowerCase().includes('nuclei'))
      if (nucleiUrlTool) {
        recommendations.push({
          tool: nucleiUrlTool,
          reason: 'Scan for known vulnerabilities and misconfigurations',
          priority: 'critical',
          estimatedTime: '5-10m',
        })
      }

      const niktoTool = webTools.find(t => t.name.toLowerCase().includes('nikto'))
      if (niktoTool) {
        recommendations.push({
          tool: niktoTool,
          reason: 'Check for web server vulnerabilities and outdated software',
          priority: 'medium',
          estimatedTime: '2-3m',
        })
      }

      const ffufUrl = webTools.find(t => t.name.toLowerCase().includes('ffuf'))
      if (ffufUrl) {
        recommendations.push({
          tool: ffufUrl,
          reason: 'Fuzz endpoints, parameters, and virtual hosts at high throughput',
          priority: 'high',
          estimatedTime: '3-8m',
        })
      }

      const feroxUrl = webTools.find(t => t.name.toLowerCase().includes('feroxbuster'))
      if (feroxUrl && (!ffufUrl || feroxUrl.name !== ffufUrl.name)) {
        recommendations.push({
          tool: feroxUrl,
          reason: 'Breadth-first directory brute force with recursion where useful',
          priority: 'high',
          estimatedTime: '5-12m',
        })
      }

      const dalfoxUrl = webTools.find(t => t.name.toLowerCase().includes('dalfox'))
      if (dalfoxUrl) {
        recommendations.push({
          tool: dalfoxUrl,
          reason: 'Target XSS validation once inputs/parameters are identified',
          priority: 'high',
          estimatedTime: '3-6m',
        })
      }

      const arjunTool = webTools.find(t => t.name.toLowerCase().includes('arjun'))
      if (arjunTool) {
        recommendations.push({
          tool: arjunTool,
          reason: 'Discover hidden HTTP parameters before injection-focused testing',
          priority: 'medium',
          estimatedTime: '2-5m',
        })
      }

      const zapTool = vulnTools.find(t => t.name.toLowerCase().includes('zap'))
      if (zapTool) {
        recommendations.push({
          tool: zapTool,
          reason: 'Baseline automated DAST-style checks when a full spider scope is appropriate',
          priority: 'medium',
          estimatedTime: '10-25m',
        })
      }
      break

    case 'email':
      // Email OSINT
      const holeheEmailTool = osintTools.find(t => t.name.toLowerCase().includes('holehe'))
      if (holeheEmailTool) {
        recommendations.push({
          tool: holeheEmailTool,
          reason: 'Discover which third-party services this email registered (account footprint)',
          priority: 'critical',
          estimatedTime: '2-4m',
        })
      }

      const h8mailTool = osintTools.find(t => t.name.toLowerCase().includes('h8mail'))
      if (h8mailTool) {
        recommendations.push({
          tool: h8mailTool,
          reason: 'Correlate the address with breaches and combo lists where enabled',
          priority: 'high',
          estimatedTime: '2-5m',
        })
      }

      const harvesterTool = osintTools.find(t => t.name.toLowerCase().includes('theharvester'))
      if (harvesterTool) {
        recommendations.push({
          tool: harvesterTool,
          reason: 'Gather related emails, hosts, and subdomains from public sources',
          priority: 'high',
          estimatedTime: '2-5m',
        })
      }

      const hibpTool = osintTools.find(t => t.name.toLowerCase().includes('hibp'))
      if (hibpTool) {
        recommendations.push({
          tool: hibpTool,
          reason: 'Check known public breach disclosures for this address',
          priority: 'high',
          estimatedTime: '30s',
        })
      }

      const emailRepTool = osintTools.find(t => t.name.toLowerCase().includes('emailrep'))
      if (emailRepTool) {
        recommendations.push({
          tool: emailRepTool,
          reason: 'Reputation, disposable-mail hints, and metadata for deliverability assessment',
          priority: 'medium',
          estimatedTime: '30s',
        })
      }

      const emailTool = osintTools.find(
        t =>
          t.name.toLowerCase().includes('email') &&
          !t.name.toLowerCase().includes('holehe') &&
          !t.name.toLowerCase().includes('h8mail') &&
          !t.name.toLowerCase().includes('emailrep')
      )
      if (emailTool) {
        recommendations.push({
          tool: emailTool,
          reason: 'Additional email validation or breach checks available in the catalog',
          priority: 'medium',
          estimatedTime: '1-2m',
        })
      }
      break

    case 'username':
      // Username / social OSINT
      const sherlockTool = osintTools.find(t => t.name.toLowerCase().includes('sherlock'))
      if (sherlockTool) {
        recommendations.push({
          tool: sherlockTool,
          reason: 'Search for this handle across many social and content platforms',
          priority: 'critical',
          estimatedTime: '2-3m',
        })
      }

      const maigretTool = osintTools.find(t => t.name.toLowerCase().includes('maigret'))
      if (maigretTool) {
        recommendations.push({
          tool: maigretTool,
          reason: 'Broad multi-site username correlation with rich profile metadata',
          priority: 'high',
          estimatedTime: '3-5m',
        })
      }

      const socialAnalyzerTool = socialMediaTools.find(
        t =>
          t.name.toLowerCase().includes('analyzer') ||
          t.name.toLowerCase().includes('analyser')
      )
      if (socialAnalyzerTool) {
        recommendations.push({
          tool: socialAnalyzerTool,
          reason: 'Structured cross-platform social footprint and NLP-style profile analysis',
          priority: 'high',
          estimatedTime: '3-8m',
        })
      }

      const whatsmynameTool = osintTools.find(t => t.name.toLowerCase().includes('whatsmyname'))
      if (whatsmynameTool) {
        recommendations.push({
          tool: whatsmynameTool,
          reason: 'Fast multi-site username existence checks',
          priority: 'high',
          estimatedTime: '2-4m',
        })
      }

      const userreconTool = osintTools.find(t => t.name.toLowerCase().includes('userrecon'))
      if (userreconTool) {
        recommendations.push({
          tool: userreconTool,
          reason: 'Interactive username reconnaissance workflow across platforms',
          priority: 'medium',
          estimatedTime: '4-8m',
        })
      }

      const blackbirdTool = osintTools.find(t => t.name.toLowerCase().includes('blackbird'))
      if (blackbirdTool) {
        recommendations.push({
          tool: blackbirdTool,
          reason: 'Correlate usernames and emails across sites with a focused OSINT lens',
          priority: 'medium',
          estimatedTime: '3-6m',
        })
      }

      const osintgramTool = osintTools.find(t => t.name.toLowerCase().includes('osintgram'))
      if (osintgramTool) {
        recommendations.push({
          tool: osintgramTool,
          reason: 'Instagram-focused enumeration when the target maps to that platform',
          priority: 'medium',
          estimatedTime: '5-12m',
        })
      }
      break
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  // Calculate total time
  const totalMinutes = recommendations.reduce((sum, r) => {
    const match = r.estimatedTime.match(/(\d+)/)
    return sum + (match ? parseInt(match[1]) : 2)
  }, 0)

  return {
    target,
    targetType,
    recommendations,
    strategy: generateStrategy(targetType, recommendations),
    estimatedTotalTime: totalMinutes < 60 ? `${totalMinutes}m` : `${Math.round(totalMinutes / 60 * 10) / 10}h`,
  }
}

/**
 * LLM-backed planner with heuristic fallback (P3-1).
 *
 * If the user has configured an API key, ask the model for a structured
 * plan (DAG of tool calls). On any failure — no key, network error,
 * malformed JSON, no model selected — silently fall back to the
 * deterministic heuristic in `generateScanPlan`. The caller never has
 * to handle errors.
 */
export async function generateScanPlanSmart(
  target: string,
  availableTools: HexstrikeTool[],
  settings?: AISettings,
  signal?: AbortSignal
): Promise<{ plan: AIScanPlan; llm?: LLMScanPlan }> {
  const heuristic = generateScanPlan(target, availableTools)
  if (!settings) return { plan: heuristic }
  try {
    const llm = await planWithLLM(settings, target, availableTools, signal)
    if (!llm || !llm.steps.length) return { plan: heuristic }
    // Convert the LLM plan into the legacy AIScanPlan shape so existing
    // UI continues to work, while exposing the richer structure too.
    const toolByName = new Map(availableTools.map((t) => [t.name, t]))
    const recommendations: AIRecommendation[] = llm.steps
      .map((s, i) => {
        const tool = toolByName.get(s.tool)
        if (!tool) return null
        const dependsOn = s.dependsOn?.map((d) => `step-${d}`)
        return {
          tool,
          reason: s.reason || `Step ${i + 1} of LLM-generated plan`,
          priority: i < 3 ? 'high' : i < 6 ? 'medium' : 'low',
          estimatedTime: '2-5 min',
          dependsOn,
          // Preserve the per-step target (may contain `${prev...}` piping)
          // and options string so the autonomous executor can run the DAG
          // the model actually planned, not just the tool ordering.
          target: s.target,
          options: s.options,
        } as AIRecommendation
      })
      .filter((r): r is AIRecommendation => r !== null)
    if (!recommendations.length) return { plan: heuristic }
    return {
      plan: {
        ...heuristic,
        recommendations,
        strategy: llm.strategy || heuristic.strategy,
      },
      llm,
    }
  } catch {
    return { plan: heuristic }
  }
}

function generateStrategy(targetType: string, _recommendations: AIRecommendation[]): string {
  const strategies: Record<string, string> = {
    domain: 'Domain reconnaissance will follow a systematic approach: first gathering passive intelligence through WHOIS and DNS, then actively discovering subdomains, probing for services, and finally scanning for vulnerabilities. This minimizes detection while maximizing information gathering.',
    ip: 'IP reconnaissance will begin with fast port discovery, followed by detailed service enumeration. Vulnerability databases will be queried for known issues on discovered services.',
    url: 'Web application analysis will focus on content discovery, vulnerability scanning, and configuration review. Both automated and manual testing techniques will be employed.',
    email: 'Email intelligence gathering will check breach databases, find related accounts, and identify any exposed credentials or personal information.',
    username: 'Username investigation will search across hundreds of platforms to build a profile of online presence and potential attack surface.',
    organization: 'Organization intelligence will combine multiple techniques including employee discovery, infrastructure mapping, and brand monitoring.',
  }
  return strategies[targetType] || 'Standard reconnaissance methodology will be applied.'
}

// Analyze tool outputs and generate intelligence
export function analyzeResults(executions: ToolExecution[], target: string): AIAnalysisResult {
  const findings: AIAnalysisResult['findings'] = []
  const correlations: AIAnalysisResult['correlations'] = []
  const allEvidence: string[] = []

  // Group by tool name
  const byTool = new Map<string, ToolExecution[]>()
  for (const exec of executions) {
    if (!byTool.has(exec.toolName)) byTool.set(exec.toolName, [])
    byTool.get(exec.toolName)!.push(exec)
  }

  // Match executions by tool-name keyword (case-insensitive, substring) so
  // the analysis works regardless of the backend's exact tool naming
  // (e.g. `nuclei` vs `nuclei_templates`, `httpx` vs `httpx_probing`).
  const findExecs = (keywords: string[]): ToolExecution[] | undefined => {
    for (const [name, execs] of byTool) {
      const n = name.toLowerCase()
      if (keywords.some((k) => n.includes(k))) return execs
    }
    return undefined
  }

  // Analyze subdomain findings
  const subdomainExecs = findExecs(['subfinder', 'amass', 'assetfinder', 'findomain', 'sublist3r', 'subdomain'])
  if (subdomainExecs?.length) {
    const result = subdomainExecs[subdomainExecs.length - 1].result || ''
    const subdomainMatches = result.match(/[\w.-]+\.\w{2,}/g) || []
    if (subdomainMatches.length > 0) {
      findings.push({
        category: 'Asset Discovery',
        severity: 'info',
        finding: `Discovered ${subdomainMatches.length} subdomains for ${target}`,
        evidence: subdomainMatches.slice(0, 10),
        tools: subdomainExecs.map(e => e.toolName),
      })
      allEvidence.push(...subdomainMatches)
    }
  }

  // Analyze port scan results
  const nmapExecs = findExecs(['nmap', 'masscan', 'rustscan', 'naabu'])
  if (nmapExecs?.length) {
    const result = nmapExecs[nmapExecs.length - 1].result || ''
    const openPorts = result.match(/(\d+)\/(tcp|udp)\s+open/g) || []
    if (openPorts.length > 0) {
      findings.push({
        category: 'Network Exposure',
        severity: openPorts.length > 10 ? 'high' : openPorts.length > 5 ? 'medium' : 'low',
        finding: `Discovered ${openPorts.length} open ports on ${target}`,
        evidence: openPorts.slice(0, 15),
        tools: nmapExecs.map(e => e.toolName),
      })
    }
  }

  // Analyze vulnerability findings
  const nucleiExecs = findExecs(['nuclei'])
  if (nucleiExecs?.length) {
    const result = nucleiExecs[nucleiExecs.length - 1].result || ''
    if (result.includes('CRITICAL') || result.includes('HIGH')) {
      findings.push({
        category: 'Vulnerability Detection',
        severity: result.includes('CRITICAL') ? 'critical' : 'high',
        finding: 'Potential security vulnerabilities detected via template scanning',
        evidence: result.split('\n').filter(l => l.includes('CRITICAL') || l.includes('HIGH')).slice(0, 10),
        tools: nucleiExecs.map(e => e.toolName),
      })
    }
  }

  // Analyze web findings
  const httpxExecs = findExecs(['httpx', 'httprobe', 'http_prob'])
  if (httpxExecs?.length) {
    const result = httpxExecs[httpxExecs.length - 1].result || ''
    const urlMatches = result.match(/https?:\/\/[^\s]+/g) || []
    if (urlMatches.length > 0) {
      findings.push({
        category: 'Web Services',
        severity: 'info',
        finding: `Identified ${urlMatches.length} active web services`,
        evidence: urlMatches.slice(0, 10),
        tools: httpxExecs.map(e => e.toolName),
      })
      allEvidence.push(...urlMatches)
    }
  }

  // Analyze Shodan findings
  const shodanExecs = findExecs(['shodan'])
  if (shodanExecs?.length) {
    const result = shodanExecs[shodanExecs.length - 1].result || ''
    if (result && result.length > 100) {
      findings.push({
        category: 'OSINT Intelligence',
        severity: result.includes('vulnerable') ? 'high' : 'info',
        finding: 'Shodan intelligence reveals exposed services and potential vulnerabilities',
        evidence: [result.substring(0, 200) + '...'],
        tools: shodanExecs.map(e => e.toolName),
      })
    }
  }

  // Generate correlations
  if (findings.length > 1) {
    correlations.push({
      title: 'Attack Surface Expansion',
      description: 'Multiple subdomains and web services increase the potential attack surface. Each discovered service represents a potential entry point for further investigation.',
      relatedFindings: findings.map((_, i) => i),
    })
  }

  const summary = generateSummary(target, findings, targetTypeFromFindings(findings))
  const nextSteps = generateNextSteps(findings, target)

  return {
    findings,
    correlations,
    summary,
    nextSteps,
  }
}

function targetTypeFromFindings(_findings: AIAnalysisResult['findings']): string {
  const categories = _findings.map((f) => f.category)
  if (categories.includes('Asset Discovery')) return 'domain'
  if (categories.includes('Network Exposure')) return 'ip'
  if (categories.includes('Web Services')) return 'url'
  return 'target'
}

function generateSummary(target: string, findings: AIAnalysisResult['findings'], _type: string): string {
  if (findings.length === 0) {
    return `Initial reconnaissance completed for ${target}. No immediate findings detected. Consider expanding the scope or trying alternative enumeration techniques.`
  }

  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const highCount = findings.filter(f => f.severity === 'high').length

  let summary = `Intelligence gathering completed for ${target}. `

  if (criticalCount > 0 || highCount > 0) {
    summary += `The investigation revealed ${criticalCount} critical and ${highCount} high-priority findings that require immediate attention. `
  }

  const categories = [...new Set(findings.map(f => f.category))]
  summary += `Analysis covered ${categories.join(', ').toLowerCase()}. `

  if (criticalCount > 0) {
    summary += 'Critical vulnerabilities were discovered that could allow for unauthorized access or data exposure. Immediate remediation is recommended.'
  } else if (highCount > 0) {
    summary += 'High-severity issues were identified that should be addressed to improve security posture.'
  } else {
    summary += 'While no critical issues were found, the gathered intelligence provides a foundation for continued security assessment.'
  }

  return summary
}

function generateNextSteps(findings: AIAnalysisResult['findings'], _target: string): string[] {
  const steps: string[] = []

  const hasVulnerabilities = findings.some(f => f.category === 'Vulnerability Detection')
  const hasSubdomains = findings.some(f => f.category === 'Asset Discovery')
  const hasWebServices = findings.some(f => f.category === 'Web Services')
  const hasNetworkExposure = findings.some(f => f.category === 'Network Exposure')

  if (hasSubdomains) {
    steps.push('Perform detailed vulnerability scanning on discovered subdomains')
    steps.push('Check for subdomain takeover vulnerabilities')
    steps.push('Identify and fingerprint technologies on each web service')
  }

  if (hasWebServices) {
    steps.push('Conduct active web application security testing')
    steps.push('Test for common web vulnerabilities (OWASP Top 10)')
    steps.push('Review authentication and authorization mechanisms')
  }

  if (hasNetworkExposure) {
    steps.push('Perform service-specific vulnerability assessment')
    steps.push('Check for default credentials on exposed services')
    steps.push('Review service configurations for security issues')
  }

  if (hasVulnerabilities) {
    steps.push('Validate and prioritize discovered vulnerabilities')
    steps.push('Prepare proof-of-concept exploits for confirmed issues')
    steps.push('Generate detailed remediation reports')
  }

  steps.push('Compile final intelligence report with findings and recommendations')

  return steps
}

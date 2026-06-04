/**
 * Client-side tool enrichment layer.
 *
 * The backend's /health probe returns minimal or empty tool descriptions.
 * This module enriches them before they are sent to the LLM so the model
 * knows *exactly* what each tool does, when to call it, and what params it
 * needs — which is what turns text generation into actual tool calls.
 *
 * Also provides target-type routing: given what the user typed (domain, IP,
 * URL, email, username) return the 12-15 most relevant tools in priority
 * order so the model isn't overwhelmed by 64 random entries.
 */

import type { HexstrikeTool } from './types'

// ---------------------------------------------------------------------------
// Rich descriptions keyed by slug patterns (matched substring-insensitive)
// ---------------------------------------------------------------------------

interface RichTool {
  /** Canonical description shown to the LLM. ~80 chars max. */
  description: string
  /** Which fields this tool actually needs. 'domain'|'target'|'url'|'host'|'email'|'username' */
  primaryParam: 'target' | 'domain' | 'url' | 'host' | 'email' | 'username' | 'filepath'
  /** Rough target category this tool is useful for. */
  categories: Array<'domain' | 'ip' | 'url' | 'email' | 'username' | 'file' | 'any'>
  /** Example options string shown to the LLM. */
  exampleOptions?: string
}

const RICH_TOOLS: Array<{ match: RegExp; info: RichTool }> = [
  // ── Network recon ────────────────────────────────────────────────────────
  {
    match: /^nmap/,
    info: {
      description: 'Port scan and service version detection. target=IP or hostname. options="-sV -p 80,443,22" or "-p- -T4".',
      primaryParam: 'target', categories: ['ip', 'domain'],
      exampleOptions: '-sV -T4 --top-ports 1000',
    },
  },
  {
    match: /^masscan/,
    info: {
      description: 'Ultra-fast port scanner for large ranges. target=IP/CIDR. options="--rate 1000 -p0-65535".',
      primaryParam: 'target', categories: ['ip'],
      exampleOptions: '--rate 500 -p 80,443,22,8080',
    },
  },
  {
    match: /^rustscan|^rustscan/,
    info: {
      description: 'Fast port discovery then hands off to nmap. target=IP. options="-- -sV".',
      primaryParam: 'target', categories: ['ip'],
    },
  },
  {
    match: /^naabu/,
    info: {
      description: 'High-speed port scanner by ProjectDiscovery. target=IP or domain.',
      primaryParam: 'target', categories: ['ip', 'domain'],
      exampleOptions: '-top-ports 100',
    },
  },
  // ── Subdomain & DNS ──────────────────────────────────────────────────────
  {
    match: /^subfinder/,
    info: {
      description: 'Passive subdomain discovery from many sources. domain=apex domain only (e.g. example.com).',
      primaryParam: 'domain', categories: ['domain'],
      exampleOptions: '-silent',
    },
  },
  {
    match: /^amass/,
    info: {
      description: 'In-depth subdomain enumeration (passive + active). domain=apex domain.',
      primaryParam: 'domain', categories: ['domain'],
      exampleOptions: '-passive',
    },
  },
  {
    match: /^assetfinder/,
    info: {
      description: 'Quick passive subdomain finder. domain=apex domain.',
      primaryParam: 'domain', categories: ['domain'],
    },
  },
  {
    match: /^findomain/,
    info: {
      description: 'Cross-source subdomain finder. domain=apex domain.',
      primaryParam: 'domain', categories: ['domain'],
    },
  },
  {
    match: /^dnsenum|^dnsrecon|^fierce|^dnsx/,
    info: {
      description: 'DNS enumeration: A/CNAME/MX/NS/TXT records, zone transfers. target=domain.',
      primaryParam: 'target', categories: ['domain'],
    },
  },
  {
    match: /^whois/,
    info: {
      description: 'WHOIS registration info: registrar, dates, nameservers. target=domain or IP.',
      primaryParam: 'target', categories: ['domain', 'ip'],
    },
  },
  {
    match: /^dnstwist/,
    info: {
      description: 'Detect typosquat / lookalike domains for phishing detection. target=apex domain.',
      primaryParam: 'target', categories: ['domain'],
    },
  },
  // ── HTTP / web ───────────────────────────────────────────────────────────
  {
    match: /^httpx/,
    info: {
      description: 'Probe hosts for live HTTP/S, titles, tech stack, status codes. target=domain, IP, or comma-sep list.',
      primaryParam: 'target', categories: ['domain', 'ip', 'url'],
      exampleOptions: '-title -tech-detect -status-code -silent',
    },
  },
  {
    match: /^nuclei/,
    info: {
      description: 'Template-based vulnerability scanner (CVEs, misconfigs). target=URL or host.',
      primaryParam: 'target', categories: ['url', 'domain', 'ip'],
      exampleOptions: '-severity high,critical -silent',
    },
  },
  {
    match: /^nikto/,
    info: {
      description: 'Web server vulnerability and misconfiguration scanner. target=URL.',
      primaryParam: 'url', categories: ['url'],
    },
  },
  {
    match: /^gobuster|^dirb$|^dirsearch/,
    info: {
      description: 'Directory and file brute-force on web servers. target=URL. options="-w /path/to/wordlist".',
      primaryParam: 'url', categories: ['url'],
      exampleOptions: '-w /usr/share/wordlists/dirb/common.txt',
    },
  },
  {
    match: /^ffuf/,
    info: {
      description: 'Fast web fuzzer for directories, parameters, vhosts. target=URL with FUZZ placeholder.',
      primaryParam: 'url', categories: ['url'],
      exampleOptions: '-w /usr/share/wordlists/dirb/common.txt',
    },
  },
  {
    match: /^feroxbuster/,
    info: {
      description: 'Recursive content discovery. target=URL.',
      primaryParam: 'url', categories: ['url'],
    },
  },
  {
    match: /^katana/,
    info: {
      description: 'Web crawler / spider for endpoint discovery. target=URL.',
      primaryParam: 'url', categories: ['url'],
      exampleOptions: '-d 3 -silent',
    },
  },
  {
    match: /^wpscan/,
    info: {
      description: 'WordPress vulnerability scanner. target=WordPress site URL.',
      primaryParam: 'url', categories: ['url'],
    },
  },
  {
    match: /^sqlmap/,
    info: {
      description: 'SQL injection detection and exploitation. target=URL with params (e.g. http://host/page?id=1).',
      primaryParam: 'url', categories: ['url'],
      exampleOptions: '--level=2 --risk=1 --batch',
    },
  },
  {
    match: /^dalfox/,
    info: {
      description: 'XSS vulnerability scanner. target=URL.',
      primaryParam: 'url', categories: ['url'],
    },
  },
  {
    match: /^arjun/,
    info: {
      description: 'Hidden HTTP parameter discovery. target=URL.',
      primaryParam: 'url', categories: ['url'],
    },
  },
  {
    match: /^gau|^getallurls/,
    info: {
      description: 'Fetch all known URLs for a domain from AlienVault, Wayback, URLScan. target=domain.',
      primaryParam: 'target', categories: ['domain'],
    },
  },
  {
    match: /^wayback/,
    info: {
      description: 'Fetch archived URLs from Wayback Machine. target=domain.',
      primaryParam: 'target', categories: ['domain'],
    },
  },
  // ── OSINT / people search ────────────────────────────────────────────────
  {
    match: /^theharvester/,
    info: {
      description: 'Harvest emails, subdomains, IPs from search engines. target=domain.',
      primaryParam: 'target', categories: ['domain', 'email'],
    },
  },
  {
    match: /^sherlock/,
    info: {
      description: 'Find username across 300+ social platforms. target=username.',
      primaryParam: 'target', categories: ['username'],
    },
  },
  {
    match: /^maigret/,
    info: {
      description: 'Username lookup across 3000+ sites with profile metadata. target=username.',
      primaryParam: 'target', categories: ['username'],
    },
  },
  {
    match: /^holehe/,
    info: {
      description: 'Check which services an email is registered on. target=email address.',
      primaryParam: 'email', categories: ['email'],
    },
  },
  {
    match: /^socialscan|^social.scan/,
    info: {
      description: 'Check username/email availability across platforms. target=username or email.',
      primaryParam: 'target', categories: ['username', 'email'],
    },
  },
  {
    match: /^social.analyzer/,
    info: {
      description: 'Cross-platform social presence analysis. target=username.',
      primaryParam: 'target', categories: ['username'],
    },
  },
  {
    match: /^h8mail/,
    info: {
      description: 'Email breach lookup across multiple data sources. target=email.',
      primaryParam: 'email', categories: ['email'],
    },
  },
  {
    match: /^ghunt/,
    info: {
      description: 'Google account OSINT from email. target=Google email address.',
      primaryParam: 'email', categories: ['email'],
    },
  },
  // ── Password / hash ──────────────────────────────────────────────────────
  {
    match: /^hashcat/,
    info: {
      description: 'GPU-accelerated password hash cracking. target=hash string. options="-m 0" for MD5.',
      primaryParam: 'target', categories: ['any'],
      exampleOptions: '-m 0 -a 0',
    },
  },
  {
    match: /^john/,
    info: {
      description: 'John the Ripper password cracker. target=hash or file path.',
      primaryParam: 'target', categories: ['any'],
    },
  },
  {
    match: /^hydra/,
    info: {
      description: 'Network login brute-force. target=host. options="-l admin -P wordlist.txt ssh".',
      primaryParam: 'target', categories: ['ip', 'domain'],
      exampleOptions: '-l admin -P /usr/share/wordlists/rockyou.txt ssh',
    },
  },
  // ── Forensics ────────────────────────────────────────────────────────────
  {
    match: /^exiftool|^exif/,
    info: {
      description: 'Extract metadata from images, documents, media. target=file path.',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  {
    match: /^binwalk/,
    info: {
      description: 'Analyze and extract embedded files from binaries. target=file path.',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  {
    match: /^strings/,
    info: {
      description: 'Extract printable strings from binary files. target=file path.',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  {
    match: /^steghide|^outguess|^steg/,
    info: {
      description: 'Steganography extraction from images. target=image file path.',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  {
    match: /^foremost/,
    info: {
      description: 'File carving / data recovery. target=file or disk image path.',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  {
    match: /^face.recognition|^face_recognition|^face.detect|^osint.image/,
    info: {
      description: 'Local face detection, encoding, comparison. target=image file path. options="face-compare pathA pathB" or "face-detect pathA".',
      primaryParam: 'filepath', categories: ['file'],
    },
  },
  // ── HexStrike system ─────────────────────────────────────────────────────
  {
    match: /^hexstrike_system_health/,
    info: {
      description: 'Read backend /health — see which tools are installed and available. No target needed.',
      primaryParam: 'target', categories: ['any'],
    },
  },
  {
    match: /^hexstrike_install_packages/,
    info: {
      description: 'Install tools on the backend. target="apt:nmap,nuclei" or "pip:holehe". Reloads catalog.',
      primaryParam: 'target', categories: ['any'],
    },
  },
  {
    match: /^hexstrike_refresh_catalog/,
    info: {
      description: 'Re-fetch tool catalog from backend. No target needed.',
      primaryParam: 'target', categories: ['any'],
    },
  },
  {
    match: /^hexstrike_subdomain_sweep/,
    info: {
      description: 'Parallel subdomain discovery (subfinder+amass+assetfinder+crt.sh). target=apex domain.',
      primaryParam: 'domain', categories: ['domain'],
    },
  },
  {
    match: /^hexstrike_web_triage/,
    info: {
      description: 'httpx probe + nuclei high/critical scan in one step. target=URL or comma-sep URLs.',
      primaryParam: 'url', categories: ['url', 'domain'],
    },
  },
  {
    match: /^hexstrike_target_profile/,
    info: {
      description: 'Classify a target (domain/IP/URL) and suggest tool categories. target=any.',
      primaryParam: 'target', categories: ['any'],
    },
  },
  {
    match: /^hexstrike_smart_recon/,
    info: {
      description: 'AI-selected tool chain for the target. target=domain/IP/URL. options can set objective.',
      primaryParam: 'target', categories: ['any'],
    },
  },
]

// ---------------------------------------------------------------------------
// Target-type tool priority lists
// (tool name patterns in the order the LLM should consider calling them)
// ---------------------------------------------------------------------------

const DOMAIN_PRIORITY = [
  'whois', 'subfinder', 'amass', 'assetfinder', 'hexstrike_subdomain_sweep',
  'httpx', 'nuclei', 'theharvester', 'gau', 'waybackurls',
  'gobuster', 'ffuf', 'dnsenum', 'dnstwist', 'nmap',
]
const IP_PRIORITY = [
  'nmap', 'masscan', 'naabu', 'rustscan', 'httpx',
  'nuclei', 'whois', 'hexstrike_target_profile',
]
const URL_PRIORITY = [
  'nuclei', 'nikto', 'gobuster', 'ffuf', 'feroxbuster',
  'katana', 'sqlmap', 'dalfox', 'arjun', 'wpscan', 'httpx',
]
const EMAIL_PRIORITY = [
  'holehe', 'h8mail', 'ghunt', 'socialscan', 'theharvester',
  'maigret',
]
const USERNAME_PRIORITY = [
  'sherlock', 'maigret', 'socialscan', 'social_analyzer',
  'holehe', 'ghunt',
]
const FILE_PRIORITY = [
  'exiftool', 'binwalk', 'strings', 'steghide', 'foremost',
  'face_recognition', 'osint_image_search',
]

type TargetType = 'domain' | 'ip' | 'url' | 'email' | 'username' | 'file' | 'unknown'

function detectTargetType(target: string): TargetType {
  if (!target) return 'unknown'
  if (target.startsWith('http://') || target.startsWith('https://')) return 'url'
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d+)?$/.test(target)) return 'ip'
  if (target.includes('@') && target.includes('.')) return 'email'
  if (/^\.(png|jpg|jpeg|gif|pdf|exe|bin|pcap|zip|tar|db|sql|dmp|mem)$/i.test(target.replace(/.*\./, '.'))) return 'file'
  if (/^[a-zA-Z0-9._-]{1,30}$/.test(target) && !target.includes('.')) return 'username'
  if (/\.[a-zA-Z]{2,}$/.test(target)) return 'domain'
  return 'unknown'
}

function getRichInfo(toolName: string): RichTool | null {
  const lower = toolName.toLowerCase()
  for (const { match, info } of RICH_TOOLS) {
    if (match.test(lower)) return info
  }
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich a tool's description using the client-side catalog.
 * Falls back to the backend-provided description when no match is found.
 */
export function enrichToolDescription(tool: HexstrikeTool): string {
  const rich = getRichInfo(tool.name)
  if (rich) return rich.description
  // Fall back to the backend string if it has substance, else generate one.
  if (tool.description && tool.description !== `HexStrike tool (${tool.name})` && tool.description.length > 10) {
    return tool.description.slice(0, 200)
  }
  return `Run ${tool.name} against the target.`
}

/**
 * Return the `primaryParam` for a tool (the LLM will use this to fill the
 * right field: 'domain' | 'target' | 'url' | 'email' | 'username' | 'filepath').
 */
export function getToolPrimaryParam(toolName: string): string {
  return getRichInfo(toolName)?.primaryParam ?? 'target'
}

/**
 * Given the task description / active target, select the top N most relevant
 * tools in priority order. Prevents the LLM from being overwhelmed.
 */
export function selectRelevantTools(
  allTools: HexstrikeTool[],
  target: string,
  taskText: string,
  maxTools = 16,
): HexstrikeTool[] {
  const byName = new Map(allTools.map((t) => [t.name.toLowerCase(), t]))

  const detectedType = detectTargetType(target || taskText)

  let priorityList: string[]
  switch (detectedType) {
    case 'domain': priorityList = DOMAIN_PRIORITY; break
    case 'ip':     priorityList = IP_PRIORITY;     break
    case 'url':    priorityList = URL_PRIORITY;    break
    case 'email':  priorityList = EMAIL_PRIORITY;  break
    case 'username': priorityList = USERNAME_PRIORITY; break
    case 'file':   priorityList = FILE_PRIORITY;   break
    default:       priorityList = [...DOMAIN_PRIORITY, ...IP_PRIORITY.slice(0, 4)]; break
  }

  // Tools that match the keyword hints in the task text (file, email, etc.)
  const taskLower = (target + ' ' + taskText).toLowerCase()
  if (taskLower.includes('face') || taskLower.includes('image') || taskLower.includes('photo')) {
    priorityList = [...FILE_PRIORITY, ...priorityList]
  }
  if (taskLower.includes('username') || taskLower.includes('person') || taskLower.includes('social')) {
    priorityList = [...USERNAME_PRIORITY, ...priorityList]
  }
  if (taskLower.includes('@') || taskLower.includes('email') || taskLower.includes('breach')) {
    priorityList = [...EMAIL_PRIORITY, ...priorityList]
  }
  if (taskLower.includes('password') || taskLower.includes('hash') || taskLower.includes('crack')) {
    priorityList = ['hashcat', 'john', 'hydra', 'medusa', ...priorityList]
  }
  if (taskLower.includes('subdomain') || taskLower.includes('dns')) {
    priorityList = [...DOMAIN_PRIORITY.slice(0, 6), ...priorityList]
  }

  // Always include hexstrike system tools (handy for any target)
  const systemTools = ['hexstrike_system_health', 'hexstrike_subdomain_sweep', 'hexstrike_web_triage', 'hexstrike_smart_recon']
  const combined = [...new Set([...priorityList, ...systemTools])]

  const selected: HexstrikeTool[] = []
  for (const pat of combined) {
    if (selected.length >= maxTools) break
    // Exact match first
    const exact = byName.get(pat.toLowerCase())
    if (exact && !selected.includes(exact)) { selected.push(exact); continue }
    // Substring match
    for (const tool of allTools) {
      if (selected.length >= maxTools) break
      if (tool.name.toLowerCase().includes(pat.toLowerCase()) && !selected.includes(tool)) {
        selected.push(tool)
      }
    }
  }

  // Pad with remaining tools if under limit
  for (const tool of allTools) {
    if (selected.length >= maxTools) break
    if (!selected.includes(tool)) selected.push(tool)
  }

  return selected
}

/**
 * Build an injected tool menu string for the auto-run system prompt.
 * Shows the model exactly which tools it can call and how.
 */
export function buildToolMenu(
  selectedTools: HexstrikeTool[],
  target: string,
): string {
  if (!selectedTools.length) return ''
  const lines = selectedTools.slice(0, 16).map((t) => {
    const rich = getRichInfo(t.name)
    const desc = enrichToolDescription(t)
    const example = rich?.exampleOptions ? ` | e.g. options="${rich.exampleOptions}"` : ''
    const param = rich?.primaryParam ?? 'target'
    return `  • ${t.name}(${param}="${target || '<target>'}") — ${desc}${example}`
  })
  return lines.join('\n')
}

/**
 * Detect target type for use in the system prompt.
 */
export { detectTargetType }

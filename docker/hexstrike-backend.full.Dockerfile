# syntax=docker/dockerfile:1.6
#
# HexStrike AI backend — FULL toolset image.
#
# Builds the pinned upstream 0x4m4/hexstrike-ai server and installs a broad,
# REAL toolset across recon / web / network / password / forensics PLUS an
# advanced person/face/image OSINT layer:
#   • Accounts & people : sherlock, maigret, holehe, socialscan, social-analyzer,
#                         theHarvester, recon-ng, h8mail, ghunt, dnstwist
#   • Face / image       : face_recognition (dlib) + the osint-image-search helper
#                          (face detect/encode/compare + reverse-image URLs)
#   • Recon (Go)         : subfinder, httpx, nuclei, naabu, dnsx, katana, ffuf,
#                          gobuster, assetfinder, gau, waybackurls, dalfox, amass
#   • System (apt)       : nmap, masscan, sqlmap, hydra, john, hashcat, whois,
#                          dnsutils, tcpdump, exiftool, binwalk, sslscan, etc.
#
# Every optional tool installs BEST-EFFORT (`|| echo skip`) so a single failing
# package never breaks the image — query GET /health afterwards to see what
# actually landed. This image is large and slow to build; that is expected.
#
# Build:   docker build -f docker/hexstrike-backend.full.Dockerfile -t hexstrike-backend:full .
# Or:      HEXSTRIKE_BACKEND_IMAGE=hexstrike-backend:full TOOLSET=full \
#            docker compose --profile backend up -d --build
#
# Runs as root so privileged tools (masscan, nmap SYN, responder) work — this
# is a local authorized-research container, mirroring how Kali tool images run.

FROM python:3.12-slim AS base

ARG HEXSTRIKE_REF=9b8c780f324ce5145a322bfa23c98886f8424ba3
ARG GO_VERSION=1.23.4

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin \
    GOPATH=/root/go \
    PATH=/usr/local/go/bin:/root/go/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    HEXSTRIKE_HOST=0.0.0.0 \
    HEXSTRIKE_PORT=8888

WORKDIR /app

# ── Base build + runtime deps (cmake/build-essential for dlib; image libs for face_recognition) ──
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git curl wget ca-certificates jq unzip xz-utils \
      python3-pip pipx \
      build-essential cmake pkg-config \
      libjpeg-dev libpng-dev libopenblas-dev liblapack-dev \
 && rm -rf /var/lib/apt/lists/*

# ── Best-effort security tools from Debian main (skip any unavailable package) ──
RUN apt-get update \
 && for p in \
      nmap masscan sqlmap hydra john hashcat medusa ncrack \
      whois dnsutils tcpdump hping3 netcat-openbsd ncat \
      libimage-exiftool-perl binwalk binutils file foremost steghide outguess \
      sslscan wfuzz hashid dnsrecon dnsenum fierce dirb \
    ; do apt-get install -y --no-install-recommends "$p" || echo "[skip apt] $p"; done \
 && rm -rf /var/lib/apt/lists/*

# ── Go toolchain + recon tools (best-effort; copied to a shared bin) ──
RUN ARCH="$(dpkg --print-architecture)" \
 && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" -o /tmp/go.tgz \
 && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
RUN for m in \
      github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest \
      github.com/projectdiscovery/httpx/cmd/httpx@latest \
      github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest \
      github.com/projectdiscovery/naabu/v2/cmd/naabu@latest \
      github.com/projectdiscovery/dnsx/cmd/dnsx@latest \
      github.com/projectdiscovery/katana/cmd/katana@latest \
      github.com/ffuf/ffuf/v2@latest \
      github.com/OJ/gobuster/v3@latest \
      github.com/tomnomnom/assetfinder@latest \
      github.com/lc/gau/v2/cmd/gau@latest \
      github.com/tomnomnom/waybackurls@latest \
      github.com/hahwul/dalfox/v2@latest \
      github.com/owasp-amass/amass/v4/...@master \
    ; do go install "$m" || echo "[skip go] $m"; done \
 && (cp /root/go/bin/* /usr/local/bin/ 2>/dev/null || true)

# ── Python OSINT / people-search tools (isolated via pipx, best-effort) ──
RUN for t in \
      sherlock-project maigret holehe socialscan theHarvester \
      dnstwist arjun dirsearch recon-ng h8mail ghunt \
    ; do pipx install "$t" || echo "[skip pipx] $t"; done

# ── social-analyzer (name→profiles, 1000+ sites) ──
RUN pip install --no-cache-dir social-analyzer || echo "[skip pip] social-analyzer"

# ── Local face recognition (dlib). Heavy compile; allowed to skip on failure. ──
RUN pip install --no-cache-dir face_recognition || echo "[skip pip] face_recognition"

# face_recognition needs (a) its trained model files and (b) `pkg_resources`,
# which face_recognition_models imports — but setuptools>=81 REMOVED
# pkg_resources, so pin setuptools<81. Kept as a separate layer so the heavy
# dlib compile above stays cached on rebuilds.
RUN pip install --no-cache-dir "setuptools<81" \
 && ( pip install --no-cache-dir face_recognition_models \
      || pip install --no-cache-dir "git+https://github.com/ageitgey/face_recognition_models" \
      || echo "[skip pip] face_recognition_models" )

# ── osint-image-search helper (face detect/encode/compare + reverse-image URLs) ──
COPY scripts/osint-image-search.py /usr/local/bin/osint-image-search
RUN chmod +x /usr/local/bin/osint-image-search \
 && (test -f /usr/local/bin/face_recognition || ln -sf "$(command -v face_recognition || echo /bin/true)" /usr/local/bin/face-recognition 2>/dev/null || true)

# ── Server runtime deps (required) ──
RUN pip install --no-cache-dir --retries 10 --timeout 120 \
      "flask>=2.3.0,<4.0.0" "requests>=2.31.0,<3.0.0" "psutil>=5.9.0,<7.0.0"

# ── Fetch the pinned upstream server ──
RUN git init -q hexstrike-src \
 && cd hexstrike-src \
 && git remote add origin https://github.com/0x4m4/hexstrike-ai.git \
 && git fetch -q --depth 1 origin "${HEXSTRIKE_REF}" \
 && git checkout -q FETCH_HEAD \
 && cp hexstrike_server.py /app/hexstrike_server.py \
 && cd /app && rm -rf hexstrike-src

# ── Patch: (1) make heavy lazily-used imports optional; (2) register the new
#    people/face/image OSINT tools in the /health probe so they appear in the
#    UI catalog and run via /api/command. ──
RUN python - <<'PY'
p = '/app/hexstrike_server.py'
src = open(p).read()

fragile = [
    "import aiohttp",
    "from bs4 import BeautifulSoup",
    "import selenium",
    "from selenium import webdriver",
    "from selenium.webdriver.chrome.options import Options",
    "from selenium.webdriver.common.by import By",
    "from selenium.webdriver.support.ui import WebDriverWait",
    "from selenium.webdriver.support import expected_conditions as EC",
    "from selenium.common.exceptions import TimeoutException, WebDriverException",
    "import mitmproxy",
    "from mitmproxy import http as mitmhttp",
    "from mitmproxy.tools.dump import DumpMaster",
    "from mitmproxy.options import Options as MitmOptions",
]
for line in fragile:
    needle = line + "\n"
    if needle in src:
        src = src.replace(needle, "try:\n    " + line + "\nexcept Exception:\n    pass\n", 1)

# Extend the osint tool probe list so the new people/face/image tools are
# detected (and shown available) by GET /health.
anchor = '"censys-cli", "have-i-been-pwned"'
extra = ('"censys-cli", "have-i-been-pwned", '
         '"maigret", "holehe", "socialscan", "h8mail", "ghunt", "blackbird", '
         '"dnstwist", "photon", "face_recognition", "face_detection", "osint-image-search"')
if anchor in src and "osint-image-search" not in src:
    src = src.replace(anchor, extra, 1)

open(p, 'w').write(src)
print("patched: optional imports + extended osint probe list")
PY

# Verify the server still imports cleanly with the minimal runtime deps.
RUN cd /tmp && python -c "import sys; sys.path.insert(0,'/app'); import hexstrike_server; print('hexstrike_server imports OK')"

RUN mkdir -p /app/data /app/output

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:8888/health" >/dev/null || exit 1

CMD ["python", "hexstrike_server.py"]

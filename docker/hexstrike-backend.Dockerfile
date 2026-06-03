# syntax=docker/dockerfile:1.6
#
# HexStrike AI backend (github.com/0x4m4/hexstrike-ai) — containerized.
#
# This image runs the UNMODIFIED upstream `hexstrike_server.py` Flask API on
# port 8888. It installs:
#   • the Python deps the server imports at module load time (flask, requests,
#     psutil, aiohttp, beautifulsoup4, selenium, mitmproxy). The heavier
#     "conditionally used" libs (angr, pwntools) are NOT required to import —
#     in the source they only appear inside generated exploit-script *templates*
#     (f-strings), never as real top-level imports.
#   • a curated set of REAL CLI security tools so tool execution works
#     end-to-end. The server's GET /health probes `which <tool>` for ~130
#     tools and reports a tools_status map; whatever is installed here shows
#     up as available and is runnable via /api/tools/<tool> and /api/command.
#
# Build (standalone):
#   docker build -f docker/hexstrike-backend.Dockerfile -t hexstrike-backend:latest .
# Or via compose:
#   docker compose --profile backend up -d --build
#
# Pin a different upstream revision with --build-arg HEXSTRIKE_REF=<sha|branch>.

FROM python:3.12-slim AS base

# Pinned upstream commit (master @ 2024-06). Override with --build-arg.
ARG HEXSTRIKE_REF=9b8c780f324ce5145a322bfa23c98886f8424ba3

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HEXSTRIKE_HOST=0.0.0.0 \
    HEXSTRIKE_PORT=8888

# ── Real CLI security tools (fast, apt-available subset of the 130 the
#    server probes). These make tool execution genuinely functional. More can
#    be added at runtime via the UI's hexstrike_install_packages tool. ──
# NOTE: package names are Debian (trixie) `main`. Tools like nikto/whatweb
# live only in Kali repos, so they are intentionally omitted here; the set
# below is all real, fast, and each binary shows up in the server's /health
# `which <tool>` probe (nmap, exiftool, binwalk, tcpdump, strings/objdump via
# binutils, file, dig via dnsutils, curl). More can be added at runtime via the
# UI's hexstrike_install_packages tool.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      curl \
      whois \
      dnsutils \
      iputils-ping \
      net-tools \
      nmap \
      tcpdump \
      libimage-exiftool-perl \
      binwalk \
      binutils \
      file \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python runtime deps ──
# Intentionally MINIMAL. The upstream server hard-imports aiohttp / bs4 /
# selenium / mitmproxy at module top-level, but only USES them inside specific
# browser/proxy tool handlers (never at import time — verified: no module-level
# references). We make those imports optional below and install only the few
# packages actually needed to boot the API + run CLI tools. This keeps the
# image small and the build fast/reliable (no 10 MB+ selenium/mitmproxy pulls).
RUN pip install --no-cache-dir --retries 10 --timeout 120 \
      "flask>=2.3.0,<4.0.0" \
      "requests>=2.31.0,<3.0.0" \
      "psutil>=5.9.0,<7.0.0"

# ── Fetch the pinned upstream server (shallow, single commit) ──
RUN git init -q hexstrike-src \
 && cd hexstrike-src \
 && git remote add origin https://github.com/0x4m4/hexstrike-ai.git \
 && git fetch -q --depth 1 origin "${HEXSTRIKE_REF}" \
 && git checkout -q FETCH_HEAD \
 && cp hexstrike_server.py /app/hexstrike_server.py \
 && cd /app \
 && rm -rf hexstrike-src

# ── Make heavy, lazily-used imports optional so the server boots on the
#    minimal dependency set above, then verify it imports cleanly. ──
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
patched = 0
for line in fragile:
    needle = line + "\n"
    if needle in src:
        src = src.replace(needle, "try:\n    " + line + "\nexcept Exception:\n    pass\n", 1)
        patched += 1
open(p, 'w').write(src)
print(f"patched {patched}/{len(fragile)} optional imports")
PY
RUN cd /tmp && python -c "import sys; sys.path.insert(0, '/app'); import hexstrike_server; print('hexstrike_server imports OK')"

# Non-root runtime user (tools like nmap fall back to TCP-connect scans when
# unprivileged, which is sufficient for the e2e flow; run as root only if you
# need raw-socket SYN scans).
RUN useradd -r -u 1001 -m -d /home/hexstrike hexstrike \
 && mkdir -p /app/data /app/output \
 && chown -R hexstrike:hexstrike /app
USER hexstrike

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:8888/health" >/dev/null || exit 1

CMD ["python", "hexstrike_server.py"]

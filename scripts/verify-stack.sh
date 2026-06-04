#!/usr/bin/env bash
# Quick HexStrike UI + backend connectivity checks (run from repo root).
set -e
echo "=== Docker containers ==="
docker compose ps 2>/dev/null || true

echo ""
echo "=== Backend direct (host → port ${BACKEND_PORT:-8888}) ==="
code_direct="$(curl -sS -o /tmp/hs-health.json -w '%{http_code}' "http://127.0.0.1:${BACKEND_PORT:-8888}/health" || echo fail)"
echo "GET http://127.0.0.1:${BACKEND_PORT:-8888}/health → HTTP ${code_direct}"
if [[ "${code_direct}" == "200" ]] && command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import json
with open("/tmp/hs-health.json") as f:
    d = json.load(f)
print("  status:", d.get("status"), "| version:", d.get("version"))
print("  total_tools_available:", d.get("total_tools_available"), "/", d.get("total_tools_count"))
PY
fi

echo ""
echo "=== Through UI nginx (host → port ${FRONTEND_PORT:-4173}) ==="
code_fe="$(curl -sS -o /tmp/hs-health-fe.json -w '%{http_code}' "http://127.0.0.1:${FRONTEND_PORT:-4173}/health" || echo fail)"
echo "GET http://127.0.0.1:${FRONTEND_PORT:-4173}/health → HTTP ${code_fe}"

echo ""
echo "=== Tips ==="
echo "  • If backend container is missing:  docker compose --profile backend up -d"
echo "  • If GET /health fails:               docker logs hexstrike-backend --tail 80"
echo "  • UI Settings URL for Docker:        /api   (same origin via nginx)"
echo "  • UI Settings URL for host backend: http://127.0.0.1:${BACKEND_PORT:-8888}"

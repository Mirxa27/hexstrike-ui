# Changelog

All notable changes to HexStrike UI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Gemini multi-turn tool use:** the model's own turn was appended with `role: 'user'` instead of `role: 'model'`, corrupting the conversation and breaking autonomous tool loops on Google providers.
- **OpenAI-compatible providers now send the system prompt** (OpenAI/Groq/Mistral/LM Studio/Ollama) via a system-role message — previously the configured system prompt was silently dropped for these providers.
- **Tool-call IDs** for failed/skipped tools in the OpenAI stream are no longer `undefined`, so tool results map correctly in the transcript.
- **Backend responses that return HTTP 200 with non-JSON bodies** no longer throw — catalog fetch, `/api/execute`, v6 tool routes, `/health`, and intelligence endpoints now fall back gracefully.
- **Chat-history localStorage quota** is no longer a silent data-loss path: it self-heals by trimming the oldest sessions and surfaces a toast instead of dropping everything on refresh.
- **File uploads** isolate per-file read errors (one bad file no longer aborts the batch) and enforce 15 MB/file + 60 MB total caps; imported chat sessions are structure-validated.
- **Autonomous workspace** `${entities.*}` variable piping now resolves (merged entities were hardcoded empty); `${prev.<tool>.*}` lookups are case-insensitive.
- **AI result analysis** matches real backend tool names (e.g. `nuclei`, `httpx`) by keyword instead of only hardcoded `*_templates`/`*_probing` names.
- Autonomous loop no longer terminates early on the over-broad `results:`/`summary:` completion markers.
- Workspace + autonomous tool execution use the configured (same-origin `/api`) URL instead of a hardcoded `http://localhost:8888` that is unreachable from the browser in Docker.
- TTS voice preference is restored by name after async voice load (no stale-closure), and the global `speechSynthesis` access is guarded.
- Removed duplicate settings-save/reset toasts and invalid-IP false positives in extracted indicators.
- Docker Compose / image healthchecks use `127.0.0.1` instead of `localhost` so liveness probes succeed when `localhost` resolves to IPv6 only.
- File investigation now uses the configured HexStrike server URL (same as chat and workspaces), including Docker same-origin `/api/`.
- Nginx starts when the optional backend container is absent; failed `/api/*` upstreams return JSON from `api-unavailable.json` instead of the SPA HTML shell.
- Stop-generation cancel request no longer doubles `/api` when the configured URL ends with `/api`.

### Added
- **Real client-side file forensic analysis:** File Investigation now extracts printable strings, URLs, emails, valid IPs, potential secrets, and magic-byte file typing directly from the uploaded bytes in the browser (the backend has no file-upload endpoint, so the previous flow — sending the filename as the target — could never analyze content). Works with no backend.
- **Playwright E2E suite** (`e2e/`, `npm run test:e2e`): hermetic browser tests for app load, backend catalog, disconnected state, workspace tabs, settings/model fetch, the mocked chat flow, and a mobile no-horizontal-overflow check — across desktop + mobile viewports.
- **Reproducible HexStrike backend Docker image** (`docker/hexstrike-backend.Dockerfile`): builds the pinned upstream `0x4m4/hexstrike-ai` server with a minimal dependency set and real CLI tools (nmap, exiftool, binwalk, tcpdump, strings/objdump, file, dig, whois). `docker compose --profile backend up -d --build` now builds and runs the full stack.

### Changed
- Vite dev server proxies `/api` to the local HexStrike backend by default (`127.0.0.1:8888`); see `.env.example` for `VITE_DEV_PROXY_*` and `VITE_HEXSTRIKE_URL`.
- Default HexStrike URL in development is same-origin (empty) when env vars are unset, matching the dev proxy.
- `WorkspacePanel` tool-form updates are immutable, so preset-applied target+options compose correctly.
- CI: ESLint is a required check (removed `continue-on-error` on the lint job).

### Added
- Initial release of HexStrike AI
- Autonomous AI agent with auto-complete mode
- Support for 730+ cybersecurity tools
- File upload and forensic analysis
- Chat history with persistence
- Keyboard shortcuts
- Docker deployment
- Multiple AI provider support (OpenAI, Anthropic, Google, Groq)
- Workspace tabs for tool categories
- OSINT report generation

### Changed
- Optimized Docker build process
- Enhanced system prompt for better tool selection

### Fixed
- Settings page routing issue
- Auto-complete state persistence

## [1.0.0] - 2025-05-03

### Added
- Initial public release
- Core AI chat functionality
- Tool execution framework
- Modern cyberpunk UI
- Settings page with AI provider configuration
- Docker support
- Comprehensive documentation

[Unreleased]: https://github.com/your-username/hexstrike-ui/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-username/hexstrike-ui/releases/tag/v1.0.0

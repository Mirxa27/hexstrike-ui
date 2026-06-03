# 🎯 HexStrike AI - Advanced Cybersecurity Assistant

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=flat&logo=github&logoColor=white)](https://github.com)

An elite cybersecurity AI assistant with autonomous agent capabilities, access to 730+ professional security tools, and advanced forensics features.

## ✨ Features

- 🤖 **Autonomous AI Agent** - Continues executing tools until task completion
- 🛠️ **730+ Security Tools** - Across 29 categories including OSINT, Network Recon, Web Security, and more
- 📁 **File Analysis** - Upload files for forensic investigation
- 💾 **Chat History** - Persistent conversation history with export/import
- 🎨 **Modern UI** - Cyberpunk-themed interface with keyboard shortcuts
- 🔒 **Secure** - Runs entirely in your infrastructure
- 🚀 **Easy Deployment** - One-command Docker deployment

## 🚀 Quick Start

### Option 1: Docker (Recommended)

**Linux/Mac:**
```bash
# Make the script executable (first time only)
chmod +x start.sh

# Start the frontend (single command, no backend image required)
./start.sh up

# Or start frontend + the optional HexStrike backend together:
./start.sh up --with-backend
```

**Windows:**
```cmd
start.bat up
start.bat up --with-backend
```

Then open your browser and visit: **http://localhost:4173**

> ⚠️ The HexStrike backend is **optional** and gated behind a Compose
> `backend` profile, so the default `up` works on a fresh clone with no extra
> setup. When you do want real tool execution, this repo can build the backend
> for you — `docker/hexstrike-backend.Dockerfile` containers the pinned
> upstream [`0x4m4/hexstrike-ai`](https://github.com/0x4m4/hexstrike-ai) server
> with a curated set of real CLI tools (nmap, exiftool, binwalk, tcpdump,
> strings/objdump, file, dig, whois). Build + run the whole stack with:
>
> ```bash
> docker compose --profile backend up -d --build
> ```
>
> Without the backend you can still talk to LLM providers and configure tools,
> but tool execution will fail until you point Settings → HexStrike URL at a
> reachable backend (defaults to `http://hexstrike-backend:8888` inside the
> compose network and is proxied at `/api/` by nginx). Install more tools at
> runtime from the UI via the **HexStrike System → install packages** tool.

### Option 2: Docker Compose directly

```bash
# Frontend only
docker compose up -d

# Frontend + a lean backend (nmap, whois, dig, exiftool, binwalk, tcpdump, …)
docker compose --profile backend up -d --build
```

### Option 2b: Full toolset + advanced OSINT (face / person search)

For a comprehensive backend (~44 tools out of the box), build the full image and
point Compose at it:

```bash
# Build the comprehensive image (large; Go recon suite + people-search + face recognition)
docker build -f docker/hexstrike-backend.full.Dockerfile -t hexstrike-backend:full .

# Run the stack against it
HEXSTRIKE_BACKEND_IMAGE=hexstrike-backend:full docker compose --profile backend up -d
```

This adds:

- **Recon (Go):** subfinder, httpx, nuclei, naabu, dnsx, katana, ffuf, gobuster, assetfinder, gau, waybackurls, dalfox, amass
- **People search:** sherlock, maigret, holehe, socialscan, social-analyzer, h8mail, ghunt, dnstwist
- **Face / image OSINT:** local `face_recognition` (dlib) + the `osint-image-search` helper
  - `osint-image-search face-detect <img>` · `face-compare <a> <b>` · `face-encode <img>`
  - `osint-image-search reverse <image-url>` → reverse-image search URLs (Google Lens, Yandex, Bing, TinEye, PimEyes/FaceCheck)

> Web-wide automated **face** search engines (PimEyes, FaceCheck) are paid/closed —
> the helper emits the correct query URLs for them and performs real, offline
> face detection/matching locally. Use only on subjects/targets you are
> authorized to investigate.

### Option 3: Manual Docker Build

```bash
# Build the image
docker build -t hexstrike-ui .

# Run the container
docker run -p 4173:8080 hexstrike-ui
```

### Option 4: Development

```bash
# Install dependencies (use npm ci for a lockfile-faithful install)
npm ci

# Start development server (or `./start.sh dev` for the same thing)
npm run dev
```

With `npm run dev`, Vite proxies browser requests to **`/api/*`** → **`http://127.0.0.1:8888`** (same pattern as Docker nginx). Override the upstream with **`VITE_DEV_PROXY_TARGET`** or **`VITE_DEV_BACKEND_HOST`** / **`VITE_DEV_BACKEND_PORT`** in `.env`. See [`.env.example`](.env.example) for **`VITE_HEXSTRIKE_URL`** (Docker build vs local backend vs same-origin dev).

```bash
# Type-check, test, build, lint
npm run typecheck
npm test
npm run build
npm run lint
```

## 🛠 Troubleshooting

**Frontend loads but tools fail with "Backend unreachable"**
The HexStrike backend isn't running. Either start it via
`./start.sh up --with-backend` or point Settings → HexStrike URL at an
existing backend (and ensure it allows your origin via CORS).

Run `./scripts/verify-stack.sh` from the repo root to check container status,
`GET /health` on the backend (port **8888**) and through the UI (port **4173**).

**“Backend not working” but Docker shows healthy**
The HTTP server may be up while most CLI tools are missing inside the container (`tools_status` in `/health`). Install tools in the backend image or expect many executions to fail until binaries exist.

Settings → **HexStrike Server URL**: use **`/api`** when using the Docker UI so nginx proxies to `hexstrike-backend`. Use **`http://127.0.0.1:8888`** only when the backend listens on the host and port **8888** is published (`docker compose` maps `8888:8888`).

**Docker UI container restarts in a loop (`host not found in upstream "hexstrike-backend"`)**
Older images resolved the backend hostname at nginx startup. Current `nginx.conf` resolves the upstream at request time so the frontend container can start **without** the backend; `/api/*` then returns **503** with JSON until the backend joins the compose network.

**`docker compose up` fails with `ImageNotFound: hexstrike-backend`**
You're invoking the backend profile without a built image. Either remove
`--profile backend` / `--with-backend`, or build the backend image
yourself in its own repository first.

**API key prompt keeps resetting**
Keys are stored in your browser's `localStorage`. Clearing site data
or using a different profile/incognito window will lose them.

**Build fails with "module not found"**
Run `npm ci` (not `npm install`) to install the exact versions from
`package-lock.json`.

## 📋 Management Commands

**Linux/Mac:**
```bash
./start.sh logs      # View logs
./start.sh stop     # Stop the application
./start.sh restart  # Restart the application
./start.sh down     # Stop and remove containers
./start.sh build    # Rebuild Docker images
./start.sh clean    # Remove all containers and volumes
```

**Windows:**
```cmd
start.bat logs      # View logs
start.bat stop     # Stop the application
start.bat restart  # Restart the application
start.bat down     # Stop and remove containers
start.bat build    # Rebuild Docker images
start.bat clean    # Remove all containers and volumes
```

## ⚙️ Configuration

### AI Provider Setup

1. Click the **⚙️ Settings** icon in the top-right
2. Select your AI provider:
   - OpenAI (GPT-4, GPT-4o)
   - Anthropic (Claude 3.5 Sonnet, Claude 3 Opus)
   - Google (Gemini Pro, Gemini Flash)
   - Groq (Llama 3.3, Mixtral)
   - Local options (Ollama, LM Studio)
3. Enter your API key
4. Click **Fetch Models** and select a model
5. Adjust parameters if needed:
   - Temperature (0-2)
   - Max Tokens (100-32000)
   - Context Window

### HexStrike Backend Setup

By default, the UI connects to a HexStrike backend at `http://localhost:8888`. If you're running the backend separately:

1. Go to **Settings**
2. Update **HexStrike Server URL** to your backend address
3. Click **Test Connection** to verify

## 🎯 Usage

### Basic Chat

1. Type your query in the input field
2. Press **Enter** to send (or **Shift+Enter** for new line)
3. The AI will autonomously execute tools until the task is complete

### Auto-Complete Mode

Auto-complete is **enabled by default** for autonomous operation:

- 🟢 **Auto ON** - AI will run multiple tools until task completion
- ⚪ **Auto OFF** - AI will wait for your input after each tool

Toggle with the **Auto** button or `Ctrl+Shift+A`

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + K` | Focus input field |
| `Ctrl + Enter` | Send message |
| `Shift + Enter` | New line in input |
| `Escape` | Stop generation |
| `Ctrl + Shift + A` | Toggle auto-complete |
| `Ctrl + /` | Show keyboard shortcuts |

### File Analysis

1. Click the **📎 Attach files** button
2. Select one or more files (images, documents, executables, PCAPs, etc.)
3. The AI will analyze them using appropriate forensic tools

### Chat History

- Click the **📜 History** icon to view past conversations
- Click any chat to load it
- Chats are automatically saved and persisted

## 🛠️ Available Tools

### Tool Categories

- **OSINT** - Shodan, theHarvester, Subfinder, Amass, WHOIS
- **Network Recon** - Nmap, Masscan, RustScan, HTTP probing
- **Web Security** - Nuclei, Gobuster, Dirsearch, SQLMap
- **Exploitation** - Metasploit, ExploitDB, searchsploit
- **Password Attacks** - Hashcat, John, Hydra, Medusa
- **Forensics** - Binwalk, Strings, ExifTool, Volatility
- **Mobile** - Frida, JADX, APKTool, objection
- **Wireless** - Aircrack, Wifite, Reaver
- **Social Engineering** - SET, Gophish

And 20+ more categories with 730+ total tools!

## 🐳 Docker Deployment

### Environment Variables

```bash
# Frontend
NODE_ENV=production

# Backend (if using)
HEXSTRIKE_HOST=0.0.0.0
HEXSTRIKE_PORT=8888
HEXSTRIKE_LOG_LEVEL=info
```

### Ports

- **Frontend**: 4173 (or your custom port)
- **Backend**: 8888

### Volumes

- `./data` - Backend data directory
- `./output` - Scan results and reports

## 🔧 Development

### Project Structure

```
hexstrike-ui/
├── src/
│   ├── components/      # React components
│   ├── pages/          # Page components
│   ├── App.tsx         # Main app
│   ├── main.tsx        # Entry point
│   └── ...
├── public/             # Static assets
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Docker Compose setup
├── nginx.conf          # Nginx configuration
├── start.sh            # Linux/Mac startup script
├── start.bat           # Windows startup script
└── README.md           # This file
```

### Building for Production

```bash
npm run build
```

Output is in the `dist/` directory.

## 🌐 API Proxy

The UI can proxy API requests to the HexStrike backend. Configure in `nginx.conf`:

```nginx
location /api/ {
    proxy_pass http://hexstrike-backend:8888;
}
```

## 🔒 Security

- All data stays in your infrastructure
- API keys stored locally (localStorage)
- No external dependencies except AI providers
- Security headers configured in Nginx
- Non-root Docker user

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Built with [React](https://react.dev/) and [Vite](https://vitejs.dev/)
- UI powered by [Lucide Icons](https://lucide.dev/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
- Deployed with [Docker](https://www.docker.com/)

---

**Made with ❤️ for the cybersecurity community**

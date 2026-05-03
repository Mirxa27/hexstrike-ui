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

# Start the application
./start.sh up
```

**Windows:**
```cmd
start.bat up
```

Then open your browser and visit: **http://localhost:4173**

### Option 2: Docker Compose

```bash
docker-compose up -d
```

### Option 3: Manual Docker Build

```bash
# Build the image
docker build -t hexstrike-ui .

# Run the container
docker run -p 4173:8080 hexstrike-ui
```

### Option 4: Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

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

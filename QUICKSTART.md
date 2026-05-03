# 🚀 Quick Start Guide

Get HexStrike AI up and running in under 5 minutes!

## Prerequisites

- Docker installed on your system
- For Linux/Mac: Terminal access
- For Windows: Command Prompt or PowerShell

## ⚡ 30-Second Startup

### Linux/Mac:

```bash
# 1. Clone the repository
git clone https://github.com/your-username/hexstrike-ui.git
cd hexstrike-ui

# 2. Start the application
./start.sh up
```

### Windows:

```cmd
# 1. Clone the repository
git clone https://github.com/your-username/hexstrike-ui.git
cd hexstrike-ui

# 2. Start the application
start.bat up
```

**That's it!** Open your browser and visit: **http://localhost:4173**

## 🔧 First-Time Setup

### 1. Configure AI Provider

1. Click the **⚙️ Settings** icon (top-right)
2. Choose your AI provider:
   - **OpenAI** - Best for GPT-4
   - **Anthropic** - Best for Claude 3.5 Sonnet
   - **Google** - Best for Gemini Pro
   - **Groq** - Fast & free (Llama 3.3)
3. Enter your API key
4. Click **"Fetch Models"** and select a model
5. Click **"Save Settings"**

### 2. Test It Out

Try these example prompts:

```
# OSINT
What subdomains does example.com have?

# Network Scan
Scan example.com for open ports

# Web Security
Check https://example.com for vulnerabilities

# File Analysis
Upload a file and ask: "Analyze this file for threats"
```

## 🎯 Key Features

- **Auto-Complete**: Enabled by default - AI runs tools autonomously
- **Keyboard Shortcuts**: Press `Ctrl + /` to see all shortcuts
- **File Upload**: Click the 📎 icon to attach files
- **Chat History**: Click the 📜 icon to view past conversations
- **Tool Categories**: Switch between 12 workspace tabs

## 📋 Management Commands

### Linux/Mac:
```bash
./start.sh logs      # View logs
./start.sh stop     # Stop
./start.sh restart  # Restart
./start.sh down     # Remove containers
```

### Windows:
```cmd
start.bat logs      # View logs
start.bat stop     # Stop
start.bat restart  # Restart
start.bat down     # Remove containers
```

## 🔒 Security Notes

- All API keys are stored locally in your browser
- No data is sent to external servers (except AI providers)
- The application runs entirely in your Docker container
- Chat history is stored in your browser's localStorage

## 🆘 Troubleshooting

### Port Already in Use?

```bash
# Change port in docker-compose.yml:
ports:
  - "3000:8080"  # Change 4173 to 3000
```

### Can't Access the UI?

```bash
# Check if container is running
docker ps

# View logs
./start.sh logs

# Restart
./start.sh restart
```

### Docker Issues?

```bash
# Clean restart
./start.sh down
./start.sh clean
./start.sh build
./start.sh up
```

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [CONTRIBUTING.md](CONTRIBUTING.md) to contribute
- View [CHANGELOG.md](CHANGELOG.md) for version history

## 🎓 Pro Tips

1. **Use Auto-Complete** - Let the AI run multiple tools automatically
2. **Upload Files** - Attach PCAPs, executables, or documents for analysis
3. **Keyboard Shortcuts** - Use `Ctrl + K` to focus input, `Escape` to stop
4. **Chat History** - Your conversations are automatically saved
5. **Tool Categories** - Select relevant categories from the sidebar

## 💡 Example Workflows

### Domain Recon:
```
1. "Find all subdomains of target.com"
2. AI runs: Subfinder → Amass → DNS enumeration → HTTP probing
3. Auto-stops when complete
```

### Vulnerability Scan:
```
1. "Scan example.com for vulnerabilities"
2. AI runs: Nmap → Nuclei → SQLMap checks
3. Provides detailed report
```

### File Analysis:
```
1. Click 📎 and upload a file
2. "Analyze this file"
3. AI runs: ExifTool → Strings → VirusTotal lookup
4. Returns comprehensive analysis
```

---

**Need Help?** Open an issue on GitHub or check the documentation!

**Made with ❤️ for the cybersecurity community**

#!/bin/bash
set -e

echo "Setting up hexstrike-ai and Awesome-Hacking..."

# Clone repositories if not present
if [ ! -d "hexstrike-ai" ]; then
    git clone https://github.com/0x4m4/hexstrike-ai.git
fi
if [ ! -d "Awesome-Hacking" ]; then
    git clone https://github.com/Hack-with-Github/Awesome-Hacking.git
fi

# Set up virtual environment and python requirements
cd hexstrike-ai
if [ ! -d "hexstrike-env" ]; then
    python3 -m venv hexstrike-env
fi
source hexstrike-env/bin/activate
pip install -r requirements.txt

# Configure MCP Server
echo '{
  "mcpServers": {
    "hexstrike-ai": {
      "command": "python3",
      "args": [
        "'$PWD'/hexstrike_mcp.py",
        "--server",
        "http://127.0.0.1:8888"
      ],
      "description": "HexStrike AI v6.0 - Advanced Cybersecurity Automation Platform. Turn off alwaysAllow if you dont want autonomous execution!",
      "timeout": 300,
      "alwaysAllow": []
    }
  }
}' > hexstrike-ai-mcp.json

echo "Installing Core Security Tools..."
# Note: Ensure you run this script with appropriate privileges or use sudo for apt
sudo DEBIAN_FRONTEND=noninteractive apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nmap masscan fierce dnsenum gobuster dirsearch ffuf dirb nikto sqlmap arjun wafw00f hydra john hashcat medusa patator ophcrack gdb radare2 binwalk checksec steghide exiftool google-chrome-stable golang

echo "Installing tools via Go..."
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
go install -v github.com/projectdiscovery/katana/cmd/katana@latest
go install -v github.com/owasp-amass/amass/v4/...@master

echo "Setup Complete. To start the server, run: "
echo "cd hexstrike-ai && source hexstrike-env/bin/activate && python3 hexstrike_server.py"

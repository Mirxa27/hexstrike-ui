#!/bin/bash

# HexStrike UI - Quick Start Script
# Single-command startup for local/production deployments.
#
# Examples:
#   ./start.sh                      # frontend only (default)
#   ./start.sh up                   # frontend only
#   ./start.sh up --with-backend    # frontend + optional HexStrike backend
#   ./start.sh logs                 # follow container logs
#   ./start.sh stop | down | clean

set -e

echo "🎯 HexStrike UI - Quick Start"
echo "================================"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Bootstrap .env from .env.example on first run so VITE_* and BACKEND_URL
# values can be customised without editing tracked files.
if [ ! -f .env ] && [ -f .env.example ]; then
    echo "📝 Creating .env from .env.example (edit it to customise)"
    cp .env.example .env
fi

# Parse args: first positional = command, look for --with-backend flag.
COMMAND=${1:-"up"}
WITH_BACKEND=0
for arg in "$@"; do
    case "$arg" in
        --with-backend|--backend)
            WITH_BACKEND=1
            ;;
    esac
done

PROFILE_ARGS=()
if [ "$WITH_BACKEND" = "1" ]; then
    PROFILE_ARGS=(--profile backend)
fi

frontend_url() {
    local port="${FRONTEND_PORT:-4173}"
    echo "http://localhost:${port}"
}

case $COMMAND in
    up|start)
        echo "🚀 Starting HexStrike UI..."
        if [ "$WITH_BACKEND" = "1" ]; then
            echo "   ↳ Including optional HexStrike backend (image: ${HEXSTRIKE_BACKEND_IMAGE:-hexstrike-backend:latest})"
        fi
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" up -d
        echo ""
        echo "✅ HexStrike UI is now running!"
        echo "📱 Open your browser at: $(frontend_url)"
        if [ "$WITH_BACKEND" != "1" ]; then
            echo "ℹ️  No backend started — the UI will work standalone, but tool"
            echo "   execution requires either:"
            echo "     • a running HexStrike backend reachable from the container, or"
            echo "     • re-running with: ./start.sh up --with-backend"
        fi
        echo ""
        echo "📋 Useful commands:"
        echo "   ./start.sh logs                 - Follow logs"
        echo "   ./start.sh stop                 - Stop containers"
        echo "   ./start.sh restart              - Restart containers"
        echo "   ./start.sh down                 - Stop and remove containers"
        echo "   ./start.sh up --with-backend    - Start with backend profile"
        ;;

    stop)
        echo "⏹️  Stopping HexStrike UI..."
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" stop
        echo "✅ Stopped!"
        ;;

    restart)
        echo "🔄 Restarting HexStrike UI..."
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" restart
        echo "✅ Restarted!"
        echo "📱 Visit: $(frontend_url)"
        ;;

    down)
        echo "🗑️  Stopping and removing containers..."
        $DOCKER_COMPOSE --profile backend down
        echo "✅ Containers removed!"
        ;;

    logs)
        echo "📋 Following logs (Ctrl+C to exit)..."
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" logs -f
        ;;

    build)
        echo "🔨 Building Docker images..."
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" build
        echo "✅ Build complete!"
        echo "🚀 Run './start.sh up' to start the application"
        ;;

    rebuild)
        echo "🔨 Rebuilding Docker images from scratch..."
        $DOCKER_COMPOSE "${PROFILE_ARGS[@]}" build --no-cache
        echo "✅ Rebuild complete!"
        echo "🚀 Run './start.sh up' to start the application"
        ;;

    clean)
        echo "🧹 Cleaning up..."
        $DOCKER_COMPOSE --profile backend down -v
        docker system prune -f
        echo "✅ Cleanup complete!"
        ;;

    dev)
        echo "💻 Starting Vite dev server (host)..."
        if ! command -v npm &> /dev/null; then
            echo "❌ npm not found — install Node.js 20+ to use './start.sh dev'"
            exit 1
        fi
        if [ ! -d node_modules ]; then
            echo "📦 Installing dependencies (first run)..."
            npm ci
        fi
        npm run dev
        ;;

    *)
        echo "❌ Unknown command: $COMMAND"
        echo ""
        echo "Usage: ./start.sh [command] [--with-backend]"
        echo ""
        echo "Commands:"
        echo "   up       - Start the application (default)"
        echo "   start    - Start the application"
        echo "   stop     - Stop the application"
        echo "   restart  - Restart the application"
        echo "   down     - Stop and remove containers"
        echo "   logs     - View logs"
        echo "   build    - Build Docker images"
        echo "   rebuild  - Rebuild from scratch"
        echo "   clean    - Remove all containers and volumes"
        echo "   dev      - Run Vite dev server on the host (npm run dev)"
        echo ""
        echo "Flags:"
        echo "   --with-backend   Also start the optional HexStrike backend"
        exit 1
        ;;
esac

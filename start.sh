#!/bin/bash

# HexStrike UI - Quick Start Script
# This script helps you quickly start the HexStrike UI application

set -e

echo "🎯 HexStrike UI - Quick Start"
echo "================================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Determine which docker compose command to use
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Parse command line arguments
COMMAND=${1:-"up"}

case $COMMAND in
    up|start)
        echo "🚀 Starting HexStrike UI..."
        $DOCKER_COMPOSE up -d
        echo ""
        echo "✅ HexStrike UI is now running!"
        echo "📱 Open your browser and visit: http://localhost:4173"
        echo ""
        echo "📋 Useful commands:"
        echo "   ./start.sh logs     - View logs"
        echo "   ./start.sh stop    - Stop the application"
        echo "   ./start.sh restart - Restart the application"
        echo "   ./start.sh down    - Stop and remove containers"
        ;;

    stop)
        echo "⏹️  Stopping HexStrike UI..."
        $DOCKER_COMPOSE stop
        echo "✅ Stopped!"
        ;;

    restart)
        echo "🔄 Restarting HexStrike UI..."
        $DOCKER_COMPOSE restart
        echo "✅ Restarted!"
        echo "📱 Visit: http://localhost:4173"
        ;;

    down)
        echo "🗑️  Stopping and removing containers..."
        $DOCKER_COMPOSE down
        echo "✅ Containers removed!"
        ;;

    logs)
        echo "📋 Following logs (Ctrl+C to exit)..."
        $DOCKER_COMPOSE logs -f
        ;;

    build)
        echo "🔨 Building Docker images..."
        $DOCKER_COMPOSE build
        echo "✅ Build complete!"
        echo "🚀 Run './start.sh up' to start the application"
        ;;

    rebuild)
        echo "🔨 Rebuilding Docker images from scratch..."
        $DOCKER_COMPOSE build --no-cache
        echo "✅ Rebuild complete!"
        echo "🚀 Run './start.sh up' to start the application"
        ;;

    clean)
        echo "🧹 Cleaning up..."
        $DOCKER_COMPOSE down -v
        docker system prune -f
        echo "✅ Cleanup complete!"
        ;;

    *)
        echo "❌ Unknown command: $COMMAND"
        echo ""
        echo "Usage: ./start.sh [command]"
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
        exit 1
        ;;
esac

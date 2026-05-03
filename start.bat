@echo off
REM HexStrike UI - Quick Start Script for Windows

echo ===============================================
echo HexStrike UI - Quick Start
echo ===============================================

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo Error: Docker is not installed. Please install Docker Desktop.
    echo Visit: https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)

REM Parse command
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=up

if "%COMMAND%"=="up" goto :start
if "%COMMAND%"=="start" goto :start
if "%COMMAND%"=="stop" goto :stop
if "%COMMAND%"=="restart" goto :restart
if "%COMMAND%"=="down" goto :down
if "%COMMAND%"=="logs" goto :logs
if "%COMMAND%"=="build" goto :build
if "%COMMAND%"=="rebuild" goto :rebuild
if "%COMMAND%"=="clean" goto :clean

echo Error: Unknown command: %COMMAND%
echo.
echo Usage: start.bat [command]
echo.
echo Commands:
echo    up       - Start the application (default)
echo    start    - Start the application
echo    stop     - Stop the application
echo    restart  - Restart the application
echo    down     - Stop and remove containers
echo    logs     - View logs
echo    build    - Build Docker images
echo    rebuild  - Rebuild from scratch
echo    clean    - Remove all containers and volumes
exit /b 1

:start
echo Starting HexStrike UI...
docker-compose up -d
echo.
echo HexStrike UI is now running!
echo Open your browser and visit: http://localhost:4173
echo.
echo Useful commands:
echo    start.bat logs     - View logs
echo    start.bat stop    - Stop the application
echo    start.bat restart - Restart the application
echo    start.bat down    - Stop and remove containers
goto :end

:stop
echo Stopping HexStrike UI...
docker-compose stop
echo Stopped!
goto :end

:restart
echo Restarting HexStrike UI...
docker-compose restart
echo Restarted!
echo Visit: http://localhost:4173
goto :end

:down
echo Stopping and removing containers...
docker-compose down
echo Containers removed!
goto :end

:logs
echo Following logs (Ctrl+C to exit)...
docker-compose logs -f
goto :end

:build
echo Building Docker images...
docker-compose build
echo Build complete!
echo Run 'start.bat up' to start the application
goto :end

:rebuild
echo Rebuilding Docker images from scratch...
docker-compose build --no-cache
echo Rebuild complete!
echo Run 'start.bat up' to start the application
goto :end

:clean
echo Cleaning up...
docker-compose down -v
docker system prune -f
echo Cleanup complete!
goto :end

:end

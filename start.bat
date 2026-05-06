@echo off
REM HexStrike UI - Quick Start Script for Windows
REM
REM Examples:
REM   start.bat                       - frontend only (default)
REM   start.bat up --with-backend     - frontend + optional backend profile
REM   start.bat logs | stop | down | clean

echo ===============================================
echo HexStrike UI - Quick Start
echo ===============================================

REM Check Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo Error: Docker is not installed. Please install Docker Desktop.
    echo Visit: https://docs.docker.com/desktop/install/windows-install/
    exit /b 1
)

REM Bootstrap .env on first run
if not exist .env (
    if exist .env.example (
        echo Creating .env from .env.example
        copy /Y .env.example .env >nul
    )
)

REM Parse args: %1 = command, look for --with-backend in remaining args.
set COMMAND=%1
if "%COMMAND%"=="" set COMMAND=up

set PROFILE_ARGS=
:parse_args
shift
if "%~1"=="" goto :after_args
if /I "%~1"=="--with-backend" set PROFILE_ARGS=--profile backend
if /I "%~1"=="--backend"      set PROFILE_ARGS=--profile backend
goto :parse_args
:after_args

if /I "%COMMAND%"=="up"      goto :start
if /I "%COMMAND%"=="start"   goto :start
if /I "%COMMAND%"=="stop"    goto :stop
if /I "%COMMAND%"=="restart" goto :restart
if /I "%COMMAND%"=="down"    goto :down
if /I "%COMMAND%"=="logs"    goto :logs
if /I "%COMMAND%"=="build"   goto :build
if /I "%COMMAND%"=="rebuild" goto :rebuild
if /I "%COMMAND%"=="clean"   goto :clean
if /I "%COMMAND%"=="dev"     goto :dev

echo Error: Unknown command: %COMMAND%
echo.
echo Usage: start.bat [command] [--with-backend]
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
echo    dev      - Run Vite dev server on the host (npm run dev)
echo.
echo Flags:
echo    --with-backend   Also start the optional HexStrike backend
exit /b 1

:start
echo Starting HexStrike UI...
docker compose %PROFILE_ARGS% up -d
echo.
echo HexStrike UI is now running!
echo Open your browser and visit: http://localhost:4173
if "%PROFILE_ARGS%"=="" (
    echo.
    echo No backend started - the UI will work standalone, but tool execution
    echo requires either a running HexStrike backend or re-running with:
    echo     start.bat up --with-backend
)
goto :end

:stop
echo Stopping HexStrike UI...
docker compose %PROFILE_ARGS% stop
echo Stopped!
goto :end

:restart
echo Restarting HexStrike UI...
docker compose %PROFILE_ARGS% restart
echo Restarted!
echo Visit: http://localhost:4173
goto :end

:down
echo Stopping and removing containers...
docker compose --profile backend down
echo Containers removed!
goto :end

:logs
echo Following logs (Ctrl+C to exit)...
docker compose %PROFILE_ARGS% logs -f
goto :end

:build
echo Building Docker images...
docker compose %PROFILE_ARGS% build
echo Build complete!
echo Run 'start.bat up' to start the application
goto :end

:rebuild
echo Rebuilding Docker images from scratch...
docker compose %PROFILE_ARGS% build --no-cache
echo Rebuild complete!
echo Run 'start.bat up' to start the application
goto :end

:clean
echo Cleaning up...
docker compose --profile backend down -v
docker system prune -f
echo Cleanup complete!
goto :end

:dev
where npm >nul 2>&1
if errorlevel 1 (
    echo npm not found - install Node.js 20+ to use 'start.bat dev'
    exit /b 1
)
if not exist node_modules (
    echo Installing dependencies (first run)...
    call npm ci
)
call npm run dev
goto :end

:end

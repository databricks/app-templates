@echo off
REM ================================================================
REM  Databricks CLI Setup for Windows
REM  This script installs the new Databricks CLI and configures
REM  OAuth authentication for the multi-agent orchestrator.
REM
REM  Reference: https://docs.databricks.com/aws/en/dev-tools/cli/install
REM  Migration: https://docs.databricks.com/aws/en/dev-tools/cli/migrate
REM ================================================================

echo.
echo ============================================================
echo  Databricks CLI Setup for Windows
echo ============================================================
echo.

REM Step 1: Check if legacy CLI is installed (Python package)
echo [1/4] Checking for legacy Databricks CLI (Python package)...
pip show databricks-cli >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  ⚠  Legacy databricks-cli Python package detected.
    echo     Uninstalling to avoid conflicts...
    pip uninstall databricks-cli -y
    echo     ✓ Legacy CLI removed.
) else (
    echo     ✓ No legacy CLI found.
)

echo.

REM Step 2: Install new CLI via winget
echo [2/4] Installing Databricks CLI via winget...
where databricks >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo     ✓ Databricks CLI already installed.
    databricks -v
) else (
    echo     Installing via winget...
    winget install Databricks.DatabricksCLI
    echo.
    echo     ⚠  IMPORTANT: Please restart your terminal after installation,
    echo        then re-run this script to complete authentication setup.
    echo.
    pause
    exit /b 0
)

echo.

REM Step 3: Verify version
echo [3/4] Verifying CLI version...
databricks -v
echo.

REM Step 4: Authenticate
echo [4/4] Setting up OAuth authentication...
echo     This will open a browser for Databricks login.
echo     Workspace: https://dbc-5c6e6e7d-7beb.cloud.databricks.com
echo.
databricks auth login --host https://dbc-5c6e6e7d-7beb.cloud.databricks.com
if %ERRORLEVEL% EQU 0 (
    echo.
    echo     ✓ Authentication successful!
    echo.
    echo  Verifying auth profile...
    databricks auth profiles
) else (
    echo.
    echo     ✗ Authentication failed. Try running manually:
    echo       databricks auth login --host https://dbc-5c6e6e7d-7beb.cloud.databricks.com
)

echo.
echo ============================================================
echo  Setup Complete!
echo.
echo  Next steps:
echo    1. Run: uv run start-app
echo    2. Open: http://localhost:8000
echo    3. A2A Agent Card: http://localhost:8000/.well-known/agent-card.json
echo ============================================================
echo.
pause

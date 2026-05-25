param(
    [switch]$NoBrowser
)

Write-Host "=== Expense Manager Startup Script ===" -ForegroundColor Green
Write-Host "Activating virtual environment..." -ForegroundColor Cyan

# Activate virtual environment
$venvPath = Join-Path $PSScriptRoot "venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
    Write-Host "✓ Virtual environment activated" -ForegroundColor Green
} else {
    Write-Host "❌ Virtual environment not found at: $venvPath" -ForegroundColor Red
    Write-Host "Please run: pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}

# Check if firebase-admin is installed
Write-Host "Checking dependencies..." -ForegroundColor Cyan
try {
    $firebaseCheck = & python -c "import firebase_admin; print('✓ firebase-admin is available')" 2>$null
    if ($firebaseCheck) {
        Write-Host $firebaseCheck -ForegroundColor Green
    }
} catch {
    Write-Host "❌ firebase-admin not installed. Installing..." -ForegroundColor Yellow
    & pip install firebase-admin==6.2.0
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ firebase-admin installed successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to install firebase-admin" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Starting Expense Manager..." -ForegroundColor Cyan
Write-Host "The application will be available at: http://127.0.0.1:5000" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the application
python app.py

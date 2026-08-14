param (
    [string]$Message = "",
    [switch]$BuildEAS = $false,
    [string]$ExpoToken = "avzL_H7hD0gdShJ1NpqXDltanaUyvdBmIpWO2xa0"
)

$ErrorActionPreference = "Continue"

$AppDir = $PSScriptRoot
if (Test-Path (Join-Path $PSScriptRoot "expense manager (web app)")) {
    $AppDir = Join-Path $PSScriptRoot "expense manager (web app)"
}
Push-Location $AppDir

try {

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  EXPENSE MANAGER -- MULTI-CLOUD SYNC WORKFLOW" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

if ([string]::IsNullOrWhiteSpace($Message)) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $Message = "chore: update web and mobile app ($timestamp)"
}

Write-Host "Commit Message: $Message" -ForegroundColor Yellow
Write-Host ""

# Step 1: Git Add & Commit
Write-Host "1. [GIT] Staging and committing changes..." -ForegroundColor Green
git add .
$status = git status --porcelain
if ($status) {
    git commit -m "$Message"
    Write-Host "   Changes committed successfully." -ForegroundColor Gray
} else {
    Write-Host "   No new changes to commit." -ForegroundColor Gray
}

# Step 2: Push to GitHub (Vercel auto-deploys from here)
Write-Host ""
Write-Host "2. [GITHUB / VERCEL] Pushing to GitHub origin/main..." -ForegroundColor Green
git push origin main 2>&1

# Step 3: Push to Hugging Face Spaces
Write-Host ""
Write-Host "3. [HUGGING FACE] Syncing to HuggingFace Space..." -ForegroundColor Green
try {
    if (Test-Path "hf_upload.py") {
        python hf_upload.py
    } else {
        git push hf main 2>&1
    }
} catch {
    Write-Host "   [Warning] Hugging Face Space sync skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Step 4: Optional EAS Cloud Build
if ($BuildEAS) {
    Write-Host ""
    Write-Host "4. [EXPO EAS] Triggering Android APK Cloud Build..." -ForegroundColor Green
    $env:EXPO_TOKEN = $ExpoToken
    Push-Location ".\mobile app"
    npx eas-cli build --platform android --profile preview --non-interactive
    Pop-Location
} else {
    Write-Host ""
    Write-Host "4. [EXPO EAS] Web updates are live immediately in the mobile app via Vercel WebView." -ForegroundColor Green
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ALL PLATFORMS SYNCHRONIZED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
}
finally {
    Pop-Location
}

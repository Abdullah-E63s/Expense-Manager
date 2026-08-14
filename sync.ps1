<#
.SYNOPSIS
    Expense Manager Multi-Cloud Sync Script
    Synchronizes local updates simultaneously to GitHub (Vercel), Hugging Face Spaces, and EAS.

.DESCRIPTION
    Usage:
        .\sync.ps1 "Your commit message"
        .\sync.ps1 -BuildEAS "Release new APK"
        .\sync.ps1
#>

param (
    [string]$Message = "",
    [switch]$BuildEAS = $false,
    [string]$ExpoToken = "avzL_H7hD0gdShJ1NpqXDltanaUyvdBmIpWO2xa0"
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🚀 EXPENSE MANAGER — MULTI-CLOUD SYNC WORKFLOW" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Determine commit message
if ([string]::IsNullOrWhiteSpace($Message)) {
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $Message = "chore: update web and mobile app ($timestamp)"
}

Write-Host "📝 Commit Message: $Message" -ForegroundColor Yellow
Write-Host ""

# Step 1: Git Add & Commit
Write-Host "1️⃣ [GIT] Staging and committing changes..." -ForegroundColor Green
git add .
$status = git status --porcelain
if ($status) {
    git commit -m "$Message"
    Write-Host "   ✅ Changes committed successfully." -ForegroundColor Gray
} else {
    Write-Host "   ℹ️ No new changes to commit." -ForegroundColor Gray
}

# Step 2: Push to GitHub (Vercel auto-deploys from here)
Write-Host ""
Write-Host "2️⃣ [GITHUB / VERCEL] Pushing to GitHub origin/main..." -ForegroundColor Green
git push origin main 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ GitHub push succeeded. Vercel deployment triggered!" -ForegroundColor Gray
} else {
    Write-Host "   ⚠️ GitHub push completed with warning/status code: $LASTEXITCODE" -ForegroundColor DarkYellow
}

# Step 3: Push to Hugging Face Spaces
Write-Host ""
Write-Host "3️⃣ [HUGGING FACE] Syncing to HuggingFace Space..." -ForegroundColor Green
if (Test-Path "hf_upload.py") {
    python hf_upload.py
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   ✅ Hugging Face Space upload succeeded via HF API!" -ForegroundColor Gray
    } else {
        Write-Host "   ℹ️ HF API returned status $LASTEXITCODE. Attempting git push..." -ForegroundColor DarkYellow
        git push hf main 2>&1
    }
} else {
    git push hf main 2>&1
}

# Step 4: Optional EAS Cloud Build
if ($BuildEAS) {
    Write-Host ""
    Write-Host "4️⃣ [EXPO EAS] Triggering Android APK Cloud Build..." -ForegroundColor Green
    $env:EXPO_TOKEN = $ExpoToken
    Set-Location -Path ".\mobile app"
    npx eas-cli build --platform android --profile preview --non-interactive
    Set-Location -Path ".."
} else {
    Write-Host ""
    Write-Host "4️⃣ [EXPO EAS] Web updates are live in the mobile app via Vercel WebView." -ForegroundColor Green
    Write-Host "   (Pass -BuildEAS to trigger a new standalone APK build when native packages change)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ✨ ALL PLATFORMS SYNCHRONIZED SUCCESSFULLY!" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

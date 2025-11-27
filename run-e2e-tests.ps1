#!/usr/bin/env pwsh

param(
    [Parameter(Position=0)]
    [ValidateSet('run', 'headed', 'ui', 'debug', 'report')]
    [string]$Mode = 'run',
    
    [switch]$Setup
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== Soccer App E2E Test Runner ===" -ForegroundColor Cyan
Write-Host ""

if ($Setup) {
    Write-Host "Running setup checks..." -ForegroundColor Yellow
    
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        npm install
    }
    
    Write-Host "Checking Playwright browsers..." -ForegroundColor Yellow
    npx playwright install chromium
    
    if (-not (Test-Path ".env.test")) {
        Write-Host ""
        Write-Host "WARNING: .env.test not found!" -ForegroundColor Red
        Write-Host "Creating from example..." -ForegroundColor Yellow
        Copy-Item .env.test.example .env.test -ErrorAction SilentlyContinue
        if (Test-Path ".env.test") {
            Write-Host "Created .env.test from example" -ForegroundColor Green
        }
    }
    
    Write-Host ""
    Write-Host "Checking AWS Amplify sandbox..." -ForegroundColor Yellow
    $sandboxCheck = Test-NetConnection -ComputerName localhost -Port 5173 -InformationLevel Quiet -WarningAction SilentlyContinue
    
    if (-not $sandboxCheck) {
        Write-Host ""
        Write-Host "WARNING: Development server not detected on port 5173" -ForegroundColor Red
        Write-Host "Make sure to run in another terminal:" -ForegroundColor Yellow
        Write-Host "  npm run dev" -ForegroundColor Cyan
        Write-Host "  npx ampx sandbox" -ForegroundColor Cyan
    } else {
        Write-Host "Dev server running on port 5173" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "Create test user automatically?" -ForegroundColor Yellow
    $createUser = Read-Host "(y/n)"
    if ($createUser -eq 'y') {
        Write-Host "Running Sandbox Seed" -ForegroundColor Yellow
        npx ampx sandbox seed
    }
    
    Write-Host ""
}

Write-Host "Running E2E tests in '$Mode' mode..." -ForegroundColor Green
Write-Host ""

switch ($Mode) {
    'run' { npm run test:e2e }
    'headed' { npm run test:e2e:headed }
    'ui' { npm run test:e2e:ui }
    'debug' { npm run test:e2e:debug }
    'report' { npm run test:e2e:report }
}

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "=== Tests Completed Successfully ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "View HTML report with: npm run test:e2e:report" -ForegroundColor Cyan
} else {
    Write-Host "=== Tests Failed ===" -ForegroundColor Red
    Write-Host ""
    Write-Host "Debug options:" -ForegroundColor Yellow
    Write-Host "  1. Run in headed mode: .\run-e2e-tests.ps1 headed" -ForegroundColor Cyan
    Write-Host "  2. Run in debug mode: .\run-e2e-tests.ps1 debug" -ForegroundColor Cyan
    Write-Host "  3. View report: .\run-e2e-tests.ps1 report" -ForegroundColor Cyan
}

Write-Host ""
exit $exitCode

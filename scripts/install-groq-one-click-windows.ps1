$ErrorActionPreference = 'Stop'

$StableRoot = Join-Path $env:LOCALAPPDATA 'GORIQ\setup'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Launcher = Join-Path $Desktop 'GORIQ Groq設定.cmd'

New-Item -ItemType Directory -Force -Path $StableRoot | Out-Null

$files = @(
  'configure-groq-free-secret-windows.ps1',
  'goriq-groq-repair.mjs',
  'invoke-node-with-groq-secret-windows.ps1'
)

foreach ($file in $files) {
  $source = Join-Path $PSScriptRoot $file
  if (-not (Test-Path -LiteralPath $source)) { throw "Required setup file missing: $file" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $StableRoot $file) -Force
}

$configure = Join-Path $StableRoot 'configure-groq-free-secret-windows.ps1'
$cmd = @"
@echo off
title GORIQ Groq Free Plan Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$configure"
echo.
pause
"@
Set-Content -LiteralPath $Launcher -Value $cmd -Encoding ASCII

Write-Host "GORIQ Groq setup launcher installed: $Launcher"

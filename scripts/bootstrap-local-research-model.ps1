param(
  [string]$Endpoint = $(if ($env:GAI_LOCAL_MODEL_ENDPOINT) { $env:GAI_LOCAL_MODEL_ENDPOINT } else { 'http://127.0.0.1:11434' }),
  [string]$Model = $(if ($env:GAI_LOCAL_MODEL_NAME) { $env:GAI_LOCAL_MODEL_NAME } else { 'qwen2.5:1.5b' })
)

$ErrorActionPreference = 'Stop'

function Write-GaiLog([string]$Message) {
  Write-Host "$(Get-Date -Format o) $Message"
}

function Test-OllamaApi {
  try {
    Invoke-RestMethod -Uri "$Endpoint/api/tags" -Method Get -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Resolve-OllamaExe {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  return ($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)
}

$ollamaExe = Resolve-OllamaExe
if (-not $ollamaExe) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'OLLAMA_INSTALLER_UNAVAILABLE: winget is not installed.'
  }
  Write-GaiLog 'Installing Ollama with winget.'
  & $winget.Source install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "OLLAMA_INSTALL_FAILED: winget exit $LASTEXITCODE" }
  $env:PATH += ";$env:LOCALAPPDATA\Programs\Ollama"
  $ollamaExe = Resolve-OllamaExe
  if (-not $ollamaExe) { throw 'OLLAMA_INSTALL_FAILED: executable not found after winget install.' }
}

if (-not (Test-OllamaApi)) {
  Write-GaiLog 'Starting ollama serve.'
  Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Test-OllamaApi) { break }
  }
}

if (-not (Test-OllamaApi)) { throw "OLLAMA_ENDPOINT_UNAVAILABLE: $Endpoint" }

$tags = Invoke-RestMethod -Uri "$Endpoint/api/tags" -Method Get -TimeoutSec 10
$installed = @($tags.models | ForEach-Object { $_.name }) -contains $Model
if (-not $installed) {
  Write-GaiLog "Pulling $Model for local research smoke tests."
  & $ollamaExe pull $Model
  if ($LASTEXITCODE -ne 0) { throw "OLLAMA_MODEL_PULL_FAILED: exit $LASTEXITCODE" }
}

Write-GaiLog "Local research model ready: $Model"

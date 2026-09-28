param(
  [string]$LocalFastModel = 'qwen2.5-coder:1.5b',
  [string]$LocalStrongModel = 'qwen2.5-coder:3b',
  [string]$CloudFreeModel = 'gpt-oss:20b-cloud'
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'GORIQ\repair-engines'
$statusPath = Join-Path $root 'status.json'
New-Item -ItemType Directory -Force -Path $root | Out-Null

function Resolve-Ollama {
  $cmd = Get-Command ollama -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $candidate) { return $candidate }
  return $null
}

$ollama = Resolve-Ollama
$installedNow = $false
if (-not $ollama) {
  Write-Host 'Ollama not found. Installing with the official Windows installer script from ollama.com...'
  $script = Invoke-RestMethod -Uri 'https://ollama.com/install.ps1' -TimeoutSec 30
  if (-not $script -or $script.Length -lt 100) { throw 'Official Ollama install script download failed.' }
  Invoke-Expression $script
  $installedNow = $true
  Start-Sleep -Seconds 3
  $ollama = Resolve-Ollama
}
if (-not $ollama) { throw 'Ollama installation completed but ollama.exe was not found.' }

function Test-OllamaApi {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 2
    return $null -ne $r
  } catch { return $false }
}

if (-not (Test-OllamaApi)) {
  Start-Process -FilePath $ollama -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
  for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-OllamaApi) { break }
  }
}
if (-not (Test-OllamaApi)) { throw 'Ollama API did not become ready on 127.0.0.1:11434.' }

$pullResults = @()
foreach ($model in @($LocalFastModel, $LocalStrongModel)) {
  Write-Host "Pulling local repair model: $model"
  $output = & $ollama pull $model 2>&1 | Out-String
  $ok = $LASTEXITCODE -eq 0
  $pullResults += [ordered]@{ model = $model; ok = $ok; outputTail = $output.Substring([Math]::Max(0, $output.Length - 1200)) }
  if (-not $ok) { throw "Failed to pull required local repair model: $model" }
}

$cloudReady = $false
$cloudProbe = ''
try {
  $cloudProbe = (& $ollama pull $CloudFreeModel 2>&1 | Out-String)
  $cloudReady = $LASTEXITCODE -eq 0
} catch {
  $cloudProbe = $_.Exception.Message
}

$version = (& $ollama --version 2>&1 | Out-String).Trim()
$tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5
$models = @($tags.models | ForEach-Object { $_.name })

$status = [ordered]@{
  ok = $true
  installedNow = $installedNow
  ollamaPath = $ollama
  ollamaVersion = $version
  apiReady = $true
  localFastModel = $LocalFastModel
  localStrongModel = $LocalStrongModel
  requiredLocalModelsPresent = (($LocalFastModel -in $models) -and ($LocalStrongModel -in $models))
  cloudFreeModel = $CloudFreeModel
  cloudFreeReady = $cloudReady
  cloudProbeTail = $cloudProbe.Substring([Math]::Max(0, $cloudProbe.Length - 1200))
  models = $models
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $statusPath
$status | ConvertTo-Json -Depth 8

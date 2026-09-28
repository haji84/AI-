param(
  [string]$LocalFastModel = 'qwen2.5-coder:1.5b',
  [string]$LocalStrongModel = 'qwen2.5-coder:3b'
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

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )

  $stdoutPath = Join-Path $env:TEMP ("goriq-native-stdout-" + [guid]::NewGuid().ToString('N') + ".log")
  $stderrPath = Join-Path $env:TEMP ("goriq-native-stderr-" + [guid]::NewGuid().ToString('N') + ".log")
  try {
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue } else { '' }
    $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue } else { '' }
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = [string]$stdout
      Stderr = [string]$stderr
      Combined = (([string]$stdout) + [Environment]::NewLine + ([string]$stderr)).Trim()
    }
  } finally {
    Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  }
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
  $pull = Invoke-NativeCapture -FilePath $ollama -Arguments @('pull', $model)
  $ok = $pull.ExitCode -eq 0
  $tail = $pull.Combined
  if ($tail.Length -gt 1200) { $tail = $tail.Substring($tail.Length - 1200) }
  $pullResults += [ordered]@{ model = $model; ok = $ok; exitCode = $pull.ExitCode; outputTail = $tail }
  if (-not $ok) { throw "Failed to pull required local repair model: $model (exit $($pull.ExitCode)): $tail" }
}

$versionResult = Invoke-NativeCapture -FilePath $ollama -Arguments @('--version')
if ($versionResult.ExitCode -ne 0) { throw "ollama --version failed with exit $($versionResult.ExitCode)" }
$version = $versionResult.Combined.Trim()
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
  models = $models
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $statusPath
$status | ConvertTo-Json -Depth 8

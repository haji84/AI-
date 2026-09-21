param(
  [string]$WorkerId = 'zbook',
  [int]$Port = 8796,
  [string]$Workspace = '',
  [string]$Engine = '',
  [int]$ExecTimeoutMs = 600000
)

$ErrorActionPreference = 'Stop'

if (-not $Workspace) {
  $Workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$root = Join-Path $env:LOCALAPPDATA 'GAIWorker\code-builder'
$serviceSource = (Resolve-Path (Join-Path $PSScriptRoot 'code-builder-worker-service.ts')).Path
$servicePath = Join-Path $root 'code-builder-worker-service.ts'
$launcherPath = Join-Path $root 'run-code-builder.ps1'
$tokenPath = Join-Path $root 'token.txt'
$logPath = Join-Path $root 'worker.log'
$stdoutPath = Join-Path $root 'worker.stdout.log'
$stderrPath = Join-Path $root 'worker.stderr.log'
$pidPath = Join-Path $root 'worker.pid'
$statusPath = Join-Path $root 'install-status.json'
$taskName = 'GAI Code Builder Worker'

New-Item -ItemType Directory -Force -Path $root | Out-Null
Copy-Item -Force $serviceSource $servicePath

$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = (& $node --version 2>&1 | Out-String).Trim()

if (-not (Test-Path $tokenPath)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -NoNewline -Encoding ascii $tokenPath
}
$token = (Get-Content $tokenPath -Raw).Trim()

function Resolve-PreferredEnginePath {
  param([System.Management.Automation.CommandInfo]$Command)

  $source = [string]$Command.Source
  if ($source -match '\.ps1$') {
    $cmdSibling = [IO.Path]::ChangeExtension($source, 'cmd')
    if (Test-Path $cmdSibling) {
      return $cmdSibling
    }
  }
  return $source
}

$detected = @()
foreach ($candidate in @('codex','aider')) {
  $commandInfo = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($commandInfo) {
    $detected += [ordered]@{
      id = $candidate
      path = (Resolve-PreferredEnginePath -Command $commandInfo)
    }
  }
}

if ($Engine -and -not (Get-Command $Engine -ErrorAction SilentlyContinue)) {
  throw "Requested engine is not installed or not on PATH"
}

$selectedEngine = ''
if ($Engine) {
  $selectedEngine = Resolve-PreferredEnginePath -Command (Get-Command $Engine -ErrorAction Stop)
} elseif ($detected.Count -gt 0) {
  $selectedEngine = [string]$detected[0].path
}

$launcherLines = @(
  '$ErrorActionPreference = ''Stop''',
  'Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue',
  '$env:GAI_WORKER_ID = ''' + $WorkerId + '''',
  '$env:CODE_BUILDER_HOST = ''127.0.0.1''',
  '$env:CODE_BUILDER_PORT = ''' + $Port + '''',
  '$env:CODE_BUILDER_TOKEN = ''' + $token + '''',
  '$env:CODE_BUILDER_WORKSPACE = ''' + $Workspace + '''',
  '$env:CODE_BUILDER_ENGINE = ''' + $selectedEngine + '''',
  '$env:CODE_BUILDER_EXEC_TIMEOUT_MS = ''' + $ExecTimeoutMs + '''',
  'Set-Content -Encoding ascii ''' + $pidPath + ''' $PID',
  '& ''' + $node + ''' ''' + $servicePath + ''' *>> ''' + $logPath + ''''
)
Set-Content -Encoding UTF8 -Path $launcherPath -Value ($launcherLines -join [Environment]::NewLine)

$taskArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description 'GAI bounded code builder worker' -Force | Out-Null

if (Test-Path $pidPath) {
  $oldPid = (Get-Content $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
}

$previousEnv = [ordered]@{
  GAI_WORKER_ID = $env:GAI_WORKER_ID
  CODE_BUILDER_HOST = $env:CODE_BUILDER_HOST
  CODE_BUILDER_PORT = $env:CODE_BUILDER_PORT
  CODE_BUILDER_TOKEN = $env:CODE_BUILDER_TOKEN
  CODE_BUILDER_WORKSPACE = $env:CODE_BUILDER_WORKSPACE
  CODE_BUILDER_ENGINE = $env:CODE_BUILDER_ENGINE
  CODE_BUILDER_EXEC_TIMEOUT_MS = $env:CODE_BUILDER_EXEC_TIMEOUT_MS
  RUNNER_TRACKING_ID = $env:RUNNER_TRACKING_ID
}

try {
  $env:GAI_WORKER_ID = $WorkerId
  $env:CODE_BUILDER_HOST = '127.0.0.1'
  $env:CODE_BUILDER_PORT = [string]$Port
  $env:CODE_BUILDER_TOKEN = $token
  $env:CODE_BUILDER_WORKSPACE = $Workspace
  $env:CODE_BUILDER_ENGINE = $selectedEngine
  $env:CODE_BUILDER_EXEC_TIMEOUT_MS = [string]$ExecTimeoutMs
  Remove-Item Env:RUNNER_TRACKING_ID -ErrorAction SilentlyContinue

  Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $node -ArgumentList @($servicePath) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  Set-Content -Encoding ascii $pidPath $process.Id
} finally {
  foreach ($name in $previousEnv.Keys) {
    $value = $previousEnv[$name]
    if ($null -eq $value) {
      Remove-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path ("Env:" + $name) -Value $value
    }
  }
}

$healthy = $false
$health = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $headers = @{ Authorization = "Bearer $token" }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Headers $headers -Method Get -TimeoutSec 2
    if ($health.ok -eq $true -and @($health.capabilities) -contains 'code-builder') {
      $healthy = $true
      break
    }
  } catch {}
}

$taskState = $null
$lastTaskResult = $null
try {
  $scheduledTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $taskState = [string]$scheduledTask.State
  $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  $lastTaskResult = $taskInfo.LastTaskResult
} catch {}

$pidValue = $null
$processAlive = $false
if (Test-Path $pidPath) {
  $pidValue = (Get-Content $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
  if ($pidValue -match '^\d+$') {
    $processAlive = $null -ne (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue)
  }
}

$stdoutTail = ''
$stderrTail = ''
if (Test-Path $stdoutPath) {
  $stdoutTail = (Get-Content $stdoutPath -Tail 40 -ErrorAction SilentlyContinue | Out-String).Trim()
}
if (Test-Path $stderrPath) {
  $stderrTail = (Get-Content $stderrPath -Tail 80 -ErrorAction SilentlyContinue | Out-String).Trim()
}

$status = [ordered]@{
  ok = $healthy
  workerId = $WorkerId
  port = $Port
  workspace = $Workspace
  nodePath = $node
  nodeVersion = $nodeVersion
  execTimeoutMs = $ExecTimeoutMs
  configuredEngine = $selectedEngine
  detectedEngines = $detected
  activeEngine = $(if ($health) { $health.engine } else { $null })
  capabilities = $(if ($health) { $health.capabilities } else { @() })
  processId = $pidValue
  processAlive = $processAlive
  stdoutTail = $stdoutTail
  stderrTail = $stderrTail
  taskName = $taskName
  taskState = $taskState
  lastTaskResult = $lastTaskResult
  pidPath = $pidPath
  root = $root
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$status | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $statusPath
$status | ConvertTo-Json -Depth 6

if (-not $healthy) {
  exit 2
}

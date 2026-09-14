param(
  [string]$WorkerId = 'zbook',
  [int]$Port = 8795,
  [string]$ModelEndpoint = 'http://127.0.0.1:11434',
  [string]$ModelName = 'qwen2.5:1.5b'
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'GAIWorker\research-worker'
$serviceSource = Join-Path (Resolve-Path (Join-Path $PSScriptRoot 'research-worker-service.ts')) ''
$servicePath = Join-Path $root 'research-worker-service.ts'
$launcherPath = Join-Path $root 'run-research-worker.ps1'
$tokenPath = Join-Path $root 'token.txt'
$pidPath = Join-Path $root 'worker.pid'
$statusPath = Join-Path $root 'install-status.json'
$logPath = Join-Path $root 'worker.log'
$taskName = 'GAI Research Worker'

New-Item -ItemType Directory -Force -Path $root | Out-Null
Copy-Item -Force $serviceSource $servicePath

$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path $tokenPath)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Content -NoNewline -Encoding ascii $tokenPath
}
$token = (Get-Content $tokenPath -Raw).Trim()

$launcher = @"
`$ErrorActionPreference = 'Stop'
`$env:GAI_WORKER_ID = '$WorkerId'
`$env:GAI_LOCAL_MODEL_ENDPOINT = '$ModelEndpoint'
`$env:GAI_LOCAL_MODEL_NAME = '$ModelName'
`$env:RESEARCH_WORKER_HOST = '127.0.0.1'
`$env:RESEARCH_WORKER_PORT = '$Port'
`$env:RESEARCH_WORKER_TOKEN = '$token'
Set-Content -Encoding ascii '$pidPath' `$PID
& '$node' '$servicePath' *>> '$logPath'
"@
Set-Content -Encoding UTF8 -Path $launcherPath -Value $launcher

if (Test-Path $pidPath) {
  $oldPid = Get-Content $pidPath -ErrorAction SilentlyContinue
  if ($oldPid -match '^\d+$') { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
}

$scheduled = $false
try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description 'GAI resident Research Worker' -Force | Out-Null
  $scheduled = $true
} catch {
  $startup = [Environment]::GetFolderPath('Startup')
  $fallback = Join-Path $startup 'GAI Research Worker.cmd'
  "@echo off`r`nstart `"`" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`"`r`n" | Set-Content -Encoding ascii $fallback
}

Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$launcherPath -WindowStyle Hidden

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -Method Get -TimeoutSec 2
    if ($health.ok -eq $true) { $healthy = $true; break }
  } catch {}
}

$status = [ordered]@{
  ok = $healthy
  workerId = $WorkerId
  platform = 'windows'
  port = $Port
  modelEndpoint = $ModelEndpoint
  model = $ModelName
  persistence = $(if ($scheduled) { 'scheduled-task' } else { 'startup-folder' })
  root = $root
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $statusPath
$status | ConvertTo-Json -Depth 4
if (-not $healthy) { exit 2 }

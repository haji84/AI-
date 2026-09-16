param(
  [Parameter(Mandatory=$true)][string]$ReleaseRoot,
  [Parameter(Mandatory=$true)][string]$SettingsPath,
  [Parameter(Mandatory=$true)][string]$AuthorizationPath,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskName = 'JARVIS Remote Host'
if (-not $Apply) {
  Write-Output 'PLAN ONLY: save owner-scoped DPAPI configuration outside repo and register Limited owner boot/logon task; no firewall changes.'
  Write-Output 'Apply requires separate approval for credential persistence and Windows task permissions. Windows owner password is entered only in the local credential dialog.'
  exit 0
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Explicit Windows elevation required' }
$ReleaseRoot = (Resolve-Path -LiteralPath $ReleaseRoot).Path
$manifest = Get-Content -LiteralPath (Join-Path $ReleaseRoot 'jarvis-release.json') -Raw | ConvertFrom-Json
$authorization = Get-Content -LiteralPath $AuthorizationPath -Raw | ConvertFrom-Json
if ($authorization.ownerSid -ne $identity.User.Value) { throw 'Installation must run as the approved Windows owner' }
if ($authorization.scopeId -ne 'issue:786' -or $authorization.commit -ne $manifest.commit -or $authorization.mainCi -ne 'success' -or $authorization.credentialAndTaskApproval -ne $true -or [datetimeoffset]::Parse($authorization.expiresAt) -le [datetimeoffset]::Now) { throw 'Exact release authorization and separate credential/task approval required' }
if (-not (Test-Path -LiteralPath (Join-Path $ReleaseRoot '.next/BUILD_ID'))) { throw 'Production build missing' }
$settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Existing task requires reviewed update; refusing overwrite' }
$stateRoot = Join-Path $env:LOCALAPPDATA 'JARVIS/production'
$configPath = Join-Path $stateRoot 'config.dpapi'
if (Test-Path -LiteralPath $configPath) { throw 'Production configuration already exists; refusing credential rotation' }
foreach ($port in @(3000,3098,8787,8790,8792)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw 'Stop the reviewed trial stack before production setup; no process will be killed automatically' }
}
$windowsCredential = Get-Credential -UserName $identity.Name -Message 'JARVIS boot startup: enter this Windows account password locally (not a PIN).'
if (-not $windowsCredential -or $windowsCredential.UserName -ine $identity.Name) { throw 'The same Windows owner identity is required' }
function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
}
$ownerCode = New-LocalSecret
$environment = @{}
foreach ($property in $settings.environment.PSObject.Properties) { $environment[$property.Name] = [string]$property.Value }
$environment.JARVIS_OWNER_SECRET = $ownerCode
$environment.JARVIS_OWNER_TOKEN = New-LocalSecret
$environment.JARVIS_REMOTE_GATEWAY_TOKEN = New-LocalSecret
$config = @{version=1;releaseRoot=$ReleaseRoot;commit=$manifest.commit;environment=$environment} | ConvertTo-Json -Depth 5 -Compress
# Validate without logging credentials; JavaScript reads the candidate through stdin.
$config | & $node (Join-Path $ReleaseRoot 'scripts/validate-jarvis-production-config.mjs') $ReleaseRoot
if ($LASTEXITCODE -ne 0) { throw 'Production settings validation failed' }
if (-not (Test-Path -LiteralPath $environment.JARVIS_DB_PATH)) { throw 'Preserved Broker database missing' }
foreach ($file in @($environment.JARVIS_PRIVATE_WORKER_CERT_PATH,$environment.JARVIS_PRIVATE_WORKER_KEY_PATH,$environment.JARVIS_ADB_PATH)) { if (-not (Test-Path -LiteralPath $file)) { throw 'Required installation file missing' } }
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in @($identity.User.Value,'S-1-5-18')) {
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.SecurityIdentifier]$sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $stateRoot -AclObject $acl
$config | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $configPath
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $ReleaseRoot 'scripts/jarvis-remote-host.mjs') + '"') -WorkingDirectory $ReleaseRoot
$triggers = @(New-ScheduledTaskTrigger -AtStartup; New-ScheduledTaskTrigger -AtLogOn -User $identity.Name)
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 20 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $taskSettings -User $identity.Name -Password $windowsCredential.GetNetworkCredential().Password -RunLevel Limited | Out-Null
Start-ScheduledTask -TaskName $taskName
# Display once locally, never write the owner code into shell output, repository or logs.
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("JARVIS owner login code (save privately):`n`n$ownerCode",'JARVIS production login') | Out-Null
$ownerCode=$null; $config=$null; $windowsCredential=$null
Write-Output 'Production startup installed. Verify owner login, signed Worker reconnect, process recovery and actual reboot separately.'

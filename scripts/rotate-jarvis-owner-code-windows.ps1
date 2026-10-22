[CmdletBinding()]
param(
  [switch]$Apply,
  [string]$AuthorizationPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = Join-Path $PSHOME 'Modules'

if (-not $Apply) {
  Write-Output 'PLAN ONLY: Owner-local credential rotation requires a separate, unexpired issue:1218 approval receipt. No credential or task was changed.'
  exit 0
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $AuthorizationPath -or -not (Test-Path -LiteralPath $AuthorizationPath -PathType Leaf)) { throw 'authorization unavailable' }
  $authorization = Get-Content -LiteralPath $AuthorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($authorization.scopeId -ne 'issue:1218' -or
      $authorization.ownerSid -ne $identity.User.Value -or
      $authorization.credentialRotationApproval -ne $true -or
      [datetimeoffset]::Parse($authorization.expiresAt) -le [datetimeoffset]::Now -or
      $authorization.configSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'authorization mismatch' }

  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $reader = Join-Path $scriptRoot 'read-jarvis-production-config.ps1'
  $validator = Join-Path $scriptRoot 'validate-jarvis-production-config.mjs'
  $configPath = if ($env:JARVIS_PRODUCTION_CONFIG) { $env:JARVIS_PRODUCTION_CONFIG } else {
    $nativePath = Join-Path $env:USERPROFILE 'JARVIS\production\config.dpapi'
    if (Test-Path -LiteralPath $nativePath) { $nativePath } else { Join-Path $env:LOCALAPPDATA 'JARVIS\production\config.dpapi' }
  }
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf) -or
      -not (Test-Path -LiteralPath $reader -PathType Leaf) -or
      -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'production configuration unavailable' }
  $configPath = (Resolve-Path -LiteralPath $configPath).Path
  if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ine $authorization.configSha256) { throw 'configuration changed since approval' }
  $taskName = 'JARVIS Remote Host'
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  if ($task.State -ne 'Running') { throw 'production task is not running' }
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stateRoot = Split-Path -Parent $configPath
  Add-Type -AssemblyName System.Windows.Forms
  $choice = [System.Windows.Forms.MessageBox]::Show(
    'Change the Production Owner login code? Existing Owner sessions will end. The Worker identities and Broker database will not be changed.',
    'Confirm Owner credential rotation',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2
  )
  if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) { Write-Output 'Rotation cancelled; no credential changed.'; exit 0 }

  $consumeConfiguration = {
    param($configuration)
    $originalCode = [string]$configuration.environment.JARVIS_OWNER_SECRET
    if ($originalCode.Length -lt 24 -or $originalCode -match "[\r\n\0]") { throw 'invalid owner credential' }
    $releaseRoot = [string]$configuration.releaseRoot
    $random = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($random) } finally { $rng.Dispose() }
    $newCode = [Convert]::ToBase64String($random)
    $configuration.environment.JARVIS_OWNER_SECRET = $newCode
    $candidateJson = $configuration | ConvertTo-Json -Depth 10 -Compress
    $candidateJson | & $node $validator $releaseRoot $stateRoot | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'candidate configuration invalid' }

    $nonce = [Guid]::NewGuid().ToString('N')
    $candidatePath = Join-Path $stateRoot ("config.dpapi.$nonce.candidate")
    $backupPath = Join-Path $stateRoot ("config.dpapi.$nonce.backup")
    $failedPath = Join-Path $stateRoot ("config.dpapi.$nonce.failed")
    $replaced = $false
    function Test-LocalOwnerLogin([string]$code) {
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { continue }
        try {
          $response = Invoke-WebRequest -UseBasicParsing -Method POST -Uri 'http://127.0.0.1:3000/api/owner-login' -Headers @{ Accept = 'application/json' } -Body @{ passcode = $code } -TimeoutSec 3
          if ($response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).ok -eq $true) { return $true }
        } catch { }
      }
      return $false
    }
    try {
      $encrypted = $candidateJson | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
      Set-Content -LiteralPath $candidatePath -Value $encrypted -Encoding ASCII -NoNewline
      Set-Acl -LiteralPath $candidatePath -AclObject (Get-Acl -LiteralPath $configPath)
      # File.Replace keeps the old encrypted config in the protected backup path.
      [IO.File]::Replace($candidatePath, $configPath, $backupPath, $true)
      $replaced = $true
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
      Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
      if (-not (Test-LocalOwnerLogin $newCode)) { throw 'new Owner login verification failed' }
    } catch {
      if ($replaced) {
        try {
          [IO.File]::Replace($backupPath, $configPath, $failedPath, $true)
          Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
          Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
          if (-not (Test-LocalOwnerLogin $originalCode)) { throw 'old Owner login verification failed after rollback' }
        } catch { throw 'Rotation failed; automatic rollback failed. Preserve encrypted backup and inspect locally.' }
      }
      throw 'Rotation failed; original encrypted configuration restored when replacement occurred.'
    } finally {
      if (Test-Path -LiteralPath $candidatePath) { Remove-Item -LiteralPath $candidatePath -Force }
      $candidateJson = $null
      $encrypted = $null
    }
    # Only after the new login has passed; nothing secret is written to stdout.
    try {
      [System.Windows.Forms.MessageBox]::Show(
        "New Owner login code (save privately):`r`n`r`n$newCode`r`n`r`nEncrypted backup: $backupPath",
        'JARVIS production login',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
    } catch { throw 'Rotation succeeded, but local display failed. Recover the new code with owner-code-windows.ps1 -Reveal.' }
    $newCode = $null
    $originalCode = $null
  }.GetNewClosure()

  & $reader -Path $configPath -ConfigurationConsumer $consumeConfiguration
  Write-Output 'Owner credential rotation verified locally. Preserve the encrypted backup until separately reviewed.'
} catch {
  [Console]::Error.WriteLine('Owner credential rotation unavailable or failed. Check the local encrypted config and task before retrying.')
  exit 1
}

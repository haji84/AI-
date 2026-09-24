[CmdletBinding()]
param(
  [switch]$Reveal,
  [switch]$Copy
)

$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$ownerCode = $null
$configuration = $null
$decrypted = $null

try {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $reader = Join-Path $scriptRoot 'read-jarvis-production-config.ps1'
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

  if ($env:JARVIS_PRODUCTION_CONFIG) {
    $configPath = $env:JARVIS_PRODUCTION_CONFIG
  } else {
    $nativePath = Join-Path $env:USERPROFILE 'JARVIS\production\config.dpapi'
    if (Test-Path -LiteralPath $nativePath) {
      $configPath = $nativePath
    } else {
      $configPath = Join-Path $env:LOCALAPPDATA 'JARVIS\production\config.dpapi'
    }
  }

  if (-not (Test-Path -LiteralPath $reader -PathType Leaf) -or
      -not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'unavailable'
  }

  # The dedicated reader owns DPAPI CurrentUser decryption. Capture its output so
  # neither the JSON nor any credential is forwarded to this process's output.
  $decrypted = & $powershell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $reader -Path $configPath 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $decrypted) { throw 'unavailable' }

  $configuration = $decrypted | ConvertFrom-Json
  $ownerCode = [string]$configuration.environment.JARVIS_OWNER_SECRET
  if ([string]::IsNullOrWhiteSpace($ownerCode) -or $ownerCode.Length -lt 24 -or $ownerCode -match "[\r\n\0]") {
    throw 'unavailable'
  }

  Add-Type -AssemblyName System.Windows.Forms
  if ($Reveal) {
    [System.Windows.Forms.MessageBox]::Show(
      "JARVIS owner login code (keep private):`r`n`r`n$ownerCode",
      'JARVIS production login',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  } else {
    $masked = [string]::new([char]0x2022, [Math]::Min($ownerCode.Length, 12))
    [System.Windows.Forms.MessageBox]::Show(
      "JARVIS owner login code:`r`n`r`n$masked`r`n`r`nRun with -Reveal only when you need to view it locally.",
      'JARVIS production login',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  }

  if ($Copy) {
    $choice = [System.Windows.Forms.MessageBox]::Show(
      'Copy the owner login code to this PC clipboard? Clipboard contents may be visible to other local applications.',
      'Confirm local clipboard copy',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning,
      [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
      [System.Windows.Forms.Clipboard]::SetText($ownerCode)
      [System.Windows.Forms.MessageBox]::Show(
        'Owner login code copied to this PC clipboard.',
        'JARVIS production login',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
    }
  }
} catch {
  [Console]::Error.WriteLine('Owner login code unavailable for this Windows identity.')
  exit 1
} finally {
  $ownerCode = $null
  $configuration = $null
  $decrypted = $null
}

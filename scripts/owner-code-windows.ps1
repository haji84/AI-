[CmdletBinding()]
param(
  [switch]$Reveal,
  [switch]$Copy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = Join-Path $PSHOME 'Modules'

try {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $reader = Join-Path $scriptRoot 'read-jarvis-production-config.ps1'

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

  # Capture the requested actions before the callback crosses into the reader
  # script's scope. The reader performs DPAPI decryption, schema validation,
  # and narrow selection; the callback receives no other production token.
  $consumeOwnerCode = {
    param([string]$ownerCode)
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
    $ownerCode = $null
  }.GetNewClosure()

  & $reader -Path $configPath -OwnerLoginCode -OwnerLoginCodeConsumer $consumeOwnerCode 2>$null
} catch {
  [Console]::Error.WriteLine('Owner login code unavailable for this Windows identity.')
  exit 1
}

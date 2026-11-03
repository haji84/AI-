[CmdletBinding()]
param(
  [switch]$Reveal,
  [switch]$Copy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = Join-Path $PSHOME 'Modules'

function Set-OwnerLocalClipboard {
  param([Parameter(Mandatory=$true)][string]$OwnerCode)
  Add-Type -AssemblyName System.Windows.Forms
  $data = New-Object System.Windows.Forms.DataObject
  $exclude = New-Object IO.MemoryStream
  try {
    # Windows documents this registered format as excluding every clipboard
    # format from both clipboard history and cross-device synchronization.
    $exclude.WriteByte(0)
    $exclude.Position = 0
    $data.SetText($OwnerCode, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    $data.SetData('ExcludeClipboardContentFromMonitorProcessing', $false, $exclude)
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  } finally {
    $exclude.Dispose()
    $OwnerCode = $null
  }
}

function Show-OwnerCodeDialog {
  param([Parameter(Mandatory=$true)][string]$OwnerCode)
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object System.Windows.Forms.Form
  $field = New-Object System.Windows.Forms.TextBox
  $copyToClipboard = ${function:Set-OwnerLocalClipboard}
  try {
    $form.Name = 'OwnerCodeDialog'
    $form.Text = 'GORIQ Owner login code'
    $form.ClientSize = New-Object System.Drawing.Size(540, 210)
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $notice = New-Object System.Windows.Forms.Label
    $notice.Text = 'Keep this code private. Copy uses this PC clipboard; other local apps may read it.'
    $notice.Location = New-Object System.Drawing.Point(20, 15)
    $notice.Size = New-Object System.Drawing.Size(500, 35)
    $form.Controls.Add($notice)
    $field.Name = 'OwnerCodeValue'
    $field.Location = New-Object System.Drawing.Point(20, 55)
    $field.Size = New-Object System.Drawing.Size(500, 25)
    $field.ReadOnly = $true
    $field.UseSystemPasswordChar = $true
    $field.Text = $OwnerCode
    $form.Controls.Add($field)
    $show = New-Object System.Windows.Forms.Button
    $show.Name = 'OwnerCodeReveal'
    $show.Text = -join @([char]0x8868, [char]0x793A)
    $show.Location = New-Object System.Drawing.Point(20, 95)
    $show.Size = New-Object System.Drawing.Size(120, 35)
    $show.Add_Click({
      $field.UseSystemPasswordChar = -not $field.UseSystemPasswordChar
      $show.Text = if ($field.UseSystemPasswordChar) { -join @([char]0x8868, [char]0x793A) } else { -join @([char]0x975E, [char]0x8868, [char]0x793A) }
    }.GetNewClosure())
    $form.Controls.Add($show)
    $status = New-Object System.Windows.Forms.Label
    $status.Name = 'OwnerCodeStatus'
    $status.Location = New-Object System.Drawing.Point(20, 145)
    $status.Size = New-Object System.Drawing.Size(500, 40)
    $copyButton = New-Object System.Windows.Forms.Button
    $copyButton.Name = 'OwnerCodeCopy'
    $copyButton.Text = -join @([char]0x30B3, [char]0x30D4, [char]0x30FC)
    $copyButton.Location = New-Object System.Drawing.Point(155, 95)
    $copyButton.Size = New-Object System.Drawing.Size(120, 35)
    $copyButton.Add_Click({
      try {
        & $copyToClipboard -OwnerCode $OwnerCode
        $status.Text = 'Copied to this PC clipboard.'
      } catch {
        $status.Text = 'Clipboard unavailable; no code was logged. Try again locally.'
      }
    }.GetNewClosure())
    $form.Controls.Add($copyButton)
    $form.Controls.Add($status)
    $form.Add_Deactivate({ $field.UseSystemPasswordChar = $true }.GetNewClosure())
    $form.ShowDialog() | Out-Null
  } finally {
    $field.Clear()
    $form.Dispose()
    $OwnerCode = $null
  }
}

# Loading the dialog definition is safe for packaging and public-fixture tests.
# Executing the utility still reads only the existing protected config below.
if ($MyInvocation.InvocationName -eq '.') { return }

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
  $copyToClipboard = ${function:Set-OwnerLocalClipboard}
  $showOwnerDialog = ${function:Show-OwnerCodeDialog}
  $consumeOwnerCode = {
    param([string]$ownerCode)
    if (-not $Reveal -and -not $Copy) {
      & $showOwnerDialog -OwnerCode $ownerCode
      $ownerCode = $null
      return
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
        & $copyToClipboard -OwnerCode $ownerCode
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

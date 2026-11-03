$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
# Public fixture only. No DPAPI/config/env lookup or production action.
$dummy = 'PUBLIC-DUMMY-OWNER-CODE-1234567890'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('owner-dialog-' + [Guid]::NewGuid().ToString('N'))
$fixtureConfig = Join-Path $fixtureRoot 'public-fixture.dpapi'
$oldOverride = $env:JARVIS_PRODUCTION_CONFIG
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
@{environment=@{JARVIS_OWNER_SECRET=$dummy;JARVIS_OWNER_TOKEN='PUBLIC-UNRELATED-FIXTURE-MUST-NOT-DISPLAY'}} | ConvertTo-Json -Depth 3 -Compress | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $fixtureConfig
$env:JARVIS_PRODUCTION_CONFIG = $fixtureConfig
$observed = @{masked=$false;revealed=$false;hiddenAgain=$false;remaskedOnDeactivate=$false;copied=$false;confirmed=$false;localClipboardOnly=$false;clearedOnClose=$false}
$state = @{failure=$null;ticks=0;field=$null}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
 try {
  $state.ticks++
  $form = @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_.Name -eq 'OwnerCodeDialog' }) | Select-Object -First 1
  if (-not $form) { if ($state.ticks -gt 30) { throw 'DIALOG_NOT_OPEN' }; return }
  $field = $form.Controls.Find('OwnerCodeValue',$true)[0]
  $show = $form.Controls.Find('OwnerCodeReveal',$true)[0]
  $copy = $form.Controls.Find('OwnerCodeCopy',$true)[0]
  $status = $form.Controls.Find('OwnerCodeStatus',$true)[0]
  $state.field = $field
  $observed.masked = $field.UseSystemPasswordChar -and $field.Text -ceq $dummy
  $show.PerformClick()
  $observed.revealed = -not $field.UseSystemPasswordChar -and $field.Text -ceq $dummy
  $form.GetType().GetMethod('OnDeactivate', [Reflection.BindingFlags]'Instance,NonPublic').Invoke($form, @([EventArgs]::Empty)) | Out-Null
  $observed.remaskedOnDeactivate = $field.UseSystemPasswordChar -and $show.Text -ceq (-join @([char]0x8868,[char]0x793A))
  $show.PerformClick()
  if ($field.UseSystemPasswordChar) { throw 'REVEAL_ACTION_CHANGED_AFTER_DEACTIVATION' }
  $show.PerformClick()
  $observed.hiddenAgain = $field.UseSystemPasswordChar
  [System.Windows.Forms.Clipboard]::SetText('PUBLIC-FIXTURE-BEFORE')
  $copy.PerformClick()
  $observed.copied = [System.Windows.Forms.Clipboard]::GetText() -ceq $dummy
  $observed.confirmed = $status.Text -ceq 'Copied to this PC clipboard.'
  $clipboardData = [System.Windows.Forms.Clipboard]::GetDataObject()
  $observed.localClipboardOnly = $clipboardData.GetDataPresent('ExcludeClipboardContentFromMonitorProcessing', $false)
  $timer.Stop()
  $form.Close()
 } catch {
  $state.failure = 'DIALOG_FIXTURE_FAILED'
  $timer.Stop()
  foreach ($open in @([System.Windows.Forms.Application]::OpenForms)) { $open.Close() }
 }
})
try {
 $timer.Start()
 $captured = @(& (Join-Path $PSScriptRoot '../scripts/owner-code-windows.ps1'))
 if ($captured.Count -ne 0) { throw 'DIALOG_OUTPUT_FORBIDDEN' }
 if ($state.failure) { throw $state.failure }
 $observed.clearedOnClose = $null -ne $state.field -and $state.field.Text.Length -eq 0
 foreach ($value in $observed.Values) { if ($value -ne $true) { throw 'DIALOG_CONTRACT_FAILED' } }
 $observed | ConvertTo-Json -Compress
} finally {
 $timer.Stop(); $timer.Dispose()
 $env:JARVIS_PRODUCTION_CONFIG = $oldOverride
 Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
 # Only a public dummy clipboard is used on the isolated CI runner.
 if ([System.Windows.Forms.Clipboard]::ContainsText() -and [System.Windows.Forms.Clipboard]::GetText() -ceq $dummy) { [System.Windows.Forms.Clipboard]::Clear() }
}

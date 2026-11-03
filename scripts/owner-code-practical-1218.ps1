[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (-not $Apply) { Write-Output 'PLAN ONLY: requires separate issue:1218 Owner-local practical approval; no credential or Production file accessed.'; exit 0 }
$stage='context'
$timer=$null
$lock=$null
$state=@{failure=$null;form=$null;copied=$false;completed=$false;ticks=0}
$result=@{schemaVersion=1;issue=1218;complete=$false;publicPackageVerified=$false;maskedDefault=$false;explicitReveal=$false;hiddenAgain=$false;explicitCopy=$false;localClipboardExcluded=$false;copiedConfirmation=$false;loopbackLogin=$false;clipboardClearAttempted=$false;cleanupFailed=$false;encryptedConfigurationUnchanged=$false;utilityStdoutEmpty=$false;physicalKeyboardOrMouseControlVerified=$false;phoneLoginOrPinVerified=$false;credentialRotation=$false;databaseOpened=$false}
try {
 if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTOR -cne 'haji84' -or $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:GITHUB_REF -cne 'refs/heads/main') { throw 'CONTEXT_REQUIRED' }
 $stage='approval'
 $scope=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:GORIQ_OWNER_PRACTICAL_APPROVAL_BASE64)) | ConvertFrom-Json
 $now=[datetimeoffset]::UtcNow
 $issued=[datetimeoffset]::Parse($scope.issuedAt)
 $expires=[datetimeoffset]::Parse($scope.expiresAt)
 if ($scope.scopeId -cne 'issue:1218:owner-local-recovery-practical' -or $scope.explicitOwnerApproval -ne $true -or
     $scope.publicToolInstallApproval -ne $true -or $scope.existingCodeLocalReadCopyApproval -ne $true -or
     $scope.singleLoopbackSessionCookieApproval -ne $true -or $scope.credentialRotationApproval -ne $false -or
     $issued -gt $now -or $expires -le $now -or $expires -gt $issued.AddHours(2) -or
     $scope.sourceRevision -cne $env:GITHUB_SHA -or $env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$' -or
     $scope.configSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'APPROVAL_REQUIRED' }
 $stage='identity'
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 if ($identity.IsSystem -or $identity.User.Value -cne $scope.ownerSid -or (Get-Process -Id $PID).SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'OWNER_CONTEXT_REQUIRED' }
 if ($env:JARVIS_PRODUCTION_CONFIG) { throw 'CONFIG_OVERRIDE_NOT_APPROVED' }
 $stage='source-artifacts'
 . (Join-Path $PSScriptRoot 'owner-code-preflight-1218.ps1')
 foreach ($name in @('owner-code-windows.ps1','read-jarvis-production-config.ps1','install-owner-code-windows.ps1')) {
  $observed=Get-1218FileMetadata (Join-Path $PSScriptRoot $name) -Limit 262144
  if ($observed.state -cne 'regular' -or $observed.sha256 -cne $scope.publicFileSha256.('scripts/'+$name)) { throw 'SOURCE_MISMATCH' }
 }
 # Fail closed on a writable-by-unrelated-identity public executable location.
 function Assert-OwnerPublicPathProtection([string]$Path) {
  $current=Get-OwnerCodeInstallPath $Path
  while (-not (Test-Path -LiteralPath $current)) { $current=Split-Path -Parent $current }
  if ($current -ine $profile -and -not $current.StartsWith($profile+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'OWNER_PROFILE_PATH_REQUIRED' }
  $trusted=@($identity.User.Value,'S-1-5-18','S-1-5-32-544','S-1-3-0')
  $writeMask=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  while ($true) {
   $acl=Get-Acl -LiteralPath $current
   if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($identity.User.Value,'S-1-5-18','S-1-5-32-544')) { throw 'PUBLIC_PATH_OWNER_UNSUITABLE' }
   foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        ($rule.FileSystemRights -band $writeMask) -eq 0) { continue }
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -notin $trusted) { throw 'PUBLIC_DIRECTORY_PROTECTION_UNSUITABLE' }
   }
   if ($current -ieq $profile) { break }
   $current=Split-Path -Parent $current
  }
 }
 . (Join-Path $PSScriptRoot 'install-owner-code-windows.ps1')
 $profile=[Environment]::GetFolderPath('UserProfile')
 if ($profile -ine [IO.Path]::GetFullPath($env:USERPROFILE)) { throw 'PROFILE_MISMATCH' }
 $stage='configuration-metadata'
 $config=Join-Path $profile 'JARVIS\production\config.dpapi'
 $metadata=Get-1218FileMetadata $config
 if ($metadata.state -cne 'regular' -or $metadata.sha256 -cne $scope.configSha256) { throw 'CONFIGURATION_CHANGED' }
 $owner=(Get-Acl -LiteralPath $config).GetOwner([Security.Principal.SecurityIdentifier]).Value
 if ($owner -cne $identity.User.Value) { throw 'CONFIGURATION_OWNER_MISMATCH' }
 # Hold encrypted file read sharing only, so it cannot change during the bounded test.
 $lock=[IO.File]::Open($config,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ine $scope.configSha256) { throw 'CONFIGURATION_CHANGED_UNDER_LOCK' }
 function Assert-ApprovedWindow { if ([datetimeoffset]::UtcNow -ge $expires) { throw 'APPROVAL_EXPIRED' } }
 $destination=Join-Path (Join-Path $profile 'JARVIS\tools\owner-code') $env:GITHUB_SHA
 Assert-OwnerPublicPathProtection $profile
 Assert-OwnerPublicPathProtection (Split-Path -Parent $destination)
 Assert-OwnerPublicPathProtection ([Environment]::GetFolderPath('DesktopDirectory'))
 Assert-OwnerPublicPathProtection $config
 Assert-ApprovedWindow
 $stage='public-install'
 $global:LASTEXITCODE=0
 $installOutput=@(& (Join-Path $PSScriptRoot 'install-owner-code-windows.ps1') -Apply -Version $env:GITHUB_SHA 2>$null)
 if ($LASTEXITCODE -ne 0) { throw 'PUBLIC_INSTALL_FAILED' }
 $toolRoot=Join-Path (Join-Path $profile 'JARVIS\tools\owner-code') $env:GITHUB_SHA
 foreach ($name in @('owner-code-windows.ps1','read-jarvis-production-config.ps1')) {
  $observed=Get-1218FileMetadata (Join-Path $toolRoot $name) -Limit 262144
  if ($observed.state -cne 'regular' -or $observed.sha256 -cne $scope.publicFileSha256.('scripts/'+$name)) { throw 'INSTALLED_SOURCE_MISMATCH' }
 }
 foreach ($name in @('owner-code-windows.ps1','read-jarvis-production-config.ps1','manifest.json')) { Assert-OwnerPublicPathProtection (Join-Path $toolRoot $name) }
 $launcher=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'GORIQ Owner Code.cmd'
 Assert-OwnerPublicPathProtection $launcher
 $expectedCommand='@echo off'+"`r`n"+'"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -File "%USERPROFILE%\JARVIS\tools\owner-code\'+$env:GITHUB_SHA+'\owner-code-windows.ps1"'+"`r`n"
 if ([IO.File]::ReadAllText($launcher) -cne $expectedCommand) { throw 'LAUNCHER_MISMATCH' }
 $result.publicPackageVerified=$true
 Add-Type -AssemblyName System.Windows.Forms
 $timer=New-Object System.Windows.Forms.Timer
 $timer.Interval=100
 $timer.Add_Tick({
  try {
   $state.ticks++
   $form=@([System.Windows.Forms.Application]::OpenForms | Where-Object {$_.Name -eq 'OwnerCodeDialog'}) | Select-Object -First 1
   if ($form) { $state.form=$form }
   if ([datetimeoffset]::UtcNow -ge $expires -or $state.ticks -gt 200) { throw 'BOUNDED_SCOPE_EXPIRED' }
   if (-not $form) { return }
   $field=$form.Controls.Find('OwnerCodeValue',$true)[0]
   $show=$form.Controls.Find('OwnerCodeReveal',$true)[0]
   $copy=$form.Controls.Find('OwnerCodeCopy',$true)[0]
   $status=$form.Controls.Find('OwnerCodeStatus',$true)[0]
   $result.maskedDefault=$field.UseSystemPasswordChar -and $field.Text.Length -ge 24
   Assert-ApprovedWindow
   $show.PerformClick(); $result.explicitReveal=-not $field.UseSystemPasswordChar
   $show.PerformClick(); $result.hiddenAgain=$field.UseSystemPasswordChar
   Assert-ApprovedWindow
   $copy.PerformClick()
   $state.copied=$status.Text -ceq 'Copied to this PC clipboard.'
   $snapshot=[System.Windows.Forms.Clipboard]::GetDataObject()
   $copiedText=[string]$snapshot.GetData([System.Windows.Forms.DataFormats]::UnicodeText,$false)
   $result.explicitCopy=$state.copied -and $copiedText -ceq $field.Text
   $result.localClipboardExcluded=$snapshot.GetDataPresent('ExcludeClipboardContentFromMonitorProcessing',$false)
   $copiedText=$null;$snapshot=$null
   $result.copiedConfirmation=$state.copied
   # Secret stays in this native process and one loopback form body; response cookie is discarded.
   Assert-ApprovedWindow
   $response=Invoke-WebRequest -UseBasicParsing -MaximumRedirection 0 -Method POST -Uri 'http://127.0.0.1:3000/api/owner-login' -Headers @{Accept='application/json'} -Body @{passcode=$field.Text} -TimeoutSec 5
   $result.loopbackLogin=$response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).ok -eq $true
   $response=$null
   $state.completed=$true
   $timer.Stop(); $form.Close()
  } catch {
   $state.failure='OWNER_LOCAL_PRACTICAL_STEP_FAILED'
   try { $timer.Stop() } catch { $result.cleanupFailed=$true }
   if ($state.form) {
    try { $state.form.Close() } catch { $result.cleanupFailed=$true; try { $state.form.Dispose() } catch { $result.cleanupFailed=$true } }
   }
  }
 })
 Assert-ApprovedWindow
 $stage='local-dialog-and-login'
 $timer.Start()
 $captured=@(& (Join-Path $toolRoot 'owner-code-windows.ps1') 2>$null)
 $result.utilityStdoutEmpty=$captured.Count -eq 0
 if ($state.failure -or -not $state.completed) { throw 'OWNER_LOCAL_PRACTICAL_FAILED' }
 $result.encryptedConfigurationUnchanged=(Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ieq $scope.configSha256
 foreach ($name in @('publicPackageVerified','maskedDefault','explicitReveal','hiddenAgain','explicitCopy','localClipboardExcluded','copiedConfirmation','loopbackLogin','encryptedConfigurationUnchanged','utilityStdoutEmpty')) { if ($result[$name] -ne $true) { throw 'PRACTICAL_CONTRACT_FAILED' } }
 $result.complete=$true
} catch {
 $result.complete=$false
 $result.failureCode='OWNER_LOCAL_PRACTICAL_UNAVAILABLE'
 $result.failedStage=$stage
} finally {
 if ($timer) { try { $timer.Stop();$timer.Dispose() } catch { $result.cleanupFailed=$true } }
 if ($state.form -and -not $state.form.IsDisposed) { try { $state.form.Close();$state.form.Dispose() } catch { $result.cleanupFailed=$true } }
 if ($lock) { try { $lock.Dispose() } catch { $result.cleanupFailed=$true } }
 $scope=$null;$captured=$null;$installOutput=$null
}
if ($result.cleanupFailed) { $result.complete=$false; $result.failureCode='OWNER_LOCAL_CLEANUP_FAILED' }
$result | ConvertTo-Json -Compress
if (-not $result.complete) { exit 1 }

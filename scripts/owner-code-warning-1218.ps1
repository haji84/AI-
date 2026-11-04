[CmdletBinding()]
param([switch]$Run)

function Assert-OwnerWarningScope {
 param($Scope,$Environment,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
 $keys=@('schemaVersion','scopeId','authorityType','issuedBy','issue','goalId','operation','ownerSid','sourceRevision','sourceHashes','workflowRunId','workflowRunAttempt','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','allowedUiAction','controlled')
 if (@($Scope.PSObject.Properties).Count -ne $keys.Count -or @($keys|Where-Object {$Scope.PSObject.Properties.Name -cnotcontains $_}).Count -ne 0) { throw 'WARNING_SCOPE_REQUIRED' }
 foreach ($key in @('schemaVersion','issue','workflowRunAttempt','maxAttempts','maxDurationSeconds')) { if ($Scope.$key -isnot [int] -and $Scope.$key -isnot [long]) { throw 'WARNING_SCOPE_REQUIRED' } }
 foreach ($key in @('scopeId','authorityType','issuedBy','goalId','operation','ownerSid','sourceRevision','workflowRunId','issuedAt','expiresAt','allowedUiAction')) { if ($Scope.$key -isnot [string]) { throw 'WARNING_SCOPE_REQUIRED' } }
 if ($Environment.GITHUB_ACTOR -cne 'haji84' -or $Environment.GITHUB_REPOSITORY -cne 'haji84/AI-' -or $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$' -or $Environment.GITHUB_RUN_ID -cnotmatch '^\d+$' -or $Environment.GITHUB_RUN_ATTEMPT -cne '1') { throw 'WARNING_CONTEXT_REQUIRED' }
 if ($Scope.schemaVersion -ne 1 -or $Scope.scopeId -cne 'issue:1218:owner-warning-only' -or $Scope.authorityType -cne 'TASK_SCOPED_ORDINARY_COMPLETION_DELEGATION' -or $Scope.issuedBy -cne 'task-delegated-operator' -or $Scope.issue -ne 1218 -or $Scope.goalId -cne 'goal-fcc81c97e09153f7' -or $Scope.operation -cne 'warning-render-and-cancel-only' -or $Scope.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $Scope.sourceRevision -cne $Environment.GITHUB_SHA -or $Scope.workflowRunId -cnotmatch '^\d+$' -or $Scope.workflowRunId -cne $Environment.GITHUB_RUN_ID -or $Scope.workflowRunAttempt -ne 1 -or $Scope.maxAttempts -ne 1 -or $Scope.maxDurationSeconds -ne 30 -or $Scope.allowedUiAction -cne 'OwnerRotationCancel' -or $Scope.controlled -isnot [bool] -or $Scope.controlled -ne $false -or $Scope.issuedAt -isnot [string] -or $Scope.expiresAt -isnot [string]) { throw 'WARNING_SCOPE_REQUIRED' }
 $issued=[datetimeoffset]::Parse($Scope.issuedAt);$expires=[datetimeoffset]::Parse($Scope.expiresAt)
 if ($issued -gt $Now -or ($expires-$Now).TotalSeconds -lt 30 -or ($expires-$issued).TotalSeconds -gt 900 -or $expires -le $issued -or $expires -gt [datetimeoffset]::Parse('2026-11-10T08:00:00Z')) { throw 'WARNING_SCOPE_REQUIRED' }
 $files=@('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')
 if (@($Scope.sourceHashes.PSObject.Properties).Count -ne 3) { throw 'WARNING_SOURCE_REJECTED' }
 foreach ($file in $files) { if ($Scope.sourceHashes.PSObject.Properties.Name -cnotcontains $file -or $Scope.sourceHashes.$file -isnot [string] -or $Scope.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$') { throw 'WARNING_SOURCE_REJECTED' } }
}
function New-OwnerWarningResult {
 return [ordered]@{schemaVersion=1;issue=1218;operation='warning-render-and-cancel-only';complete=$false;failureCode='WARNING_UI_UNVERIFIED';runtimeScopeSha256=$null;sourceRevision=$null;sourceHashesVerified=$false;actualWindowsOwnerContextVerified=$false;originalFormShown=$false;originalWarningVisible=$false;warningBeforeAnyConfirmation=$false;originalCancelControlObserved=$false;defaultCancelObserved=$false;cancelInvoked=$false;cancelledWithoutConfirmation=$false;formDisposed=$false;deadlineRespected=$false;childCleanupVerified=$false;confirmEventObserved=$false}
}
function Get-OwnerWarningDigest([byte[]]$Bytes) {
 $sha=[Security.Cryptography.SHA256]::Create();try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Invoke-OwnerWarningOnly {
 $ErrorActionPreference='Stop';Set-StrictMode -Version Latest
 $result=New-OwnerWarningResult;$observer=$null;$markerStream=$null;$warningObservation=@{form=$null;cancelClick=$false;confirmation=$null;failed=$false}
 try {
  $encoded=$env:GORIQ_OWNER_WARNING_SCOPE_BASE64
  if (-not $encoded -or $encoded.Length -gt 32768 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'WARNING_SCOPE_REQUIRED' }
  $scopeBytes=[Convert]::FromBase64String($encoded);if ([Convert]::ToBase64String($scopeBytes) -cne $encoded) { throw 'WARNING_SCOPE_REQUIRED' }
  $scopeText=[Text.Encoding]::UTF8.GetString($scopeBytes);$scope=$scopeText|ConvertFrom-Json
  $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
  Assert-OwnerWarningScope -Scope $scope -Environment $environment
  if (($scope|ConvertTo-Json -Depth 6 -Compress) -cne $scopeText) { throw 'WARNING_SCOPE_REQUIRED' }
  $result.runtimeScopeSha256=Get-OwnerWarningDigest $scopeBytes;$result.sourceRevision=$scope.sourceRevision
  if ($env:OS -cne 'Windows_NT' -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage') { throw 'WARNING_OWNER_CONTEXT_REQUIRED' }
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if ($identity.IsSystem -or $identity.User.Value -cne $scope.ownerSid -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'WARNING_OWNER_CONTEXT_REQUIRED' }
  $result.actualWindowsOwnerContextVerified=$true
  $root=Split-Path -Parent $PSScriptRoot
  foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) {
   $path=Join-Path $root $file;$item=Get-Item -LiteralPath $path -Force
   if ($item -isnot [IO.FileInfo] -or $item.Length -gt 262144 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-OwnerWarningDigest ([IO.File]::ReadAllBytes($path))) -cne $scope.sourceHashes.$file) { throw 'WARNING_SOURCE_REJECTED' }
  }
  # Import unchanged definitions only. Never call Main, context or transaction.
  . (Join-Path $PSScriptRoot 'rotate-jarvis-owner-code-windows.ps1') -Apply:$false -AuthorizationPath ''
  foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) { Assert-OwnerRotationProtectedPath -Path (Join-Path $root $file) -OwnerSid $scope.ownerSid }
  $result.sourceHashesVerified=$true
  $deadline=[datetimeoffset]::Parse($env:GORIQ_OWNER_WARNING_DEADLINE_UTC);$now=[datetimeoffset]::UtcNow
  if ($deadline -le $now.AddSeconds(3) -or $deadline -gt $now.AddSeconds(30) -or $deadline -gt [datetimeoffset]::Parse($scope.expiresAt)) { throw 'WARNING_SCOPE_REQUIRED' }
  $marker=Get-OwnerRotationSafePath (Join-Path (Join-Path $root '.gai-results') 'owner-warning-1218.attempt')
  $item=Get-Item -LiteralPath $marker -Force;if ($item -isnot [IO.FileInfo] -or $item.Length -gt 4096) { throw 'WARNING_ATTEMPT_CONSUMED' }
  $markerStream=[IO.File]::Open($marker,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $reader=New-Object IO.StreamReader($markerStream,[Text.Encoding]::UTF8,$true,4096,$true)
  try { $attempt=$reader.ReadToEnd()|ConvertFrom-Json } finally { $reader.Dispose() }
  if (@($attempt.PSObject.Properties).Count -ne 5 -or $attempt.schemaVersion -ne 1 -or $attempt.runtimeScopeSha256 -cne $result.runtimeScopeSha256 -or $attempt.sourceRevision -cne $scope.sourceRevision -or $attempt.workflowRunId -cne $scope.workflowRunId -or $attempt.stage -cne 'reserved') { throw 'WARNING_ATTEMPT_CONSUMED' }
  $attempt.stage='consumed';$bytes=[Text.Encoding]::UTF8.GetBytes(($attempt|ConvertTo-Json -Compress));$markerStream.SetLength(0);$markerStream.Position=0;$markerStream.Write($bytes,0,$bytes.Length);$markerStream.Flush();$markerStream.Dispose();$markerStream=$null
  Assert-OwnerWarningScope -Scope $scope -Environment $environment
  Add-Type -AssemblyName System.Windows.Forms
  if ([Windows.Forms.Application]::OpenForms.Count -ne 0) { throw 'WARNING_UI_UNVERIFIED' }
  $until=$now.AddSeconds(10);if ($until -gt $deadline.AddSeconds(-3)) { $until=$deadline.AddSeconds(-3) }
  $displayContext=[pscustomobject]@{ForwardDeadline=$until}
  $observer=New-Object Windows.Forms.Timer;$observer.Interval=50
  $observer.Add_Tick({
   try {
    if ([datetimeoffset]::UtcNow -ge $until) { throw 'WARNING_TIMEOUT' }
    $forms=@([Windows.Forms.Application]::OpenForms)
    if ($forms.Count -eq 0) { return }
    if ($forms.Count -ne 1 -or $forms[0].Name -cne 'OwnerRotationConfirmation') { throw 'WARNING_UI_UNVERIFIED' }
    $form=$forms[0];$warningObservation.form=$form
    $warning=@($form.Controls.Find('OwnerRotationWarning',$true));$cancel=@($form.Controls.Find('OwnerRotationCancel',$true));$confirm=@($form.Controls.Find('OwnerRotationConfirm',$true))
    if ($warning.Count -ne 1 -or $cancel.Count -ne 1 -or $confirm.Count -ne 1 -or $warning[0] -isnot [Windows.Forms.Label] -or $cancel[0] -isnot [Windows.Forms.Button] -or $confirm[0] -isnot [Windows.Forms.Button]) { throw 'WARNING_UI_UNVERIFIED' }
    $confirm[0].Add_Click({$result.confirmEventObserved=$true}.GetNewClosure())
    $cancel[0].Add_Click({$warningObservation.cancelClick=$true}.GetNewClosure())
    $result.originalFormShown=$form.Visible
    $result.originalWarningVisible=$warning[0].Visible -and $warning[0].Text -ceq 'Change the Production Owner login code? Existing Owner sessions will end. Worker identities and Broker data must remain unchanged.'
    $result.originalCancelControlObserved=$cancel[0].Visible -and $cancel[0].Enabled -and $cancel[0].DialogResult -eq [Windows.Forms.DialogResult]::Cancel
    $result.defaultCancelObserved=[object]::ReferenceEquals($form.AcceptButton,$cancel[0]) -and [object]::ReferenceEquals($form.CancelButton,$cancel[0])
    $result.warningBeforeAnyConfirmation=$result.originalFormShown -and $result.originalWarningVisible -and -not $result.confirmEventObserved
    if (-not $result.warningBeforeAnyConfirmation -or -not $result.originalCancelControlObserved -or -not $result.defaultCancelObserved) { throw 'WARNING_UI_UNVERIFIED' }
    $observer.Stop();$cancel[0].PerformClick();$result.cancelInvoked=$warningObservation.cancelClick
   } catch { $warningObservation.failed=$true;$observer.Stop();if ($warningObservation.form -and -not $warningObservation.form.IsDisposed) { $warningObservation.form.Close() } }
  }.GetNewClosure())
  try { $observer.Start();$warningObservation.confirmation=Show-OwnerRotationConfirmation -Authorization $null -Context $displayContext -Controlled:$false } finally { $observer.Stop() }
  $result.cancelledWithoutConfirmation=$warningObservation.cancelClick -and -not $result.confirmEventObserved -and $warningObservation.confirmation -and $warningObservation.confirmation.confirmed -eq $false -and $warningObservation.confirmation.warning -eq $true
 } catch { $code=[string]$_.Exception.Message;if ($code -in @('WARNING_CONTEXT_REQUIRED','WARNING_SCOPE_REQUIRED','WARNING_SOURCE_REJECTED','WARNING_ATTEMPT_CONSUMED','WARNING_OWNER_CONTEXT_REQUIRED','WARNING_TIMEOUT')) { $result.failureCode=$code } }
 finally {
  if ($markerStream) { try { $markerStream.Dispose() } catch { $result.failureCode='WARNING_CLEANUP_FAILED' } }
  if ($observer) { try { $observer.Stop();$observer.Dispose() } catch { $result.failureCode='WARNING_CLEANUP_FAILED' } }
  if ($warningObservation.form) { try { if (-not $warningObservation.form.IsDisposed) { $warningObservation.form.Close();$warningObservation.form.Dispose() };$result.formDisposed=$warningObservation.form.IsDisposed } catch { $result.failureCode='WARNING_CLEANUP_FAILED' } }
 }
 if (Get-Variable -Name deadline -ErrorAction SilentlyContinue) { $result.deadlineRespected=[datetimeoffset]::UtcNow -le $deadline }
 $required=@('sourceHashesVerified','actualWindowsOwnerContextVerified','originalFormShown','originalWarningVisible','warningBeforeAnyConfirmation','originalCancelControlObserved','defaultCancelObserved','cancelInvoked','cancelledWithoutConfirmation','formDisposed','deadlineRespected')
 if (-not $warningObservation.failed -and -not $result.confirmEventObserved -and @($required|Where-Object {-not $result[$_]}).Count -eq 0 -and $result.failureCode -cne 'WARNING_CLEANUP_FAILED') { $result.complete=$true;$result.failureCode=$null }
 return $result
}
if ($MyInvocation.InvocationName -ne '.') {
 if (-not $Run) { Write-Output 'PLAN ONLY: warning-and-Cancel requires a fresh ordinary task scope; no Owner state or UI is accessed.';exit 0 }
 $result=Invoke-OwnerWarningOnly
 $result|ConvertTo-Json -Depth 6 -Compress
 if (-not $result.complete) { exit 1 }
}

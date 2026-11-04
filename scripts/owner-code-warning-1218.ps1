[CmdletBinding()]
param([switch]$Run,[switch]$Prepare)

if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules') }
$script:ownerWarningJsonCodec=$null

function Assert-OwnerWarningScope {
 param($Scope,$Environment,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
 $keys=@('schemaVersion','scopeId','authorityType','issuedBy','issue','goalId','operation','ownerSid','sourceRevision','sourceHashes','workflowRunId','workflowRunAttempt','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','allowedUiAction','controlled')
 if (@($Scope.PSObject.Properties).Count -ne $keys.Count) { throw 'WARNING_SCOPE_REQUIRED' };foreach ($key in $keys) { if ($Scope.PSObject.Properties.Name -cnotcontains $key) { throw 'WARNING_SCOPE_REQUIRED' } }
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
# Windows PowerShell uses the trusted framework JSON codec without cold module discovery.
function Get-OwnerWarningJsonCodec {
 if (-not $script:ownerWarningJsonCodec) {
  $null=[Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
  $script:ownerWarningJsonCodec=[Web.Script.Serialization.JavaScriptSerializer]::new();$script:ownerWarningJsonCodec.MaxJsonLength=32768
 }
 return $script:ownerWarningJsonCodec
}
function ConvertFrom-OwnerWarningJson([string]$Text) {
 if ([IO.Path]::DirectorySeparatorChar -ne [char]92) { return ($Text|ConvertFrom-Json) }
 $value=(Get-OwnerWarningJsonCodec).DeserializeObject($Text)
 if ($value -isnot [Collections.IDictionary]) { throw 'WARNING_SCOPE_REQUIRED' }
 $properties=[ordered]@{};foreach ($key in $value.Keys) {$properties.Add($key,$value[$key])};$object=[pscustomobject]$properties
 if ($value.ContainsKey('sourceHashes')) { if ($value['sourceHashes'] -isnot [Collections.IDictionary]) { throw 'WARNING_SCOPE_REQUIRED' };$sources=[ordered]@{};foreach ($key in $value['sourceHashes'].Keys) {$sources.Add($key,$value['sourceHashes'][$key])};$object.sourceHashes=[pscustomobject]$sources }
 return $object
}
function ConvertTo-OwnerWarningJson($Value) {
 if ([IO.Path]::DirectorySeparatorChar -ne [char]92) { return ($Value|ConvertTo-Json -Depth 6 -Compress) }
 return (Get-OwnerWarningJsonCodec).Serialize($Value)
}
function Get-OwnerWarningCanonicalScope($Scope) {
 $keys=@('schemaVersion','scopeId','authorityType','issuedBy','issue','goalId','operation','ownerSid','sourceRevision','sourceHashes','workflowRunId','workflowRunAttempt','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','allowedUiAction','controlled')
 $pairs=[Collections.Generic.List[string]]::new()
 foreach ($key in $keys) {
  if ($key -ceq 'sourceHashes') {
   $sources=[Collections.Generic.List[string]]::new();foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) { $sources.Add('"'+$file+'":'+(ConvertTo-OwnerWarningJson $Scope.sourceHashes.$file)) };$value='{'+[string]::Join(',',$sources)+'}'
  } else { $value=ConvertTo-OwnerWarningJson $Scope.$key }
  $pairs.Add('"'+$key+'":'+$value)
 }
 return '{'+[string]::Join(',',$pairs)+'}'
}
function Set-OwnerWarningClockBridge([scriptblock]$Clock) {
 # Caller supplies only the original definition after all three source hashes pass.
 ${function:script:Get-OwnerRotationNow}=$Clock
}
function Get-OwnerWarningAdmission {
 $encoded=$env:GORIQ_OWNER_WARNING_SCOPE_BASE64
 if (-not $encoded -or $encoded.Length -gt 32768 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'WARNING_SCOPE_REQUIRED' }
 $scopeBytes=[Convert]::FromBase64String($encoded);if ([Convert]::ToBase64String($scopeBytes) -cne $encoded) { throw 'WARNING_SCOPE_REQUIRED' }
 $scopeText=[Text.Encoding]::UTF8.GetString($scopeBytes);$scope=ConvertFrom-OwnerWarningJson $scopeText
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
 Assert-OwnerWarningScope -Scope $scope -Environment $environment
 if ((Get-OwnerWarningCanonicalScope $scope) -cne $scopeText) { throw 'WARNING_SCOPE_REQUIRED' }
 if ($env:OS -cne 'Windows_NT' -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage') { throw 'WARNING_OWNER_CONTEXT_REQUIRED' }
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 try { if ($identity.IsSystem -or $identity.User.Value -cne $scope.ownerSid -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'WARNING_OWNER_CONTEXT_REQUIRED' } } finally { $identity.Dispose() }
 $profile=[IO.Path]::GetFullPath([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile))
 if (-not $env:USERPROFILE -or $profile -ine [IO.Path]::GetFullPath($env:USERPROFILE)) { throw 'WARNING_OWNER_CONTEXT_REQUIRED' }
 $root=[IO.Path]::GetDirectoryName($PSScriptRoot)
 foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) {
  $path=[IO.Path]::Combine($root,$file);$item=[IO.FileInfo]::new($path);$item.Refresh()
  if (-not $item.Exists -or $item.Length -gt 262144 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-OwnerWarningDigest ([IO.File]::ReadAllBytes($path))) -cne $scope.sourceHashes.$file) { throw 'WARNING_SOURCE_REJECTED' }
 }
 return @{scope=$scope;environment=$environment;scopeHash=(Get-OwnerWarningDigest $scopeBytes);root=$root;profile=$profile}
}
function Get-OwnerWarningStageName($Scope,[string]$ScopeHash) { return '.goriq-owner-warning-1218-'+$Scope.workflowRunId+'-'+$Scope.workflowRunAttempt+'-'+$ScopeHash }
function Assert-OwnerWarningStage($Admission) {
 $expected=[IO.Path]::Combine($Admission.profile,(Get-OwnerWarningStageName $Admission.scope $Admission.scopeHash))
 if ($Admission.root -ine $expected) { throw 'WARNING_SOURCE_REJECTED' }
 $claim=Get-OwnerRotationSafePath -Path ($expected+'.claim') -NativeMetadata;$item=Get-OwnerRotationNativeItem $claim
 if ($item -isnot [IO.FileInfo] -or $item.Length -gt 4096) { throw 'WARNING_SOURCE_REJECTED' }
 Assert-OwnerRotationProtectedPath -Path $claim -OwnerSid $Admission.scope.ownerSid -OwnerProfile $Admission.profile -NativeMetadata
 $record=ConvertFrom-OwnerWarningJson ([IO.File]::ReadAllText($claim,[Text.Encoding]::UTF8));$keys=@('schemaVersion','runtimeScopeSha256','sourceRevision','workflowRunId','workflowRunAttempt')
 if (@($record.PSObject.Properties).Count -ne $keys.Count) { throw 'WARNING_SOURCE_REJECTED' };foreach ($key in $keys) { if ($record.PSObject.Properties.Name -cnotcontains $key) { throw 'WARNING_SOURCE_REJECTED' } }
 if ($record.schemaVersion -isnot [int] -or $record.schemaVersion -ne 1 -or $record.runtimeScopeSha256 -isnot [string] -or $record.runtimeScopeSha256 -cne $Admission.scopeHash -or $record.sourceRevision -isnot [string] -or $record.sourceRevision -cne $Admission.scope.sourceRevision -or $record.workflowRunId -isnot [string] -or $record.workflowRunId -cne $Admission.scope.workflowRunId -or $record.workflowRunAttempt -isnot [int] -or $record.workflowRunAttempt -ne $Admission.scope.workflowRunAttempt) { throw 'WARNING_SOURCE_REJECTED' }
}
function Read-OwnerWarningAttempt([string]$Path,$Admission) {
 $item=[IO.FileInfo]::new($Path);$item.Refresh();if (-not $item.Exists -or $item.Length -gt 4096 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'WARNING_ATTEMPT_CONSUMED' }
 $attempt=ConvertFrom-OwnerWarningJson ([IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8))
 if (@($attempt.PSObject.Properties).Count -ne 5 -or $attempt.schemaVersion -ne 1 -or $attempt.runtimeScopeSha256 -cne $Admission.scopeHash -or $attempt.sourceRevision -cne $Admission.scope.sourceRevision -or $attempt.workflowRunId -cne $Admission.scope.workflowRunId -or $attempt.stage -cne 'reserved') { throw 'WARNING_ATTEMPT_CONSUMED' };return $attempt
}
function Initialize-OwnerWarningStage {
 $ErrorActionPreference='Stop';$answer=[ordered]@{schemaVersion=1;complete=$false;failureCode='WARNING_SOURCE_REJECTED';profileMatchesEnvironment=$false};$claim=$null
 try {
  $admission=Get-OwnerWarningAdmission;$answer.profileMatchesEnvironment=$true;$scope=$admission.scope
  . ([IO.Path]::Combine($PSScriptRoot,'rotate-jarvis-owner-code-windows.ps1')) -Apply:$false -AuthorizationPath ''
  $profile=Get-OwnerRotationSafePath -Path $admission.profile -NativeMetadata
  Assert-OwnerRotationProtectedPath -Path $profile -OwnerSid $scope.ownerSid -OwnerProfile $profile -NativeMetadata
  $name=Get-OwnerWarningStageName $scope $admission.scopeHash;$stage=[IO.Path]::Combine($profile,$name);$claimPath=$stage+'.claim'
  try {$claim=[IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)} catch [IO.IOException] { if ($null -ne (Get-OwnerRotationNativeItem $claimPath)) {throw 'WARNING_ATTEMPT_CONSUMED'};throw }
  $claimBytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerWarningJson ([ordered]@{schemaVersion=1;runtimeScopeSha256=$admission.scopeHash;sourceRevision=$scope.sourceRevision;workflowRunId=$scope.workflowRunId;workflowRunAttempt=$scope.workflowRunAttempt})));$claim.Write($claimBytes,0,$claimBytes.Length);$claim.Flush();$claim.Dispose();$claim=$null
  if ($null -ne (Get-OwnerRotationNativeItem $stage)) { throw 'WARNING_ATTEMPT_CONSUMED' }
  $security=[Security.AccessControl.DirectorySecurity]::new();$security.SetAccessRuleProtection($true,$false);$security.SetOwner([Security.Principal.SecurityIdentifier]::new($scope.ownerSid))
  foreach ($sid in @($scope.ownerSid,'S-1-5-18','S-1-5-32-544')) {
   $rule=[Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$security.AddAccessRule($rule)
  }
  ([IO.DirectoryInfo]::new($stage)).Create($security)
  $null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'scripts'));$null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'.gai-results'))
  foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) {
   $bytes=[IO.File]::ReadAllBytes([IO.Path]::Combine($admission.root,$file));if ($bytes.Length -gt 262144 -or (Get-OwnerWarningDigest $bytes) -cne $scope.sourceHashes.$file) { throw 'WARNING_SOURCE_REJECTED' }
   $target=[IO.Path]::Combine($stage,$file);$stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try {$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
   Assert-OwnerRotationProtectedPath -Path $target -OwnerSid $scope.ownerSid -OwnerProfile $profile -NativeMetadata
   if ((Get-OwnerWarningDigest ([IO.File]::ReadAllBytes($target))) -cne $scope.sourceHashes.$file) { throw 'WARNING_SOURCE_REJECTED' }
  }
  $sourceMarker=[IO.Path]::Combine([IO.Path]::Combine($admission.root,'.gai-results'),'owner-warning-1218.attempt');$attempt=Read-OwnerWarningAttempt $sourceMarker $admission
  $marker=[IO.Path]::Combine([IO.Path]::Combine($stage,'.gai-results'),'owner-warning-1218.attempt');$bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerWarningJson ([ordered]@{schemaVersion=1;runtimeScopeSha256=$attempt.runtimeScopeSha256;sourceRevision=$attempt.sourceRevision;workflowRunId=$attempt.workflowRunId;stage='reserved'})))
  $stream=[IO.File]::Open($marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try {$stream.Write($bytes,0,$bytes.Length)} finally {$stream.Dispose()}
  $answer.complete=$true;$answer.failureCode=$null
 } catch { $code=[string]$_.Exception.Message;if ($code -in @('WARNING_CONTEXT_REQUIRED','WARNING_SCOPE_REQUIRED','WARNING_SOURCE_REJECTED','WARNING_ATTEMPT_CONSUMED','WARNING_OWNER_CONTEXT_REQUIRED')) {$answer.failureCode=$code} }
 finally { if ($claim) {$claim.Dispose()} }
 return $answer
}
function Invoke-OwnerWarningOnly {
 $ErrorActionPreference='Stop';Set-StrictMode -Version Latest
 $result=New-OwnerWarningResult;$observer=$null;$markerStream=$null;$deadline=$null;$warningObservation=@{form=$null;cancelClick=$false;confirmation=$null;failed=$false}
 try {
  $admission=Get-OwnerWarningAdmission;$scope=$admission.scope;$environment=$admission.environment;$root=$admission.root
  $result.runtimeScopeSha256=$admission.scopeHash;$result.sourceRevision=$scope.sourceRevision;$result.actualWindowsOwnerContextVerified=$true
  # Import only after all three source hashes pass; never invoke Main/context/transaction.
  . ([IO.Path]::Combine($PSScriptRoot,'rotate-jarvis-owner-code-windows.ps1')) -Apply:$false -AuthorizationPath ''
  $profile=Get-OwnerRotationSafePath -Path $admission.profile -NativeMetadata
  if ($root -ine $profile -and -not $root.StartsWith($profile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'WARNING_SOURCE_REJECTED' }
  Assert-OwnerWarningStage -Admission $admission
  foreach ($file in @('scripts/owner-code-warning-1218.mjs','scripts/owner-code-warning-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')) { Assert-OwnerRotationProtectedPath -Path ([IO.Path]::Combine($root,$file)) -OwnerSid $scope.ownerSid -OwnerProfile $profile -NativeMetadata }
  Set-OwnerWarningClockBridge -Clock ${function:Get-OwnerRotationNow}
  $result.sourceHashesVerified=$true
  $deadline=[datetimeoffset]::Parse($env:GORIQ_OWNER_WARNING_DEADLINE_UTC);$now=[datetimeoffset]::UtcNow
  if ($deadline -le $now.AddSeconds(3) -or $deadline -gt $now.AddSeconds(30) -or $deadline -gt [datetimeoffset]::Parse($scope.expiresAt)) { throw 'WARNING_SCOPE_REQUIRED' }
  $marker=Get-OwnerRotationSafePath -Path ([IO.Path]::Combine([IO.Path]::Combine($root,'.gai-results'),'owner-warning-1218.attempt')) -NativeMetadata
  Assert-OwnerRotationProtectedPath -Path $marker -OwnerSid $scope.ownerSid -OwnerProfile $profile -NativeMetadata
  $markerStream=[IO.File]::Open($marker,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  if ($markerStream.Length -gt 4096) { throw 'WARNING_ATTEMPT_CONSUMED' };$reader=[IO.StreamReader]::new($markerStream,[Text.Encoding]::UTF8,$true,4096,$true)
  try { $attempt=ConvertFrom-OwnerWarningJson ($reader.ReadToEnd()) } finally { $reader.Dispose() }
  if (@($attempt.PSObject.Properties).Count -ne 5 -or $attempt.schemaVersion -ne 1 -or $attempt.runtimeScopeSha256 -cne $result.runtimeScopeSha256 -or $attempt.sourceRevision -cne $scope.sourceRevision -or $attempt.workflowRunId -cne $scope.workflowRunId -or $attempt.stage -cne 'reserved') { throw 'WARNING_ATTEMPT_CONSUMED' }
  $attempt.stage='consumed';$bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerWarningJson ([ordered]@{schemaVersion=1;runtimeScopeSha256=$attempt.runtimeScopeSha256;sourceRevision=$attempt.sourceRevision;workflowRunId=$attempt.workflowRunId;stage=$attempt.stage})));$markerStream.SetLength(0);$markerStream.Position=0;$markerStream.Write($bytes,0,$bytes.Length);$markerStream.Flush();$markerStream.Dispose();$markerStream=$null
  Assert-OwnerWarningScope -Scope $scope -Environment $environment
  Add-Type -AssemblyName System.Windows.Forms
  if ([Windows.Forms.Application]::OpenForms.Count -ne 0) { throw 'WARNING_UI_UNVERIFIED' }
  $until=$now.AddSeconds(10);if ($until -gt $deadline.AddSeconds(-3)) { $until=$deadline.AddSeconds(-3) }
  $displayContext=[pscustomobject]@{ForwardDeadline=$until}
  $observer=[Windows.Forms.Timer]::new();$observer.Interval=50
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
 if ($null -ne $deadline) { $result.deadlineRespected=[datetimeoffset]::UtcNow -le $deadline }
 $required=@('sourceHashesVerified','actualWindowsOwnerContextVerified','originalFormShown','originalWarningVisible','warningBeforeAnyConfirmation','originalCancelControlObserved','defaultCancelObserved','cancelInvoked','cancelledWithoutConfirmation','formDisposed','deadlineRespected')
 $allRequired=$true;foreach ($key in $required) { if (-not $result[$key]) {$allRequired=$false} };if (-not $warningObservation.failed -and -not $result.confirmEventObserved -and $allRequired -and $result.failureCode -cne 'WARNING_CLEANUP_FAILED') { $result.complete=$true;$result.failureCode=$null }
 return $result
}
if ($MyInvocation.InvocationName -ne '.') {
 if (-not $Run -and -not $Prepare) { [Console]::Out.WriteLine('PLAN ONLY: warning-and-Cancel requires a fresh ordinary task scope; no Owner state or UI is accessed.');exit 0 }
 if ($Run -and $Prepare) { $result=New-OwnerWarningResult;$result.failureCode='WARNING_SCOPE_REQUIRED' } elseif ($Prepare) { $result=Initialize-OwnerWarningStage } else { $result=Invoke-OwnerWarningOnly }
 [Console]::Out.WriteLine((ConvertTo-OwnerWarningJson $result))
 if (-not $result.complete) { exit 1 }
}

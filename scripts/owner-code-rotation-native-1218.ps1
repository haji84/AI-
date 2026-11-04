[CmdletBinding()]
param([switch]$Prepare)

# This entry defines only preparation capabilities. Default invocation is inert.
$script:ownerRotationEntryCodec=$null
function Get-OwnerRotationEntrySources {
 return @('scripts/owner-code-rotation-acceptance.mjs','scripts/owner-code-fleet-preservation.mjs','scripts/owner-code-pc-preservation.mjs','scripts/owner-code-rotation-worker.ps1','scripts/rotate-jarvis-owner-code-windows.ps1','scripts/read-jarvis-production-config.ps1','scripts/validate-jarvis-production-config.mjs','scripts/jarvis-production-config.mjs','scripts/jarvis-windows-install-paths.mjs')
}
function Get-OwnerRotationEntryDigest([byte[]]$Bytes) {
 $sha=[Security.Cryptography.SHA256]::Create();try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-OwnerRotationEntryCodec {
 if (-not $script:ownerRotationEntryCodec) {
  $null=[Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
  $script:ownerRotationEntryCodec=[Web.Script.Serialization.JavaScriptSerializer]::new();$script:ownerRotationEntryCodec.MaxJsonLength=65536;$script:ownerRotationEntryCodec.RecursionLimit=12
 }
 return $script:ownerRotationEntryCodec
}
function ConvertFrom-OwnerRotationEntryDictionary($Value) {
 if ($Value -is [Collections.IDictionary]) {
  $properties=[ordered]@{};foreach ($key in $Value.Keys) { $properties.Add($key,(ConvertFrom-OwnerRotationEntryDictionary $Value[$key])) };return [pscustomobject]$properties
 }
 if ($Value -is [array]) { $items=@(foreach ($item in $Value) { ConvertFrom-OwnerRotationEntryDictionary $item });return ,$items }
 return $Value
}
function ConvertFrom-OwnerRotationEntryJson([string]$Text) {
 if ([IO.Path]::DirectorySeparatorChar -ne [char]92) { return ($Text|ConvertFrom-Json -DateKind String) }
 return (ConvertFrom-OwnerRotationEntryDictionary ((Get-OwnerRotationEntryCodec).DeserializeObject($Text)))
}
function ConvertTo-OwnerRotationEntryJson($Value) {
 if ([IO.Path]::DirectorySeparatorChar -ne [char]92) { return ($Value|ConvertTo-Json -Depth 8 -Compress) }
 return (Get-OwnerRotationEntryCodec).Serialize($Value)
}
function Assert-OwnerRotationEntryShape($Value,[string[]]$Keys) {
 if ($null -eq $Value -or $Value -isnot [pscustomobject] -or @($Value.PSObject.Properties).Count -ne $Keys.Count) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 foreach ($key in $Keys) { if ($Value.PSObject.Properties.Name -cnotcontains $key) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
}
function Assert-OwnerRotationEntryScope {
 param($Scope,$Environment,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
 $flags=@('credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval')
 $strings=@('scopeId','ownerSid','issuedAt','expiresAt','sourceRevision','configSha256','taskSha256','nodeSha256','runtimeRevision','dbPath','attemptId','workflowRunId')
 $integers=@('maxAttempts','maxDurationSeconds','recoveryReserveSeconds','workflowRunAttempt')
 Assert-OwnerRotationEntryShape $Scope ($strings+$integers+@('sourceHashes','cohortAuthority','pcSidecars')+$flags)
 foreach ($key in $strings) { if ($Scope.$key -isnot [string]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 foreach ($key in $integers) { if ($Scope.$key -isnot [int] -and $Scope.$key -isnot [long]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 foreach ($key in $flags) { if ($Scope.$key -isnot [bool] -or $Scope.$key -ne $true) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Environment.GITHUB_ACTOR -cne 'haji84' -or $Environment.GITHUB_REPOSITORY -cne 'haji84/AI-' -or $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$' -or $Environment.GITHUB_RUN_ID -cnotmatch '^\d+$' -or $Environment.GITHUB_RUN_ATTEMPT -cne '1') { throw 'ROTATION_ENTRY_CONTEXT_REQUIRED' }
 if ($Scope.scopeId -cne 'issue:1218:owner-code-rotation' -or $Scope.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $Scope.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Scope.runtimeRevision -cnotmatch '^[a-f0-9]{40}$' -or $Scope.maxAttempts -ne 1 -or $Scope.maxDurationSeconds -ne 900 -or $Scope.recoveryReserveSeconds -ne 120 -or $Scope.workflowRunAttempt -ne 1 -or $Scope.workflowRunId -cnotmatch '^\d+$' -or $Scope.attemptId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($Scope.sourceRevision -cne $Environment.GITHUB_SHA -or $Scope.workflowRunId -cne $Environment.GITHUB_RUN_ID) { throw 'ROTATION_ENTRY_CONTEXT_REQUIRED' }
 foreach ($key in @('configSha256','taskSha256','nodeSha256')) { if ($Scope.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Scope.dbPath -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]*$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 foreach ($part in $Scope.dbPath.Split([char]92)) { if ($part -in @('.','..') -or $part -match '[. ]$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 try { $issued=[datetimeoffset]::Parse($Scope.issuedAt);$expires=[datetimeoffset]::Parse($Scope.expiresAt) } catch { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($issued -gt $Now -or $expires -le $Now -or ($expires-$issued).TotalSeconds -gt 7200 -or ($expires-$Now).TotalSeconds -lt 900) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $files=Get-OwnerRotationEntrySources;Assert-OwnerRotationEntryShape $Scope.sourceHashes $files
 foreach ($file in $files) { if ($Scope.sourceHashes.$file -isnot [string] -or $Scope.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 Assert-OwnerRotationEntryShape $Scope.pcSidecars @('profile','expectedTaskFile','expectedObservationFile')
 foreach ($key in @('profile','expectedTaskFile','expectedObservationFile')) { if ($Scope.pcSidecars.$key -isnot [string]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Scope.pcSidecars.profile -cne 'jarvis-pc-sidecars-v1' -or $Scope.pcSidecars.expectedTaskFile -cnotin @('present','absent') -or $Scope.pcSidecars.expectedObservationFile -cnotin @('present','absent')) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $cohort=$Scope.cohortAuthority
 if ($null -eq $cohort -or $cohort.kind -isnot [string] -or ($cohort.expectedCount -isnot [int] -and $cohort.expectedCount -isnot [long]) -or $cohort.expectedCount -ne 38) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($cohort.kind -ceq 'approved-active-capture') { Assert-OwnerRotationEntryShape $cohort @('kind','expectedCount') }
 elseif ($cohort.kind -ceq 'original-cohort-digest') { Assert-OwnerRotationEntryShape $cohort @('kind','expectedCount','cohortSha256');if ($cohort.cohortSha256 -isnot [string] -or $cohort.cohortSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 else { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
}
# Check every existing component before reading bytes, including the checkout root.
# The original protected-path guard is imported only from this verified snapshot.
function Get-OwnerRotationEntrySafePath([string]$Path) {
 if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n\0]' -or $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 $full=[IO.Path]::GetFullPath($Path);$pathRoot=[IO.Path]::GetPathRoot($full);$currentPath=$pathRoot
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92 -and ($full -notmatch '^[A-Za-z]:\\[^:]*$' -or ([IO.DriveInfo]::new($pathRoot)).DriveType -ne [IO.DriveType]::Fixed)) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 foreach ($part in @('')+$full.Substring($pathRoot.Length).Split([IO.Path]::DirectorySeparatorChar)) {
  if ($part) { $currentPath=[IO.Path]::Combine($currentPath,$part) }
  try { $attributes=[IO.File]::GetAttributes($currentPath) } catch { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 }
 return $full
}
function Get-OwnerRotationEntrySourceSnapshot($Root,$Scope) {
 $snapshot=@{}
 foreach ($file in (Get-OwnerRotationEntrySources)) {
  $path=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($Root,$file));$item=[IO.FileInfo]::new($path);$item.Refresh()
  if (-not $item.Exists -or $item.Length -gt 1048576 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $bytes=[IO.File]::ReadAllBytes($path)
  if ($bytes.Length -gt 1048576 -or (Get-OwnerRotationEntryDigest $bytes) -cne $Scope.sourceHashes.$file) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $snapshot.Add($file,$bytes)
 }
 return $snapshot
}
function Assert-OwnerRotationEntryProtectedPath([string]$Path,[string]$OwnerSid) {
 # Omit OwnerProfile deliberately: the unchanged guard must walk all ancestors.
 try { Assert-OwnerRotationProtectedPath -Path $Path -OwnerSid $OwnerSid -NativeMetadata } catch { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
}
function Get-OwnerRotationEntryNode($Scope) {
 try {
  $commands=@(Get-Command node.exe -CommandType Application -ErrorAction Stop)
  if ($commands.Count -ne 1 -or [string]$commands[0].CommandType -cne 'Application' -or -not [IO.Path]::IsPathRooted($commands[0].Source)) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  $path=Get-OwnerRotationEntrySafePath $commands[0].Source
  if (-not [string]::Equals($path,$commands[0].Source,[StringComparison]::OrdinalIgnoreCase)) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  Assert-OwnerRotationEntryProtectedPath -Path $path -OwnerSid $Scope.ownerSid
  $item=[IO.FileInfo]::new($path);$item.Refresh()
  if (-not $item.Exists -or $item.Length -gt 268435456 -or (Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($path))) -cne $Scope.nodeSha256) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  return $path
 } catch { throw 'ROTATION_ENTRY_NODE_REJECTED' }
}
function Get-OwnerRotationEntryAdmission {
 $encoded=$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64
 if (-not $encoded -or $encoded.Length -gt 87384 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256 -cnotmatch '^[a-f0-9]{64}$' -or $env:JARVIS_PRODUCTION_CONFIG) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 try {
  $bytes=[Convert]::FromBase64String($encoded)
  if ($bytes.Length -gt 65536 -or [Convert]::ToBase64String($bytes) -cne $encoded) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
  $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes);$scope=ConvertFrom-OwnerRotationEntryJson $text
 } catch { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
 Assert-OwnerRotationEntryScope -Scope $scope -Environment $environment
 if ($env:OS -cne 'Windows_NT' -or [IO.Path]::DirectorySeparatorChar -ne [char]92 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage') { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' }
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 try { if ($identity.IsSystem -or $identity.User.Value -cne $scope.ownerSid -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' } } finally { $identity.Dispose() }
 $ownerProfile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
 if (-not $ownerProfile -or -not $env:USERPROFILE -or -not [string]::Equals([IO.Path]::GetFullPath($ownerProfile),[IO.Path]::GetFullPath($env:USERPROFILE),[StringComparison]::OrdinalIgnoreCase)) { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' }
 return @{scope=$scope;scopeBytes=$bytes;scopeHash=(Get-OwnerRotationEntryDigest $bytes);descriptorHash=$env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256;root=[IO.Path]::GetDirectoryName($PSScriptRoot);profile=[IO.Path]::GetFullPath($ownerProfile)}
}
function New-OwnerRotationEntryClaim($Admission) {
 $scope=$Admission.scope;$stage=[IO.Path]::Combine($Admission.profile,('.goriq-owner-rotation-1218-'+$scope.attemptId));$claimPath=$stage+'.claim'
 if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage)) { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
 $record=[ordered]@{schemaVersion=1;attemptId=$scope.attemptId;originalDescriptorSha256=$Admission.descriptorHash;runtimeScopeSha256=$Admission.scopeHash;sourceRevision=$scope.sourceRevision;workflowRunId=$scope.workflowRunId;workflowRunAttempt=$scope.workflowRunAttempt}
 $bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $record));$stream=$null
 try {
  try { $stream=[IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) } catch [IO.IOException] { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush()
 } finally { if ($stream) { $stream.Dispose() } }
 return $claimPath
}
function Write-OwnerRotationEntryNewFile([string]$Path,[byte[]]$Bytes) {
 $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try { $stream.Write($Bytes,0,$Bytes.Length);$stream.Flush() } finally { $stream.Dispose() }
}
function Initialize-OwnerRotationEntryStage {
 $ErrorActionPreference='Stop';$answer=[ordered]@{schemaVersion=1;complete=$false;failureCode='ROTATION_ENTRY_PREPARATION_FAILED';profileMatchesEnvironment=$false}
 try {
  $admission=Get-OwnerRotationEntryAdmission;$answer.profileMatchesEnvironment=$true;$scope=$admission.scope
  $snapshot=Get-OwnerRotationEntrySourceSnapshot -Root $admission.root -Scope $scope
  # Import the exact verified bytes, avoiding a second unbound read before import.
  . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($snapshot['scripts/rotate-jarvis-owner-code-windows.ps1']))) -Apply:$false -AuthorizationPath ''
  $ownerProfile=Get-OwnerRotationEntrySafePath $admission.profile
  Assert-OwnerRotationEntryProtectedPath -Path $ownerProfile -OwnerSid $scope.ownerSid
  foreach ($file in (Get-OwnerRotationEntrySources)) { Assert-OwnerRotationEntryProtectedPath -Path ([IO.Path]::Combine($admission.root,$file)) -OwnerSid $scope.ownerSid }
  $null=Get-OwnerRotationEntryNode -Scope $scope
  $claimPath=New-OwnerRotationEntryClaim -Admission $admission
  Assert-OwnerRotationEntryProtectedPath -Path $claimPath -OwnerSid $scope.ownerSid
  $stage=[IO.Path]::Combine($ownerProfile,('.goriq-owner-rotation-1218-'+$scope.attemptId))
  if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage)) { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
  $security=[Security.AccessControl.DirectorySecurity]::new();$security.SetAccessRuleProtection($true,$false);$security.SetOwner([Security.Principal.SecurityIdentifier]::new($scope.ownerSid))
  foreach ($sid in @($scope.ownerSid,'S-1-5-18','S-1-5-32-544')) { $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)) }
  # Create with security at creation; never repair or update an existing DACL.
  ([IO.DirectoryInfo]::new($stage)).Create($security)
  Assert-OwnerRotationEntryProtectedPath -Path $stage -OwnerSid $scope.ownerSid
  $null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'scripts'));$null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'.gai-results'))
  foreach ($file in (Get-OwnerRotationEntrySources)) {
   $target=[IO.Path]::Combine($stage,$file);Write-OwnerRotationEntryNewFile -Path $target -Bytes $snapshot[$file]
   Assert-OwnerRotationEntryProtectedPath -Path $target -OwnerSid $scope.ownerSid
   if ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $target)))) -cne $scope.sourceHashes.$file) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  }
  $receipt=[IO.Path]::Combine([IO.Path]::Combine($stage,'.gai-results'),'owner-code-rotation-scope.json')
  Write-OwnerRotationEntryNewFile -Path $receipt -Bytes $admission.scopeBytes
  Assert-OwnerRotationEntryProtectedPath -Path $receipt -OwnerSid $scope.ownerSid
  if ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $receipt)))) -cne $admission.scopeHash) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $answer.complete=$true;$answer.failureCode=$null
 } catch {
  $code=[string]$_.Exception.Message
  if ($code -cin @('ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED','ROTATION_ENTRY_PREPARATION_FAILED')) { $answer.failureCode=$code }
 }
 return $answer
}
if ($MyInvocation.InvocationName -ne '.') {
 if (-not $Prepare) { [Console]::Out.WriteLine('PLAN ONLY: native rotation preparation requires fresh exact-source authority; no Owner state is accessed.');exit 0 }
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules') }
 $result=Initialize-OwnerRotationEntryStage
 # Fixed protocol emission must also work if the trusted scope codec is unavailable.
 $failureJson=if ($null -eq $result.failureCode) { 'null' } else { '"'+$result.failureCode+'"' }
 [Console]::Out.WriteLine('{"schemaVersion":1,"complete":'+([bool]$result.complete).ToString().ToLowerInvariant()+',"failureCode":'+$failureJson+',"profileMatchesEnvironment":'+([bool]$result.profileMatchesEnvironment).ToString().ToLowerInvariant()+'}')
 if (-not $result.complete) { exit 1 }
}

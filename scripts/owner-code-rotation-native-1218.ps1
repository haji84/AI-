[CmdletBinding()]
param([switch]$Prepare,[switch]$PreparePublic)

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
 if($Admission.protectedClaim){try{New-OwnerLauncherProtectedFile -Path $claimPath -Bytes $bytes -OwnerSid $scope.ownerSid}catch{throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'};return $claimPath}
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
function Get-OwnerRotationPublicResource([string]$Uri) {
 if($Uri -cnotmatch '^https://(?:api\.github\.com/repos/haji84/AI-/|raw\.githubusercontent\.com/haji84/AI-/)[A-Za-z0-9?=._/-]+$'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $request=[Net.HttpWebRequest]::Create($Uri);$request.Method='GET';$request.AllowAutoRedirect=$false;$request.Timeout=10000;$request.ReadWriteTimeout=10000;$request.UserAgent='GORIQ-1218-public-rotation-grant';$request.Accept='application/vnd.github+json'
 $response=$null;$stream=$null;$memory=[IO.MemoryStream]::new()
 try{$response=$request.GetResponse();if([int]$response.StatusCode -ne 200){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$stream=$response.GetResponseStream();$buffer=New-Object byte[] 8192;while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){if($memory.Length+$count -gt 1048576){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$memory.Write($buffer,0,$count)};return ,$memory.ToArray()}finally{if($stream){$stream.Dispose()};if($response){$response.Dispose()};$memory.Dispose()}
}
function Assert-OwnerRotationPublicSource($Grant,[string]$Root) {
 $files=@((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')
 Assert-OwnerRotationEntryShape $Grant.sourceHashes $files
 if($Grant.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Grant.ciRunId -cnotmatch '^[1-9][0-9]{0,19}$' -or $Grant.ciRunAttempt -ne 1){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 $base='https://api.github.com/repos/haji84/AI-/'
 $main=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'git/ref/heads/main'))))
 $run=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'actions/runs/'+$Grant.ciRunId))))
 $jobs=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'actions/runs/'+$Grant.ciRunId+'/attempts/1/jobs?per_page=100'))))
 if($main.object.sha -cne $Grant.sourceRevision -or [string]$run.id -cne $Grant.ciRunId -or $run.run_attempt -ne 1 -or $run.name -cne 'CI' -or $run.path -cne '.github/workflows/ci.yml' -or $run.event -cne 'push' -or $run.head_branch -cne 'main' -or $run.head_sha -cne $Grant.sourceRevision -or $run.status -cne 'completed' -or $run.conclusion -cne 'success' -or @($jobs.jobs).Count -ne 4){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 foreach($name in @('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures')){if(@($jobs.jobs|Where-Object{$_.name -ceq $name -and $_.status -ceq 'completed' -and $_.conclusion -ceq 'success'}).Count -ne 1){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}}
 foreach($file in $files){
  if($Grant.sourceHashes.$file -isnot [string] -or $Grant.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $path=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($Root,$file));$item=[IO.FileInfo]::new($path);if($item.Length -gt 1048576){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $remote=Get-OwnerRotationPublicResource ('https://raw.githubusercontent.com/haji84/AI-/'+$Grant.sourceRevision+'/'+$file)
  if((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($path))) -cne $Grant.sourceHashes.$file -or (Get-OwnerRotationEntryDigest $remote) -cne $Grant.sourceHashes.$file){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 }
}

# The public boundary never accepts the private scope. Paths and runtime hashes
# below are acquired only from this same host, then retained in protected objects.
function Assert-OwnerRotationEntrySingleLink([string]$Path,[long]$Limit=1048576) {
 $safe=Get-OwnerRotationEntrySafePath $Path;$stream=$null;$other=$null
 try {
  $stream=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if($stream.Length -gt $Limit){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $first=Get-OwnerLauncherHandleIdentity -Stream $stream -Path $safe
  $other=[IO.File]::Open((Get-OwnerRotationEntrySafePath $safe),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $after=Get-OwnerLauncherHandleIdentity -Stream $other -Path $safe
  if($first.links -ne 1 -or $after.links -ne 1 -or $first.finalPath -ine $safe -or $after.finalPath -ine $safe -or $first.key -cne $after.key -or $stream.Length -ne $other.Length){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 } finally {if($other){$other.Dispose()};if($stream){$stream.Dispose()}}
}
function Get-OwnerRotationPublicAdmission {
 $encoded=$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64
 if(-not $encoded -or $encoded.Length -gt 87384 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $env:JARVIS_PRODUCTION_CONFIG){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 try{$bytes=[Convert]::FromBase64String($encoded);if([Convert]::ToBase64String($bytes) -cne $encoded -or $bytes.Length -gt 65536){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};$grant=ConvertFrom-OwnerRotationEntryJson ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))}catch{throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 if($grant.kind -cne 'NONSECRET_ORIGINAL_ROTATION_GRANT' -or $grant.profile -cne 'jarvis-owner-production-v1' -or $grant.operation -cne 'rotate-verify-restore-verify-original'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $root=[IO.Path]::GetDirectoryName($PSScriptRoot)
 # Authenticate public source against official current-main CI before importing code.
 Assert-OwnerRotationPublicSource -Grant $grant -Root $root
 $snapshot=Get-OwnerRotationEntrySourceSnapshot -Root $root -Scope $grant
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($snapshot['scripts/rotate-jarvis-owner-code-windows.ps1']))) -Apply:$false -AuthorizationPath ''
 $launcher=[IO.Path]::Combine($root,'scripts','owner-code-launcher-binding-inspection-1218.ps1')
 $safe=Get-OwnerRotationEntrySafePath $launcher;$helperBytes=[IO.File]::ReadAllBytes($safe)
 if($helperBytes.Length -gt 262144 -or (Get-OwnerRotationEntryDigest $helperBytes) -cne $grant.sourceHashes.'scripts/owner-code-launcher-binding-inspection-1218.ps1'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($helperBytes))) -Inspect:$false -AuthorizationPath ''
 $kernel=Get-OwnerLauncherKernelContext
 if($kernel.isSystem -or $kernel.sessionId -le 0 -or -not $kernel.interactive -or $kernel.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or (Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes($kernel.ownerSid))) -cne $grant.ownerSidSha256 -or $kernel.profile -ine $kernel.environmentProfile){throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED'}
 $profile=Get-OwnerRotationEntrySafePath $kernel.profile
 foreach($candidate in @([IO.Path]::Combine($profile,('.goriq-owner-rotation-1218-'+$grant.approvalId)),([IO.Path]::Combine($profile,('.goriq-owner-rotation-1218-'+$grant.approvalId))+'.claim'))){try{$null=[IO.File]::GetAttributes($candidate);throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'}catch [IO.FileNotFoundException]{}catch [IO.DirectoryNotFoundException]{}}
 Assert-OwnerRotationEntryProtectedPath -Path $profile -OwnerSid $kernel.ownerSid
 foreach($file in @((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){Assert-OwnerRotationEntryProtectedPath -Path ([IO.Path]::Combine($root,$file)) -OwnerSid $kernel.ownerSid}
 # No alternate executable is selected. The PATH interpreter must be the actual
 # parent Node executable, independently protected before any configuration read.
 $command=@(Get-Command node.exe -CommandType Application -ErrorAction Stop)
 if($command.Count -ne 1 -or [string]$command[0].CommandType -cne 'Application'){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 $node=Get-OwnerRotationEntrySafePath $command[0].Source
 Assert-OwnerRotationEntryProtectedPath -Path $node -OwnerSid $kernel.ownerSid
 $nodeItem=[IO.FileInfo]::new($node);if($nodeItem.Length -gt 268435456){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 Assert-OwnerRotationEntrySingleLink -Path $node -Limit 268435456
 $nodeHash=Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($node))
 $self=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID) -ErrorAction Stop
 $parent=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$self.ParentProcessId) -ErrorAction Stop
 if(-not $parent.ExecutablePath -or [IO.Path]::GetFullPath([string]$parent.ExecutablePath) -ine $node){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 # Execute only already protected exact public source. This independently checks
 # closed/canonical grant, actual workflow context and official current-main CI.
 $env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256=Get-OwnerRotationEntryDigest $bytes
 $entry=[IO.Path]::Combine($root,'scripts','owner-code-rotation-native-1218.mjs')
 $entryBytes=[IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $entry))
 if((Get-OwnerRotationEntryDigest $entryBytes) -cne $grant.sourceHashes.'scripts/owner-code-rotation-native-1218.mjs'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 $proof=@(& $node $entry --verify-public-grant 2>$null)
 if($LASTEXITCODE -ne 0 -or $proof.Count -ne 1 -or $proof[0] -cne 'PUBLIC_ROTATION_GRANT_VERIFIED'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 foreach($file in @((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){Assert-OwnerRotationEntrySingleLink -Path ([IO.Path]::Combine($root,$file))}
 Assert-OwnerRotationEntrySingleLink -Path ([IO.Path]::Combine($profile,'JARVIS','production','config.dpapi'))
 $admission=New-OwnerRotationLocalScope -Grant $grant -GrantBytes $bytes -Root $root -Kernel $kernel -Profile $profile -Node $node -NodeHash $nodeHash
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
 Assert-OwnerRotationEntryScope -Scope $admission.scope -Environment $environment
 Assert-OwnerRotationEntrySingleLink -Path $admission.scope.dbPath -Limit 268435456
 foreach($suffix in @('.pc-tasks.json','.pc-observations.json')){if([IO.File]::Exists($admission.scope.dbPath+$suffix)){Assert-OwnerRotationEntrySingleLink -Path ($admission.scope.dbPath+$suffix) -Limit 8388608}}
 $admission.helperBytes=$helperBytes
 return $admission
}
function Get-OwnerRotationHostTask { ScheduledTasks\Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop }
function Read-OwnerRotationHostConfiguration([string]$Path,[scriptblock]$Consumer) { & ([IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot),'scripts','read-jarvis-production-config.ps1')) -Path $Path -ConfigurationConsumer $Consumer|Out-Null }
function New-OwnerRotationLocalScope {
 param($Grant,[byte[]]$GrantBytes,[string]$Root,$Kernel,[string]$Profile,[string]$Node,[string]$NodeHash)
 $config=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($profile,'JARVIS','production','config.dpapi'))
 Assert-OwnerRotationEntryProtectedPath -Path $config -OwnerSid $kernel.ownerSid
 if((Get-Acl -LiteralPath $config -ErrorAction Stop).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $kernel.ownerSid){throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED'}
 $configItem=[IO.FileInfo]::new($config);if($configItem.Length -gt 1048576){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $configHash=Get-OwnerRotationHash $config;$task=Get-OwnerRotationHostTask
 if($task.State -cne 'Running'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 $taskHash=Get-OwnerRotationTaskHash $task
 $capture=@{value=$null};$consumer={param($configuration)$capture.value=$configuration}.GetNewClosure()
 try {
  Read-OwnerRotationHostConfiguration -Path $config -Consumer $consumer|Out-Null
  if(-not $capture.value -or $capture.value.commit -cnotmatch '^[a-f0-9]{40}$'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
  $configuration=$capture.value;$db=Get-OwnerRotationSafePath ([string]$configuration.environment.JARVIS_DB_PATH)
  $scope=[ordered]@{scopeId='issue:1218:owner-code-rotation';ownerSid=$kernel.ownerSid;issuedAt=$grant.issuedAt;expiresAt=$grant.expiresAt;sourceRevision=$grant.sourceRevision;sourceHashes=[ordered]@{};configSha256=$configHash;taskSha256=$taskHash;nodeSha256=$nodeHash;runtimeRevision=$configuration.commit;dbPath=$db;attemptId=$grant.approvalId;maxAttempts=1;maxDurationSeconds=900;recoveryReserveSeconds=120;cohortAuthority=$grant.cohortAuthority;pcSidecars=$grant.pcSidecars;workflowRunId=$env:GITHUB_RUN_ID;workflowRunAttempt=1}
  foreach($file in (Get-OwnerRotationEntrySources)){$scope.sourceHashes[$file]=$grant.sourceHashes.$file}
  foreach($flag in @('credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval')){$scope[$flag]=$grant.$flag}
  $scope=ConvertFrom-OwnerRotationEntryJson (ConvertTo-OwnerRotationEntryJson $scope)
  $context=[pscustomobject]@{Task=$task;NodePath=$node}
  Assert-OwnerRotationRuntimeConfiguration -Authorization $scope -Context $context -Configuration $configuration
  Assert-OwnerRotationDatabase -Authorization $scope -Context $context
  $release=Get-OwnerRotationEntrySafePath ([string]$configuration.releaseRoot);Assert-OwnerRotationEntryProtectedPath -Path $release -OwnerSid $kernel.ownerSid
  # Capture must not silently bind a mixed context across decryption or task I/O.
  if((Get-OwnerRotationHash $config) -cne $configHash -or (Get-OwnerRotationTaskHash (Get-OwnerRotationHostTask)) -cne $taskHash -or (Get-OwnerRotationHash $node) -cne $nodeHash){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
  foreach($pair in @(@('.pc-tasks.json','expectedTaskFile'),@('.pc-observations.json','expectedObservationFile'))){$exists=[IO.File]::Exists($db+$pair[0]);if($exists -ne ($scope.pcSidecars.($pair[1]) -ceq 'present')){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}}
  $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
  $scopeBytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $scope))
  return @{scope=$scope;scopeBytes=$scopeBytes;scopeHash=(Get-OwnerRotationEntryDigest $scopeBytes);descriptorHash=(Get-OwnerRotationEntryDigest $GrantBytes);root=$root;profile=$profile;protectedClaim=$true;publicGrantBytes=$GrantBytes;publicGrant=$grant}
 } finally {$capture.value=$null;$configuration=$null}
}

function Initialize-OwnerRotationEntryStage {
 param($PublicAdmission)
 $ErrorActionPreference='Stop';$answer=[ordered]@{schemaVersion=1;complete=$false;failureCode='ROTATION_ENTRY_PREPARATION_FAILED';profileMatchesEnvironment=$false}
 try {
  $admission=if($null -ne $PublicAdmission){$PublicAdmission}else{Get-OwnerRotationEntryAdmission};$answer.profileMatchesEnvironment=$true;$scope=$admission.scope
  $snapshot=Get-OwnerRotationEntrySourceSnapshot -Root $admission.root -Scope $scope
  . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($snapshot['scripts/rotate-jarvis-owner-code-windows.ps1']))) -Apply:$false -AuthorizationPath ''
  if($admission.protectedClaim){
   . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($admission.helperBytes))) -Inspect:$false -AuthorizationPath ''
   foreach($extra in @('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){
    $source=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($admission.root,$extra));Assert-OwnerRotationEntryProtectedPath -Path $source -OwnerSid $scope.ownerSid
    $data=[IO.File]::ReadAllBytes($source);if($data.Length -gt 1048576 -or (Get-OwnerRotationEntryDigest $data) -cne $admission.publicGrant.sourceHashes.$extra){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$snapshot[$extra]=$data
   }
  }
  # Import the exact verified bytes, avoiding a second unbound read before import.
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
  foreach ($file in $snapshot.Keys) {
   $target=[IO.Path]::Combine($stage,$file);Write-OwnerRotationEntryNewFile -Path $target -Bytes $snapshot[$file]
   Assert-OwnerRotationEntryProtectedPath -Path $target -OwnerSid $scope.ownerSid
   if ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $target)))) -cne $(if($admission.protectedClaim){$admission.publicGrant.sourceHashes.$file}else{$scope.sourceHashes.$file})) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  }
  if($admission.protectedClaim){New-OwnerLauncherProtectedFile -Path ([IO.Path]::Combine($stage,'.gai-results','original-grant.json')) -Bytes $admission.publicGrantBytes -OwnerSid $scope.ownerSid}
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
 if (-not $Prepare -and -not $PreparePublic) { [Console]::Out.WriteLine('PLAN ONLY: native rotation preparation requires fresh exact-source authority; no Owner state is accessed.');exit 0 }
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules') }
 $result=if($PreparePublic){try{$public=Get-OwnerRotationPublicAdmission;Initialize-OwnerRotationEntryStage -PublicAdmission $public}catch{$code=[string]$_.Exception.Message;if($code -cnotin @('ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED')){$code='ROTATION_ENTRY_PREPARATION_FAILED'};@{schemaVersion=1;complete=$false;failureCode=$code;profileMatchesEnvironment=$false}}}else{Initialize-OwnerRotationEntryStage}
 # Fixed protocol emission must also work if the trusted scope codec is unavailable.
 $failureJson=if ($null -eq $result.failureCode) { 'null' } else { '"'+$result.failureCode+'"' }
 [Console]::Out.WriteLine('{"schemaVersion":1,"complete":'+([bool]$result.complete).ToString().ToLowerInvariant()+',"failureCode":'+$failureJson+',"profileMatchesEnvironment":'+([bool]$result.profileMatchesEnvironment).ToString().ToLowerInvariant()+'}')
 if (-not $result.complete) { exit 1 }
}

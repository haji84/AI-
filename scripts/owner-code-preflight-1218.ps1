# Fixed read-only acceptance preflight. Never invoke the credential reader or -Apply.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$script:PreflightRoot = Split-Path -Parent $PSScriptRoot
$script:LastSourceArtifact = $null

function Get-1218FileMetadata {
 param([string]$Path, [long]$Limit = 4194304)
 $result = [ordered]@{state='rejected-path';present=$false;sha256=$null;sizeBytes=$null}
 try {
  $windows=[IO.Path]::DirectorySeparatorChar -eq [char]92
  if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '^[\\/]{2}' -or
      ($windows -and $Path -notmatch '^[A-Za-z]:[\\/]') -or
      ($Path -match ':' -and $Path -notmatch '^[A-Za-z]:[\\/][^:]*$')) { return [pscustomobject]$result }
  $full=[IO.Path]::GetFullPath($Path)
  $root=[IO.Path]::GetPathRoot($full)
  if ($windows -and ($full -notmatch '^[A-Za-z]:\\' -or
      ([IO.DriveInfo]::new($root)).DriveType -ne [IO.DriveType]::Fixed)) { return [pscustomobject]$result }
  # Inspect every ancestor before descending; Test-Path on the full child could follow a network junction.
  $current=$root
  $parts=@($full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar) | Where-Object { $_.Length -gt 0 })
  $item=Get-Item -LiteralPath $root -Force
  foreach ($part in $parts) {
   if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.state='reparse'; return [pscustomobject]$result }
   $current=Join-Path $current $part
   try { $item=Get-Item -LiteralPath $current -Force } catch {
    $result.state=if ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) { 'missing' } else { 'unreadable' }
    return [pscustomobject]$result
   }
  }
  $result.present=$true
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.state='reparse'; return [pscustomobject]$result }
  if ($item -isnot [IO.FileInfo]) { $result.state='not-regular'; return [pscustomobject]$result }
  if ($item.Length -gt $Limit) { $result.state='oversize'; return [pscustomobject]$result }
  $result.state='regular'; $result.sizeBytes=$item.Length
  $result.sha256=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
 } catch { $result.state='unreadable' }
 return [pscustomobject]$result
}

function Get-1218ReviewedArtifacts {
 param([string]$Root)
 $pins=[ordered]@{
  'owner-code-windows.ps1'='e8f0fe68f5ca8c6d8f5056299c1e805e05663d6782e744a69692ee5512262f43'
  'read-jarvis-production-config.ps1'='252f057b933ddd16c8eec85507fd43b084cf9f0cdba1ded93746ad5e199cccb5'
  'install-owner-code-windows.ps1'='160b03d5660831717cdf8b3ca2501cda56d474d5fd2b0c72f750320971ef1ad6'
  'rotate-jarvis-owner-code-windows.ps1'='588cae41ffdc4aac330629877e4757844e489fb737564bd0465f7a1f5cfa00f3'
 }
 $artifacts=@()
 foreach ($name in $pins.Keys) {
  $file=Join-Path (Join-Path $Root 'scripts') $name
  $script:LastSourceArtifact=@{name=$name;state='unobserved';sha256=$null;expectedSha256=$pins[$name]}
  $meta=Get-1218FileMetadata $file -Limit 262144
  $script:LastSourceArtifact.state=$meta.state; $script:LastSourceArtifact.sha256=$meta.sha256
  if ($meta.state -ne 'regular' -or $meta.sha256 -cne $pins[$name]) { throw 'UNREVIEWED_SOURCE' }
  $tokens=$null; $errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
  if (@($errors).Count -ne 0) { throw 'SOURCE_PARSE_FAILED' }
  $artifacts+=@{name=$name;sha256=$meta.sha256;astErrorCount=0;parameters=@($ast.ParamBlock.Parameters | ForEach-Object {$_.Name.VariablePath.UserPath})}
 }
 return $artifacts
}

function Invoke-1218PlanOnly {
 param([string]$Root)
 Get-1218ReviewedArtifacts $Root | Out-Null
 $rotation=Join-Path (Join-Path $Root 'scripts') 'rotate-jarvis-owner-code-windows.ps1'
 $binary=(Get-Process -Id $PID).Path
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$binary
 $info.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$rotation+'"'
 $info.UseShellExecute=$false; $info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
 $process=New-Object Diagnostics.Process
 $process.StartInfo=$info
 try {
  if (-not $process.Start()) { throw 'PLAN_START_FAILED' }
  $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(15000)) { $process.Kill(); $null=$process.WaitForExit(2000); throw 'PLAN_TIMEOUT' }
  $expected='PLAN ONLY: Owner-local credential rotation requires a separate, unexpired issue:1218 approval receipt. No credential or task was changed.'
  $matched=$process.ExitCode -eq 0 -and $stdout.Result.Trim() -ceq $expected -and $stderr.Result.Trim().Length -eq 0
  return [pscustomobject]@{exitCode=$process.ExitCode;noArguments=$true;expectedOutputMatched=$matched}
 } finally { if (-not $process.HasExited) { $process.Kill(); $null=$process.WaitForExit(2000) }; $process.Dispose() }
}

# Observations of the unchanged practical guards; never approval or a practical PASS.
function Get-1218OwnerPathProtection {
 param([string]$Path,[string]$OwnerProfile,[string]$OwnerSid)
 $result=@{state='rejected';reasonCode='PATH_METADATA_UNAVAILABLE'}
 try {
  . (Join-Path $PSScriptRoot 'install-owner-code-windows.ps1')
  $current=Get-OwnerCodeInstallPath $Path
  while (-not (Test-Path -LiteralPath $current)) { $current=Split-Path -Parent $current }
  if ($current -ine $OwnerProfile -and -not $current.StartsWith($OwnerProfile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'OWNER_PROFILE_PATH_REQUIRED' }
  $trusted=@($OwnerSid,'S-1-5-18','S-1-5-32-544','S-1-3-0')
  $writeMask=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  while ($true) {
   $acl=Get-Acl -LiteralPath $current
   if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($OwnerSid,'S-1-5-18','S-1-5-32-544')) { throw 'PUBLIC_PATH_OWNER_UNSUITABLE' }
   foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or ($rule.FileSystemRights -band $writeMask) -eq 0) { continue }
    if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'PUBLIC_DIRECTORY_PROTECTION_UNSUITABLE' }
   }
   if ($current -ieq $OwnerProfile) { break }
   $current=Split-Path -Parent $current
  }
  $result=@{state='ready';reasonCode='PATH_PROTECTION_MATCHED'}
 } catch {
  $code=[string]$_.Exception.Message
  if ($code -in @('LOCAL_PATH_REQUIRED','LOCAL_DRIVE_REQUIRED','FIXED_DRIVE_REQUIRED','REPARSE_PATH','OWNER_PROFILE_PATH_REQUIRED','PUBLIC_PATH_OWNER_UNSUITABLE','PUBLIC_DIRECTORY_PROTECTION_UNSUITABLE')) { $result.reasonCode=$code }
 }
 return [pscustomobject]$result
}

function Get-1218EncryptedReadLock {
 param([string]$Path,[string]$ExpectedSha256)
 $result=@{state='rejected';reasonCode='READ_LOCK_UNAVAILABLE'}; $locked=$null
 try {
  if ($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'INVALID_CIPHER_HASH' }
  . (Join-Path $PSScriptRoot 'install-owner-code-windows.ps1')
  $local=Get-OwnerCodeInstallPath $Path
  $item=Get-Item -LiteralPath $local -Force
  if ($item -isnot [IO.FileInfo] -or $item.Length -gt 4194304) { throw 'INVALID_CIPHER_FILE' }
  $locked=[IO.File]::Open($local,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if ((Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash -ine $ExpectedSha256) { $result.reasonCode='CONFIGURATION_CHANGED_UNDER_LOCK' }
  else { $result=@{state='ready';reasonCode='READ_LOCK_AND_HASH_MATCHED'} }
 } catch {} finally { if ($locked) { try { $locked.Dispose() } catch { $result=@{state='rejected';reasonCode='READ_LOCK_UNAVAILABLE'} } } }
 return [pscustomobject]$result
}

function Get-1218PracticalReadiness {
 param([string]$Origin,[string]$ConfigurationPath,[string]$ConfigSha256,[string]$OwnerSid,[bool]$IsSystem)
 $result=[ordered]@{state='not-checked';reasonCode='OWNER_PROFILE_CONFIGURATION_REQUIRED';profileMatchesEnvironment=$null;encryptedReadLock=$null;paths=@()}
 if ($Origin -cne 'owner-profile' -or $env:JARVIS_PRODUCTION_CONFIG) { return [pscustomobject]$result }
 try {
  $result.reasonCode='OWNER_MAIN_CONTEXT_REQUIRED'
  if ($env:OS -ne 'Windows_NT' -or $env:GITHUB_ACTOR -cne 'haji84' -or $env:GITHUB_REPOSITORY -cne 'haji84/AI-' -or $env:GITHUB_REF -cne 'refs/heads/main' -or $env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$' -or $IsSystem -or (Get-Process -Id $PID).SessionId -eq 0 -or -not [Environment]::UserInteractive) { return [pscustomobject]$result }
  $profile=[Environment]::GetFolderPath('UserProfile')
  $result.profileMatchesEnvironment=$profile -ieq [IO.Path]::GetFullPath($env:USERPROFILE)
  $result.reasonCode='PROFILE_MISMATCH'
  if (-not $result.profileMatchesEnvironment -or $ConfigurationPath -ine (Join-Path $profile 'JARVIS\production\config.dpapi')) { return [pscustomobject]$result }
  $result.encryptedReadLock=Get-1218EncryptedReadLock -Path $ConfigurationPath -ExpectedSha256 $ConfigSha256
  $targets=[ordered]@{'owner-profile'=$profile;'tool-parent'=(Join-Path $profile 'JARVIS\tools\owner-code');'desktop'=[Environment]::GetFolderPath('DesktopDirectory');'start-menu'=[Environment]::GetFolderPath('Programs');'encrypted-config'=$ConfigurationPath}
  foreach ($role in $targets.Keys) { $observation=Get-1218OwnerPathProtection -Path $targets[$role] -OwnerProfile $profile -OwnerSid $OwnerSid; $result.paths+=@{role=$role;state=$observation.state;reasonCode=$observation.reasonCode} }
  $result.state='observed';$result.reasonCode='READ_ONLY_GUARDS_OBSERVED'
 } catch { $result.state='unavailable';$result.reasonCode='PRACTICAL_METADATA_UNAVAILABLE' }
 return [pscustomobject]$result
}

# Closed observations only. No receipt, runtime, DPAPI or database is accessed.
# Even matching metadata cannot authorize or verify an actual rotation.
function New-1218RotationProtectionDiagnostics {
 $paths=[ordered]@{}
 foreach ($role in @('pathNode','taskNode','releaseRoot','releaseManifest')) { $paths[$role]=@{legacy='notObserved';native='notObserved'} }
 return [ordered]@{schemaVersion=1;readOnly=$true;proof='UNVERIFIED';state='NOT_OBSERVED';cause='UNKNOWN';authorizationGranted=$false;actualAcceptanceConditionsPassed=0;paths=$paths}
}

function New-1218RotationProtectionRoleObservation {
 return @{state='NOT_OBSERVED';predicate='UNKNOWN';location='NOT_OBSERVED';ownerClass='NOT_OBSERVED'}
}
function New-1218RotationProtectionFailureDetails {
 $paths=[ordered]@{}
 foreach ($role in @('pathNode','taskNode','releaseRoot','releaseManifest')) { $paths[$role]=New-1218RotationProtectionRoleObservation }
 return [ordered]@{schemaVersion=1;readOnly=$true;proof='UNVERIFIED';measurement='CURRENT_OBSERVATION';priorCause='UNKNOWN';state='NOT_OBSERVED';authorizationGranted=$false;actualAcceptanceConditionsPassed=0;paths=$paths}
}

# Public source was measured before the original metadata calls. Check only
# that record and the loaded ASTs here; do not remeasure a file or trust errors.
function Test-1218RotationObservationPolicy {
 try {
  $pin='588cae41ffdc4aac330629877e4757844e489fb737564bd0465f7a1f5cfa00f3'
  $proof=$script:LastSourceArtifact
  if ($null -eq $proof -or $proof.name -cne 'rotate-jarvis-owner-code-windows.ps1' -or $proof.state -cne 'regular' -or $proof.sha256 -cne $pin -or $proof.expectedSha256 -cne $pin) { return $false }
  $expected=[IO.Path]::Combine($PSScriptRoot,'rotate-jarvis-owner-code-windows.ps1')
  $comparison=if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  $bodies=@{nativeItem=${function:Get-OwnerRotationNativeItem};safePath=${function:Get-OwnerRotationSafePath};protectedPath=${function:Assert-OwnerRotationProtectedPath}}
  $hashes=@{nativeItem='0db776a27ce5c1bb8944f1644d3a3247f53576b45062034439a0cb94afa5daa9';safePath='8fe9e539740f5fb7e00a8cba20cd09b84fb4df115adeca19de18af78154461ab';protectedPath='a936165a8bed48b80aeb1f0b62be02f72bd12c1bf5186fbbee63b3b5af7aceb5'}
  foreach ($key in @('nativeItem','safePath','protectedPath')) {
   $body=$bodies[$key]
   if ($null -eq $body -or -not [string]::Equals($body.File,$expected,$comparison)) { return $false }
   $sha=[Security.Cryptography.SHA256]::Create()
   try { $actual=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body.Ast.Extent.Text)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
   if ($actual -cne $hashes[$key]) { return $false }
  }
  return $true
 } catch { return $false }
}

# This is a later CURRENT observation, never authentication of an ErrorRecord
# or a replacement for the original guard. Keep its pinned native policy exact.
function Get-1218CurrentRotationProtectionObservation {
 param([string]$Path,[string]$OwnerSid)
 $unknown=New-1218RotationProtectionRoleObservation;$unknown.state='UNAVAILABLE'
 try {
  if (-not (Test-1218RotationObservationPolicy) -or $OwnerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$') { return $unknown }
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n\0]' -or $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)) { return @{state='CURRENT_REFUSAL';predicate='pathShapeRefused';location='pathInput';ownerClass='NOT_OBSERVED'} }
  $full=[IO.Path]::GetFullPath($Path);$pathRoot=[IO.Path]::GetPathRoot($full)
  if ([IO.Path]::DirectorySeparatorChar -eq [char]92 -and ($full -notmatch '^[A-Za-z]:\\[^:]*$' -or ([IO.DriveInfo]::new($pathRoot)).DriveType -ne [IO.DriveType]::Fixed)) { return @{state='CURRENT_REFUSAL';predicate='pathOrDriveContextRefused';location='pathInput';ownerClass='NOT_OBSERVED'} }
  # The cap bounds this optional observer only. A partial walk never matches.
  $budget=[int[]]@(512)
  function Get-1218ObservationNativeItem([string]$Value) {
   $budget[0]--;if ($budget[0] -lt 0) { throw 'OBSERVATION_UNAVAILABLE' }
   Get-OwnerRotationNativeItem $Value
  }
  function Get-1218ObservationTier([string]$Value) {
   $separators=[char[]]@([char]92,[char]47)
   $observed=$Value.TrimEnd($separators);$selected=$full.TrimEnd($separators)
   if ([string]::Equals($observed,$pathRoot.TrimEnd($separators),$comparison)) { return 'volumeRoot' }
   if ([string]::Equals($observed,$selected,$comparison)) { return 'leaf' }
   if ([string]::Equals($observed,[IO.Path]::GetDirectoryName($selected),$comparison)) { return 'parent' }
   return 'ancestor'
  }
  function New-1218CurrentRefusal([string]$Predicate,[string]$Value,[string]$OwnerClass='NOT_OBSERVED') {
   return @{state='CURRENT_REFUSAL';predicate=$Predicate;location=(Get-1218ObservationTier $Value);ownerClass=$OwnerClass}
  }
  $comparison=if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
  # The original comparison calls SafePath, then its native guard calls it
  # again. Preserve both prefix walks, stopping before a reparse descent.
  foreach ($pass in @(0,1)) {
   $item=Get-1218ObservationNativeItem $pathRoot;$current=$pathRoot
   if ($null -eq $item -or $item -isnot [IO.DirectoryInfo]) { return (New-1218CurrentRefusal 'rootMetadataRefused' $current) }
   foreach ($part in $full.Substring($pathRoot.Length).Split([IO.Path]::DirectorySeparatorChar)) {
    if (-not $part) { continue }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return (New-1218CurrentRefusal 'reparseRefused' $current) }
    $current=[IO.Path]::Combine($current,$part);$item=Get-1218ObservationNativeItem $current
    if ($null -eq $item) { break }
   }
   if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return (New-1218CurrentRefusal 'reparseRefused' $current) }
  }
  $current=$full
  while ($null -eq (Get-1218ObservationNativeItem $current)) {
   $previous=$current;$current=[IO.Path]::GetDirectoryName($current)
   if (-not $current) { return (New-1218CurrentRefusal 'metadataRefused' $previous) }
  }
  $trusted=@($OwnerSid,'S-1-5-18','S-1-5-32-544','S-1-3-0');$depth=0
  $fullWrite=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
  while ($true) {
   $write=if ($depth -le 1) { $fullWrite } else { [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership' }
   $item=Get-1218ObservationNativeItem $current
   if ($null -eq $item) { return (New-1218CurrentRefusal 'metadataRefused' $current) }
   $budget[0]--;if ($budget[0] -lt 0) { return $unknown }
   $acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner)
   $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
   $ownerClass=if ($owner -eq $OwnerSid) { 'owner' } elseif ($owner -eq 'S-1-5-18') { 'system' } elseif ($owner -eq 'S-1-5-32-544') { 'administrators' } elseif ($owner -eq 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') { 'trustedInstaller' } else { 'other' }
   if ($owner -notin @($OwnerSid,'S-1-5-18','S-1-5-32-544')) { return (New-1218CurrentRefusal 'ownerOutsideTrustSet' $current $ownerClass) }
   $rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
   foreach ($rule in $rules) {
    if ($rule.IdentityReference -isnot [Security.Principal.SecurityIdentifier]) { return (New-1218CurrentRefusal 'nonSidAccessRuleRefused' $current $ownerClass) }
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.FileSystemRights -band $write) -ne 0) {
     if ($rule.IdentityReference.Value -notin $trusted) { return (New-1218CurrentRefusal 'writeOutsideTrustSet' $current $ownerClass) }
    }
   }
   if ($current -ieq $pathRoot) { break };$current=[IO.Path]::GetDirectoryName($current);$depth++
  }
  return @{state='CURRENT_MATCH';predicate='policyMatched';location='NOT_OBSERVED';ownerClass='NOT_OBSERVED'}
 } catch { return $unknown }
}

function Set-1218RotationProtectionFailureDetails {
 param([Collections.IDictionary]$Details,[Collections.IDictionary]$SelectedPaths,[Collections.IDictionary]$Diagnostics,[string]$OwnerSid)
 try {
  $null=$Details.paths # Fail before extra I/O for an unusable collector.
  $policy=Test-1218RotationObservationPolicy
  foreach ($role in @('pathNode','taskNode','releaseRoot','releaseManifest')) {
   if (-not $SelectedPaths.Contains($role)) { continue }
   $observation=New-1218RotationProtectionRoleObservation;$observation.state='UNAVAILABLE'
   if ($policy) {
    $outcome=$Diagnostics.paths[$role].native
    if ($outcome -ceq 'notObserved') { continue }
    if ($outcome -ceq 'policyMatched') { $observation=@{state='CURRENT_MATCH';predicate='policyMatched';location='NOT_OBSERVED';ownerClass='NOT_OBSERVED'} }
    elseif ($outcome -ceq 'guardRefusedCauseUnknown') {
     try {
      $values=@(Get-1218CurrentRotationProtectionObservation -Path $SelectedPaths[$role] -OwnerSid $OwnerSid)
      if ($values.Count -ne 1 -or $values[0] -isnot [Collections.IDictionary] -or $values[0].Count -ne 4) { throw 'OBSERVATION_UNAVAILABLE' }
      $candidate=$values[0]
      foreach ($key in @('state','predicate','location','ownerClass')) { if ($candidate.Keys -cnotcontains $key -or $candidate[$key] -isnot [string]) { throw 'OBSERVATION_UNAVAILABLE' } }
      if ($candidate.state -cnotin @('CURRENT_MATCH','CURRENT_REFUSAL','UNAVAILABLE') -or $candidate.predicate -cnotin @('UNKNOWN','policyMatched','pathShapeRefused','pathOrDriveContextRefused','rootMetadataRefused','reparseRefused','metadataRefused','ownerOutsideTrustSet','nonSidAccessRuleRefused','writeOutsideTrustSet') -or $candidate.location -cnotin @('NOT_OBSERVED','pathInput','leaf','parent','ancestor','volumeRoot') -or $candidate.ownerClass -cnotin @('NOT_OBSERVED','owner','system','administrators','trustedInstaller','other')) { throw 'OBSERVATION_UNAVAILABLE' }
      if (($candidate.state -ceq 'CURRENT_MATCH' -and ($candidate.predicate -cne 'policyMatched' -or $candidate.location -cne 'NOT_OBSERVED' -or $candidate.ownerClass -cne 'NOT_OBSERVED')) -or ($candidate.state -ceq 'UNAVAILABLE' -and ($candidate.predicate -cne 'UNKNOWN' -or $candidate.location -cne 'NOT_OBSERVED' -or $candidate.ownerClass -cne 'NOT_OBSERVED')) -or ($candidate.state -ceq 'CURRENT_REFUSAL' -and ($candidate.predicate -cin @('UNKNOWN','policyMatched') -or $candidate.location -ceq 'NOT_OBSERVED'))) { throw 'OBSERVATION_UNAVAILABLE' }
      $observation=@{state=$candidate.state;predicate=$candidate.predicate;location=$candidate.location;ownerClass=$candidate.ownerClass}
     } catch { }
    }
   }
   $Details.paths[$role]=$observation
   if ($observation.state -cin @('CURRENT_MATCH','CURRENT_REFUSAL')) { $Details.state='OBSERVED' } elseif ($Details.state -cne 'OBSERVED') { $Details.state='UNAVAILABLE' }
  }
 } catch { } # Neither output nor errors may alter the captured old results.
}

# Informational comparison only. It cannot supply bytes or change the legacy
# guard's result. Fixed refusals do not distinguish path, ACL or context cause.
function Set-1218RotationProtectionDiagnostic {
 param([Collections.IDictionary]$Diagnostics,[string]$Role,[string]$Path,[string]$OwnerSid,$LegacyError)
 try {
  $legacy='policyMatched'
  if ($null -ne $LegacyError) {
   $legacy='observationUnavailable'
   $commands=@('Get-Item','Join-Path','Test-Path','Split-Path','Get-Acl')
   if ($LegacyError.Exception -is [Management.Automation.CommandNotFoundException] -and
       (($LegacyError.Exception.CommandName -is [string] -and $LegacyError.Exception.CommandName -cin $commands) -or
        ($LegacyError.TargetObject -is [string] -and $LegacyError.TargetObject -cin $commands))) { $legacy='commandUnavailable' }
   elseif ($LegacyError.Exception.Message -ceq 'ROTATION_CONTEXT_UNAVAILABLE') { $legacy='guardRefusedCauseUnknown' }
  }
  $Diagnostics.paths[$Role]=@{legacy=$legacy;native='unavailable'}
  $Diagnostics.state='OBSERVED'
  try {
   $safe=Get-OwnerRotationSafePath -Path $Path -NativeMetadata
   # No OwnerProfile: retain the existing guard's complete ancestor walk.
   Assert-OwnerRotationProtectedPath -Path $safe -OwnerSid $OwnerSid -NativeMetadata | Out-Null
   $Diagnostics.paths[$Role].native='policyMatched'
  } catch {
   if ($_.Exception.Message -ceq 'ROTATION_CONTEXT_UNAVAILABLE') { $Diagnostics.paths[$Role].native='guardRefusedCauseUnknown' }
  }
 } catch { } # A broken optional collector cannot affect legacy observations.
}

function Get-1218RotationMetadata {
 param($Task,[string]$OwnerSid,[string]$OwnerName,[Collections.IDictionary]$ProtectionDiagnostics,[Collections.IDictionary]$ProtectionFailureDetails)
 $selectedProtectionPaths=@{}
 $effectiveDiagnostics=$ProtectionDiagnostics
 if ($null -ne $ProtectionFailureDetails -and $null -eq $effectiveDiagnostics) { $effectiveDiagnostics=New-1218RotationProtectionDiagnostics }
 $result=[ordered]@{schemaVersion=1;readOnly=$true;proof='UNVERIFIED';actualAcceptanceConditionsPassed=0;readyForRotation=$false;actionKind='missing';taskSha256=$null;currentOwnerPrincipalMatch=$null;taskRunning=$null;pathNode=@{state='unverified';sha256=$null;sizeBytes=$null;protection='unverified'};taskNode=@{state='unverified';sha256=$null;sizeBytes=$null;protection='unverified'};pathNodeMatchesTaskNodeBytes=$null;pathNodeMatchesTaskNodePath=$null;releaseManifest=@{state='unverified';sha256=$null;revision=$null;protection='unverified'};directNodeGuardShapeMatches=$null}
 if ($null -eq $Task) { return $result }
 try {
  $result.actionKind='unsupported'
  $actions=@($Task.Actions)
  $principal=[string]$Task.Principal.UserId
  $result.currentOwnerPrincipalMatch=($OwnerSid -cmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -and ($principal -ceq $OwnerSid -or (-not [string]::IsNullOrWhiteSpace($OwnerName) -and $principal -ieq $OwnerName)))
  if ([string]$Task.State -in @('Unknown','Disabled','Queued','Ready','Running')) { $result.taskRunning=[string]$Task.State -ceq 'Running' }
  if ($actions.Count -ne 1 -or [string]$Task.TaskName -cne 'JARVIS Remote Host' -or [string]$Task.TaskPath -cne '\' -or
      [string]$Task.Principal.LogonType -notin @('Password','S4U','Interactive','InteractiveToken','InteractiveOrPassword') -or [string]$Task.Principal.RunLevel -notin @('Limited','Highest')) { return $result }
  # Classify strings before inspecting a path or hashing potentially private args.
  $action=$actions[0];$root=[string]$action.WorkingDirectory;$execute=[string]$action.Execute
  foreach ($path in @($root,$execute)) {
   if ([string]::IsNullOrWhiteSpace($path) -or $path -match '[\r\n\0"<>|]' -or $path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($path) -or
       ([IO.Path]::DirectorySeparatorChar -eq [char]92 -and $path -notmatch '^[A-Za-z]:[\\/][^:]*$') -or [IO.Path]::GetFullPath($path) -ine $path) { return $result }
  }
  if ([IO.Path]::GetFileName($execute) -ieq 'node.exe' -and [string]$action.Arguments -ceq ('"'+(Join-Path (Join-Path $root 'scripts') 'jarvis-remote-host.mjs')+'"')) { $result.actionKind='direct-node-host' }
  elseif ($env:SystemRoot -and $env:LOCALAPPDATA -and $execute -ieq (Join-Path (Join-Path (Join-Path (Join-Path $env:SystemRoot 'System32') 'WindowsPowerShell') 'v1.0') 'powershell.exe') -and
          [string]$action.Arguments -ceq ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+(Join-Path (Join-Path (Join-Path $env:LOCALAPPDATA 'JARVIS') 'production') 'launch-current.ps1')+'"')) { $result.actionKind='compatibility-launcher';$result.directNodeGuardShapeMatches=$false }
  else { return $result }
  # Task Scheduler may return the current local account without its machine
  # prefix. Resolve only that known local spelling, then require the same SID.
  if (-not $result.currentOwnerPrincipalMatch -and $OwnerSid -cmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -and -not [string]::IsNullOrWhiteSpace($OwnerName)) {
   $ownerParts=@($OwnerName.Split([char]92))
   if ($ownerParts.Length -eq 2 -and $ownerParts[0] -ieq [Environment]::MachineName -and $principal -ieq $ownerParts[1]) {
    try {
     $resolvedPrincipalSid=([Security.Principal.NTAccount]::new([Environment]::MachineName,$principal)).Translate([Security.Principal.SecurityIdentifier]).Value
     $result.currentOwnerPrincipalMatch=$resolvedPrincipalSid -ceq $OwnerSid
    } catch { $result.currentOwnerPrincipalMatch=$false }
   }
  }
  if (-not $result.currentOwnerPrincipalMatch) { return $result }
  # This import only defines functions. Its Apply/AuthorizationPath parameters
  # stay in this function scope; its executable entry guard excludes dot-source.
  . (Join-Path $PSScriptRoot 'rotate-jarvis-owner-code-windows.ps1') -Apply:$false -AuthorizationPath ''
  $result.taskSha256=Get-OwnerRotationTaskHash $Task
  function Get-1218RotationProtectedPath([string]$Path,[string]$Role) {
   if ($null -ne $ProtectionFailureDetails) { $selectedProtectionPaths[$Role]=$Path }
   $safe=$null;$legacyError=$null
   try { $safe=Get-OwnerRotationSafePath $Path;Assert-OwnerRotationProtectedPath -Path $safe -OwnerSid $OwnerSid } catch { $legacyError=$_ }
   if ($null -ne $effectiveDiagnostics) {
    try { Set-1218RotationProtectionDiagnostic -Diagnostics $effectiveDiagnostics -Role $Role -Path $Path -OwnerSid $OwnerSid -LegacyError $legacyError | Out-Null } catch { }
   }
   if ($null -ne $legacyError) { throw $legacyError }
   return $safe
  }
  function Get-1218RotationBinaryObservation([string]$Path,[string]$Role) {
   $observation=@{state='unverified';sha256=$null;sizeBytes=$null;protection='unverified'}
   try {
    $safe=Get-1218RotationProtectedPath -Path $Path -Role $Role
    $observation.protection='protected'
    $metadata=Get-1218FileMetadata $safe -Limit 268435456
    $observation.state=$metadata.state
    if ($metadata.state -ceq 'regular') { $observation.sha256=$metadata.sha256;$observation.sizeBytes=$metadata.sizeBytes }
   } catch { $observation.state='unavailable';$observation.protection='rejected' }
   return $observation
  }
  $pathNode=$null
  try { $command=Get-Command -Name 'node.exe' -ErrorAction Stop;if ([string]$command.CommandType -ceq 'Application') { $pathNode=[string]$command.Source;$result.pathNode=Get-1218RotationBinaryObservation -Path $pathNode -Role 'pathNode' } } catch {}
  if ($result.actionKind -ceq 'direct-node-host') {
   $result.taskNode=Get-1218RotationBinaryObservation -Path $execute -Role 'taskNode'
   if ($result.pathNode.sha256 -and $result.taskNode.sha256) {
    $result.pathNodeMatchesTaskNodeBytes=$result.pathNode.sha256 -ceq $result.taskNode.sha256
    $result.pathNodeMatchesTaskNodePath=[IO.Path]::GetFullPath($pathNode) -ieq [IO.Path]::GetFullPath($execute)
   }
  }
  $stream=$null
  try {
   $safeRoot=Get-1218RotationProtectedPath -Path $root -Role 'releaseRoot'
   if ((Get-Item -LiteralPath $safeRoot -Force) -isnot [IO.DirectoryInfo]) { throw 'METADATA_UNAVAILABLE' }
   $manifest=Get-1218RotationProtectedPath -Path (Join-Path $safeRoot 'jarvis-release.json') -Role 'releaseManifest'
   $result.releaseManifest.protection='protected'
   $metadata=Get-1218FileMetadata $manifest -Limit 65536
   $result.releaseManifest.state=$metadata.state
   if ($metadata.state -ceq 'regular') {
    # Bounded even if the file changes between metadata inspection and open.
    $stream=[IO.File]::Open($manifest,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $bytes=New-Object byte[] 65537;$count=0
    while ($count -lt $bytes.Length) { $read=$stream.Read($bytes,$count,$bytes.Length-$count);if ($read -eq 0) { break };$count+=$read }
    if ($count -gt 65536) { throw 'METADATA_UNAVAILABLE' }
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $observed=([BitConverter]::ToString($sha.ComputeHash($bytes,0,$count))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($observed -cne $metadata.sha256) { throw 'METADATA_UNAVAILABLE' }
    $decoded=[Text.Encoding]::UTF8.GetString($bytes,0,$count).TrimStart([char]0xfeff)|ConvertFrom-Json
    $result.releaseManifest.sha256=$observed
    $result.releaseManifest.state='invalid-manifest'
    if ($decoded -is [pscustomobject] -and $decoded.PSObject.Properties.Name -ccontains 'commit' -and $decoded.commit -is [string] -and $decoded.commit -cmatch '^[a-f0-9]{40}$') { $result.releaseManifest.revision=$decoded.commit;$result.releaseManifest.state='regular' }
   }
  } catch { $result.releaseManifest.state='unavailable';$result.releaseManifest.sha256=$null;$result.releaseManifest.revision=$null;if ($result.releaseManifest.protection -cne 'protected') { $result.releaseManifest.protection='rejected' } }
  finally { if ($stream) { $stream.Dispose() } }
  if ($result.actionKind -ceq 'direct-node-host' -and $null -ne $result.pathNodeMatchesTaskNodeBytes -and $result.releaseManifest.revision -and $null -ne $result.taskRunning) {
   $result.directNodeGuardShapeMatches=$result.pathNodeMatchesTaskNodeBytes -and $result.pathNodeMatchesTaskNodePath -and $result.taskRunning
  }
 } catch { }
 if ($null -ne $ProtectionFailureDetails) {
  try { Set-1218RotationProtectionFailureDetails -Details $ProtectionFailureDetails -SelectedPaths $selectedProtectionPaths -Diagnostics $effectiveDiagnostics -OwnerSid $OwnerSid | Out-Null } catch { }
 }
 return $result
}

function New-1218FailureReport {
 param([string]$Stage, [string]$ReasonCode, [int]$FailureLine=0)
 if ($Stage -notin @('platform','source-artifacts','identity','configuration-metadata','installed-artifacts','rotation-metadata','prior-workspace-artifacts','plan-only')) { $Stage='unknown' }
 if ($ReasonCode -notin @('WINDOWS_REQUIRED','UNREVIEWED_SOURCE','SOURCE_PARSE_FAILED','PLAN_START_FAILED','PLAN_TIMEOUT')) { $ReasonCode='PREFLIGHT_RUNTIME_ERROR' }
 return @{schemaVersion=1;issue=1218;readOnly=$true;complete=$false;failedStage=$Stage;reasonCode=$ReasonCode;failureLine=$FailureLine;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;sourceArtifact=$script:LastSourceArtifact;rotationMetadata=(Get-1218RotationMetadata);rotationProtectionDiagnostics=(New-1218RotationProtectionDiagnostics);rotationProtectionFailureDetails=(New-1218RotationProtectionFailureDetails);actualDpapiUsed=$false;secretDisplayed=$false;clipboardAccessed=$false;credentialGenerated=$false;serviceOrTaskMutation=$false;databaseOpened=$false;originalAcceptanceConditionsPassed=0}
}

function Invoke-1218NativePreflight {
 $stage='platform'
 try {
  if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
  $stage='source-artifacts'
  $artifacts=@(Get-1218ReviewedArtifacts $script:PreflightRoot)
  $stage='identity'
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $sid=$identity.User.Value
  $stage='configuration-metadata'
  $config=$env:JARVIS_PRODUCTION_CONFIG; $origin='environment-override'
  if (-not $config) {
   $config=Join-Path $env:USERPROFILE 'JARVIS\production\config.dpapi'; $origin='owner-profile'
   if ((Get-1218FileMetadata $config).state -eq 'missing') { $config=Join-Path $env:LOCALAPPDATA 'JARVIS\production\config.dpapi'; $origin='legacy-localappdata' }
  }
  $meta=Get-1218FileMetadata $config
  $configOwner=$null
  if ($meta.state -eq 'regular') { try { $acl=Get-Acl -LiteralPath $config; $configOwner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value } catch {} }
  $practicalReadiness=Get-1218PracticalReadiness -Origin $origin -ConfigurationPath $config -ConfigSha256 $meta.sha256 -OwnerSid $sid -IsSystem $identity.IsSystem
  $stage='installed-artifacts'
  $installed=@(); $taskReadable=$false; $task=$null
  try {
   $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop
   $actions=@($task.Actions)
   if ($actions.Count -eq 1 -and $actions[0].WorkingDirectory) {
    $root=[string]$actions[0].WorkingDirectory; $taskReadable=$true
    foreach ($source in $artifacts) { $installedMeta=Get-1218FileMetadata (Join-Path (Join-Path $root 'scripts') $source.name) -Limit 262144; $installed+=@{name=$source.name;state=$installedMeta.state;sha256=$installedMeta.sha256;matchesReviewedSource=($installedMeta.state -eq 'regular' -and $installedMeta.sha256 -ceq $source.sha256)} }
   }
  } catch {}
  $stage='rotation-metadata'
  $rotationProtectionDiagnostics=New-1218RotationProtectionDiagnostics
  $rotationProtectionFailureDetails=New-1218RotationProtectionFailureDetails
  $rotationMetadata=Get-1218RotationMetadata -Task $task -OwnerSid $sid -OwnerName $identity.Name -ProtectionDiagnostics $rotationProtectionDiagnostics -ProtectionFailureDetails $rotationProtectionFailureDetails
  $stage='prior-workspace-artifacts'
  $priorWorkspace=@()
  if ($env:GITHUB_WORKSPACE -and $env:GITHUB_WORKSPACE -ne $script:PreflightRoot) {
   foreach ($source in $artifacts) {
    $prior=Get-1218FileMetadata (Join-Path (Join-Path $env:GITHUB_WORKSPACE 'scripts') $source.name) -Limit 262144
    $priorWorkspace+=@{name=$source.name;state=$prior.state;sha256=$prior.sha256;matchesReviewedSource=($prior.state -eq 'regular' -and $prior.sha256 -ceq $source.sha256)}
   }
  }
  $stage='plan-only'
  $plan=Invoke-1218PlanOnly $script:PreflightRoot
  $revision=$env:GITHUB_SHA
  if ($revision -notmatch '^[a-f0-9]{40}$') { $revision=$null }
  [ordered]@{schemaVersion=1;issue=1218;sourceRevision=$revision;readOnly=$true;complete=[bool]$plan.expectedOutputMatched;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;priorWorkspaceArtifacts=$priorWorkspace;actualWindowsSid=$sid;isSystem=$identity.IsSystem;processSessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;environmentUserInteractive=[Environment]::UserInteractive;desktopInputControl='UNVERIFIED';sourceArtifacts=$artifacts;installedArtifacts=$installed;installedTaskReadable=$taskReadable;encryptedConfiguration=@{origin=$origin;state=$meta.state;sha256=$meta.sha256;ownerSid=$configOwner;ownerIsExecutingUser=($null -ne $configOwner -and $configOwner -ceq $sid)};practicalReadiness=$practicalReadiness;rotationMetadata=$rotationMetadata;rotationProtectionDiagnostics=$rotationProtectionDiagnostics;rotationProtectionFailureDetails=$rotationProtectionFailureDetails;rotationPlan=$plan;actualDpapiUsed=$false;secretDisplayed=$false;clipboardAccessed=$false;credentialGenerated=$false;serviceOrTaskMutation=$false;databaseOpened=$false;originalAcceptanceConditionsPassed=0} | ConvertTo-Json -Depth 8 -Compress
  if (-not $plan.expectedOutputMatched) { exit 1 }
 } catch { New-1218FailureReport -Stage $stage -ReasonCode ([string]$_.Exception.Message) -FailureLine ([int]$_.InvocationInfo.ScriptLineNumber) | ConvertTo-Json -Depth 8 -Compress; exit 1 }
}
if ($MyInvocation.InvocationName -ne '.') { Invoke-1218NativePreflight }

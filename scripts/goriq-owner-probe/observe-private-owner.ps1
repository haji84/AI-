[CmdletBinding()]
param([switch]$Observe)
# Dormant without -Observe. The gated workflow supplies pinned source in memory.
function New-OwnerProbeFailure([string]$Reason) {
 $known=@('UNSUPPORTED_PLATFORM','UNSAFE_PROFILE','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','TIMEOUT','CHILD_STOP_UNCONFIRMED','OUTPUT_REJECTED')
 if($Reason -cnotin $known){$Reason='OUTPUT_REJECTED'}
 return ([ordered]@{schema='OWNER_PROBE_V1';authority='NOT_AUTHORITATIVE';status='INCOMPLETE';readOnly=$true;metadataOnly=$true;recovered=$false;g1='HOLD';historicalStateProven=$false;allFixedTargetsObserved=$false;target='NONE';reason=$Reason;observations=@()} | ConvertTo-Json -Depth 5 -Compress)
}
function Test-OwnerProbeCanonical([string]$Path) {
 if(-not $Path -or $Path.Length -gt 240 -or $Path -cnotmatch '^[A-Za-z]:\\' -or $Path.Substring(2).IndexOfAny([char[]]':/"<>|?*') -ge 0){return $false}
 foreach($c in $Path.ToCharArray()){if([char]::IsControl($c)){return $false}}
 if($Path.Length -eq 3){return $true}
 foreach($part in $Path.Substring(3).Split('\')){if(-not $part -or $part -in @('.','..') -or $part.EndsWith(' ') -or $part.EndsWith('.') -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)'){return $false}}
 return $true
}
function Test-OwnerProbeWithin([string]$Parent,[string]$Path) {
 return $Path.Equals($Parent,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)
}
function Get-OwnerProbeCompilerAncestors([string]$Workspace) {
 if(-not (Test-OwnerProbeCanonical $Workspace)){return}
 $parts=@();if($Workspace.Length -gt 3){$parts=$Workspace.Substring(3).Split('\')}
 if($parts.Count -gt 15){return}
 $current=$Workspace.Substring(0,3);$current
 foreach($part in $parts){if($current.Length -gt 3){$current+='\'};$current+=$part;$current}
}
function Test-OwnerProbeCompilerMetadata([string]$Expected,[string]$FullName,[IO.FileAttributes]$Attributes,[bool]$Ready,[string]$DriveType,[string]$Format) {
 return (Test-OwnerProbeCanonical $Expected) -and (Test-OwnerProbeCanonical $FullName) -and $Expected.Equals($FullName,[StringComparison]::OrdinalIgnoreCase) -and ($Attributes -band [IO.FileAttributes]::Directory) -ne 0 -and ($Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and $Ready -and $DriveType -ceq 'Fixed' -and $Format -ceq 'NTFS'
}
function Test-OwnerProbeCompilerWorkspace([string]$Workspace) {
 $chain=@(Get-OwnerProbeCompilerAncestors $Workspace)
 if($chain.Count -eq 0 -or $chain.Count -gt 16){return $false}
 $drive=New-Object IO.DriveInfo($Workspace.Substring(0,3))
 foreach($path in $chain){
  # Stop before traversing a later component when an ancestor is uncertain.
  $item=Microsoft.PowerShell.Management\Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if(-not (Test-OwnerProbeCompilerMetadata $path $item.FullName $item.Attributes $drive.IsReady $drive.DriveType.ToString() $drive.DriveFormat)){return $false}
 }
 return $true
}
function ConvertTo-OwnerProbeClosedJson([string]$Text) {
 if($Text.Length -gt 16384){throw 'REFUSED'}
 $p=ConvertFrom-Json -InputObject $Text -ErrorAction Stop
 $template=[ordered]@{schema='OWNER_PROBE_V1';authority='NOT_AUTHORITATIVE';status='INCOMPLETE';readOnly=$true;metadataOnly=$true;recovered=$false;g1='HOLD';historicalStateProven=$false;allFixedTargetsObserved=$false;target='NONE';reason='NOT_STARTED';observations=@()}
 if($null -eq $p -or @($p.PSObject.Properties).Count -ne $template.Count){throw 'REFUSED'}
 foreach($key in $template.Keys){if($p.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
 foreach($key in @('schema','authority','status','g1')){if($p.$key -isnot [string] -or $p.$key -cne $template[$key]){throw 'REFUSED'}}
 foreach($key in @('readOnly','metadataOnly','recovered','historicalStateProven')){if($p.$key -isnot [bool] -or $p.$key -cne $template[$key]){throw 'REFUSED'}}
 $targets=@('NONE','IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT','ANCESTOR_01','ANCESTOR_02','ANCESTOR_03','ANCESTOR_04','ANCESTOR_05','ANCESTOR_06','ANCESTOR_07','PROFILE','HANDOFF','LAYOUT','RAW','WORK','CONTEXT')
 $reasons=@('NOT_STARTED','OBSERVED_POLICY_MATCH','UNSUPPORTED_PLATFORM','IDENTITY_UNVERIFIED','UNSAFE_PROFILE','TARGET_LIMIT','TIMEOUT','TARGET_MISSING','ACCESS_DENIED','PRIVATE_LOCAL_STORAGE_UNAVAILABLE','PRIVATE_NATIVE_OPEN_UNAVAILABLE','PRIVATE_FILE_METADATA_UNVERIFIED','PRIVATE_FINAL_PATH_UNVERIFIED','PRIVATE_OWNER_UNVERIFIED','PRIVATE_DACL_UNVERIFIED','UNEXPECTED_FAILURE','OUTPUT_REJECTED','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','CHILD_STOP_UNCONFIRMED')
 if($p.allFixedTargetsObserved -isnot [bool] -or $p.target -isnot [string] -or $p.target -cnotin $targets -or $p.reason -isnot [string] -or $p.reason -cnotin $reasons -or $p.observations -isnot [array] -or $p.observations.Count -gt 16){throw 'REFUSED'}
 $ancestorCount=@($p.observations|Where-Object {$_.target -cmatch '^ANCESTOR_0[1-7]$'}).Count
 $sequence=@('IDENTITY','PROFILE_ENVIRONMENT','VOLUME_ROOT')
 for($n=1;$n -le $ancestorCount;$n++){$sequence+=('ANCESTOR_0'+$n)}
 $sequence+=@('PROFILE','HANDOFF','LAYOUT','RAW','WORK','CONTEXT')
 $facts=@();$seen=@();$failed=$false
 foreach($fact in $p.observations){
  $keys=@('target','reason','storageVerified','attributesVerified','finalPathVerified','owner','dacl')
  if($null -eq $fact -or @($fact.PSObject.Properties).Count -ne $keys.Count -or $failed){throw 'REFUSED'}
  foreach($key in $keys){if($fact.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
  if($fact.target -isnot [string] -or $fact.target -ceq 'NONE' -or $fact.target -cnotin $targets -or $fact.target -cin $seen -or $fact.reason -isnot [string] -or $fact.reason -cnotin $reasons -or $fact.owner -isnot [string] -or $fact.owner -cnotin @('UNOBSERVED','CURRENT_USER','OTHER','SYSTEM') -or $fact.dacl -isnot [string] -or $fact.dacl -cnotin @('UNOBSERVED','PRIVATE_POLICY_MATCH','ANCESTOR_METADATA_ONLY','UNVERIFIED')){throw 'REFUSED'}
  foreach($key in @('storageVerified','attributesVerified','finalPathVerified')){if($fact.$key -isnot [bool]){throw 'REFUSED'}}
  if($fact.reason -cmatch '^(?:NATIVE_|CHILD_)'){throw 'REFUSED'}
  if($facts.Count -ge $sequence.Count -or $fact.target -cne $sequence[$facts.Count]){throw 'REFUSED'}
  $native=$fact.target -cnotin @('IDENTITY','PROFILE_ENVIRONMENT')
  $private=$fact.target -cin @('PROFILE','HANDOFF','LAYOUT','RAW','WORK','CONTEXT')
  $ownerPermitted=$fact.owner -ceq 'CURRENT_USER' -or ($fact.target -ceq 'PROFILE' -and $fact.owner -ceq 'SYSTEM')
  if(($fact.attributesVerified -and -not $fact.storageVerified) -or ($fact.finalPathVerified -and -not $fact.attributesVerified) -or
     ($fact.owner -cne 'UNOBSERVED' -and -not $fact.finalPathVerified) -or ($fact.dacl -cne 'UNOBSERVED' -and $fact.owner -ceq 'UNOBSERVED')){throw 'REFUSED'}
  if(-not $native){
   if($fact.storageVerified -or $fact.attributesVerified -or $fact.finalPathVerified -or $fact.owner -cne 'UNOBSERVED' -or $fact.dacl -cne 'UNOBSERVED'){throw 'REFUSED'}
  }elseif($fact.reason -ceq 'OBSERVED_POLICY_MATCH'){
   $expectedDacl='ANCESTOR_METADATA_ONLY';if($private){$expectedDacl='PRIVATE_POLICY_MATCH'}
   if(-not $fact.finalPathVerified -or $fact.owner -ceq 'UNOBSERVED' -or $fact.dacl -cne $expectedDacl -or ($private -and -not $ownerPermitted)){throw 'REFUSED'}
  }
  if($fact.reason -ceq 'PRIVATE_OWNER_UNVERIFIED' -and (-not $private -or -not $fact.finalPathVerified -or $ownerPermitted -or $fact.owner -cnotin @('OTHER','SYSTEM') -or $fact.dacl -cne 'UNOBSERVED')){throw 'REFUSED'}
  $seen+=$fact.target;$failed=$fact.reason -cne 'OBSERVED_POLICY_MATCH'
  $facts+=@{target=$fact.target;reason=$fact.reason;storageVerified=$fact.storageVerified;attributesVerified=$fact.attributesVerified;finalPathVerified=$fact.finalPathVerified;owner=$fact.owner;dacl=$fact.dacl}
 }
 if($facts.Count -eq 0){
  if($p.target -cne 'NONE' -or $p.allFixedTargetsObserved -or $p.reason -cnotin @('UNSUPPORTED_PLATFORM','UNSAFE_PROFILE','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','TIMEOUT','CHILD_STOP_UNCONFIRMED','OUTPUT_REJECTED')){throw 'REFUSED'}
 }else{
  $last=$facts[$facts.Count-1]
  if($p.target -cne $last.target -or $p.reason -cne $last.reason){throw 'REFUSED'}
  $complete=$facts.Count -eq $sequence.Count -and -not $failed
  if($p.allFixedTargetsObserved -ne $complete -or ($p.reason -ceq 'OBSERVED_POLICY_MATCH' -and -not $complete)){throw 'REFUSED'}
 }
 $template.allFixedTargetsObserved=$p.allFixedTargetsObserved;$template.target=$p.target;$template.reason=$p.reason;$template.observations=$facts
 return ($template | ConvertTo-Json -Depth 5 -Compress)
}
function New-SourceAclProbeFailure([string]$Reason) {
 $known=@('UNSUPPORTED_PLATFORM','IDENTITY_UNVERIFIED','UNSAFE_PROFILE','TARGET_LIMIT','TIMEOUT','UNEXPECTED_FAILURE','OUTPUT_REJECTED','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','CHILD_STOP_UNCONFIRMED')
 $canonical='OUTPUT_REJECTED'
 foreach($candidate in $known){if([string]::Equals($Reason,$candidate,[StringComparison]::Ordinal)){$canonical=$candidate;break}}
 $Reason=$canonical
 return ([ordered]@{schema='SOURCE_ACL_PROBE_V1';authority='NOT_AUTHORITATIVE';status='INCOMPLETE';readOnly=$true;metadataOnly=$true;recovered=$false;g1='HOLD';historicalStateProven=$false;maxTargets=48;maxAces=16;budgetSeconds=20;reason=$Reason;observations=@()} | ConvertTo-Json -Depth 8 -Compress)
}
function Assert-SourceAclProbeJsonSyntax([string]$Text) {
 if([Text.Encoding]::UTF8.GetByteCount($Text) -gt 131072){throw 'REFUSED'}
 # The fixed native DTO uses literal ASCII strings and unsigned integers only.
 # Escaped strings, non-ASCII text, and other JSON scalar forms are refused
 # explicitly rather than relying on permissive PowerShell JSON conversion.
 $tokens=[regex]::Matches($Text,'\G[ \t\r\n]*(?<token>"[\x20-\x21\x23-\x5b\x5d-\x7e]*"|[{}\[\],:]|(?:0|[1-9][0-9]*)|true|false|null)[ \t\r\n]*',[Text.RegularExpressions.RegexOptions]::CultureInvariant,[TimeSpan]::FromMilliseconds(1000))
 if($tokens.Count -eq 0 -or $tokens.Count -gt 16384 -or $tokens[$tokens.Count-1].Index+$tokens[$tokens.Count-1].Length -ne $Text.Length -or $tokens[0].Groups['token'].Value -cne '{'){throw 'REFUSED'}
 # States: object key-or-end/key/colon/value/comma-or-end (0..4), then
 # array value-or-end/value/comma-or-end (5..7). A comma requires a value/key;
 # neither comments nor trailing commas can cross this container grammar.
 $frames=New-Object 'Collections.Generic.List[int]';$frames.Add(0)
 for($n=1;$n -lt $tokens.Count;$n++){
  if($frames.Count -eq 0){throw 'REFUSED'}
  $token=$tokens[$n].Groups['token'].Value;$last=$frames.Count-1;$valueExpected=$false
  switch($frames[$last]){
   0 {if($token -ceq '}'){$frames.RemoveAt($last)}elseif($token[0] -ceq '"'){$frames[$last]=2}else{throw 'REFUSED'}}
   1 {if($token[0] -ceq '"'){$frames[$last]=2}else{throw 'REFUSED'}}
   2 {if($token -ceq ':'){$frames[$last]=3}else{throw 'REFUSED'}}
   3 {$frames[$last]=4;$valueExpected=$true}
   4 {if($token -ceq ','){$frames[$last]=1}elseif($token -ceq '}'){$frames.RemoveAt($last)}else{throw 'REFUSED'}}
   5 {if($token -ceq ']'){$frames.RemoveAt($last)}else{$frames[$last]=7;$valueExpected=$true}}
   6 {$frames[$last]=7;$valueExpected=$true}
   7 {if($token -ceq ','){$frames[$last]=6}elseif($token -ceq ']'){$frames.RemoveAt($last)}else{throw 'REFUSED'}}
   default {throw 'REFUSED'}
  }
  if($valueExpected){
   if($token -ceq '{'){$frames.Add(0)}elseif($token -ceq '['){$frames.Add(5)}elseif($token[0] -cne '"' -and $token[0] -notmatch '[0-9]' -and $token -cnotin @('true','false','null')){throw 'REFUSED'}
   if($frames.Count -gt 5){throw 'REFUSED'}
  }
 }
 if($frames.Count -ne 0){throw 'REFUSED'}
}
function ConvertTo-SourceAclProbeClosedJson([string]$Text) {
 Assert-SourceAclProbeJsonSyntax $Text
 $p=ConvertFrom-Json -InputObject $Text -ErrorAction Stop
 $template=[ordered]@{schema='SOURCE_ACL_PROBE_V1';authority='NOT_AUTHORITATIVE';status='INCOMPLETE';readOnly=$true;metadataOnly=$true;recovered=$false;g1='HOLD';historicalStateProven=$false;maxTargets=48;maxAces=16;budgetSeconds=20;reason='OUTPUT_REJECTED';observations=@()}
 if($null -eq $p -or @($p.PSObject.Properties).Count -ne $template.Count){throw 'REFUSED'}
 foreach($key in $template.Keys){if($p.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
 foreach($key in @('schema','authority','g1')){if($p.$key -isnot [string] -or $p.$key -cne $template[$key]){throw 'REFUSED'}}
 foreach($key in @('readOnly','metadataOnly','recovered','historicalStateProven')){if($p.$key -isnot [bool] -or $p.$key -cne $template[$key]){throw 'REFUSED'}}
 foreach($key in @('maxTargets','maxAces','budgetSeconds')){if(($p.$key -isnot [int] -and $p.$key -isnot [long]) -or $p.$key -ne $template[$key]){throw 'REFUSED'}}
 $reasons=@('OBSERVED','UNSUPPORTED_PLATFORM','IDENTITY_UNVERIFIED','UNSAFE_PROFILE','TARGET_LIMIT','TIMEOUT','UNEXPECTED_FAILURE','OUTPUT_REJECTED','NATIVE_CONTEXT_UNVERIFIED','NATIVE_BUILD_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED','NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','CHILD_START_UNAVAILABLE','CHILD_STOP_UNCONFIRMED')
 if($p.status -isnot [string] -or $p.status -cnotin @('METADATA_ONLY_COMPLETE','INCOMPLETE') -or $p.reason -isnot [string] -or $p.reason -cnotin $reasons -or $p.observations -isnot [array] -or $p.observations.Count -gt 48){throw 'REFUSED'}
 $statuses=@('ACL_OBSERVED','TARGET_MISSING','ACCESS_DENIED','ANCESTOR_UNVERIFIED','STORAGE_UNVERIFIED','ATTRIBUTES_UNVERIFIED','FINAL_PATH_UNVERIFIED','SECURITY_DESCRIPTOR_UNVERIFIED','ACE_LIMIT','TIMEOUT','UNEXPECTED_FAILURE')
 $owners=@('UNOBSERVED','CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER','OTHER')
 $accounts=@('CURRENT_USER','SYSTEM','ADMINISTRATORS','TRUSTED_INSTALLER','APP_SILO','APP_CAPABILITY','APP_PACKAGE','EVERYONE','AUTHENTICATED_USERS','USERS','OTHER')
 $fixed=@('APPDATA','LOCAL','WORKER','SOURCE','DB','WAL','SHM','JOURNAL','SIDECAR','JOBS','CHANGES','HANDOFF','CAPTURE','RAW','WORK','CONTEXT','RAW_DB','RAW_WAL','RAW_SHM','RAW_JOBS','RAW_CHANGES','WORK_DB','WORK_WAL','WORK_SHM','WORK_JOBS','WORK_CHANGES')
 $targets=@('VOLUME_ROOT','PROFILE')+$fixed
 foreach($prefix in @('PROFILE_ANCESTOR_0','SOURCE_ANCESTOR_0')){foreach($n in 1..7){$targets+=($prefix+$n)}}
 $facts=@();$seen=@();$profileAncestors=0;$sourceAncestors=0;$propertyCount=$template.Count
 foreach($fact in $p.observations){
  $keys=@('target','status','storageVerified','attributesVerified','finalPathVerified','owner','dacl','aces')
  if($null -eq $fact -or @($fact.PSObject.Properties).Count -ne $keys.Count){throw 'REFUSED'}
  foreach($key in $keys){if($fact.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
  if($fact.target -isnot [string] -or $fact.target -cnotin $targets -or $fact.target -cin $seen -or $fact.status -isnot [string] -or $fact.status -cnotin $statuses -or $fact.owner -isnot [string] -or $fact.owner -cnotin $owners -or $fact.dacl -isnot [string] -or $fact.dacl -cnotin @('UNOBSERVED','PRESENT','NULL','ABSENT') -or $fact.aces -isnot [array] -or $fact.aces.Count -gt 16){throw 'REFUSED'}
  foreach($key in @('storageVerified','attributesVerified','finalPathVerified')){if($fact.$key -isnot [bool]){throw 'REFUSED'}}
  if(($fact.attributesVerified -and -not $fact.storageVerified) -or ($fact.finalPathVerified -and -not $fact.attributesVerified)){throw 'REFUSED'}
  if($fact.status -cin @('ACL_OBSERVED','ACE_LIMIT')){
   if(-not $fact.finalPathVerified -or $fact.owner -ceq 'UNOBSERVED' -or $fact.dacl -ceq 'UNOBSERVED'){throw 'REFUSED'}
   if($fact.status -ceq 'ACE_LIMIT' -and ($fact.dacl -cne 'PRESENT' -or $fact.aces.Count -ne 16)){throw 'REFUSED'}
  }elseif($fact.owner -cne 'UNOBSERVED' -or $fact.dacl -cne 'UNOBSERVED' -or $fact.aces.Count -ne 0){throw 'REFUSED'}
  if($fact.dacl -cne 'PRESENT' -and $fact.aces.Count -ne 0){throw 'REFUSED'}
  $aces=@();$propertyCount+=$keys.Count
  foreach($ace in $fact.aces){
   $aceKeys=@('account','qualifier','mask','flags')
   if($null -eq $ace -or @($ace.PSObject.Properties).Count -ne $aceKeys.Count){throw 'REFUSED'}
   foreach($key in $aceKeys){if($ace.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
   if($ace.account -isnot [string] -or $ace.account -cnotin $accounts -or $ace.qualifier -isnot [string] -or $ace.qualifier -cnotin @('ALLOW','DENY','CALLBACK_ALLOW','CALLBACK_DENY','OTHER')){throw 'REFUSED'}
   if(($ace.mask -isnot [int] -and $ace.mask -isnot [long]) -or $ace.mask -lt 0 -or $ace.mask -gt [long]4294967295 -or ($ace.flags -isnot [int] -and $ace.flags -isnot [long]) -or $ace.flags -lt 0 -or $ace.flags -gt 255){throw 'REFUSED'}
   $aces+=[ordered]@{account=$ace.account;qualifier=$ace.qualifier;mask=[uint32]$ace.mask;flags=[byte]$ace.flags};$propertyCount+=$aceKeys.Count
  }
  if($fact.target -cmatch '^PROFILE_ANCESTOR_0[1-7]$'){$profileAncestors++}
  if($fact.target -cmatch '^SOURCE_ANCESTOR_0[1-7]$'){$sourceAncestors++}
  $seen+=$fact.target
  $facts+=[ordered]@{target=$fact.target;status=$fact.status;storageVerified=$fact.storageVerified;attributesVerified=$fact.attributesVerified;finalPathVerified=$fact.finalPathVerified;owner=$fact.owner;dacl=$fact.dacl;aces=$aces}
 }
 $sequence=@('VOLUME_ROOT')
 for($n=1;$n -le $profileAncestors;$n++){$sequence+=('PROFILE_ANCESTOR_0'+$n)}
 $sequence+='PROFILE'
 for($n=1;$n -le $sourceAncestors;$n++){$sequence+=('SOURCE_ANCESTOR_0'+$n)}
 $sequence+=$fixed
 for($n=0;$n -lt $facts.Count;$n++){if($n -ge $sequence.Count -or $facts[$n].target -cne $sequence[$n]){throw 'REFUSED'}}
 if($p.status -ceq 'METADATA_ONLY_COMPLETE'){
  if($p.reason -cne 'OBSERVED' -or $facts.Count -ne $sequence.Count){throw 'REFUSED'}
 }elseif($p.reason -ceq 'OBSERVED' -or ($facts.Count -gt 0 -and $p.reason -cnotin @('TIMEOUT','TARGET_LIMIT','UNEXPECTED_FAILURE'))){throw 'REFUSED'}
 # ConvertFrom-Json can collapse duplicate property names. Every accepted
 # string value is a closed enum, so count JSON property tokens independently
 # before reconstruction to reject duplicates at every object level as well.
 if([regex]::Matches($Text,'"(?:[^"\\]|\\.)*"\s*:').Count -ne $propertyCount){throw 'REFUSED'}
 $template.status=$p.status;$template.reason=$p.reason;$template.observations=$facts
 $closed=$template|ConvertTo-Json -Depth 8 -Compress
 if([Text.Encoding]::UTF8.GetByteCount($closed) -gt 131072){throw 'REFUSED'}
 return $closed
}
function Resolve-SourceAclProbeOutput([string]$Text) {
 try{return ConvertTo-SourceAclProbeClosedJson $Text}catch{}
 try {
  # Bootstrap still uses the legacy supervisor's fixed failure envelopes. Only
  # an already-closed empty failure may cross schemas; legacy facts never do.
  # Apply the Source wire grammar here too: legacy's permissive parser must not
  # admit array roots, comments, or Unicode via this compatibility boundary.
  Assert-SourceAclProbeJsonSyntax $Text
  $legacy=ConvertTo-OwnerProbeClosedJson $Text|ConvertFrom-Json
  # The sole compatibility object has exactly the twelve legacy header keys
  # and no row/ACE objects. Count raw keys to catch duplicates collapsed by the
  # unchanged legacy converter, including duplicate observations/reason keys.
  if($legacy.target -ceq 'NONE' -and -not $legacy.allFixedTargetsObserved -and $legacy.observations.Count -eq 0 -and [regex]::Matches($Text,'"(?:[^"\\]|\\.)*"\s*:').Count -eq 12){return New-SourceAclProbeFailure $legacy.reason}
 }catch{}
 return New-SourceAclProbeFailure 'OUTPUT_REJECTED'
}
function Invoke-SourceAclProbeObservation([string]$NativeSource) {
 try {
  if($PSBoundParameters.ContainsKey('NativeSource')){$text=Invoke-OwnerProbeObservation -NativeSource $NativeSource -SourceAcl}else{$text=Invoke-OwnerProbeObservation -SourceAcl}
  return Resolve-SourceAclProbeOutput $text
 }catch{return New-SourceAclProbeFailure 'OUTPUT_REJECTED'}
}
function Wait-OwnerProbeOutput([Threading.Tasks.Task[]]$Tasks,[int]$RemainingMilliseconds) {
 if($RemainingMilliseconds -lt 0 -or $RemainingMilliseconds -gt 25000){throw 'REFUSED'}
 return [Threading.Tasks.Task]::WhenAll($Tasks).Wait($RemainingMilliseconds)
}
function Send-OwnerProbeSource([Diagnostics.Process]$Child,[string]$NativeSource,[Diagnostics.Stopwatch]$Clock) {
 $write=$Child.StandardInput.WriteLineAsync([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($NativeSource)))
 $remaining=[int][Math]::Max(0,25000-$Clock.ElapsedMilliseconds)
 if(-not (Wait-OwnerProbeOutput -Tasks ([Threading.Tasks.Task[]]@($write)) -RemainingMilliseconds $remaining)){return $false}
 # This source channel contains exactly one record. Signal EOF before waiting
 # for the Windows PowerShell host to exit; do not leave redirected input open.
 $Child.StandardInput.Close()
 return $true
}
function Read-OwnerProbeNativeSource([IO.Stream]$InputStream) {
 # Process.StandardInput uses Console.InputEncoding on .NET Framework. Detect
 # its Unicode preamble rather than treating it as part of the base64 record.
 $reader=[IO.StreamReader]::new($InputStream,[Text.UTF8Encoding]::new($false,$true),$true,1024)
 try {
  $encoded=$reader.ReadLine()
  if([string]::IsNullOrEmpty($encoded)){throw 'NATIVE_SOURCE_EMPTY'}
  if($encoded.Length -gt 87384){throw 'NATIVE_SOURCE_OVERSIZED'}
  try {$bytes=[Convert]::FromBase64String($encoded)}catch{throw 'NATIVE_SOURCE_BASE64_REJECTED'}
  if($bytes.Length -eq 0){throw 'NATIVE_SOURCE_EMPTY'}
  if($bytes.Length -gt 65536){throw 'NATIVE_SOURCE_OVERSIZED'}
  try {return [Text.UTF8Encoding]::new($false,$true).GetString($bytes)}catch{throw 'NATIVE_SOURCE_UTF8_REJECTED'}
 }finally{$reader.Dispose()}
}
function Invoke-OwnerProbeObservation([string]$NativeSource,[switch]$SourceAcl) {
 $ErrorActionPreference='Stop';$child=$null;$started=$false
 try {
  if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){return New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'}
  $fixed=[IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell','v1.0','powershell.exe')
  if($PSVersionTable.PSVersion.Major -ne 5 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage' -or [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName -ine $fixed){return New-OwnerProbeFailure 'NATIVE_CONTEXT_UNVERIFIED'}
  # Full original unsafe-profile guard is checked before compiler TEMP is set.
  # These are lexical/environment checks; source/runtime paths are never opened.
  $profile=[Environment]::GetFolderPath('UserProfile');$local=[Environment]::GetFolderPath('LocalApplicationData');$workspace=$env:GITHUB_WORKSPACE
  if($profile -cne $env:USERPROFILE -or $local -cne $env:LOCALAPPDATA -or -not (Test-OwnerProbeCanonical $profile) -or $profile.Length -eq 3 -or $profile.Substring(3).Split('\').Count -gt 8 -or -not (Test-OwnerProbeCanonical $local) -or -not (Test-OwnerProbeCanonical $workspace) -or -not (Test-OwnerProbeWithin $profile $local)){return New-OwnerProbeFailure 'UNSAFE_PROFILE'}
  $parent=$profile+'\.goriq-handoff';$source=$local+'\GAIWorker\goal-1218-bridge-state'
  if(-not (Test-OwnerProbeCanonical $source) -or (Test-OwnerProbeWithin $workspace $parent) -or (Test-OwnerProbeWithin $parent $workspace) -or (Test-OwnerProbeWithin $source $parent) -or (Test-OwnerProbeWithin $parent $source) -or (Test-OwnerProbeWithin $source $workspace) -or (Test-OwnerProbeWithin $workspace $source)){return New-OwnerProbeFailure 'UNSAFE_PROFILE'}
  # Check before Process.Start: PowerShell startup may consult TEMP before its
  # encoded command runs. The child repeats this check immediately before build.
  try {$workspaceReady=Test-OwnerProbeCompilerWorkspace $workspace}catch{$workspaceReady=$false}
  if(-not $workspaceReady){return New-OwnerProbeFailure 'UNSAFE_PROFILE'}
  if(-not $PSBoundParameters.ContainsKey('NativeSource')){$NativeSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))}
  if(-not $NativeSource -or [Text.Encoding]::UTF8.GetByteCount($NativeSource) -gt 65536){return New-OwnerProbeFailure 'NATIVE_BUILD_UNAVAILABLE'}
  $failure=New-OwnerProbeFailure 'NATIVE_BUILD_UNAVAILABLE'
  $contextFailure=New-OwnerProbeFailure 'NATIVE_CONTEXT_UNVERIFIED'
  $unsafeFailure=New-OwnerProbeFailure 'UNSAFE_PROFILE'
  $code=@'
$ErrorActionPreference='Stop';$WarningPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue'
$moduleRoot=[IO.Path]::Combine($PSHOME,'Modules');$env:PSModulePath=$moduleRoot
$PSModuleAutoLoadingPreference='None'
$sourceFailure='__NATIVE_SOURCE_UNAVAILABLE__'
$stage='__NATIVE_MODULE_MANAGEMENT_UNAVAILABLE__'
try {
 foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Security','Microsoft.PowerShell.Utility')){
  $stage=switch($module){
   'Microsoft.PowerShell.Management' {'__NATIVE_MODULE_MANAGEMENT_UNAVAILABLE__'}
   'Microsoft.PowerShell.Security' {'__NATIVE_MODULE_SECURITY_UNAVAILABLE__'}
   'Microsoft.PowerShell.Utility' {'__NATIVE_MODULE_UTILITY_UNAVAILABLE__'}
  }
  Import-Module -Name ([IO.Path]::Combine($moduleRoot,$module,($module+'.psd1'))) -ErrorAction Stop
 }
 $stage='__NATIVE_SIGNATURE_UNAVAILABLE__'
 $fixed=[IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell','v1.0','powershell.exe')
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $fixed -ErrorAction Stop
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){[Console]::Out.WriteLine('__CONTEXT_FAILURE__');exit}
 try {$workspaceReady=Test-OwnerProbeCompilerWorkspace $env:GITHUB_WORKSPACE}catch{$workspaceReady=$false}
 if(-not $workspaceReady){[Console]::Out.WriteLine('__UNSAFE_FAILURE__');exit}
 $stage=$sourceFailure
 $source=Read-OwnerProbeNativeSource -InputStream ([Console]::OpenStandardInput())
 $stage='__FAILURE__'
 $null=Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
 $stage='__NATIVE_ENTRY_UNAVAILABLE__'
 [Console]::Out.WriteLine([GoriqPrivateOwnerProbe]::ObserveJson())
}catch{
 if($stage -ceq $sourceFailure -and $_.Exception.Message -cin @('NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED')){
  $stage=$sourceFailure.Replace('"reason":"NATIVE_SOURCE_UNAVAILABLE"',('"reason":"'+$_.Exception.Message+'"'))
 }
 if($stage -ceq '__FAILURE__'){
  $cause=$_.Exception
  for($depth=0;$null -ne $cause -and $depth -lt 8;$depth++){
   if($cause -is [UnauthorizedAccessException] -or ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 5)){$stage='__NATIVE_BUILD_ACCESS_DENIED__';break}
   if($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -in @(2,3)){$stage='__NATIVE_BUILD_COMPILER_MISSING__';break}
   $message=$cause.Message;if($message.Length -gt 16384){$message=$message.Substring(0,16384)}
   if($message -cmatch '\berror CS(?:0006|0012|0234|0246)\b'){$stage='__NATIVE_BUILD_REFERENCE_UNAVAILABLE__';break}
   if($message -cmatch '\berror CS[0-9]{4}\b'){$stage='__NATIVE_BUILD_SOURCE_REJECTED__';break}
   $cause=$cause.InnerException
  }
  if($stage -ceq '__FAILURE__' -and $_.FullyQualifiedErrorId -cmatch '^SOURCE_CODE_ERROR,'){$stage='__NATIVE_BUILD_SOURCE_REJECTED__'}
 }
 [Console]::Out.WriteLine($stage)
}
'@
  if($SourceAcl){$code=$code.Replace('[GoriqPrivateOwnerProbe]::ObserveJson()','[GoriqSourceAclProbe]::ObserveJson()')}
  $definitions=''
  foreach($name in @('Test-OwnerProbeCanonical','Get-OwnerProbeCompilerAncestors','Test-OwnerProbeCompilerMetadata','Test-OwnerProbeCompilerWorkspace','Read-OwnerProbeNativeSource')){$definitions+='function '+$name+' {'+(Get-Command $name -CommandType Function).Definition+"}`n"}
  $code=$definitions+$code.Replace('__FAILURE__',$failure).Replace('__CONTEXT_FAILURE__',$contextFailure).Replace('__UNSAFE_FAILURE__',$unsafeFailure)
  foreach($phase in @('NATIVE_MODULE_MANAGEMENT_UNAVAILABLE','NATIVE_MODULE_SECURITY_UNAVAILABLE','NATIVE_MODULE_UTILITY_UNAVAILABLE','NATIVE_SIGNATURE_UNAVAILABLE','NATIVE_SOURCE_UNAVAILABLE','NATIVE_SOURCE_EMPTY','NATIVE_SOURCE_OVERSIZED','NATIVE_SOURCE_BASE64_REJECTED','NATIVE_SOURCE_UTF8_REJECTED','NATIVE_ENTRY_UNAVAILABLE','NATIVE_BUILD_ACCESS_DENIED','NATIVE_BUILD_COMPILER_MISSING','NATIVE_BUILD_REFERENCE_UNAVAILABLE','NATIVE_BUILD_SOURCE_REJECTED')){$code=$code.Replace(('__'+$phase+'__'),(New-OwnerProbeFailure $phase))}
  $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$fixed;$info.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.WorkingDirectory=$workspace
  # No token or other inherited environment is passed. Compilation may create
  # temporary files in the approved job workspace after its metadata preflight.
  # Shared metadata observations cannot prevent a later path-replacement race.
  $info.EnvironmentVariables.Clear()
  $info.EnvironmentVariables['SystemRoot']=[Environment]::GetFolderPath('Windows')
  $info.EnvironmentVariables['USERPROFILE']=$profile;$info.EnvironmentVariables['LOCALAPPDATA']=$local;$info.EnvironmentVariables['GITHUB_WORKSPACE']=$workspace
  $info.EnvironmentVariables['TEMP']=$workspace;$info.EnvironmentVariables['TMP']=$workspace
  $child=New-Object Diagnostics.Process;$child.StartInfo=$info;$clock=[Diagnostics.Stopwatch]::StartNew();$started=$child.Start()
  if(-not $started){return New-OwnerProbeFailure 'CHILD_START_UNAVAILABLE'}
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  # Async line transfer stays inside the child deadline and does not require
  # source files or an overlong Windows command line. Never inherit tokens.
  $inputReady=Send-OwnerProbeSource -Child $child -NativeSource $NativeSource -Clock $clock
  $remaining=[int][Math]::Max(0,25000-$clock.ElapsedMilliseconds)
  if(-not $inputReady -or -not $child.WaitForExit($remaining)){
   $child.Kill()
   if(-not $child.WaitForExit(2000)){return New-OwnerProbeFailure 'CHILD_STOP_UNCONFIRMED'}
   return New-OwnerProbeFailure 'TIMEOUT'
  }
  $remaining=[int][Math]::Max(0,25000-$clock.ElapsedMilliseconds)
  if(-not (Wait-OwnerProbeOutput -Tasks ([Threading.Tasks.Task[]]@($stdout,$stderr)) -RemainingMilliseconds $remaining)){return New-OwnerProbeFailure 'TIMEOUT'}
  if($child.ExitCode -ne 0){return New-OwnerProbeFailure 'OUTPUT_REJECTED'}
  $text=$stdout.GetAwaiter().GetResult();$errorText=$stderr.GetAwaiter().GetResult()
  if($errorText.Length -ne 0){return New-OwnerProbeFailure 'OUTPUT_REJECTED'}
  if($SourceAcl){return Resolve-SourceAclProbeOutput $text}
  return ConvertTo-OwnerProbeClosedJson $text
 }catch{return New-OwnerProbeFailure 'OUTPUT_REJECTED'}
 finally {
  if($null -ne $child){
   if($started -and -not $child.HasExited){try{$child.Kill();$null=$child.WaitForExit(2000)}catch{}}
   $child.Dispose()
  }
 }
}
if($Observe){Invoke-OwnerProbeObservation}

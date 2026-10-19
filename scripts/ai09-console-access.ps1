[CmdletBinding()]
param([ValidateSet('Inspect','Apply','Rollback')][string]$Mode='Inspect',[string]$PlanPath,[string]$ExpectedPlanSha256,[string]$AuthorizationReference,[string]$JournalPath,[string]$ExpectedJournalSha256)
# Fixed per-VM console access only. No group, guest, network, key, task or VM
# lifecycle change. Existing native administrator authority is required.
# One authorized administrator writer is required: Hyper-V exposes no CAS.
# Approval expiry is NOT native expiry; VMConnect grants have no native TTL.
# A separately pinned fresh Revoke plan can remove only this journal's addition.
$ai09ConsoleArguments=@{}+$PSBoundParameters
$script:Ai09ConsoleSource=$PSCommandPath
$script:Ai09ConsoleWorkspace=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$script:Ai09ConsoleDependency='1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64'
$dependency=Join-Path $PSScriptRoot 'ai09-access-host.ps1'
$dependencyLock=[IO.File]::Open($dependency,'Open','Read','Read')
try {
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$actual=([BitConverter]::ToString($hash.ComputeHash($dependencyLock))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
  if ($actual -cne $script:Ai09ConsoleDependency) {throw 'DEPENDENCY_PIN_MISMATCH'}
  . $dependency
} finally {$dependencyLock.Dispose()}
function Get-Ai09ConsoleUtcNow {return [datetimeoffset]::UtcNow}
function Get-Ai09ConsoleJson($Value){return ConvertTo-Json -InputObject $Value -Depth 20 -Compress}
function Get-Ai09ConsoleSha([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
function Get-Ai09ConsoleDigest($Value){return Get-Ai09ConsoleSha ([Text.Encoding]::UTF8.GetBytes((Get-Ai09ConsoleJson $Value)))}
function Assert-Ai09ConsoleFields($Value,[string[]]$Names){if($null -eq $Value -or @($Value.PSObject.Properties).Count -ne $Names.Count){throw 'SCHEMA_INVALID'};foreach($name in $Names){if($null -eq $Value.PSObject.Properties[$name]){throw 'SCHEMA_INVALID'}}}
function Get-Ai09ConsoleHyperVManifest([string]$Root){
  if(-not [IO.Path]::IsPathRooted($Root) -or -not (Test-Path -LiteralPath $Root -PathType Container)){throw 'NATIVE_HYPERV_REQUIRED'}
  $item=Get-Item -LiteralPath $Root -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'NATIVE_HYPERV_REQUIRED'}
  $children=@(Get-ChildItem -LiteralPath $Root -Directory -Force);if($children.Count -gt 64){throw 'NATIVE_HYPERV_REQUIRED'}
  $found=@();foreach($directory in (@($item)+@($children|Where-Object {$_.Name -cmatch '^\d+\.\d+(\.\d+){0,2}$'}))){
    if($directory.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'NATIVE_HYPERV_REQUIRED'}
    $candidate=Join-Path $directory.FullName 'Hyper-V.psd1'
    if(Test-Path -LiteralPath $candidate){$manifest=Get-Item -LiteralPath $candidate -Force;if($manifest.PSIsContainer -or ($manifest.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'NATIVE_HYPERV_REQUIRED'};$found+=@($manifest.FullName)}
  }
  if($found.Count -ne 1){throw 'NATIVE_HYPERV_REQUIRED'};return $found[0]
}
function Assert-Ai09ConsoleNativeAuthority {
  if([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::MachineName -cne 'HAJI'){throw 'NATIVE_HOST_REQUIRED'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if(-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $manifest=Get-Ai09ConsoleHyperVManifest (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/WindowsPowerShell/v1.0/Modules/Hyper-V')
  Import-Module -Name $manifest -ErrorAction Stop
  foreach($name in @('Get-VM','Get-VMNetworkAdapter','Get-VMConnectAccess','Grant-VMConnectAccess','Revoke-VMConnectAccess')){
    $command=Get-Command -Name "Hyper-V\$name" -CommandType Cmdlet -ErrorAction Stop
    if(-not $command.Module.Path.StartsWith((Split-Path $manifest -Parent),[StringComparison]::OrdinalIgnoreCase)){throw 'NATIVE_HYPERV_REQUIRED'}
  }
}
function Get-Ai09ConsoleSafePath([string]$Path){
  # Reuse the pinned host validator: check aliases through all ancestors, and
  # ownership/write authority on the actual parent and existing target. An OS
  # drive's TrustedInstaller owner does not own these separate user files.
  return Get-Ai09SafePath $Path
}
function Read-Ai09ConsoleBytes($Stream,[int]$Limit){
  if($Stream.Length -lt 1 -or $Stream.Length -gt $Limit){throw 'FILE_BOUND'};$Stream.Position=0;$bytes=New-Object byte[] ([int]$Stream.Length);$offset=0
  while($offset -lt $bytes.Length){$count=$Stream.Read($bytes,$offset,$bytes.Length-$offset);if($count -le 0){throw 'FILE_CHANGED'};$offset+=$count};return ,$bytes
}
function Get-Ai09ConsoleNativeSnapshot {
  $vm=Hyper-V\Get-VM -Id '453b139b-cceb-446e-99fb-f45bf5895436' -ComputerName 'HAJI' -ErrorAction Stop
  $nics=@(Hyper-V\Get-VMNetworkAdapter -VM $vm -ErrorAction Stop);if($nics.Count -ne 1){throw 'NIC_AMBIGUOUS'}
  $account=New-Object Security.Principal.NTAccount('HAJI\qq113');$sid=$account.Translate([Security.Principal.SecurityIdentifier]).Value
  return [pscustomobject][ordered]@{hostName=[Environment]::MachineName;vmId=[string]$vm.Id;vmName=[string]$vm.Name;vmState=[string]$vm.State;nicId=[string]$nics[0].Id;nicMac=[string]$nics[0].MacAddress;userName='HAJI\qq113';userSid=$sid
    aces=@(Hyper-V\Get-VMConnectAccess -VMId '453b139b-cceb-446e-99fb-f45bf5895436' -ComputerName 'HAJI' -ErrorAction Stop)}
}
function New-Ai09ConsoleAce {return [pscustomobject][ordered]@{UserName='HAJI\qq113';UserId='S-1-5-21-3241814747-1938433149-1705921193-1004';VMName='GORIQ-AI09-Ubuntu';VMId='453b139b-cceb-446e-99fb-f45bf5895436';ComputerName='HAJI';Access='Allowed'}}
function ConvertTo-Ai09ConsoleState($Raw){
  if($Raw.hostName -cne 'HAJI' -or $Raw.vmId -cne '453b139b-cceb-446e-99fb-f45bf5895436' -or $Raw.vmName -cne 'GORIQ-AI09-Ubuntu' -or $Raw.vmState -cne 'Running' -or $Raw.nicMac -cne '00155DDC2C00' -or [string]::IsNullOrWhiteSpace($Raw.nicId) -or $Raw.nicId.Length -gt 256 -or $Raw.userName -cne 'HAJI\qq113' -or $Raw.userSid -cne 'S-1-5-21-3241814747-1938433149-1705921193-1004'){throw 'FIXED_IDENTITY_REQUIRED'}
  $rows=@();$seen=@();if(@($Raw.aces).Count -gt 128){throw 'ACE_BOUND'}
  foreach($ace in $Raw.aces){
    foreach($field in @('UserName','UserId','VMName','VMId','ComputerName','Access')){if($null -eq $ace.PSObject.Properties[$field] -or ([string]$ace.$field).Length -gt 512){throw 'ACE_PROJECTION_UNAVAILABLE'}}
    if([string]$ace.VMId -ine $Raw.vmId -or [string]$ace.VMName -cne $Raw.vmName -or [string]$ace.ComputerName -ine 'HAJI' -or [string]$ace.Access -cnotin @('Allowed','Denied') -or [string]$ace.UserId -cnotmatch '^S-1-\d+(-\d+){1,15}$' -or [string]::IsNullOrWhiteSpace([string]$ace.UserName)){throw 'ACE_PROJECTION_UNAVAILABLE'}
    if(([string]$ace.UserId -eq $Raw.userSid) -ne ([string]$ace.UserName -ieq $Raw.userName)){throw 'TARGET_IDENTITY_CONFLICT'}
    $row=[ordered]@{UserName=[string]$ace.UserName;UserId=[string]$ace.UserId;VMName=[string]$ace.VMName;VMId=([string]$ace.VMId).ToLowerInvariant();ComputerName=([string]$ace.ComputerName).ToUpperInvariant();Access=[string]$ace.Access}
    $json=Get-Ai09ConsoleJson $row;if($json -in $seen){throw 'ACE_AMBIGUOUS'};$seen+=@($json);$rows+=@($json)
  }
  [string[]]$ordered=$rows;[Array]::Sort($ordered,[StringComparer]::Ordinal)
  return [ordered]@{hostName=$Raw.hostName;vmId=$Raw.vmId;vmName=$Raw.vmName;vmState=$Raw.vmState;nicId=$Raw.nicId;nicMac=$Raw.nicMac;userName=$Raw.userName;userSid=$Raw.userSid;aces=@($ordered|ForEach-Object {$_|ConvertFrom-Json})}
}
function Get-Ai09ConsoleObserved {
  $state=ConvertTo-Ai09ConsoleState (Get-Ai09ConsoleNativeSnapshot)
  if([Text.Encoding]::UTF8.GetByteCount((Get-Ai09ConsoleJson $state)) -gt 65536){throw 'BASELINE_BOUND'}
  return @{status='OBSERVED';success=$true;version=1;issue=1219;observedAt=(Get-Ai09ConsoleUtcNow).ToString('o');baseline=$state;baselineSha256=(Get-Ai09ConsoleDigest $state)}
}
function Get-Ai09ConsoleTime($Value){if($Value -is [datetime]){return [datetimeoffset]$Value};return [datetimeoffset]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture)}
function Assert-Ai09ConsoleFresh($Plan){$now=Get-Ai09ConsoleUtcNow;$expiry=Get-Ai09ConsoleTime $Plan.expiresAt;$observed=Get-Ai09ConsoleTime $Plan.baselineObservedAt;if($expiry -le $now -or $expiry -gt $now.AddHours(24) -or $observed -lt $now.AddMinutes(-15) -or $observed -gt $now.AddSeconds(5)){throw 'PLAN_EXPIRED_OR_STALE'}}
function Get-Ai09ConsolePlan($Path,$Expected,$Reference,$Action){
  if($Expected -cnotmatch '^[a-f0-9]{64}$' -or $Reference -cnotmatch '^[A-Za-z0-9:/#._-]{1,240}$'){throw 'EXPLICIT_APPROVAL_REQUIRED'}
  $path=Get-Ai09ConsoleSafePath $Path;$file=[IO.File]::Open($path,'Open','Read','Read');try{$bytes=Read-Ai09ConsoleBytes $file 16384}finally{$file.Dispose()}
  if((Get-Ai09ConsoleSha $bytes) -cne $Expected){throw 'PLAN_PIN_MISMATCH'}
  $plan=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)|ConvertFrom-Json
  Assert-Ai09ConsoleFields $plan @('version','issue','action','hostName','vmId','vmName','nicMac','userName','userSid','baselineSha256','baselineObservedAt','expiresAt','executorSha256','authorizationRef')
  if($plan.version -ne 1 -or $plan.issue -ne 1219 -or $plan.action -cne $Action -or $plan.hostName -cne 'HAJI' -or $plan.vmId -cne '453b139b-cceb-446e-99fb-f45bf5895436' -or $plan.vmName -cne 'GORIQ-AI09-Ubuntu' -or $plan.nicMac -cne '00155DDC2C00' -or $plan.userName -cne 'HAJI\qq113' -or $plan.userSid -cne 'S-1-5-21-3241814747-1938433149-1705921193-1004' -or $plan.authorizationRef -cne $Reference -or $plan.baselineSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'PLAN_SCOPE_INVALID'}
  if($plan.executorSha256 -cne (Get-Ai09ConsoleSha ([IO.File]::ReadAllBytes($script:Ai09ConsoleSource)))){throw 'EXECUTOR_PIN_MISMATCH'}
  Assert-Ai09ConsoleFresh $plan;return $plan
}
function Grant-Ai09ConsoleNative {Hyper-V\Grant-VMConnectAccess -VMId '453b139b-cceb-446e-99fb-f45bf5895436' -UserName 'HAJI\qq113' -ComputerName 'HAJI' -Confirm:$false -ErrorAction Stop}
function Revoke-Ai09ConsoleNative {Hyper-V\Revoke-VMConnectAccess -VMId '453b139b-cceb-446e-99fb-f45bf5895436' -UserName 'HAJI\qq113' -ComputerName 'HAJI' -Confirm:$false -ErrorAction Stop}
function Write-Ai09ConsoleJournal($Stream,$Record){$bytes=[Text.Encoding]::UTF8.GetBytes((Get-Ai09ConsoleJson $Record)+"`n");if($Stream.Length+$bytes.Length -gt 131072){throw 'JOURNAL_BOUND'};$null=$Stream.Seek(0,[IO.SeekOrigin]::End);$Stream.Write($bytes,0,$bytes.Length);$Stream.Flush($true)}
function Invoke-Ai09ConsoleAccess {
  param([ValidateSet('Inspect','Apply','Rollback')]$Mode='Inspect',$PlanPath,$ExpectedPlanSha256,$AuthorizationReference,$JournalPath,$ExpectedJournalSha256)
  $ErrorActionPreference='Stop';$journal=$null;$mutating=$false;$result=$null
  try {
    Assert-Ai09ConsoleNativeAuthority
    if($Mode -eq 'Inspect'){$result=Get-Ai09ConsoleObserved;return $result}
    $action=if($Mode -eq 'Apply'){'Grant'}else{'Revoke'};$plan=Get-Ai09ConsolePlan $PlanPath $ExpectedPlanSha256 $AuthorizationReference $action
    $observed=Get-Ai09ConsoleObserved;$state=$observed.baseline
    if($observed.baselineSha256 -cne $plan.baselineSha256){throw 'BASELINE_DRIFT'}
    $path=Get-Ai09ConsoleSafePath $JournalPath
    if($Mode -eq 'Apply'){
      $target=@($state.aces|Where-Object {$_.UserId -ceq $state.userSid});if($target.Count -gt 1){throw 'TARGET_POLICY_AMBIGUOUS'}
      if($target.Count -eq 1){if($target[0].Access -ceq 'Denied'){throw 'TARGET_DENIED'};$result=@{status='NO_CHANGE';success=$true;grantAdded=$false;issue=1219};return $result}
      $journal=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
      Write-Ai09ConsoleJournal $journal ([ordered]@{status='PREPARED';version=1;issue=1219;action='Grant';sourceSha256=$plan.executorSha256;planSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;before=$state;addedAce=(New-Ai09ConsoleAce);observedAt=$observed.observedAt})
      $expected=Get-Ai09ConsoleJson $state|ConvertFrom-Json;$expected.aces=@($expected.aces)+@((New-Ai09ConsoleAce));$wanted=Get-Ai09ConsoleDigest (ConvertTo-Ai09ConsoleState $expected)
    }else{
      if($ExpectedJournalSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'INDEPENDENT_JOURNAL_PIN_REQUIRED'}
      $journal=[IO.File]::Open($path,'Open','ReadWrite','None');$bytes=Read-Ai09ConsoleBytes $journal 131072
      if((Get-Ai09ConsoleSha $bytes) -cne $ExpectedJournalSha256){throw 'JOURNAL_PIN_MISMATCH'}
      $lines=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes).Split("`n");if($lines.Count -gt 8 -or $lines[-1] -ne ''){throw 'JOURNAL_INVALID'}
      $record=$lines[0]|ConvertFrom-Json;Assert-Ai09ConsoleFields $record @('status','version','issue','action','sourceSha256','planSha256','authorizationRef','before','addedAce','observedAt')
      if($record.status -cne 'PREPARED' -or $record.version -ne 1 -or $record.issue -ne 1219 -or $record.action -cne 'Grant' -or $record.sourceSha256 -cne $plan.executorSha256 -or $record.planSha256 -cnotmatch '^[a-f0-9]{64}$' -or $record.authorizationRef -cnotmatch '^[A-Za-z0-9:/#._-]{1,240}$'){throw 'JOURNAL_BINDING_INVALID'}
      for($i=1;$i -lt $lines.Count-1;$i++){$row=$lines[$i]|ConvertFrom-Json;if($row.status -cnotin @('APPLIED','UNCERTAIN','BLOCKED','ROLLBACK_PREPARED','ROLLED_BACK')){throw 'JOURNAL_INVALID'}}
      $before=ConvertTo-Ai09ConsoleState $record.before
      if(@($before.aces|Where-Object {$_.UserId -ceq $before.userSid}).Count -ne 0 -or (Get-Ai09ConsoleJson $record.addedAce) -cne (Get-Ai09ConsoleJson (New-Ai09ConsoleAce))){throw 'JOURNAL_BINDING_INVALID'}
      $wanted=Get-Ai09ConsoleDigest $before
      if($observed.baselineSha256 -ceq $wanted){$result=@{status='NO_CHANGE';success=$true;grantAdded=$false;issue=1219};return $result}
      $expected=Get-Ai09ConsoleJson $before|ConvertFrom-Json;$expected.aces=@($expected.aces)+@($record.addedAce)
      if((Get-Ai09ConsoleDigest (ConvertTo-Ai09ConsoleState $expected)) -cne $observed.baselineSha256){throw 'ROLLBACK_STATE_DRIFT'}
      Write-Ai09ConsoleJournal $journal @{status='ROLLBACK_PREPARED';issue=1219;planSha256=$ExpectedPlanSha256;authorizationRef=$AuthorizationReference;observedAt=$observed.observedAt}
    }
    if((Get-Ai09ConsoleObserved).baselineSha256 -cne $observed.baselineSha256){throw 'BASELINE_DRIFT'}
    Assert-Ai09ConsoleFresh $plan;$mutating=$true
    if($Mode -eq 'Apply'){$null=Grant-Ai09ConsoleNative;$status='APPLIED'}else{$null=Revoke-Ai09ConsoleNative;$status='ROLLED_BACK'}
    $after=Get-Ai09ConsoleObserved;if($after.baselineSha256 -cne $wanted){throw 'AFTER_STATE_UNCONFIRMED'}
    $result=@{status=$status;success=$true;version=1;issue=1219;grantAdded=($Mode -eq 'Apply');planSha256=$ExpectedPlanSha256;beforeSha256=$observed.baselineSha256;afterSha256=$after.baselineSha256;authorizationExpiresAt=$plan.expiresAt;observedAt=$after.observedAt}
    Write-Ai09ConsoleJournal $journal $result;return $result
  }catch{
    $code=[string]$_.Exception.Message;if($code -cnotmatch '^[A-Z][A-Z0-9_]{1,80}$'){$code='NATIVE_OR_IO_FAILURE'}
    $result=@{status=if($mutating){'UNCERTAIN'}else{'BLOCKED'};success=$false;code=$code;issue=1219}
    if($journal){try{Write-Ai09ConsoleJournal $journal $result}catch{$result.journalWriteUnconfirmed=$true}};return $result
  }finally{
    if($result){$result.authenticatedGuest=$false;$result.physicalGoal=$false;$result.nativeTtlAvailable=$false;$result.nativeGrantExpiresAutomatically=$false}
    if($journal){$journal.Dispose()}
  }
}
if($MyInvocation.InvocationName -ne '.'){$receipt=Invoke-Ai09ConsoleAccess @ai09ConsoleArguments;$receipt|ConvertTo-Json -Depth 20;if($receipt.success){exit 0}else{exit 1}}

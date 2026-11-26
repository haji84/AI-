Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ai09-console-access.ps1')
$script:Assertions=0
function Assert-Equal($Actual,$Expected,$Label){$script:Assertions++;if($Actual -cne $Expected){throw "ASSERT:$Label expected=$Expected actual=$Actual"}}
function Assert-True($Value,$Label){$script:Assertions++;if(-not $Value){throw "ASSERT:$Label"}}
function Assert-Ai09ConsoleNativeAuthority {}
function Assert-Ai09OwnerPath {param($Path)}
function Get-Ai09ConsoleUtcNow {return $script:Clock}
function Get-Ai09ConsoleNativeSnapshot {
  $script:Reads++;if($script:DriftOnRead -eq $script:Reads){$script:State.aces[0].Access='Denied'}
  return ($script:State|ConvertTo-Json -Depth 16|ConvertFrom-Json)
}
function Grant-Ai09ConsoleNative {
  $script:Grants++
  Assert-True ((Get-Item -LiteralPath $script:Journal).Length -gt 0) 'intent saved before grant'
  if(-not $script:NoEffect){$script:State.aces=@($script:State.aces)+@([pscustomobject]@{UserName=$script:NativeTargetName;UserId='S-1-5-21-3241814747-1938433149-1705921193-1004';VMName='GORIQ-AI09-Ubuntu';VMId='453b139b-cceb-446e-99fb-f45bf5895436';ComputerName='HAJI';Access='Allowed'})}
  if($script:ExtraChange){$script:State.aces[0].Access='Denied'}
  if($script:ThrowAfterGrant){throw 'FIXTURE_GRANT_UNCONFIRMED'}
}
function Revoke-Ai09ConsoleNative {$script:Revokes++;$script:State.aces=@($script:State.aces|Where-Object {$_.UserId -ne 'S-1-5-21-3241814747-1938433149-1705921193-1004'})}
function Reset-Fixture {
  $script:Grants=0;$script:Revokes=0;$script:Reads=0;$script:DriftOnRead=0;$script:NoEffect=$false;$script:ExtraChange=$false;$script:ThrowAfterGrant=$false;$script:NativeTargetName='HAJI\qq113';$script:Clock=[datetimeoffset]::UtcNow
  $script:State=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';nicId='fixed-nic';nicMac='00155DDC2C00';userName='HAJI\qq113';userSid='S-1-5-21-3241814747-1938433149-1705921193-1004';aces=@([pscustomobject]@{UserName='HAJI\unrelated';UserId='S-1-5-21-3241814747-1938433149-1705921193-1005';VMName='GORIQ-AI09-Ubuntu';VMId='453b139b-cceb-446e-99fb-f45bf5895436';ComputerName='HAJI';Access='Allowed'})}
  $script:Journal=Join-Path $root ([guid]::NewGuid().ToString('N')+'.journal')
}
function Plan-Arguments($Action='Grant',$Changes=@{}) {
  $observation=Invoke-Ai09ConsoleAccess
  $plan=[ordered]@{version=1;issue=1219;action=$Action;hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';nicMac='00155DDC2C00';userName='HAJI\qq113';userSid='S-1-5-21-3241814747-1938433149-1705921193-1004';baselineSha256=$observation.baselineSha256;baselineObservedAt=$observation.observedAt;expiresAt=$script:Clock.AddMinutes(10).ToString('o');executorSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../scripts/ai09-console-access.ps1') -Algorithm SHA256).Hash.ToLowerInvariant();authorizationRef='fixture-owner-console-grant'}
  foreach($key in $Changes.Keys){$plan[$key]=$Changes[$key]}
  $file=Join-Path $root ([guid]::NewGuid().ToString('N')+'.json');[IO.File]::WriteAllText($file,($plan|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
  $args=@{Mode=if($Action -eq 'Grant'){'Apply'}else{'Rollback'};PlanPath=$file;ExpectedPlanSha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();AuthorizationReference='fixture-owner-console-grant';JournalPath=$script:Journal}
  if($Action -eq 'Revoke'){$args.ExpectedJournalSha256=(Get-FileHash -LiteralPath $script:Journal -Algorithm SHA256).Hash.ToLowerInvariant()};return $args
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-console-fixture-'+[guid]::NewGuid().ToString('N'));$null=New-Item -ItemType Directory -Path $root
try {
  Reset-Fixture;$read=Invoke-Ai09ConsoleAccess
  Assert-Equal $read.status 'OBSERVED' 'default read-only inspect';Assert-Equal $script:Grants 0 'inspect no grant';Assert-Equal $script:Revokes 0 'inspect no revoke'
  Assert-Equal $read.authenticatedGuest $false 'no guest authentication claim';Assert-Equal $read.physicalGoal $false 'no physical Goal claim';Assert-Equal $read.nativeTtlAvailable $false 'native grant has no TTL'
  $args=Plan-Arguments;$applied=Invoke-Ai09ConsoleAccess @args
  Assert-Equal $applied.status 'APPLIED' 'one scoped grant verified';Assert-Equal $script:Grants 1 'one grant';Assert-Equal $script:State.aces.Count 2 'original ACE preserved'
  Assert-True ([IO.File]::ReadAllText($script:Journal) -match 'PREPARED.*APPLIED'.Replace('.*','[\s\S]*')) 'journal retains before and after'
  $rollback=Plan-Arguments 'Revoke';$rolled=Invoke-Ai09ConsoleAccess @rollback
  Assert-Equal $rolled.status 'ROLLED_BACK' 'exact own grant rollback';Assert-Equal $script:Revokes 1 'one revoke';Assert-Equal $script:State.aces.Count 1 'unrelated ACE retained'
  Assert-Equal (Invoke-Ai09ConsoleAccess).baselineSha256 $read.baselineSha256 'original policy restored'
  Reset-Fixture;$script:NativeTargetName='haji\qq113';$read=Invoke-Ai09ConsoleAccess;$args=Plan-Arguments
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'APPLIED' 'native target account casing preserves Windows identity'
  Assert-Equal (Invoke-Ai09ConsoleAccess).baseline.aces[0].UserName 'HAJI\qq113' 'only fixed target name is canonicalized'
  $rollback=Plan-Arguments 'Revoke'
  Assert-Equal (Invoke-Ai09ConsoleAccess @rollback).status 'ROLLED_BACK' 'case-varied native own entry can be removed exactly'
  Assert-Equal (Invoke-Ai09ConsoleAccess).baselineSha256 $read.baselineSha256 'case-varied rollback preserves complete before policy'
  Reset-Fixture;$script:NativeTargetName='HAJI\someone-else';$args=Plan-Arguments
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'UNCERTAIN' 'same SID with conflicting account name is never accepted'
  Assert-Equal $script:Revokes 0 'identity conflict never triggers blanket recovery'
  Reset-Fixture;$args=Plan-Arguments;$null=Invoke-Ai09ConsoleAccess @args;$script:Journal=Join-Path $root 'no-change-not-created.journal';$args=Plan-Arguments
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'NO_CHANGE' 'existing target Allowed never regranted';Assert-Equal $script:Grants 1 'no repeat grant';Assert-True (-not (Test-Path -LiteralPath $script:Journal)) 'NO_CHANGE creates no own rollback journal'
  $script:State.aces[1].Access='Denied';$args=Plan-Arguments
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).code 'TARGET_DENIED' 'existing target Denied refused';Assert-Equal $script:Grants 1 'Denied not overwritten'
  foreach($change in @(@{expiresAt=[datetimeoffset]::UtcNow.AddSeconds(-1).ToString('o')},@{baselineObservedAt=[datetimeoffset]::UtcNow.AddMinutes(-16).ToString('o')},@{userSid='S-1-5-18'},@{userName='HAJI\other'},@{executorSha256=('0'*64)},@{extra='broader'})){
    Reset-Fixture;$args=Plan-Arguments 'Grant' $change;Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'BLOCKED' 'invalid plan blocked';Assert-Equal $script:Grants 0 'invalid no mutation';Assert-True (-not (Test-Path -LiteralPath $script:Journal)) 'invalid no journal'
  }
  foreach($field in @('vmId','vmName','nicMac','userSid')){Reset-Fixture;$args=Plan-Arguments;$script:State[$field]='wrong';Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'BLOCKED' "identity mismatch:$field";Assert-Equal $script:Grants 0 'identity no grant'}
  Reset-Fixture;$args=Plan-Arguments;$args.ExpectedPlanSha256='0'*64;Assert-Equal (Invoke-Ai09ConsoleAccess @args).code 'PLAN_PIN_MISMATCH' 'independent plan pin';Assert-Equal $script:Grants 0 'pin no grant'
  Reset-Fixture;$args=Plan-Arguments;$args.AuthorizationReference='different';Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'BLOCKED' 'explicit approval ref match';Assert-Equal $script:Grants 0 'ref no grant'
  Reset-Fixture;$args=Plan-Arguments;$script:Reads=0;$script:DriftOnRead=2
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).code 'BASELINE_DRIFT' 'full policy compared immediately before grant';Assert-Equal $script:Grants 0 'concurrent policy not overwritten'
  foreach($failure in @('NoEffect','ExtraChange','ThrowAfterGrant')){
    Reset-Fixture;$args=Plan-Arguments;Set-Variable -Scope Script -Name $failure -Value $true;$result=Invoke-Ai09ConsoleAccess @args
    Assert-Equal $result.status 'UNCERTAIN' "unconfirmed mutation:$failure";Assert-Equal $result.success $false 'partial grant never PASS';Assert-Equal $script:Revokes 0 'no blanket automatic restore'
  }
  Reset-Fixture;$args=Plan-Arguments;$script:ThrowAfterGrant=$true;$null=Invoke-Ai09ConsoleAccess @args;$rollback=Plan-Arguments 'Revoke'
  Assert-Equal (Invoke-Ai09ConsoleAccess @rollback).status 'ROLLED_BACK' 'own uncertain addition can be removed exactly'
  Reset-Fixture;$args=Plan-Arguments;$null=Invoke-Ai09ConsoleAccess @args;$rollback=Plan-Arguments 'Revoke';$rollback.ExpectedJournalSha256='0'*64
  Assert-Equal (Invoke-Ai09ConsoleAccess @rollback).code 'JOURNAL_PIN_MISMATCH' 'independent journal pin';Assert-Equal $script:Revokes 0 'wrong journal no revoke'
  Reset-Fixture;$args=Plan-Arguments;$null=Invoke-Ai09ConsoleAccess @args;$script:State.aces[0].Access='Denied';$rollback=Plan-Arguments 'Revoke'
  Assert-Equal (Invoke-Ai09ConsoleAccess @rollback).code 'ROLLBACK_STATE_DRIFT' 'rollback refuses unrelated policy drift';Assert-Equal $script:Revokes 0 'unrelated changes retained'
  Reset-Fixture;$args=Plan-Arguments;$null=Invoke-Ai09ConsoleAccess @args;$script:State.aces[0].UserName='haji\unrelated';$rollback=Plan-Arguments 'Revoke'
  Assert-Equal (Invoke-Ai09ConsoleAccess @rollback).code 'ROLLBACK_STATE_DRIFT' 'unrelated account spelling remains strictly pinned';Assert-Equal $script:Revokes 0 'target case fix never relaxes unrelated policy'
  Reset-Fixture;$args=Plan-Arguments;[IO.File]::WriteAllText($script:Journal,'existing evidence')
  Assert-Equal (Invoke-Ai09ConsoleAccess @args).status 'BLOCKED' 'exclusive journal';Assert-Equal ([IO.File]::ReadAllText($script:Journal)) 'existing evidence' 'no journal overwrite';Assert-Equal $script:Grants 0 'existing journal no grant'
  Write-Output "AI09_CONSOLE_FIXTURES_PASS assertions=$script:Assertions; no real Hyper-V mutation or guest authentication"
} finally {
  if([IO.Path]::GetFullPath($root).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $root -Leaf) -like 'ai09-console-fixture-*'){Remove-Item -LiteralPath $root -Recurse -Force}
}

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\scripts\goriq-completion-native-activate.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'completion-transaction-not-implemented'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'completion-transaction-parse'}
foreach($name in @('Invoke-CompletionTransaction','Assert-CompletionWindow','Assert-CompletionProcessEdges','Assert-CompletionRecoveryRecords')){
 $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if($null -eq $def){throw 'completion-function-missing'}
 Invoke-Expression $def.Extent.Text
}
Assert-CompletionWindow $false ([datetimeoffset]::Parse('2026-10-23T12:00:00Z'))
Assert-CompletionWindow $true ([datetimeoffset]::Parse('2026-10-23T14:40:00Z'))
foreach($case in @(@($false,'2026-10-23T14:30:00Z'),@($true,'2026-10-23T14:59:59Z'),@($false,'2026-10-23T10:00:00Z'))){
 $rejected=$false;try{Assert-CompletionWindow $case[0] ([datetimeoffset]::Parse($case[1]))}catch{$rejected=$true}
 if(-not $rejected){throw 'expired-operation-accepted'}
}
$script:steps=New-Object 'Collections.Generic.List[string]'
$args=@{Persist={$script:steps.Add('backup')};Apply={$script:steps.Add('apply')};Verify={$script:steps.Add('verify')};Recover={$script:steps.Add('recover')}}
$r=Invoke-CompletionTransaction @args
if(-not $r.verified -or ($steps -join ',') -cne 'backup,apply,verify'){throw 'transaction-order'}
$steps.Clear();$args.Persist={throw 'backup-failed'};$rejected=$false
try{$null=Invoke-CompletionTransaction @args}catch{$rejected=$true}
if(-not $rejected -or $steps.Count){throw 'mutation-before-backup'}
$args.Persist={$script:steps.Add('backup')};$args.Apply={$script:steps.Add('partial');throw 'partial'}
$r=Invoke-CompletionTransaction @args
if($r.verified -or -not $r.restored -or ($steps -join ',') -cne 'backup,partial,recover'){throw 'partial-not-recovered'}
$steps.Clear();$args.Recover={$script:steps.Add('recover');throw 'unknown-residual'}
$r=Invoke-CompletionTransaction @args
if($r.verified -or $r.restored -or ($steps -join ',') -cne 'backup,partial,recover'){throw 'unknown-recovery-retried'}
Write-Output 'Completion native expiry/backup/partial-failure/recovery fixtures PASS'
$t=[datetime]::Parse('2026-10-23T12:00:00Z').ToUniversalTime()
$tree=@([pscustomobject]@{ProcessId=10;ParentProcessId=1;CreationDate=$t},[pscustomobject]@{ProcessId=20;ParentProcessId=10;CreationDate=$t.AddSeconds(2)},[pscustomobject]@{ProcessId=30;ParentProcessId=20;CreationDate=$t.AddSeconds(3)})
Assert-CompletionProcessEdges $tree
$tree[2].CreationDate=$t.AddSeconds(1)
$rejected=$false;try{Assert-CompletionProcessEdges $tree}catch{$rejected=$true}
if(-not $rejected){throw 'reused-parent-pid-accepted'}
$old=@(0..4 | ForEach-Object {[pscustomobject]@{path="fixture-$_";directory=($_ -lt 3);identity="id-$_";descriptor='old';hash=$(if($_ -lt 3){$null}else{'original'})}})
$baseline=[pscustomobject]@{records=$old;wanted=@('new','new','new','new','new')}
# Serializing/reloading has no in-memory pointer state from the failed parent.
$loaded=$baseline | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$live=@($loaded.records | ForEach-Object {$_.PSObject.Copy()});$live[3].descriptor='new';$live[3].hash='expected'
$intent=[pscustomobject]@{index=3;identity='id-3';descriptor='new';hash='expected'}
Assert-CompletionRecoveryRecords $loaded $live @($intent)
foreach($change in @('hash','identity','descriptor')){
 $copy=@($live | ForEach-Object {$_.PSObject.Copy()});$copy[3].$change='unknown'
 $rejected=$false;try{Assert-CompletionRecoveryRecords $loaded $copy @($intent)}catch{$rejected=$true}
 if(-not $rejected){throw 'unknown-crash-state-accepted'}
}
Write-Output 'Completion PID reuse refusal and durable known/unknown recovery classification PASS'

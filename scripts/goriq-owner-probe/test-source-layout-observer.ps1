$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot '../goriq-source-layout-observer.ps1'
$checks=0
function Check-Layout([bool]$Value,[string]$Name){if(-not $Value){throw ('LAYOUT_FIXTURE:'+ $Name)};$script:checks++}
Check-Layout (Test-Path -LiteralPath $file -PathType Leaf) 'observer_definition_missing'
$definition=@(. $file)
Check-Layout ($definition.Count -eq 0) 'definition_is_inert'
$cases=@(
 @('SOURCE','compass.sqlite',$false,'COMPASS_DB'),
 @('SOURCE','state.sqlite',$false,'BROKER_DB'),
 @('SOURCE','STATE.SQLITE',$false,'BROKER_DB'),
 @('SOURCE','state.sqlite-wal',$false,'BROKER_WAL'),
 @('SOURCE','state.sqlite-shm',$false,'BROKER_SHM'),
 @('SOURCE','state.sqlite-journal',$false,'BROKER_JOURNAL'),
 @('SOURCE','state.sqlite.pc-tasks.json',$false,'PC_TASKS'),
 @('SOURCE','state.sqlite.pc-observations.json',$false,'PC_OBSERVATIONS'),
 @('SOURCE','state.sqlite.invitation.json',$false,'INVITATIONS'),
 @('SOURCE','state.sqlite.trusted-devices.json',$false,'TRUSTED_DEVICES'),
 @('SOURCE','state.sqlite.google-owner.json',$false,'GOOGLE_OWNER'),
 @('SOURCE','self-development',$true,'SELF_DEVELOPMENT'),
 @('SELF_DEVELOPMENT','jobs.json',$false,'JOBS'),
 @('SELF_DEVELOPMENT','change-sets.json',$false,'CHANGE_SETS'),
 @('SELF_DEVELOPMENT','device-intake.json',$false,'DEVICE_INTAKE'),
 @('SOURCE','jobs.json',$false,'OTHER'),
 @('SOURCE','state.sqlite',$true,'OTHER'),
 @('SOURCE','self-development',$false,'OTHER'),
 @('SOURCE',('self-development'+[char]0x200B),$true,'OTHER'),
 @('SOURCE',('self-development'+[char]0),$true,'OTHER'),
 @('SOURCE','../state.sqlite',$false,'OTHER'),
 @('SOURCE','PRIVATE_TOKEN_abcdef.json',$false,'OTHER'),
 @('SOURCE',"PRIVATE`r`nTOKEN",$false,'OTHER')
)
foreach($case in $cases){Check-Layout ((Get-GoriqSourceLayoutCategory $case[0] $case[1] $case[2]) -ceq $case[3]) ('category_'+$script:checks)}
$rows=@(
 [pscustomobject]@{location='SOURCE';name='compass.sqlite';attributes=0},
 [pscustomobject]@{location='SOURCE';name='state.sqlite';attributes=0},
 [pscustomobject]@{location='SOURCE';name='PRIVATE_TOKEN_abcdef.json';attributes=0},
 [pscustomobject]@{location='SELF_DEVELOPMENT';name='jobs.json';attributes=0}
)
$report=ConvertTo-GoriqSourceLayoutReport $rows
Check-Layout ($report.status -ceq 'OBSERVED' -and $report.reason -ceq 'NONE') 'observed_status'
Check-Layout ($report.sourceCount -eq 3 -and $report.selfDevelopmentCount -eq 1 -and $report.unknownCount -eq 1) 'counts_are_derived'
Check-Layout ($report.entries.Count -eq 4 -and $report.entries[1].category -ceq 'BROKER_DB') 'broker_file_identified'
$json=$report|ConvertTo-Json -Depth 5 -Compress
Check-Layout ($json -cnotmatch 'PRIVATE|abcdef|sqlite|json|[A-Z]:\\') 'no_raw_names_or_paths'
Check-Layout (-not $report.contentRead -and -not $report.permissionChanged -and $report.consistency -ceq 'LIVE_SAMPLED') 'no_false_authority'
Check-Layout ($null -ne (Get-Command ConvertFrom-GoriqSourceLayoutClosedJson -ErrorAction SilentlyContinue)) 'validator_definition_missing'
Check-Layout ((ConvertFrom-GoriqSourceLayoutClosedJson $json) -ceq $json) 'canonical_report_accepted'
foreach($kind in @('extra','duplicate','count','flag','category','trailing','unicode','array_consistency','array_reason','escaped_constant')){
 $bad=$json
 switch($kind){
  'extra' {$bad=$bad.Substring(0,$bad.Length-1)+',"private":"PRIVATE"}'}
  'duplicate' {$bad=$bad.Replace('"version":1','"version":1,"version":1')}
  'count' {$bad=$bad.Replace('"sourceCount":3','"sourceCount":2')}
  'flag' {$bad=$bad.Replace('"permissionChanged":false','"permissionChanged":true')}
  'category' {$bad=$bad.Replace('"BROKER_DB"','"PRIVATE"')}
  'trailing' {$bad+=' PRIVATE'}
  'unicode' {$bad=[char]0xFEFF+$bad}
  'array_consistency' {$bad=$bad.Replace('"consistency":"LIVE_SAMPLED"','"consistency":["LIVE_SAMPLED","LIVE_SAMPLED"]')}
  'array_reason' {$bad=$bad.Replace('"reason":"NONE"','"reason":["NONE","NONE"]')}
  'escaped_constant' {$bad=$bad.Replace('"consistency":"LIVE_SAMPLED"','"consistency":"LIVE_SAMPLED\u0000"')}
 }
 $failed=$false;try{$null=ConvertFrom-GoriqSourceLayoutClosedJson $bad}catch{$failed=$true}
 Check-Layout $failed ('closed_report_'+$kind)
}
$bounded=@();for($n=0;$n -lt 32;$n++){$bounded+=[pscustomobject]@{location='SOURCE';name=('private'+$n);attributes=0};$bounded+=[pscustomobject]@{location='SELF_DEVELOPMENT';name=('private'+$n);attributes=0}}
$full=ConvertTo-GoriqSourceLayoutReport $bounded
Check-Layout ($full.entries.Count -eq 64 -and $full.unknownCount -eq 64) 'both_branch_bounds_accepted'
foreach($bad in @(
 [pscustomobject]@{location='OUTSIDE';name='state.sqlite';attributes=0},
 [pscustomobject]@{location='SOURCE';name='state.sqlite';attributes=1024},
 [pscustomobject]@{location='SOURCE';name='state.sqlite';attributes=0;private='PRIVATE'}
)){
 $failed=$false;try{$null=ConvertTo-GoriqSourceLayoutReport @($bad)}catch{$failed=$true}
 Check-Layout $failed 'malformed_or_reparse_refused'
}
$failed=$false;try{$null=ConvertTo-GoriqSourceLayoutReport ($bounded+@([pscustomobject]@{location='SOURCE';name='extra';attributes=0}))}catch{$failed=$true}
Check-Layout $failed 'branch_overflow_refused'
$temp=Join-Path ([IO.Path]::GetTempPath()) ('source-layout-fixture-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($temp)
try{
 $canary=Join-Path $temp 'state.sqlite';[IO.File]::WriteAllText($canary,'PRIVATE_CONTENT_MUST_NOT_BE_READ_OR_CHANGED')
 $nested=Join-Path $temp 'unknown-directory';$null=[IO.Directory]::CreateDirectory($nested)
 [IO.File]::WriteAllText((Join-Path $nested 'PRIVATE_NESTED.txt'),'PRIVATE')
 $hold=[IO.File]::Open($canary,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try{$facts=@(Read-GoriqSourceLayoutDirectory $temp 'SOURCE' ([Diagnostics.Stopwatch]::StartNew()))}finally{$hold.Dispose()}
 Check-Layout ($facts.Count -eq 2) 'no_recursive_traversal'
 Check-Layout ([IO.File]::ReadAllText($canary) -ceq 'PRIVATE_CONTENT_MUST_NOT_BE_READ_OR_CHANGED') 'source_bytes_preserved'
 $snapshot=ConvertTo-GoriqSourceLayoutReport $facts
 Check-Layout ($snapshot.sourceCount -eq 2 -and @($snapshot.entries|Where-Object category -CEQ 'BROKER_DB').Count -eq 1) 'real_metadata_projection'
 for($n=0;$n -lt 31;$n++){[IO.File]::WriteAllText((Join-Path $temp ('extra'+$n)),'')}
 $failed=$false;try{$null=@(Read-GoriqSourceLayoutDirectory $temp 'SOURCE' ([Diagnostics.Stopwatch]::StartNew()))}catch{$failed=$true}
 Check-Layout $failed 'actual_directory_overflow_refused'
}finally{[IO.Directory]::Delete($temp,$true)}
$savedRunner=$env:RUNNER_NAME
try{$env:RUNNER_NAME='NOT_THE_APPROVED_RUNNER';$closed=Invoke-GoriqSourceLayoutObservation|ConvertFrom-Json}finally{$env:RUNNER_NAME=$savedRunner}
Check-Layout ($closed.status -ceq 'REFUSED' -and $closed.reason -ceq 'CONTEXT_UNVERIFIED' -and $closed.entries.Count -eq 0) 'wrong_context_refused_before_source_read'
Write-Output ('SOURCE_LAYOUT_OBSERVER_PASS='+$checks)

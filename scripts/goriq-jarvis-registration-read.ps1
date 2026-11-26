[CmdletBinding()]
param()
# Definition-only import. The workflow supplies all pinned source bytes in memory.
function New-GoriqJarvisRegistrationSummary {
 [ordered]@{
  version=1;mode='FIXED_JARVIS_REGISTRATION_METADATA';status='INCOMPLETE';failureCode='CONTEXT_INVALID';readOnly=$true;preserved=$false;preservationMode=$null;queryVerified=$false
  currentGoalPresent=$null;currentGoalId=$null;currentGoalMentionsJarvis=$null
  ownerRequirementCount=$null;ownerRequirementsForOriginalGoal=$null;ownerRequirementsMentioningJarvis=$null;ownerRequirementsWithoutGoal=$null
  workRunCount=$null;workRunsForOriginalGoal=$null;detailsOmitted=$true;authorityComplete=$false;originalGoalRecovered=$false;g1='HOLD'
 }
}
function Assert-GoriqJarvisRegistrationWindow([datetimeoffset]$Now) {
 if($Now -lt [datetimeoffset]::Parse('2026-11-20T03:00:00Z') -or $Now -ge [datetimeoffset]::Parse('2026-11-20T06:00:00Z')){throw 'REFUSED'}
}
function ConvertFrom-GoriqJarvisRegistrationSummary([string]$Text,[bool]$PreservedExpected=$false) {
 if($Text.Length -gt 4096){throw 'REFUSED'}
 try{$report=ConvertFrom-Json -InputObject $Text -ErrorAction Stop}catch{throw 'REFUSED'}
 $template=New-GoriqJarvisRegistrationSummary
 if($null -eq $report -or $report -isnot [pscustomobject] -or @($report.PSObject.Properties).Count -ne $template.Count){throw 'REFUSED'}
 foreach($key in $template.Keys){if($report.PSObject.Properties.Name -cnotcontains $key){throw 'REFUSED'}}
 if(($report.version -isnot [int] -and $report.version -isnot [long]) -or $report.version -ne 1 -or $report.mode -cne 'FIXED_JARVIS_REGISTRATION_METADATA' -or $report.g1 -cne 'HOLD'){throw 'REFUSED'}
 foreach($key in @('readOnly','preserved','queryVerified','detailsOmitted','authorityComplete','originalGoalRecovered')){if($report.$key -isnot [bool]){throw 'REFUSED'}}
 if(-not $report.readOnly -or -not $report.detailsOmitted -or $report.authorityComplete -or $report.originalGoalRecovered -or $report.preserved -ne $PreservedExpected){throw 'REFUSED'}
 if(($PreservedExpected -and $report.preservationMode -cne 'OBSERVED_STABLE_SHARED') -or (-not $PreservedExpected -and $null -ne $report.preservationMode)){throw 'REFUSED'}
 if($report.status -cnotin @('READ','INCOMPLETE') -or $report.failureCode -cnotin @('NONE','CONTEXT_INVALID','OWNER_SCOPE_UNVERIFIED','PRIVATE_STORAGE_UNAVAILABLE','SOURCE_ACQUISITION_INCOMPLETE','INSTALLED_RUNTIME_UNAVAILABLE','COPIED_QUERY_UNVERIFIED','COPIED_QUERY_INVALID')){throw 'REFUSED'}
 $counts=@('ownerRequirementCount','ownerRequirementsForOriginalGoal','ownerRequirementsMentioningJarvis','ownerRequirementsWithoutGoal','workRunCount','workRunsForOriginalGoal')
 foreach($key in $counts){
  $maximum=500;if($key -cin @('workRunCount','workRunsForOriginalGoal')){$maximum=2000}
  if($null -ne $report.$key -and (($report.$key -isnot [int] -and $report.$key -isnot [long]) -or $report.$key -lt 0 -or $report.$key -gt $maximum)){throw 'REFUSED'}
 }
 foreach($key in @('currentGoalPresent','currentGoalMentionsJarvis')){if($null -ne $report.$key -and $report.$key -isnot [bool]){throw 'REFUSED'}}
 if($null -ne $report.currentGoalId -and ($report.currentGoalId -isnot [string] -or $report.currentGoalId -cnotmatch '^goal-[a-f0-9]{16}\z')){throw 'REFUSED'}
 if($report.status -ceq 'READ'){
  if(-not $report.queryVerified -or $report.failureCode -cne 'NONE' -or $report.currentGoalPresent -isnot [bool]){throw 'REFUSED'}
  foreach($key in $counts){if($null -eq $report.$key){throw 'REFUSED'}}
  if(($report.currentGoalPresent -and ($null -eq $report.currentGoalId -or $report.currentGoalMentionsJarvis -isnot [bool])) -or
    (-not $report.currentGoalPresent -and ($null -ne $report.currentGoalId -or $null -ne $report.currentGoalMentionsJarvis))){throw 'REFUSED'}
  if($report.ownerRequirementsForOriginalGoal+$report.ownerRequirementsWithoutGoal -gt $report.ownerRequirementCount -or
    $report.ownerRequirementsMentioningJarvis -gt $report.ownerRequirementCount -or $report.workRunsForOriginalGoal -gt $report.workRunCount){throw 'REFUSED'}
 }else{
  if($report.queryVerified -or $report.failureCode -ceq 'NONE'){throw 'REFUSED'}
  foreach($key in ($counts+@('currentGoalPresent','currentGoalId','currentGoalMentionsJarvis'))){if($null -ne $report.$key){throw 'REFUSED'}}
 }
 $clean=[ordered]@{};foreach($key in $template.Keys){$clean[$key]=$report.$key}
 # Flat ASCII canonical serialization rejects duplicate/escaped keys and extra
 # syntax even on Windows PS5 ConvertFrom-Json, which otherwise accepts duplicates.
 if(($clean|ConvertTo-Json -Depth 3 -Compress) -cne $Text.Trim()){throw 'REFUSED'}
 return $clean
}
function Invoke-GoriqJarvisRegistrationRead([byte[]]$QuerySource,[byte[]]$InventorySource,[string]$NativeSource) {
 $result=New-GoriqJarvisRegistrationSummary;$capture=$null;$failure='CONTEXT_INVALID'
 try{
  Assert-GoriqBridgeContext
  if($env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GITHUB_RUN_NUMBER -cne '1' -or $env:GITHUB_TRIGGERING_ACTOR -cne 'haji84'){throw 'REFUSED'}
  $failure='OWNER_SCOPE_UNVERIFIED';Assert-GoriqJarvisRegistrationWindow ([datetimeoffset]::UtcNow)
  $failure='PRIVATE_STORAGE_UNAVAILABLE';$capture=New-GoriqBridgeCapture $NativeSource ([ref]$failure)
  $failure='SOURCE_ACQUISITION_INCOMPLETE';$capture.Acquire();if(-not $capture.Preserved){throw 'REFUSED'}
  $failure='INSTALLED_RUNTIME_UNAVAILABLE';$node=Get-GoriqBridgeNode $capture
  $failure='COPIED_QUERY_UNVERIFIED'
  # Keep the unchanged capture's exact two permitted stage leaves. The new
  # workflow pins the metadata reader bytes, never caller-provided code or paths.
  $capture.Stage('goriq-zbook-bridge-original-read.mjs',$QuerySource)
  $capture.Stage('goriq-g1-backup-inventory.mjs',$InventorySource)
  $capture.PrepareOutputs();$raw=Invoke-GoriqBridgeCopiedQuery $capture $node
  $result=ConvertFrom-GoriqJarvisRegistrationSummary $raw
  $result.preserved=$true;$result.preservationMode='OBSERVED_STABLE_SHARED'
 }catch{
  $result=New-GoriqJarvisRegistrationSummary;$result.failureCode=$failure
  if($null -ne $capture){
   $result.preserved=[bool]$capture.Preserved;if($result.preserved){$result.preservationMode='OBSERVED_STABLE_SHARED'}
   try{$capture.WritePrivate('failure.txt',[Text.Encoding]::UTF8.GetBytes($_.ToString()))}catch{}
  }
 }finally{if($null -ne $capture){$capture.Dispose()}}
 return ($result|ConvertTo-Json -Depth 3 -Compress)
}

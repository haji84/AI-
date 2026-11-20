[CmdletBinding()]
param()
$ErrorActionPreference='Stop';$WarningPreference='Stop';$script:checks=0
$repository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$reader=Join-Path $repository 'scripts/goriq-jarvis-registration-read.ps1'
if(-not (Test-Path -LiteralPath $reader -PathType Leaf)){throw 'REGISTRATION_READER_IMPLEMENTATION_MISSING'}
$definition=@(. ([scriptblock]::Create(([IO.File]::ReadAllText($reader)).Replace('[datetimeoffset]::UtcNow',"[datetimeoffset]::Parse('2026-11-20T04:00:00Z')"))))
if($definition.Count -ne 0){throw 'DEFINITION_SIDE_EFFECT'}
function Check([bool]$Value){if(-not $Value){throw 'CHECK_FAILED'};$script:checks++}
function Reject([scriptblock]$Action){$refused=$false;try{$null=& $Action}catch{if($_.Exception.Message -cne 'REFUSED'){throw};$refused=$true};Check $refused}
function Json($Value){ConvertTo-Json -InputObject $Value -Depth 5 -Compress}
$valid=[ordered]@{
 version=1;mode='FIXED_JARVIS_REGISTRATION_METADATA';status='READ';failureCode='NONE';readOnly=$true;preserved=$false;preservationMode=$null;queryVerified=$true
 currentGoalPresent=$true;currentGoalId='goal-0af48e9d681db91a';currentGoalMentionsJarvis=$true
 ownerRequirementCount=3;ownerRequirementsForOriginalGoal=1;ownerRequirementsMentioningJarvis=2;ownerRequirementsWithoutGoal=1
 workRunCount=2;workRunsForOriginalGoal=1;detailsOmitted=$true;authorityComplete=$false;originalGoalRecovered=$false;g1='HOLD'
}
$parsed=ConvertFrom-GoriqJarvisRegistrationSummary (Json $valid)
Check ($parsed.ownerRequirementCount -eq 3 -and $parsed.currentGoalId -ceq 'goal-0af48e9d681db91a' -and -not $parsed.preserved)
$badCases=@(
 @{key='ownerRequirementCount';value=1},@{key='ownerRequirementsForOriginalGoal';value=4},@{key='ownerRequirementsMentioningJarvis';value=4},
 @{key='ownerRequirementsWithoutGoal';value=3},@{key='workRunsForOriginalGoal';value=3},@{key='ownerRequirementCount';value=501},
 @{key='workRunCount';value=2001},@{key='ownerRequirementCount';value=0.5},@{key='ownerRequirementCount';value='3'},
 @{key='currentGoalId';value='PRIVATE_PATH'},@{key='currentGoalPresent';value=$false},@{key='currentGoalMentionsJarvis';value=$null},
 @{key='readOnly';value=$false},@{key='readOnly';value='true'},@{key='authorityComplete';value=$true},@{key='originalGoalRecovered';value=$true},
 @{key='detailsOmitted';value=$false},@{key='g1';value='PASS'},@{key='version';value=2},@{key='failureCode';value='PRIVATE_ERROR'},
 @{key='queryVerified';value=$false},@{key='preserved';value=$true}
)
foreach($case in $badCases){$copy=ConvertFrom-Json (Json $valid);$copy.($case.key)=$case.value;$text=Json $copy;Reject {ConvertFrom-GoriqJarvisRegistrationSummary $text}}
$extra=(Json $valid).Replace('"version":1','"version":1,"private":"PRIVATE"');Reject {ConvertFrom-GoriqJarvisRegistrationSummary $extra}
$duplicate=(Json $valid).Replace('"version":1','"version":1,"version":1');Reject {ConvertFrom-GoriqJarvisRegistrationSummary $duplicate}
$escaped=(Json $valid).Replace('"version":1','"version":1,"ver\u0073ion":1');Reject {ConvertFrom-GoriqJarvisRegistrationSummary $escaped}
$unknown=New-GoriqJarvisRegistrationSummary
$parsed=ConvertFrom-GoriqJarvisRegistrationSummary (Json $unknown);Check ($null -eq $parsed.ownerRequirementCount -and -not $parsed.queryVerified)
$unknown.ownerRequirementCount=0;$text=Json $unknown;Reject {ConvertFrom-GoriqJarvisRegistrationSummary $text}
$preserved=ConvertFrom-Json (Json $valid);$preserved.preserved=$true;$preserved.preservationMode='OBSERVED_STABLE_SHARED'
$parsed=ConvertFrom-GoriqJarvisRegistrationSummary (Json $preserved) $true;Check $parsed.preserved
Reject {Assert-GoriqJarvisRegistrationWindow ([datetimeoffset]::Parse('2026-11-20T02:59:59.9999999Z'))}
$null=Assert-GoriqJarvisRegistrationWindow ([datetimeoffset]::Parse('2026-11-20T03:00:00Z'));$script:checks++
$null=Assert-GoriqJarvisRegistrationWindow ([datetimeoffset]::Parse('2026-11-20T05:59:59.9999999Z'));$script:checks++
Reject {Assert-GoriqJarvisRegistrationWindow ([datetimeoffset]::Parse('2026-11-20T06:00:00Z'))}

# Replace only the unsafe native acquisition/child-process boundaries. The real
# adapter, closed parser, staging arguments, context checks and egress remain real.
function Assert-GoriqBridgeContext {}
function New-GoriqBridgeCapture([string]$Source,[ref]$InitializationFailure){
 if($Source -cne 'FIXTURE_NATIVE'){throw 'REFUSED'}
 $capture=[pscustomobject]@{Preserved=$false;disposed=$false;prepared=$false;staged=0}
 $capture|Add-Member ScriptMethod Acquire {$this.Preserved=$true}
 $capture|Add-Member ScriptMethod Stage {param($Name,$Bytes)
  $text=[Text.Encoding]::UTF8.GetString($Bytes)
  if(($Name -ceq 'goriq-zbook-bridge-original-read.mjs' -and $text -ceq 'FIXTURE_QUERY') -or ($Name -ceq 'goriq-g1-backup-inventory.mjs' -and $text -ceq 'FIXTURE_INVENTORY')){$this.staged++}else{throw 'REFUSED'}
 }
 $capture|Add-Member ScriptMethod PrepareOutputs {if($this.staged -ne 2){throw 'REFUSED'};$this.prepared=$true}
 $capture|Add-Member ScriptMethod WritePrivate {param($Name,$Bytes)}
 $capture|Add-Member ScriptMethod Dispose {$this.disposed=$true}
 return $capture
}
function Get-GoriqBridgeNode($Capture){return 'FIXTURE_TRUSTED_NODE'}
$script:queryText=Json $valid
function Invoke-GoriqBridgeCopiedQuery($Capture,[string]$Node){if(-not $Capture.prepared -or $Node -cne 'FIXTURE_TRUSTED_NODE'){throw 'REFUSED'};return $script:queryText}
$priorAttempt=$env:GITHUB_RUN_ATTEMPT;$priorActor=$env:GITHUB_TRIGGERING_ACTOR;$priorRunNumber=$env:GITHUB_RUN_NUMBER
try{
 $env:GITHUB_RUN_ATTEMPT='1';$env:GITHUB_TRIGGERING_ACTOR='haji84';$env:GITHUB_RUN_NUMBER='1'
 $args=@([Text.Encoding]::UTF8.GetBytes('FIXTURE_QUERY'),[Text.Encoding]::UTF8.GetBytes('FIXTURE_INVENTORY'),'FIXTURE_NATIVE')
 $text=Invoke-GoriqJarvisRegistrationRead @args
 $report=ConvertFrom-GoriqJarvisRegistrationSummary $text $true
 Check ($report.status -ceq 'READ' -and $report.ownerRequirementCount -eq 3 -and $report.preserved)
 $script:queryText=(Json $valid).Replace('"version":1','"version":1,"private":"PRIVATE"')
 $text=Invoke-GoriqJarvisRegistrationRead @args;$report=ConvertFrom-GoriqJarvisRegistrationSummary $text $true
 Check ($report.status -ceq 'INCOMPLETE' -and $null -eq $report.ownerRequirementCount -and $text -cnotmatch 'PRIVATE')
 $script:queryText=Json $valid;$env:GITHUB_RUN_ATTEMPT='2'
 $report=ConvertFrom-GoriqJarvisRegistrationSummary (Invoke-GoriqJarvisRegistrationRead @args)
 Check ($report.status -ceq 'INCOMPLETE' -and -not $report.preserved)
 $env:GITHUB_RUN_ATTEMPT='1';$env:GITHUB_TRIGGERING_ACTOR='other'
 $report=ConvertFrom-GoriqJarvisRegistrationSummary (Invoke-GoriqJarvisRegistrationRead @args)
 Check ($report.status -ceq 'INCOMPLETE' -and -not $report.preserved)
 $env:GITHUB_TRIGGERING_ACTOR='haji84';$env:GITHUB_RUN_NUMBER='2'
 $report=ConvertFrom-Json (Invoke-GoriqJarvisRegistrationRead @args)
 Check ($report.status -ceq 'INCOMPLETE' -and -not $report.preserved)
}finally{$env:GITHUB_RUN_ATTEMPT=$priorAttempt;$env:GITHUB_TRIGGERING_ACTOR=$priorActor;$env:GITHUB_RUN_NUMBER=$priorRunNumber}
Write-Output ('JARVIS_REGISTRATION_READER_PASS='+$script:checks)

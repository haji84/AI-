param([string]$RepositoryRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
. (Join-Path $RepositoryRoot 'scripts/ai09-network-recovery-session.ps1')
if(-not(Get-Command Assert-Ai09StagedResume -ErrorAction SilentlyContinue)){throw 'RESUME_GUARD_MISSING'}
$script:passed=0
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:passed++}
function Refuses([scriptblock]$Action,[string]$Pattern){$caught=$false;try{& $Action}catch{$caught=$true;if($_.Exception.Message -notlike ('*'+$Pattern+'*')){throw}};Assert $caught ('EXPECTED_REFUSAL_'+$Pattern)}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('ai09-resume-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $temp
$script:oldPidPresent=$false
function Get-Process {param($Id,$ErrorAction);if($script:oldPidPresent){return [pscustomobject]@{Id=$Id}}}
try {
    $staged=@{Status='RECOVERY_SCRIPT_STAGED_GUEST_NOT_EXECUTED';Phase='VERIFIED_ATTACHMENT';Success=$true;GuestExecuted=$false
        SeedRunId='02ea2f0d324543a1ab2973e73c97421d';RecoveryRunId='network-recovery-20261016-v1'
        GuestScriptSha256='213E06BB5459C35E4535EB8C81C9DE5014D7BF85E30895F4C19F4864DEFE3CED'}
    $records=[ordered]@{
        PreviousSession=@{RunId='c692d7e6426349cc90d2155cc1c95864';SourceSha256='7C143591435AC6C831E7ECC94F20192FAA0E6677FA65A63CB95DD46D8EFC2494';Status='STOPPED';Error='SESSION_NATIVE_EXIT_UNAVAILABLE';Success=$false;Children=@()}
        PreviousChild=@{Pid=33544;ExitCode=$null;TimedOut=$false}
        StagedNative=@{NativeExitCode=0}
        StagedOutput=$staged.Clone()
        StagedErrors=$null
        StagedHost=$staged.Clone()
    }
    $scope=[pscustomobject]@{ResumePins=@();AuthRoot=(Join-Path $temp 'auth');ConsoleRoot=(Join-Path $temp 'console');PreviousRoot=(Join-Path $temp 'previous')}
    $null=New-Item -ItemType Directory -Path $scope.PreviousRoot
    foreach($name in $records.Keys){
        $path=Join-Path $temp ($name+'.json')
        $content=if($name -eq 'StagedErrors'){''}else{$records[$name]|ConvertTo-Json -Depth 6 -Compress}
        [IO.File]::WriteAllText($path,$content,[Text.UTF8Encoding]::new($false))
        $scope.ResumePins+=@(@{Name=$name;Path=$path;Hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash})
    }
    $proof=Assert-Ai09StagedResume $scope
    Assert ($proof.StagingReused -and $proof.Evidence.Count -eq 6) 'VALID_STAGE_PROOF_REFUSED'
    # Every byte-bound receipt/output, including empty stderr, is required.
    foreach($pin in $scope.ResumePins){
        $saved=[IO.File]::ReadAllBytes($pin.Path)
        [IO.File]::WriteAllText($pin.Path,'changed')
        Refuses {Assert-Ai09StagedResume $scope} 'SOURCE_HASH'
        [IO.File]::WriteAllBytes($pin.Path,$saved)
    }
    $script:oldPidPresent=$true
    Refuses {Assert-Ai09StagedResume $scope} 'CHILD_PRESENT'
    $script:oldPidPresent=$false
    foreach($path in @($scope.AuthRoot,$scope.ConsoleRoot,(Join-Path $scope.PreviousRoot 'Auth'),(Join-Path $scope.PreviousRoot 'Console'),(Join-Path $scope.PreviousRoot 'Collect'))){
        $null=New-Item -ItemType Directory -Path $path
        Refuses {Assert-Ai09StagedResume $scope} 'ALREADY_ADVANCED'
        Remove-Item -LiteralPath $path
    }
    # Test semantic refusal with synthetic repinned fixtures; production pins are fixed.
    foreach($case in @(
        @{Name='PreviousSession';Field='RunId';Value=('0'*32);Error='PREVIOUS_SESSION'},
        @{Name='PreviousSession';Field='SourceSha256';Value=@();Error='PREVIOUS_SESSION'},
        @{Name='StagedNative';Field='NativeExitCode';Value=7;Error='NATIVE_RESULT'},
        @{Name='PreviousChild';Field='TimedOut';Value=$true;Error='NATIVE_RESULT'},
        @{Name='StagedOutput';Field='GuestExecuted';Value=$true;Error='ATTACHMENT_PROOF'},
        @{Name='StagedHost';Field='Success';Value='true';Error='ATTACHMENT_PROOF'},
        @{Name='StagedHost';Field='GuestScriptSha256';Value=@();Error='ATTACHMENT_PROOF'}
    )){
        $pin=@($scope.ResumePins|Where-Object Name -eq $case.Name)[0]
        $saved=[IO.File]::ReadAllBytes($pin.Path);$oldHash=$pin.Hash
        $value=(Read-Ai09SessionEvidence -Path $pin.Path -Json).Value
        $value.($case.Field)=$case.Value
        [IO.File]::WriteAllText($pin.Path,($value|ConvertTo-Json -Depth 6 -Compress),[Text.UTF8Encoding]::new($false))
        $pin.Hash=(Get-FileHash -LiteralPath $pin.Path -Algorithm SHA256).Hash
        Refuses {Assert-Ai09StagedResume $scope} $case.Error
        [IO.File]::WriteAllBytes($pin.Path,$saved);$pin.Hash=$oldHash
    }
    # Real orchestration function, trace-only native adapters: Stage must never be repeated.
    $script:flowScope=[pscustomobject]@{Root=(Join-Path $temp 'old-session');ResumeRoot=(Join-Path $temp 'resumed-session');StageRoot=(Join-Path $temp 'old-stage');AuthRoot=$scope.AuthRoot;ConsoleRoot=$scope.ConsoleRoot;PreviousRoot=$scope.PreviousRoot;Pins=@();ResumePins=$scope.ResumePins}
    $null=New-Item -ItemType Directory -Path $script:flowScope.Root
    $null=New-Item -ItemType Directory -Path $script:flowScope.StageRoot
    $script:trace=[Collections.Generic.List[string]]::new()
    function Get-Ai09SessionScope {return $script:flowScope}
    function Assert-Ai09SessionNative {$script:trace.Add('NativeGuard')}
    function Wait-Ai09SessionResponse {
        param($Context,$Request)
        $script:trace.Add($Request.Stage)
        if($Request.Stage -eq 'SESSION_READY'){$Context.Ready=$true}
        if($Request.Stage -eq 'AUTH_HANDOFF'){throw 'FIXTURE_STOP_AFTER_AUTH'}
        return [pscustomobject]@{Decision=$Request.Decision}
    }
    function Invoke-Ai09SessionChild {param($Scope,$Context,$Name,$GuestExitCode);$script:trace.Add($Name);return [pscustomobject]@{Name=$Name;ExitCode=0}}
    function Assert-Ai09SessionAuthPrompt {param($Scope);return ('F'*64)}
    Refuses {Invoke-Ai09NetworkRecoverySession -Mode ResumeAfterStaging -SourceHash ('A'*64)} 'FIXTURE_STOP_AFTER_AUTH'
    Assert (($script:trace -join ',') -ceq 'NativeGuard,SESSION_READY,Auth,AUTH_HANDOFF') 'RESUME_REPEATED_STAGE'
    Assert ((Test-Path -LiteralPath (Join-Path $script:flowScope.ResumeRoot 'receipt.json')) -and (Test-Path -LiteralPath $script:flowScope.StageRoot)) 'RESUME_LOST_PRIOR_EVIDENCE'
    Refuses {Invoke-Ai09NetworkRecoverySession -Mode ResumeAfterStaging -SourceHash ('A'*64)} 'ONE_SHOT_ALREADY_STARTED'
    'RESUME_FIXTURES_PASS='+$script:passed
    'VM_OPERATIONS=0'
} finally {
    $resolved=[IO.Path]::GetFullPath($temp);$parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai09-resume-fixture-*'){throw 'UNSAFE_FIXTURE_CLEANUP'}
    if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}

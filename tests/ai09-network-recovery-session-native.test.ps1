param([string]$RepositoryRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){
    'SESSION_NATIVE_FIXTURE_PLATFORM=WINDOWS_REQUIRED'
    return
}
. (Join-Path $RepositoryRoot 'scripts/ai09-network-recovery-session.ps1')
$native=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if(-not(Test-Path -LiteralPath $native)){throw 'WINDOWS_POWERSHELL_REQUIRED'}
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('ai09-native-child-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixtureRoot
$script:passed=0
$script:started=0
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:passed++}
try {
    foreach($code in @(0,7)){
        $directory=Join-Path $fixtureRoot ('exit-'+$code)
        $null=New-Item -ItemType Directory -Path $directory
        $payload=Join-Path $directory 'child.ps1'
        $body="[Console]::Out.WriteLine('FIXTURE_STDOUT');[Console]::Error.WriteLine('FIXTURE_STDERR');exit "+$code
        [IO.File]::WriteAllText($payload,$body,[Text.UTF8Encoding]::new($false))
        $scope=[pscustomobject]@{NativePowerShell=$native;Pins=@(@{Name='Stage';Path=$payload;Hash=(Read-Ai09SessionEvidence $payload).Hash})}
        $context=New-Ai09SessionContext -Root $directory -SourceHash ('A'*64) -Seconds 15
        $caught=$null;$value=$null;$script:started++
        try{$value=Invoke-Ai09SessionChild $scope $context Stage}catch{$caught=$_.Exception.Message}
        $receipt=(Read-Ai09SessionEvidence -Path (Join-Path $directory 'Stage/receipt.json') -Json).Value
        'SESSION_NATIVE_CHILD_METRICS='+([ordered]@{Runtime=$PSVersionTable.PSVersion.ToString();RequestedExit=$code;ObservedExit=$receipt.ExitCode;Error=$caught}|ConvertTo-Json -Compress)
        Assert ($receipt.ExitCode -eq $code -and $receipt.ExitCode -is [ValueType] -and $receipt.OutputComplete -and -not $receipt.TimedOut) 'NATIVE_CHILD_EXIT_NOT_RECORDED'
        if($code -eq 0){Assert ($null -eq $caught -and $value.ExitCode -eq 0) 'NATIVE_CHILD_SUCCESS_REFUSED'}
        else{Assert ($caught -ceq 'SESSION_CHILD_EXIT_Stage_7') 'NATIVE_NONZERO_FAILURE_LOST'}
        Assert ([IO.File]::ReadAllText((Join-Path $directory 'Stage/stdout.txt')).Trim() -ceq 'FIXTURE_STDOUT') 'NATIVE_STDOUT_LOST'
        Assert ([IO.File]::ReadAllText((Join-Path $directory 'Stage/stderr.txt')).Trim() -ceq 'FIXTURE_STDERR') 'NATIVE_STDERR_LOST'
    }
    $directory=Join-Path $fixtureRoot 'timeout'
    $null=New-Item -ItemType Directory -Path $directory
    $payload=Join-Path $directory 'child.ps1'
    [IO.File]::WriteAllText($payload,"Start-Sleep -Milliseconds 1500;[Console]::Out.WriteLine('FIXTURE_NATURAL_COMPLETION');exit 0",[Text.UTF8Encoding]::new($false))
    $scope=[pscustomobject]@{NativePowerShell=$native;Pins=@(@{Name='Stage';Path=$payload;Hash=(Read-Ai09SessionEvidence $payload).Hash})}
    $context=New-Ai09SessionContext -Root $directory -SourceHash ('A'*64) -Seconds 0.4
    $caught=$null;$timer=[Diagnostics.Stopwatch]::StartNew();$script:started++
    try{Invoke-Ai09SessionChild $scope $context Stage}catch{$caught=$_.Exception.Message}
    Assert ($caught -ceq 'SESSION_CHILD_STILL_RUNNING_NO_KILL' -and $timer.Elapsed.TotalSeconds -lt 5) 'NATIVE_DEADLINE_NOT_BOUNDED'
    $receipt=(Read-Ai09SessionEvidence -Path (Join-Path $directory 'Stage/receipt.json') -Json).Value
    Assert ($receipt.Pid -gt 0 -and $null -eq $receipt.ExitCode -and $receipt.TimedOut -and -not $receipt.OutputComplete -and -not $receipt.CleanupVerified) 'NATIVE_TIMEOUT_FAKED_COMPLETION'
    $stdout=Join-Path $directory 'Stage/stdout.txt'
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(10)
    $completion=$null
    do {
        try{$completion=[IO.File]::ReadAllText($stdout).Trim()}catch [IO.IOException]{$completion=$null}
        if($completion -cne 'FIXTURE_NATURAL_COMPLETION'){Start-Sleep -Milliseconds 100}
    }while([DateTimeOffset]::UtcNow -lt $deadline -and $completion -cne 'FIXTURE_NATURAL_COMPLETION')
    Assert ($completion -ceq 'FIXTURE_NATURAL_COMPLETION') 'TIMED_OUT_CHILD_DID_NOT_FINISH_NATURALLY'
    'SESSION_NATIVE_FIXTURES_PASS='+$script:passed
    'HARMLESS_CHILDREN_STARTED='+$script:started
    'VM_OPERATIONS=0'
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    $tempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $resolved.StartsWith($tempParent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai09-native-child-fixture-*'){throw 'UNSAFE_FIXTURE_CLEANUP'}
    # Do not kill a child to clean up. Keep its evidence if it has not closed its output.
    $deadline=[DateTimeOffset]::UtcNow.AddSeconds(10);$closed=$false
    do {
        $closed=$true
        foreach($path in @(Get-ChildItem -LiteralPath $resolved -File -Recurse)){
            try{$handle=[IO.File]::Open($path.FullName,'Open','Read','None');$handle.Dispose()}catch{$closed=$false;break}
        }
        if(-not $closed){Start-Sleep -Milliseconds 100}
    }while(-not $closed -and [DateTimeOffset]::UtcNow -lt $deadline)
    if($closed){Remove-Item -LiteralPath $resolved -Recurse -Force}else{Write-Warning ('FIXTURE_OUTPUT_RETAINED='+$resolved)}
}

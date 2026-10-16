param([string]$RepositoryRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$source=Join-Path $RepositoryRoot 'scripts/ai09-network-recovery-session.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'SESSION_SOURCE_MISSING'}
$tokens=$null;$errors=$null
$null=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'SESSION_PARSE_ERROR'}
. $source
$script:passed=0
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:passed++}
function Refuses([scriptblock]$Action,[string]$Pattern){
    $caught=$false
    try{& $Action}catch{$caught=$true;if($_.Exception.Message -notlike ('*'+$Pattern+'*')){throw}}
    Assert $caught ('EXPECTED_REFUSAL_'+$Pattern)
}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('ai09-session-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $temp
function Fixture-Json($Value){
    $path=Join-Path $temp ([guid]::NewGuid().ToString('N')+'.json')
    Write-Ai09SessionJson $path $Value
    return (Read-Ai09SessionEvidence -Path $path -Json).Value
}
function Fixture-Context {
    $directory=Join-Path $temp ([guid]::NewGuid().ToString('N'))
    $null=New-Item -ItemType Directory -Path $directory
    return New-Ai09SessionContext -Root $directory -SourceHash ('A'*64)
}
function Fixture-CollectResponse($Request,[int]$Code=0){
    $r=Fixture-Json $Request
    $r|Add-Member GuestExitCode $Code
    $r|Add-Member UnmountExitCode 0
    $r|Add-Member SeedDeviceUnmounted $true
    $r|Add-Member MountpointExitCode 32
    return Fixture-Json $r
}
try {
    $context=Fixture-Context
    Assert (-not $context.Ready) 'READY_BEFORE_ACK'
    $request=New-Ai09SessionRequest $context SESSION_READY
    $response=Fixture-Json $request
    Assert ((Assert-Ai09SessionResponse $context $request $response) -eq $true) 'VALID_READY_REFUSED'
    foreach($field in @('Version','RunId','SourceSha256','Stage','Nonce','ExpiresAt','ProofSha256')){
        $bad=Fixture-Json $request;$bad.$field='wrong'
        Refuses {Assert-Ai09SessionResponse $context $request $bad} 'IDENTITY'
    }
    foreach($badValue in @($null,@(),@('READY'),[pscustomobject]@{Value='READY'})){
        $bad=Fixture-Json $request;$bad.Decision=$badValue
        Refuses {Assert-Ai09SessionResponse $context $request $bad} 'DECISION_TYPE'
    }
    $bad=Fixture-Json $request;$bad|Add-Member Extra 1
    Refuses {Assert-Ai09SessionResponse $context $request $bad} 'FIELDS'
    $expired=Fixture-Json $request;$expired.ExpiresAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')
    Refuses {Assert-Ai09SessionResponse $context $expired $expired} 'EXPIRED'
    $partial=Join-Path $context.Root 'SESSION_READY.ack.json.pending'
    [IO.File]::WriteAllText($partial,'{')
    Assert ($null -eq (Receive-Ai09SessionResponse $context $request)) 'PARTIAL_ACK_VISIBLE'
    Write-Ai09SessionJson (Join-Path $context.Root 'SESSION_READY.ack.json') $response
    $accepted=Receive-Ai09SessionResponse $context $request
    Assert ($context.Ready -and $accepted.Decision -ceq 'READY') 'READY_NOT_CONSUMED'
    Refuses {Receive-Ai09SessionResponse $context $request} 'REPLAY'
    Refuses {New-Ai09SessionRequest $context SESSION_READY} 'REPLAY'
    $auth=New-Ai09SessionRequest $context AUTH_HANDOFF
    Assert ($auth.Decision -ceq 'VERIFY_ROOT_MAY_START' -and -not $context.AuthHandoff) 'AUTH_IMPLIED_SUCCESS'
    $abort=Fixture-Json $auth;$abort.Decision='ABORT'
    Write-Ai09SessionJson (Join-Path $context.Root 'AUTH_HANDOFF.ack.json') $abort
    Refuses {Receive-Ai09SessionResponse $context $auth} 'OBSERVER_ABORTED'
    Assert (-not $context.AuthHandoff) 'ABORT_ALLOWED_NEXT_STEP'
    $duplicate=Join-Path $temp 'duplicate.json'
    [IO.File]::WriteAllText($duplicate,'{"Decision":"READY","Decision":"READY"}')
    Refuses {Read-Ai09SessionEvidence -Path $duplicate -Json -Flat} 'DUPLICATE'
    $malformed=Join-Path $temp 'malformed.json'
    [IO.File]::WriteAllText($malformed,'{')
    $caught=$false;try{Read-Ai09SessionEvidence -Path $malformed -Json -Flat}catch{$caught=$true}
    Assert $caught 'MALFORMED_JSON_ACCEPTED'

    $collectContext=Fixture-Context;$collectContext.Ready=$true;$collectContext.AuthHandoff=$true
    $collect=New-Ai09SessionRequest $collectContext COLLECT ('B'*64)
    foreach($code in @(0,18,255)){
        $value=Fixture-CollectResponse $collect $code
        Assert ((Assert-Ai09SessionResponse $collectContext $collect $value) -eq $true) 'VALID_GUEST_EXIT_REFUSED'
    }
    foreach($badValue in @(-1,256,'0',$true,@(0),[decimal]0)){
        $value=Fixture-CollectResponse $collect;$value.GuestExitCode=$badValue
        Refuses {Assert-Ai09SessionResponse $collectContext $collect $value} 'OBSERVATION'
    }
    foreach($field in @('UnmountExitCode','MountpointExitCode','SeedDeviceUnmounted')){
        $value=Fixture-CollectResponse $collect;$value.$field='wrong'
        Refuses {Assert-Ai09SessionResponse $collectContext $collect $value} 'OBSERVATION'
    }
    $notReady=Fixture-Context
    Refuses {New-Ai09SessionRequest $notReady AUTH_HANDOFF} 'READINESS'
    $dead=Fixture-Context;$dead.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Refuses {New-Ai09SessionRequest $dead SESSION_READY} 'DEADLINE'

    $consoleDirectory=Join-Path $temp 'console'
    $null=New-Item -ItemType Directory -Path $consoleDirectory
    $scope=[pscustomobject]@{ConsoleRoot=$consoleDirectory;Pins=@(@{Name='Console';Hash=('C'*64)})}
    $proofContext=Fixture-Context;$proofContext.ConsoleStartedAt=[DateTimeOffset]::UtcNow.AddSeconds(-3)
    $receipt=[ordered]@{RunId=('d'*32);SourceSha256=('C'*64);Success=$true;GuestExecutionVerified=$false
        StartedAt=[DateTimeOffset]::UtcNow.AddSeconds(-2).ToString('o');FinishedAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o');Events=@()}
    foreach($stage in @('command-6-after','command-8-after','command-9-after','command-10-after')){
        $imagePath=Join-Path $consoleDirectory ($stage+'.png')
        [IO.File]::WriteAllBytes($imagePath,[byte[]]@(137,80,78,71,13,10,26,10))
        $imageHash=(Read-Ai09SessionEvidence $imagePath).Hash
        $frame=[ordered]@{Version='1';RunId=$receipt.RunId;SourceSha256=$receipt.SourceSha256;Stage=$stage;Nonce=[guid]::NewGuid().ToString('N');ImageSha256=$imageHash;ExpiresAt=[DateTimeOffset]::UtcNow.AddSeconds(90).ToString('o');Decision='OBSERVED'}
        Write-Ai09SessionJson (Join-Path $consoleDirectory ($stage+'.request.json')) $frame
        Write-Ai09SessionJson (Join-Path $consoleDirectory ($stage+'.consumed.json')) $frame
        $receipt.Events+=@{Event='ObservationConsumed';Stage=$stage;Nonce=$frame.Nonce;ImageSha256=$frame.ImageSha256;Decision='OBSERVED'}
    }
    $receiptPath=Join-Path $consoleDirectory 'receipt.json'
    Write-Ai09SessionJson $receiptPath $receipt
    $proof=Get-Ai09SessionConsoleProof $scope $proofContext
    Assert ($proof.Value.Frames.Count -eq 4 -and $proof.Hash -match '^[A-F0-9]{64}$') 'FOUR_FRAME_PROOF_FAILED'
    foreach($stage in @('command-6-after','command-8-after','command-9-after','command-10-after')){
        $imagePath=Join-Path $consoleDirectory ($stage+'.png');$saved=[IO.File]::ReadAllBytes($imagePath)
        [IO.File]::WriteAllBytes($imagePath,[byte[]]@(1,2,3))
        Refuses {Get-Ai09SessionConsoleProof $scope $proofContext} 'FRAME_IDENTITY'
        [IO.File]::WriteAllBytes($imagePath,$saved)
    }
    $originalReceipt=[IO.File]::ReadAllText($receiptPath)
    $receipt.Events[0].Nonce='f'*32
    [IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Depth 8))
    Refuses {Get-Ai09SessionConsoleProof $scope $proofContext} 'FRAME_RECEIPT'
    [IO.File]::WriteAllText($receiptPath,$originalReceipt)
    $proofContext.ConsoleStartedAt=[DateTimeOffset]::UtcNow
    Refuses {Get-Ai09SessionConsoleProof $scope $proofContext} 'CONSOLE_STALE'

    # Real JSON arrays must not satisfy scalar receipt identities.
    $proofContext.ConsoleStartedAt=[DateTimeOffset]::UtcNow.AddSeconds(-30)
    foreach($value in @(@(),@('C'*64))){
        $badReceipt=Fixture-Json (Read-Ai09SessionEvidence -Path $receiptPath -Json).Value
        $badReceipt.SourceSha256=$value
        [IO.File]::WriteAllText($receiptPath,($badReceipt|ConvertTo-Json -Depth 8))
        Refuses {Get-Ai09SessionConsoleProof $scope $proofContext} 'CONSOLE_RECEIPT'
        [IO.File]::WriteAllText($receiptPath,$originalReceipt)
    }
    foreach($field in @('Nonce','ImageSha256','Decision')){
        foreach($kind in @('empty','single')){
            $badReceipt=Fixture-Json (Read-Ai09SessionEvidence -Path $receiptPath -Json).Value
            $expected=$badReceipt.Events[0].$field
            $badReceipt.Events[0].$field=if($kind -eq 'empty'){@()}else{@($expected)}
            # Preserve the one-element array even when a PowerShell pipeline unwraps it.
            if($kind -eq 'single'){$badReceipt.Events[0].$field=[object[]]@($expected)}
            [IO.File]::WriteAllText($receiptPath,($badReceipt|ConvertTo-Json -Depth 8))
            Refuses {Get-Ai09SessionConsoleProof $scope $proofContext} 'FRAME_RECEIPT'
            [IO.File]::WriteAllText($receiptPath,$originalReceipt)
        }
    }
    $authDirectory=Join-Path $temp 'auth-proof';$null=New-Item -ItemType Directory -Path $authDirectory
    $authScope=[pscustomobject]@{AuthRoot=$authDirectory;Pins=@(@{Name='Auth';Hash=('F'*64)})}
    $authReceiptPath=Join-Path $authDirectory 'receipt.json'
    $authReceipt=[pscustomobject]@{Success=$true;AuthenticationVerified=$false;SuccessMeaning='FIXED_SUDO_PROMPT_SENT_ONLY';SourceSha256=('F'*64)}
    Write-Ai09SessionJson $authReceiptPath $authReceipt
    Assert ((Assert-Ai09SessionAuthPrompt $authScope) -match '^[A-F0-9]{64}$') 'AUTH_PROMPT_PROOF_REFUSED'

    foreach($field in @('SourceSha256','SuccessMeaning')){
        foreach($kind in @('empty','single')){
            $badAuth=Fixture-Json $authReceipt
            $badAuth.$field=if($kind -eq 'empty'){@()}else{@($authReceipt.$field)}
            if($kind -eq 'single'){$badAuth.$field=[object[]]@($authReceipt.$field)}
            [IO.File]::WriteAllText($authReceiptPath,($badAuth|ConvertTo-Json))
            Refuses {Assert-Ai09SessionAuthPrompt $authScope} 'AUTH_PROMPT'
        }
    }

    # Change the published file between initial validation and consumed read.
    $changedContext=Fixture-Context;$changedRequest=New-Ai09SessionRequest $changedContext SESSION_READY
    Write-Ai09SessionJson (Join-Path $changedContext.Root 'SESSION_READY.ack.json') $changedRequest
    $script:originalReader=(Get-Command Read-Ai09SessionEvidence).ScriptBlock
    $script:changedConsumed=Join-Path $changedContext.Root 'SESSION_READY.consumed.json'
    function Read-Ai09SessionEvidence {
        param([string]$Path,[int]$Limit=2097152,[switch]$Json,[switch]$Flat)
        if($Path -ceq $script:changedConsumed){
            $body=[IO.File]::ReadAllText($Path).Replace('"Decision":"READY"','"Decision":"ABORT"')
            [IO.File]::WriteAllText($Path,$body)
        }
        & $script:originalReader -Path $Path -Limit $Limit -Json:$Json -Flat:$Flat
    }
    Refuses {Receive-Ai09SessionResponse $changedContext $changedRequest} 'ACK_CHANGED'
    Assert (-not $changedContext.Ready) 'CHANGED_ACK_PERMITTED_READY'
    Set-Item Function:\Read-Ai09SessionEvidence -Value $script:originalReader

    $pinPath=Join-Path $temp 'pinned.ps1';[IO.File]::WriteAllText($pinPath,'# harmless; never executed')
    $pinScope=[pscustomobject]@{Pins=@(@{Name='Fixture';Path=$pinPath;Hash=(Read-Ai09SessionEvidence $pinPath).Hash})}
    $held=Open-Ai09SessionPins $pinScope
    try {Refuses {$attempt=[IO.File]::Open($pinPath,'Open','ReadWrite','None');$attempt.Dispose()} ''}finally{foreach($handle in $held){$handle.Dispose()}}
    $attempt=[IO.File]::Open($pinPath,'Open','ReadWrite','None');$attempt.Dispose();Assert $true 'LOCK_NOT_RELEASED'
    $pinScope.Pins[0].Hash='0'*64
    Refuses {Open-Ai09SessionPins $pinScope} 'SOURCE_HASH'
    $pinScope.Pins[0].Hash=''
    Refuses {Open-Ai09SessionPins $pinScope} 'UNPINNED'
    # A real parent link must be rejected even though the final file is ordinary.
    $realDirectory=Join-Path $temp 'real';$linkDirectory=Join-Path $temp 'link'
    $null=New-Item -ItemType Directory -Path $realDirectory
    [IO.File]::WriteAllText((Join-Path $realDirectory 'plain.txt'),'fixture')
    if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){
        $null=New-Item -ItemType Junction -Path $linkDirectory -Target $realDirectory
    }else{$null=New-Item -ItemType SymbolicLink -Path $linkDirectory -Target $realDirectory}
    Refuses {Assert-Ai09SessionPath (Join-Path $linkDirectory 'plain.txt')} 'REPARSE'

    # Exercise child lifecycle using a fake process: no executable is started.
    $script:childBehavior='exit7';$script:childContext=$null
    function Start-Process {
        param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
        [IO.File]::WriteAllText($RedirectStandardOutput,'fixture stdout')
        [IO.File]::WriteAllText($RedirectStandardError,'fixture stderr')
        $fake=[pscustomobject]@{Id=12345;ExitCode=7}
        if($script:childBehavior -eq 'timeout'){$fake.ExitCode=$null}
        $fake|Add-Member ScriptMethod WaitForExit {param([int]$Milliseconds=0);if($script:childBehavior -eq 'timeout'){$script:childContext.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1);return $false};return $true}
        $fake|Add-Member ScriptMethod Refresh {}
        return $fake
    }
    $childScope=[pscustomobject]@{NativePowerShell='NEVER_EXECUTED';Pins=@(@{Name='Stage';Path=$pinPath;Hash=('E'*64)})}
    $childContext=Fixture-Context;$script:childContext=$childContext
    Refuses {Invoke-Ai09SessionChild $childScope $childContext Stage} 'CHILD_EXIT_Stage_7'
    $childReceipt=(Read-Ai09SessionEvidence -Path (Join-Path $childContext.Root 'Stage/receipt.json') -Json).Value
    Assert ($childReceipt.ExitCode -eq 7 -and $childReceipt.OutputComplete -and -not $childReceipt.CleanupVerified) 'ACTUAL_EXIT_LOST'
    $script:childBehavior='timeout';$childContext=Fixture-Context;$script:childContext=$childContext
    Refuses {Invoke-Ai09SessionChild $childScope $childContext Stage} 'STILL_RUNNING_NO_KILL'
    $childReceipt=(Read-Ai09SessionEvidence -Path (Join-Path $childContext.Root 'Stage/receipt.json') -Json).Value
    Assert ($childReceipt.Pid -eq 12345 -and $null -eq $childReceipt.ExitCode -and $childReceipt.TimedOut -and -not $childReceipt.OutputComplete -and -not $childReceipt.CleanupVerified) 'TIMEOUT_FAKED_CLEANUP'
    Remove-Item Function:\Start-Process

    # Model the complete orchestration with native actions replaced by trace-only adapters.
    $script:trace=[Collections.Generic.List[string]]::new();$script:guestCode=18;$script:stopAt=''
    $script:flowScope=[pscustomobject]@{Root=(Join-Path $temp 'flow');StageRoot=(Join-Path $temp 'unused-stage');AuthRoot=(Join-Path $temp 'unused-auth');ConsoleRoot=(Join-Path $temp 'unused-console');Pins=@()}
    function Get-Ai09SessionScope {return $script:flowScope}
    function Open-Ai09SessionPins {param($Scope);$list=[Collections.Generic.List[IO.FileStream]]::new();$list.Add([IO.File]::Open($pinPath,'Open','Read','Read'));return ,$list}
    function Assert-Ai09SessionNative {$script:trace.Add('NativeGuard')}
    function Wait-Ai09SessionResponse {
        param($Context,$Request)
        $script:trace.Add($Request.Stage)
        if($Request.Stage -eq $script:stopAt){throw 'FIXTURE_ABORT'}
        if($Request.Stage -eq 'SESSION_READY'){$Context.Ready=$true}
        if($Request.Stage -eq 'AUTH_HANDOFF'){$Context.AuthHandoff=$true}
        if($Request.Stage -eq 'COLLECT'){return [pscustomobject]@{GuestExitCode=$script:guestCode}}
        return [pscustomobject]@{Decision=$Request.Decision}
    }
    function Invoke-Ai09SessionChild {param($Scope,$Context,$Name,$GuestExitCode);$script:trace.Add($Name);return [pscustomobject]@{Name=$Name;ExitCode=0}}
    function Assert-Ai09SessionAuthPrompt {param($Scope);return ('F'*64)}
    function Get-Ai09SessionConsoleProof {param($Scope,$Context);return [pscustomobject]@{Value=@{Fixed=$true};Hash=('B'*64)}}
    $verified=Invoke-Ai09NetworkRecoverySession -SourceHash ('A'*64)
    Assert ($verified.Status -ceq 'READ_ONLY_SESSION_SOURCE_VERIFIED' -and $script:trace.Count -eq 0 -and -not(Test-Path -LiteralPath $script:flowScope.Root)) 'DEFAULT_VERIFY_MUTATED'
    $result=Invoke-Ai09NetworkRecoverySession -Mode Execute -SourceHash ('A'*64)
    Assert (($script:trace -join ',') -ceq 'NativeGuard,SESSION_READY,Stage,Auth,AUTH_HANDOFF,Console,COLLECT,Collect') 'WRONG_ORDER'
    Assert (-not $result.Success -and $result.Status -ceq 'GUEST_FAILED_EVIDENCE_COLLECTED' -and -not $result.SshVerified -and -not $result.AuthenticationVerified) 'FAILED_GUEST_PROMOTED'
    $script:trace.Clear();$script:flowScope.Root=Join-Path $temp 'aborted-flow';$script:stopAt='AUTH_HANDOFF'
    Refuses {Invoke-Ai09NetworkRecoverySession -Mode Execute -SourceHash ('A'*64)} 'FIXTURE_ABORT'
    Assert (-not $script:trace.Contains('Console') -and -not $script:trace.Contains('Collect')) 'AUTH_ABORT_STARTED_CONSOLE'

    $script:originalWriter=(Get-Command Write-Ai09SessionJson).ScriptBlock
    $script:flowScope.Root=Join-Path $temp 'receipt-failure-flow';$script:stopAt=''
    function Write-Ai09SessionJson {
        param([string]$Path,$Value)
        if($Path -ceq (Join-Path $script:flowScope.Root 'receipt.json')){throw 'FIXTURE_FINAL_RECEIPT_WRITE_FAILED'}
        & $script:originalWriter $Path $Value
    }
    Refuses {Invoke-Ai09NetworkRecoverySession -Mode Execute -SourceHash ('A'*64)} 'FINAL_RECEIPT_WRITE_FAILED'
    $attempt=[IO.File]::Open($pinPath,'Open','ReadWrite','None');$attempt.Dispose()
    Assert $true 'SOURCE_LOCK_LEAKED_AFTER_RECEIPT_FAILURE'
    Set-Item Function:\Write-Ai09SessionJson -Value $script:originalWriter

    $text=[IO.File]::ReadAllText($source)
    Assert ($text -notmatch 'Stop-Process|\.Kill\(|-Verb\s+RunAs|-ExecutionPolicy|-EncodedCommand') 'FORBIDDEN_PROCESS_ACTION'
    Assert ($text -notmatch 'Invoke-Expression') 'ARBITRARY_COMMAND_BRIDGE'
    'SESSION_FIXTURES_PASS='+$script:passed
    'NATIVE_EXECUTIONS=0'
} finally {
    # Only this fixture's unique temp directory is eligible for cleanup.
    $resolved=[IO.Path]::GetFullPath($temp)
    $parent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $resolved.StartsWith($parent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai09-session-fixture-*'){throw 'UNSAFE_FIXTURE_CLEANUP'}
    if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}

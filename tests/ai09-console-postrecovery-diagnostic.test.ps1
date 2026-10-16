param([string]$RepositoryRoot=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$source=Join-Path $RepositoryRoot 'scripts/ai09-console-postrecovery-diagnostic.ps1'
if(-not(Test-Path -LiteralPath $source)){throw 'POSTRECOVERY_DIAGNOSTIC_MISSING'}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'DIAGNOSTIC_PARSE_ERROR'}
. $source
$script:passed=0
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message};$script:passed++}
function Refuses([scriptblock]$Body,[string]$Pattern){$caught=$false;try{$null=& $Body}catch{$caught=$true;if($_.Exception.Message -notlike ('*'+$Pattern+'*')){throw}};Assert $caught ('EXPECTED_'+$Pattern)}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('ai09-postdiagnostic-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $temp
try{
    $commands=@(Get-Ai09PostRecoveryCommands)
    Assert ($commands.Count -eq 11) 'COMMAND_COUNT'
    foreach($command in $commands){
        Assert ($command -cmatch '^timeout -k 1s 5s [a-z]' -and $command.EndsWith('; echo $?')) 'UNBOUNDED_COMMAND'
        Assert ($command -cnotmatch '[^a-zA-Z0-9 /.,;$?-]') 'UNSUPPORTED_ENCODER_CHARACTER'
        Assert ($command -notmatch '\bsudo\b|\bmount\b|\bumount\b|\breload\b|\breconfigure\b|[|><&]') 'MUTATING_OR_GENERIC_COMMAND'
    }
    Assert ($commands[1] -ceq 'timeout -k 1s 5s ip -4 -br address show eth0; echo $?') 'ACTUAL_IPV4_MISSING'
    Assert ($commands[3] -ceq 'timeout -k 1s 5s networkctl --no-pager -n 0 status eth0; echo $?') 'NETWORK_STATUS_UNBOUNDED'
    Assert ($commands[4] -match ' stat ' -and $commands[5] -match ' readlink -f ' -and $commands[6] -match ' sha256sum ' -and $commands[7] -match ' head -c 512 ') 'CONFIG_READ_ORDER'
    Assert ($commands[9] -match 'journalctl ' -and $commands[9] -match '-n 10 ' -and $commands[9] -match '--no-full ' -and $commands[9] -match '--truncate-newline ' -and $commands[9] -match '--no-pager ') 'JOURNAL_DISPLAY_BOUNDARY'
    $context=New-Ai09SyncContext $temp ('A'*64)
    Refuses {Assert-Ai09InputReady $context} 'FRESH_OBSERVATION'
    $ready=New-Ai09SyncRequest $context ready
    Assert (-not(Receive-Ai09SyncResponse $context $ready)) 'READINESS_AUTO_ACKED'
    Publish-Ai09SyncJson (Join-Path $temp 'ready.ack.json.pending') $ready
    Assert (-not(Receive-Ai09SyncResponse $context $ready)) 'PARTIAL_ACK_ACCEPTED'
    Publish-Ai09SyncJson (Join-Path $temp 'ready.ack.json') $ready
    $null=Receive-Ai09SyncResponse $context $ready
    Refuses {Assert-Ai09InputReady $context} 'FRESH_OBSERVATION'
    $before=New-Ai09SyncRequest $context before ('B'*64)
    Publish-Ai09SyncJson (Join-Path $temp 'before.ack.json') $before
    $null=Receive-Ai09SyncResponse $context $before
    Assert-Ai09InputReady $context;Assert $true 'FRESH_INPUT_REFUSED'
    $request=New-Ai09SyncRequest $context command-2-after ('B'*64)
    Assert ($request.Decision -ceq 'OBSERVED') 'READONLY_SUDO_GATE_REMAINED'
    foreach($field in @('RunId','Stage','Nonce','ImageSha256','SourceSha256')){
        $bad=$request.PSObject.Copy();$bad.$field='wrong'
        Refuses {Assert-Ai09SyncResponse $context $request $bad} 'ACK_IDENTITY_MISMATCH'
    }
    $bad=$request.PSObject.Copy();$bad.Decision='SUDO_ROOT_EXIT0_OBSERVED'
    Refuses {Assert-Ai09SyncResponse $context $request $bad} 'ACK_DECISION_MISMATCH'
    $bad=$request.PSObject.Copy();$bad.Decision=@('OBSERVED')
    Refuses {Assert-Ai09SyncResponse $context $request $bad} 'ACK_DECISION_MISMATCH'
    Publish-Ai09SyncJson (Join-Path $temp 'command-2-after.ack.json') $request
    $null=Receive-Ai09SyncResponse $context $request
    Refuses {Receive-Ai09SyncResponse $context $request} 'ACK_REPLAY'
    $abort=New-Ai09SyncRequest $context command-3-typed ('B'*64)
    $abortResponse=$abort.PSObject.Copy();$abortResponse.Decision='ABORT'
    Publish-Ai09SyncJson (Join-Path $temp 'command-3-typed.ack.json') $abortResponse
    Refuses {Receive-Ai09SyncResponse $context $abort} 'OBSERVER_ABORTED'

    $configRequest=New-Ai09SyncRequest $context command-5-after ('B'*64)
    Assert ($configRequest.Decision -ceq 'REGULAR_CONFIG_LE512_OBSERVED') 'CONFIG_GATE_NOT_SPECIFIC'
    Refuses {Assert-Ai09DiagnosticCommandReady $context 6} 'REGULAR_NONLINK'
    $badConfig=$configRequest.PSObject.Copy();$badConfig.Decision='OBSERVED'
    Refuses {Assert-Ai09SyncResponse $context $configRequest $badConfig} 'ACK_DECISION_MISMATCH'
    Publish-Ai09SyncJson (Join-Path $temp 'command-5-after.ack.json') $configRequest
    $null=Receive-Ai09SyncResponse $context $configRequest
    Assert-Ai09DiagnosticCommandReady $context 7
    Assert $context.ConfigFileObserved 'CONFIG_GATE_NOT_CONSUMED'
    $context.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Refuses {Assert-Ai09InputReady $context} 'DEADLINE'

    $script:attached=$false;$script:boundaryFailure=$false;$script:preflights=0
    function Assert-Ai09CollectionEnvironment {param($Scope,[bool]$SeedAttached);if($SeedAttached){throw 'ATTACHED_REQUESTED'};if($script:boundaryFailure){throw 'EXACT_BOUNDARY_CHANGED'};$script:preflights++}
    function Get-Ai09CollectionVhd {param($Scope);return [pscustomobject]@{Attached=$script:attached}}
    Assert-Ai09PostRecoveryPreflight ([pscustomobject]@{})
    Assert ($script:preflights -eq 1) 'DETACHED_PREFLIGHT_NOT_CALLED'
    $script:attached=$true
    Refuses {Assert-Ai09PostRecoveryPreflight ([pscustomobject]@{})} 'SEED_HOST_ATTACHED'
    $script:attached=$false;$script:boundaryFailure=$true
    Refuses {Assert-Ai09PostRecoveryPreflight ([pscustomobject]@{})} 'EXACT_BOUNDARY_CHANGED'


    # Startup waits only on the unchanged full preflight's exact busy-Runner result.
    $preflightAst=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-Ai09PostRecoveryPreflight'},$false)
    $script:waitCalls=0;$script:busyRemaining=2;$script:waitFailure='';$script:realWait=$false
    function Assert-Ai09PostRecoveryPreflight {
        param($Scope)
        $script:waitCalls++
        if($script:waitFailure){throw $script:waitFailure}
        if($script:busyRemaining -gt 0){$script:busyRemaining--;throw 'RUNNER_NOT_IDLE'}
    }
    function Start-Sleep {param([int]$Milliseconds);if($Milliseconds -le 0 -or $Milliseconds -gt 5000){throw 'INVALID_FIXTURE_SLEEP_BOUND'};if($script:realWait){[Threading.Thread]::Sleep($Milliseconds)}}
    function New-WaitFixture {
        $c=New-Ai09SyncContext $temp ('A'*64)
        $c.ReadyAccepted=$true;$null=$c.Stages.Add('ready')
        return $c
    }
    $waitContext=New-WaitFixture;$waitReport=[ordered]@{Events=@()}
    Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport
    Assert ($script:waitCalls -eq 3 -and $waitReport.StartupRunnerWait.BusyObservations -eq 2 -and $waitReport.StartupRunnerWait.Outcome -ceq 'PREFLIGHT_PASSED') 'BUSY_RUNNER_NOT_RECHECKED'
    Assert ($waitReport.StartupRunnerWait.LimitSeconds -eq 300 -and @($waitReport.Events).Count -eq 0 -and -not $waitContext.FreshBeforeAccepted) 'STARTUP_WAIT_CHANGED_INPUT_STATE'
    Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport} 'STARTUP_ONLY_WAIT'
    $script:waitCalls=0;$script:busyRemaining=1000;$script:realWait=$true
    $waitContext=New-WaitFixture;$waitReport=[ordered]@{Events=@()}
    Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport -Seconds 0.03} 'STARTUP_RUNNER_WAIT_TIMEOUT'
    Assert ($waitReport.StartupRunnerWait.Outcome -ceq 'STOPPED' -and $waitReport.StartupRunnerWait.BusyObservations -ge 1) 'WAIT_TIMEOUT_EVIDENCE_MISSING'
    $waitContext=New-WaitFixture;$waitContext.Deadline=[DateTimeOffset]::UtcNow.AddMilliseconds(30);$waitReport=[ordered]@{Events=@()}
    Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport} 'WHOLE_RUN_DEADLINE'
    $script:realWait=$false;$script:waitCalls=0;$script:waitFailure='VM_ACL_CHANGED'
    $waitContext=New-WaitFixture;$waitReport=[ordered]@{Events=@()}
    Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport} 'VM_ACL_CHANGED'
    Assert ($script:waitCalls -eq 1 -and $waitReport.StartupRunnerWait.BusyObservations -eq 0) 'OTHER_FAILURE_RETRIED'
    $script:waitFailure='';$script:waitCalls=0
    foreach($advancedState in @('notready','before','event','pressed')){
        $waitContext=New-WaitFixture;$waitReport=[ordered]@{Events=@()}
        switch($advancedState){
            notready {$waitContext.ReadyAccepted=$false}
            before {$null=$waitContext.Stages.Add('before')}
            event {$waitReport.Events=@([pscustomobject]@{Event='before'})}
            pressed {$null=$waitContext.PressAttempted.Add(17)}
        }
        Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) $waitReport} 'STARTUP_ONLY_WAIT'
    }
    Assert ($script:waitCalls -eq 0) 'ADVANCED_STATE_REACHED_PREFLIGHT_WAIT'
    $waitContext=New-WaitFixture;$waitContext.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Refuses {Wait-Ai09DiagnosticStartup $waitContext ([pscustomobject]@{}) ([ordered]@{Events=@()})} 'WHOLE_RUN_DEADLINE'
    Refuses {Wait-Ai09DiagnosticStartup (New-WaitFixture) ([pscustomobject]@{}) ([ordered]@{Events=@()}) -Seconds 301} 'INVALID_STARTUP_WAIT'
    Remove-Item -LiteralPath Function:\Start-Sleep
    . ([scriptblock]::Create($preflightAst.Extent.Text))

    $script:ruleHash='D'*64
    function Get-NetAdapter {param($Name,$ErrorAction);[pscustomobject]@{Name=$Name;InterfaceIndex=37;MacAddress='00-15-5D-B2-2D-C4';Status='Up'}}
    function Get-NetIPAddress {param($InterfaceIndex,$AddressFamily,$ErrorAction);[pscustomobject]@{InterfaceIndex=37;IPAddress='172.27.128.1';PrefixLength=20;AddressState='Preferred';PrefixOrigin='Manual';SuffixOrigin='Manual'}}
    function Get-VMNetworkAdapterExtendedAcl {param($VMName,$ErrorAction);1..4|ForEach-Object{[pscustomobject]@{Direction=1;Action=2;Weight=$_;LocalIPAddress='172.29.80.1/32';RemoteIPAddress='0.0.0.0/0';LocalPort='67';RemotePort='68';Protocol='UDP';Stateful=$false;IdleSessionTimeout=0}}}
    function Get-Ai09AclSha256 {param($Rules);return $script:ruleHash}
    $scope=[pscustomobject]@{VmName='GORIQ-AI09-Ubuntu';AclSha256=('D'*64)}
    $snapshot=Get-Ai09PostRecoveryHostSnapshot $scope
    Assert ($snapshot.DefaultSwitchIPv4[0].IPAddress -ceq '172.27.128.1' -and $snapshot.DefaultSwitchIPv4[0].PrefixLength -eq 20) 'OBSERVED_HOST_ADDRESS_REPLACED'
    Assert ($snapshot.Acl.Count -eq 4 -and $snapshot.Acl[0].LocalIPAddress -ceq '172.29.80.1/32') 'EXACT_ACL_NOT_RECORDED'
    Assert (-not $snapshot.GuestNetworkVerified) 'HOST_ADDRESS_PROMOTED_TO_GUEST_VERIFICATION'
    $script:ruleHash='E'*64
    Refuses {Get-Ai09PostRecoveryHostSnapshot $scope} 'VM_ACL_CHANGED'

    $file=Join-Path $temp 'trusted.ps1';[IO.File]::WriteAllText($file,'# fixture')
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    $lock=Open-Ai09DiagnosticPinnedFile $file $hash
    try{Refuses {$h=[IO.File]::Open($file,'Open','ReadWrite','None');$h.Dispose()} ''}finally{$lock.Dispose()}
    Refuses {Open-Ai09DiagnosticPinnedFile $file ('0'*64)} 'PINNED_FILE_HASH'
    $real=Join-Path $temp 'real';$link=Join-Path $temp 'link'
    $null=New-Item -ItemType Directory -Path $real
    [IO.File]::WriteAllText((Join-Path $real 'plain.txt'),'fixture')
    if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){$null=New-Item -ItemType Junction -Path $link -Target $real}
    else{$null=New-Item -ItemType SymbolicLink -Path $link -Target $real}
    Refuses {Assert-Ai09DiagnosticPath (Join-Path $link 'plain.txt')} 'REPARSE'

    $text=[IO.File]::ReadAllText($source).Replace([string][char]13,'')
    $start=$text.IndexOf('        foreach ($character in $command.ToCharArray())')
    $end=$text.IndexOf('        $typedName',$start)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$encoderHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text.Substring($start,$end-$start))))).Replace('-','')}finally{$sha.Dispose()}
    Assert ($encoderHash -ceq '0DCA46956711AFA401AF7A0573659498EAC0B93CCB432F158A495ACF0ABB00DE') 'REVIEWED_ENCODER_CHANGED'
    Assert ($text -notmatch 'SeedAttached \$true|SudoRootObserved|OneDrive|Invoke-Expression|Start-Process|Set-Net|Add-VM|Mount-VHD|Remove-VM') 'UNAUTHORIZED_NATIVE_PATH'


    # Image rendezvous uses 300 seconds, while the whole-run deadline still wins.
    $longContext=New-Ai09SyncContext $temp ('A'*64)
    $now=[DateTimeOffset]::UtcNow
    $longRequest=New-Ai09SyncRequest $longContext command-4-after ('B'*64)
    $expiry=[DateTimeOffset]::ParseExact($longRequest.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    Assert (($expiry-$now).TotalSeconds -ge 299 -and ($expiry-$now).TotalSeconds -le 301) 'IMAGE_RENDEZVOUS_NOT_300_SECONDS'
    Assert ($longContext.WholeSeconds -eq 1800) 'WHOLE_DEADLINE_CHANGED'
    $shortContext=New-Ai09SyncContext $temp ('A'*64) -WholeSeconds 2
    $shortRequest=New-Ai09SyncRequest $shortContext command-10-typed ('B'*64)
    Assert ([DateTimeOffset]::ParseExact($shortRequest.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture) -le $shortContext.Deadline) 'IMAGE_WAIT_EXCEEDS_WHOLE_DEADLINE'
    $shortContext.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Refuses {Assert-Ai09SyncResponse $shortContext $shortRequest $shortRequest} 'WHOLE_RUN_DEADLINE'

    $proofReceipt=[pscustomobject]@{
        RunId='5da8b683fa714b4796505665c5445820';SourceSha256='190E33522BB620AF520F217AAC01F3DBC705DB5465BF3A84750F29597DCCAF99'
        Success=$false;GuestExecutionVerified=$false;GuestNetworkVerified=$false;AuthenticationVerified=$false
        Error='OBSERVER_TIMEOUT_before';StartedAt='2026-10-16T04:17:37.6542482+00:00';FinishedAt='2026-10-16T04:20:03.9340604+00:00'
        Events=@(
            @(160,161,162,163,164,165)|ForEach-Object{[pscustomobject]@{Method='IsKeyPressed';Key=$_;ReturnValue=0;KeyState=$false}}
        )+@(
            [pscustomobject]@{Event='ThumbnailMetadata';Stage='before'},
            [pscustomobject]@{Event='ThumbnailDecoded';Stage='before'},
            [pscustomobject]@{Event='before'}
        )
    }
    $proofRequest=[pscustomobject]@{Version='1';RunId=$proofReceipt.RunId;SourceSha256=$proofReceipt.SourceSha256;Stage='before';Nonce='5c7ae13562e1483b8f58d6a148acf312';ImageSha256=('B'*64);ExpiresAt='2026-10-16T04:20:03.8981577+00:00';Decision='OBSERVED'}
    Assert-Ai09DiagnosticRetryProof $proofReceipt $proofRequest ('B'*64)
    Assert $true 'EXACT_NO_INPUT_FAILURE_REFUSED'
    foreach($field in @('RunId','SourceSha256','Error','FinishedAt')){
        $bad=$proofReceipt.PSObject.Copy();$bad.$field='wrong'
        Refuses {Assert-Ai09DiagnosticRetryProof $bad $proofRequest ('B'*64)} ''
    }
    $bad=$proofReceipt.PSObject.Copy();$bad.Success=$true
    Refuses {Assert-Ai09DiagnosticRetryProof $bad $proofRequest ('B'*64)} 'RETRY_TERMINAL'
    $bad=$proofReceipt.PSObject.Copy();$bad.Error=@('OBSERVER_TIMEOUT_before')
    Refuses {Assert-Ai09DiagnosticRetryProof $bad $proofRequest ('B'*64)} 'RETRY_TERMINAL'
    $bad=$proofReceipt.PSObject.Copy();$bad.Events=@($proofReceipt.Events)+@{Event='FixedCommandStart'}
    Refuses {Assert-Ai09DiagnosticRetryProof $bad $proofRequest ('B'*64)} 'RETRY_INPUT'
    $savedMethod=$proofReceipt.Events[0].Method;$proofReceipt.Events[0].Method='TypeKey'
    Refuses {Assert-Ai09DiagnosticRetryProof $proofReceipt $proofRequest ('B'*64)} 'RETRY_INPUT'
    $proofReceipt.Events[0].Method=$savedMethod
    $badRequest=$proofRequest.PSObject.Copy();$badRequest.ImageSha256='C'*64
    Refuses {Assert-Ai09DiagnosticRetryProof $proofReceipt $badRequest ('B'*64)} 'RETRY_BEFORE'
    $badRequest=$proofRequest.PSObject.Copy();$badRequest.Stage='awake'
    Refuses {Assert-Ai09DiagnosticRetryProof $proofReceipt $badRequest ('B'*64)} 'RETRY_BEFORE'

    # Exercise the fixed selector with test-local paths and independently hashed fixture bytes.
    $oldRoot=Join-Path $temp 'old';$retryRoot=$oldRoot+'-retry1'
    $selector=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-Ai09DiagnosticOutputRoot'},$false)
    $literalRoot='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\tmp\ai09-console-postrecovery-diagnostic'
    $selectorText=$selector.Extent.Text.Replace($literalRoot,$oldRoot.Replace("'","''"))
    . ([scriptblock]::Create($selectorText))
    $locks=[Collections.Generic.List[IO.FileStream]]::new()
    Assert ((Get-Ai09DiagnosticOutputRoot $locks) -ceq $oldRoot -and $locks.Count -eq 0) 'FIRST_RUN_REDIRECTED'
    $null=New-Item -ItemType Directory -Path $retryRoot
    Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'ORIGINAL_RETRY_PROOF_MISSING'
    Remove-Item -LiteralPath $retryRoot
    $null=New-Item -ItemType Directory -Path $oldRoot
    Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_FILE_SET'
    [IO.File]::WriteAllBytes((Join-Path $oldRoot 'before.png'),[byte[]]@(1,2,3))
    [IO.File]::WriteAllBytes((Join-Path $oldRoot 'before-1024.raw'),[byte[]]@(4,5,6))
    $proofRequest.ImageSha256=(Get-FileHash -LiteralPath (Join-Path $oldRoot 'before.png')).Hash
    [IO.File]::WriteAllText((Join-Path $oldRoot 'before.request.json'),($proofRequest|ConvertTo-Json -Compress))
    [IO.File]::WriteAllText((Join-Path $oldRoot 'receipt.json'),($proofReceipt|ConvertTo-Json -Depth 8 -Compress))
    [IO.File]::WriteAllText((Join-Path $oldRoot 'ready.request.json'),'{"fixture":true}')
    [IO.File]::WriteAllText((Join-Path $oldRoot 'ready.consumed.json'),'{"fixture":true}')
    $actualPins=@{
        'before-1024.raw'='24F8FD825EC6D0D066263095FEDA465A921016CDD1B3466335AC2B1AD3C06B7D'
        'before.png'='AE59E2DB9564011827DF400748EA4D16E3F22CFA90EB6ED455EFE262CFAADDBD'
        'before.request.json'='51E4CC07107D72377FB267F778ED2F69C9B6568B4DC40DFA406839C78A5461CA'
        'ready.request.json'='296EDB3AEAF544145436352AA66DAA5005A52AC78ED42F7D693CDC2FFB855039'
        'ready.consumed.json'='296EDB3AEAF544145436352AA66DAA5005A52AC78ED42F7D693CDC2FFB855039'
        'receipt.json'='7BFDB29801FCABB72078F2F26B63E120C2DF1047D5DCEF6DFB70967CE62AE68E'
    }
    foreach($name in $actualPins.Keys){$selectorText=$selectorText.Replace($actualPins[$name],(Get-FileHash -LiteralPath (Join-Path $oldRoot $name)).Hash)}
    . ([scriptblock]::Create($selectorText))
    try{
        Assert ((Get-Ai09DiagnosticOutputRoot $locks) -ceq $retryRoot -and $locks.Count -eq 6) 'EXACT_RETRY_NOT_SELECTED'
        Refuses {$h=[IO.File]::Open((Join-Path $oldRoot 'receipt.json'),'Open','ReadWrite','None');$h.Dispose()} ''
    }finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}
    $null=New-Item -ItemType Directory -Path $retryRoot
    try{Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_FILE_SET'}finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}
    $secondReceipt=[pscustomobject]@{
        RunId='1ab689a6b0e94f8cb390ee762c79aeb8';SourceSha256='AB0AEEC3468B0BBFC29EAEC5A738234FA77494F1985CD288BB7AAD0E439DED46'
        StartedAt='2026-10-16T04:37:45.8595958+00:00';FinishedAt='2026-10-16T04:38:12.5462601+00:00';Error='RUNNER_NOT_IDLE'
        Success=$false;GuestExecutionVerified=$false;GuestNetworkVerified=$false;AuthenticationVerified=$false;Events=@()
        ContinuedFromRunId='5da8b683fa714b4796505665c5445820';ContinuationReceiptSha256='7BFDB29801FCABB72078F2F26B63E120C2DF1047D5DCEF6DFB70967CE62AE68E'
    }
    $secondReady=[pscustomobject]@{
        Version='1';RunId=$secondReceipt.RunId;SourceSha256=$secondReceipt.SourceSha256;Stage='ready'
        Nonce='c02643b99d054f019004d2ab7261dddc';ImageSha256='';ExpiresAt='2026-10-16T04:42:45.8846469+00:00';Decision='READY'
    }
    Assert-Ai09DiagnosticSecondRetryProof $secondReceipt $secondReady
    Assert $true 'EXACT_SECOND_FAILURE_REFUSED'
    foreach($field in @('RunId','SourceSha256','Error','ContinuedFromRunId','ContinuationReceiptSha256')){
        $bad=$secondReceipt.PSObject.Copy();$bad.$field=@($secondReceipt.$field)
        Refuses {Assert-Ai09DiagnosticSecondRetryProof $bad $secondReady} 'SECOND_RETRY'
    }
    foreach($events in @(@{Value=$null},@{Value=@([pscustomobject]@{Event='before'})})){
        $bad=$secondReceipt.PSObject.Copy();$bad.Events=$events.Value
        Refuses {Assert-Ai09DiagnosticSecondRetryProof $bad $secondReady} 'SECOND_RETRY'
    }
    $bad=$secondReceipt.PSObject.Copy();$bad.GuestNetworkVerified=$true
    Refuses {Assert-Ai09DiagnosticSecondRetryProof $bad $secondReady} 'SECOND_RETRY'
    foreach($field in @('RunId','SourceSha256','Stage','Nonce','Decision','ImageSha256')){
        $bad=$secondReady.PSObject.Copy();$bad.$field='wrong'
        Refuses {Assert-Ai09DiagnosticSecondRetryProof $secondReceipt $bad} 'SECOND_RETRY'
    }
    $bad=$secondReady.PSObject.Copy();$bad.Decision=@()
    Refuses {Assert-Ai09DiagnosticSecondRetryProof $secondReceipt $bad} 'SECOND_RETRY'
    $secondReceiptText=$secondReceipt|ConvertTo-Json -Depth 8 -Compress
    $secondReadyText=$secondReady|ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $retryRoot 'receipt.json'),$secondReceiptText)
    [IO.File]::WriteAllText((Join-Path $retryRoot 'ready.request.json'),$secondReadyText)
    [IO.File]::WriteAllText((Join-Path $retryRoot 'ready.consumed.json'),$secondReadyText)
    $selectorText=$selectorText.Replace('073FDE9DBFE5A85442F3CE12B4F566F27A0989E57FC9D6DBB86CE6792A025B56',(Get-FileHash -LiteralPath (Join-Path $retryRoot 'receipt.json')).Hash)
    $selectorText=$selectorText.Replace('E3AF8C299B90443BF842FF7AD5273D41CB01772571C64626A9A829DBF6EB7F17',(Get-FileHash -LiteralPath (Join-Path $retryRoot 'ready.request.json')).Hash)
    . ([scriptblock]::Create($selectorText))
    $retry2Root=$oldRoot+'-retry2'
    try{
        Assert ((Get-Ai09DiagnosticOutputRoot $locks) -ceq $retry2Root -and $locks.Count -eq 9) 'FINAL_RETRY_NOT_SELECTED_OR_UNLOCKED'
        foreach($heldPath in @((Join-Path $oldRoot 'receipt.json'),(Join-Path $retryRoot 'receipt.json'))){
            Refuses {$h=[IO.File]::Open($heldPath,'Open','ReadWrite','None');$h.Dispose()} ''
        }
    }finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}
    $null=New-Item -ItemType Directory -Path $retry2Root
    Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_ALREADY_STARTED'
    Assert ($locks.Count -eq 0) 'FINAL_RETRY_EXISTENCE_NOT_CHECKED_FIRST'
    Remove-Item -LiteralPath $retry2Root
    $advancedSecond=Join-Path $retryRoot 'before.png';[IO.File]::WriteAllText($advancedSecond,'unexpected')
    try{Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_FILE_SET'}finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}
    Remove-Item -LiteralPath $advancedSecond
    [IO.File]::AppendAllText((Join-Path $retryRoot 'ready.consumed.json'),' ')
    try{Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'PINNED_FILE_HASH'}finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}
    [IO.File]::WriteAllText((Join-Path $retryRoot 'ready.consumed.json'),$secondReadyText)
    $advanced=Join-Path $oldRoot 'awake.png';[IO.File]::WriteAllText($advanced,'unexpected')
    Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_FILE_SET'
    Remove-Item -LiteralPath $advanced
    $tampered=Join-Path $oldRoot 'before.png';[IO.File]::WriteAllBytes($tampered,[byte[]]@(9))
    try{Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'PINNED_FILE_HASH'}finally{foreach($held in $locks){$held.Dispose()};$locks.Clear()}

    # Execute only the startup failure path with readiness and helper loading stubbed.
    # The fixed production output path is replaced inside this test-local function AST.
    $main=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-Ai09PostRecoveryDiagnostic'},$false)
    $safeRun=Join-Path $temp 'startup-failure'
    $originalOutput='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\tmp\ai09-console-postrecovery-diagnostic'
    $testFunction=$main.Extent.Text
    function Get-Ai09DiagnosticOutputRoot {param($Locks);return $safeRun}
    . ([scriptblock]::Create($testFunction))
    $script:nativeQueries=0
    function Get-VM {$script:nativeQueries++;throw 'UNEXPECTED_NATIVE_QUERY'}
    function Open-Ai09DiagnosticPinnedFile {param($Path,$Hash);throw 'FIXTURE_HELPER_PREFLIGHT_FAILURE'}
    function Wait-Ai09SyncResponse {param($Context,$Request,$Seconds);$Context.ReadyAccepted=$true}
    $startupError=$null
    try{Invoke-Ai09PostRecoveryDiagnostic ('A'*64)}catch{$startupError=$_.Exception.Message}
    Assert ($startupError -like '*POSTRECOVERY_DIAGNOSTIC_STOPPED*') 'STARTUP_FAILURE_NOT_SURFACED'
    $receiptPath=Join-Path $safeRun 'receipt.json'
    Assert (Test-Path -LiteralPath $receiptPath) 'STARTUP_FAILURE_RECEIPT_MISSING'
    $receipt=Get-Content -LiteralPath $receiptPath -Raw|ConvertFrom-Json
    Assert (-not $receipt.Success -and -not $receipt.GuestNetworkVerified -and -not $receipt.AuthenticationVerified -and [bool]$receipt.Error) 'STARTUP_FAILURE_REPORTED_SUCCESS'
    Assert ($script:nativeQueries -eq 0 -and @($receipt.Events).Count -eq 0) 'STARTUP_FAILURE_REACHED_VM'

    'POSTRECOVERY_DIAGNOSTIC_FIXTURES_PASS='+$script:passed
    'NATIVE_VM_INPUTS=0'
}finally{
    $resolved=[IO.Path]::GetFullPath($temp);$tempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if(-not $resolved.StartsWith($tempParent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai09-postdiagnostic-fixture-*'){throw 'UNSAFE_FIXTURE_CLEANUP'}
    if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Recurse -Force}
}

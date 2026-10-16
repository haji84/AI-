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
    Refuses {Get-Ai09DiagnosticOutputRoot $locks} 'RETRY_ALREADY_STARTED'
    Remove-Item -LiteralPath $retryRoot
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

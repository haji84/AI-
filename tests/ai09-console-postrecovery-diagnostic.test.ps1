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

    # Execute only the startup failure path with readiness and helper loading stubbed.
    # The fixed production output path is replaced inside this test-local function AST.
    $main=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-Ai09PostRecoveryDiagnostic'},$false)
    $safeRun=Join-Path $temp 'startup-failure'
    $originalOutput='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\tmp\ai09-console-postrecovery-diagnostic'
    $testFunction=$main.Extent.Text.Replace($originalOutput,$safeRun.Replace("'","''"))
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

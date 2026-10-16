param([string]$HelperPath = (Join-Path $PSScriptRoot 'ai09-console-bootstrap-synced.ps1'))
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $HelperPath)) { throw 'SYNCED_RENDEZVOUS_HELPER_MISSING' }
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($HelperPath,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
. $HelperPath
$passed=0
function Assert-True($value,[string]$message){if(-not $value){throw $message}}
function Expect-Failure([scriptblock]$body,[string]$message){
    $actual=''; try{$null=& $body}catch{$actual=$_.Exception.Message}
    Assert-True ($actual -like ('*'+$message+'*')) ("Expected "+$message+"; got "+$actual)
}
function Test-SyncCase([string]$name,[scriptblock]$body){
    $temp=Join-Path ([IO.Path]::GetTempPath()) ('ai09-sync-fixture-'+[guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($temp)|Out-Null
    try {
        $context=New-Ai09SyncContext -Root $temp -SourceSha256 ('A'*64)
        & $body
        $script:passed++; Write-Output ("PASS "+$name)
    } finally {
        foreach($file in [IO.Directory]::EnumerateFiles($temp)){[IO.File]::Delete($file)}
        [IO.Directory]::Delete($temp,$false)
    }
}
function Ack-Request($context,$request){
    Publish-Ai09SyncJson -Path (Join-Path $context.Root ($request.Stage+'.ack.json')) -Value $request
    Receive-Ai09SyncResponse -Context $context -Request $request
}
Test-SyncCase 'delayed startup stays idle until atomic readiness arrives' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready -Seconds 3
    Assert-True (-not (Receive-Ai09SyncResponse $context $request) -and -not $context.ReadyAccepted) 'Early readiness'
    $worker=[PowerShell]::Create()
    try {
        $null=$worker.AddScript('param($helper,$root) . $helper; Start-Sleep -Milliseconds 300; $request=Read-Ai09SyncJson (Join-Path $root "ready.request.json"); Publish-Ai09SyncJson -Path (Join-Path $root "ready.ack.json") -Value $request').AddArgument($HelperPath).AddArgument($temp)
        $pending=$worker.BeginInvoke()
        $clock=[Diagnostics.Stopwatch]::StartNew()
        Wait-Ai09SyncResponse -Context $context -Request $request -Seconds 3
        $null=$worker.EndInvoke($pending)
        Assert-True ($worker.Streams.Error.Count -eq 0 -and $clock.Elapsed.TotalMilliseconds -ge 200 -and $context.ReadyAccepted -and -not $context.FreshBeforeAccepted) 'Delayed rendezvous not honored'
    } finally {$worker.Dispose()}
}
foreach($field in @('RunId','Stage','Nonce','ImageSha256','SourceSha256','ExpiresAt')){
    Test-SyncCase ("wrong "+$field+" refuses acknowledgement") {
        $request=New-Ai09SyncRequest -Context $context -Stage before -ImageSha256 ('B'*64)
        $response=$request.PSObject.Copy()
        $response.$field='wrong'
        Publish-Ai09SyncJson -Path (Join-Path $temp 'before.ack.json') -Value $response
        Expect-Failure { Receive-Ai09SyncResponse $context $request } ('ACK_IDENTITY_MISMATCH_'+$field)
        Assert-True (-not $context.FreshBeforeAccepted) 'Wrong identity accepted'
    }
}
Test-SyncCase 'expired readiness cannot enable input' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready -Seconds .02
    Start-Sleep -Milliseconds 40
    Publish-Ai09SyncJson -Path (Join-Path $temp 'ready.ack.json') -Value $request
    Expect-Failure { Receive-Ai09SyncResponse $context $request } 'ACK_EXPIRED'
    Assert-True (-not $context.ReadyAccepted) 'Expired ready accepted'
}
Test-SyncCase 'missing startup response has a finite timeout' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready -Seconds 2
    Expect-Failure { Wait-Ai09SyncResponse -Context $context -Request $request -Seconds .1 } 'OBSERVER_TIMEOUT'
    Assert-True (-not $context.ReadyAccepted) 'Timeout enabled input'
}
Test-SyncCase 'whole deadline wins even with ready response' {
    $context=New-Ai09SyncContext -Root $temp -SourceSha256 ('A'*64) -WholeSeconds .02
    $request=New-Ai09SyncRequest -Context $context -Stage ready -Seconds 3
    Start-Sleep -Milliseconds 40
    Publish-Ai09SyncJson -Path (Join-Path $temp 'ready.ack.json') -Value $request
    Expect-Failure { Receive-Ai09SyncResponse $context $request } 'WHOLE_RUN_DEADLINE_EXPIRED'
}
Test-SyncCase 'partial pending response is invisible until closed and published' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready
    $pending=Join-Path $temp 'ready.ack.json.fixture.pending'
    $final=Join-Path $temp 'ready.ack.json'
    $bytes=[Text.Encoding]::UTF8.GetBytes(($request|ConvertTo-Json -Compress))
    $stream=[IO.File]::Open($pending,'CreateNew','Write','None')
    try {
        $half=[int]($bytes.Length/2)
        $stream.Write($bytes,0,$half);$stream.Flush($true)
        Assert-True (-not (Receive-Ai09SyncResponse $context $request)) 'Partial ack became visible'
        $stream.Write($bytes,$half,$bytes.Length-$half);$stream.Flush($true)
    } finally {$stream.Dispose()}
    Assert-True (-not $context.ReadyAccepted) 'Pending response enabled input'
    [IO.File]::Move($pending,$final)
    Assert-True (Receive-Ai09SyncResponse $context $request) 'Published response not accepted'
}
Test-SyncCase 'consumed response and reused stage cannot be replayed' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready
    Assert-True (Ack-Request $context $request) 'Ready rejected'
    Assert-True ((Test-Path (Join-Path $temp 'ready.consumed.json')) -and -not (Test-Path (Join-Path $temp 'ready.ack.json'))) 'ACK not consumed'
    Publish-Ai09SyncJson -Path (Join-Path $temp 'ready.ack.json') -Value $request
    Expect-Failure {Receive-Ai09SyncResponse $context $request} 'ACK_REPLAY_REFUSED'
    Expect-Failure {New-Ai09SyncRequest -Context $context -Stage ready} 'STAGE_REPLAY_REFUSED'
}
Test-SyncCase 'publisher never overwrites an existing final response' {
    $path=Join-Path $temp 'test.json'
    Publish-Ai09SyncJson $path ([pscustomobject]@{Value='first'})
    Expect-Failure {Publish-Ai09SyncJson $path ([pscustomobject]@{Value='second'})} 'SYNC_FILE_ALREADY_EXISTS'
    Assert-True ((Read-Ai09SyncJson $path).Value -eq 'first') 'Existing response overwritten'
}
Test-SyncCase 'extra command payload is refused' {
    $request=New-Ai09SyncRequest -Context $context -Stage ready
    $response=$request.PSObject.Copy()
    $response|Add-Member Command 'echo untrusted'
    Publish-Ai09SyncJson -Path (Join-Path $temp 'ready.ack.json') -Value $response
    Expect-Failure {Receive-Ai09SyncResponse $context $request} 'ACK_FIELDS_MISMATCH'
}
Test-SyncCase 'ordinary observation cannot certify sudo root exit0' {
    $request=New-Ai09SyncRequest -Context $context -Stage command-2-after -ImageSha256 ('B'*64)
    $response=$request.PSObject.Copy()
    $response.Decision='OBSERVED'
    Publish-Ai09SyncJson -Path (Join-Path $temp 'command-2-after.ack.json') -Value $response
    Expect-Failure {Receive-Ai09SyncResponse $context $request} 'ACK_DECISION_MISMATCH'
    Assert-True (-not $context.SudoRootObserved) 'Unverified sudo allowed'
}
Test-SyncCase 'failure acknowledgement stops promptly and never certifies sudo' {
    $request=New-Ai09SyncRequest -Context $context -Stage command-2-after -ImageSha256 ('B'*64)
    $response=$request.PSObject.Copy()
    $response.Decision='ABORT'
    Publish-Ai09SyncJson -Path (Join-Path $temp 'command-2-after.ack.json') -Value $response
    $clock=[Diagnostics.Stopwatch]::StartNew()
    Expect-Failure {Wait-Ai09SyncResponse -Context $context -Request $request -Seconds 90} 'OBSERVER_ABORTED'
    Assert-True ($clock.Elapsed.TotalSeconds -lt 2 -and -not $context.SudoRootObserved -and $context.Consumed.Contains($request.Nonce)) 'Abort delayed or enabled input'
}
Test-SyncCase 'old run response cannot satisfy a new run' {
    $old=New-Ai09SyncRequest -Context $context -Stage ready
    $other=New-Ai09SyncContext -Root $temp -SourceSha256 ('A'*64)
    $request=$old.PSObject.Copy()
    $request.RunId=$other.RunId
    Publish-Ai09SyncJson -Path (Join-Path $temp 'ready.ack.json') -Value $old
    Expect-Failure {Receive-Ai09SyncResponse $other $request} 'ACK_IDENTITY_MISMATCH_RunId'
}
Test-SyncCase 'real input gate prevents all keys until ready and fresh before observation' {
    $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-Key'},$true))
    Assert-True ($definition.Count -eq 1) 'Input wrapper missing'
    . ([scriptblock]::Create($definition[0].Extent.Text))
    $sync=$context
    $keyboard=[pscustomobject]@{}
    $keyboard|Add-Member -MemberType ScriptMethod -Name GetMethodParameters -Value {param($method) throw 'KEYBOARD_BOUNDARY_REACHED'}
    Expect-Failure {Invoke-Key 'TypeKey' 13} 'FRESH_OBSERVATION_REQUIRED_BEFORE_INPUT'
    $ready=New-Ai09SyncRequest -Context $context -Stage ready
    $null=Ack-Request $context $ready
    Expect-Failure {Invoke-Key 'TypeKey' 13} 'FRESH_OBSERVATION_REQUIRED_BEFORE_INPUT'
    $before=New-Ai09SyncRequest -Context $context -Stage before -ImageSha256 ('B'*64)
    $null=Ack-Request $context $before
    Expect-Failure {Invoke-Key 'TypeKey' 13} 'KEYBOARD_BOUNDARY_REACHED'
    $context.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Expect-Failure {Invoke-Key 'TypeKey' 13} 'WHOLE_RUN_DEADLINE_EXPIRED'
}
Test-SyncCase 'fresh image before readiness is refused' {
    $request=New-Ai09SyncRequest -Context $context -Stage before -ImageSha256 ('B'*64)
    Publish-Ai09SyncJson -Path (Join-Path $temp 'before.ack.json') -Value $request
    Expect-Failure {Receive-Ai09SyncResponse $context $request} 'READINESS_REQUIRED'
    Assert-True (-not $context.FreshBeforeAccepted) 'Fresh frame without ready'
}

Test-SyncCase 'owned modifier cleanup survives deadline and uncertain press response' {
    $definition=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-Key'},$true))
    . ([scriptblock]::Create($definition[0].Extent.Text))
    $sync=$context; $sync.ReadyAccepted=$true; $sync.FreshBeforeAccepted=$true
    $report=[ordered]@{Events=@()}
    $keyboard=[pscustomobject]@{Calls=[Collections.Generic.List[string]]::new(); FailPress=$false}
    $keyboard|Add-Member -MemberType ScriptMethod -Name GetMethodParameters -Value {param($method) [pscustomobject]@{keyCode=[uint32]0}}
    $keyboard|Add-Member -MemberType ScriptMethod -Name InvokeMethod -Value {
        param($method,$parameters,$unused)
        $this.Calls.Add($method+':'+$parameters.keyCode)
        if($method -eq 'PressKey' -and $this.FailPress){throw 'PRESS_RESPONSE_LOST'}
        [pscustomobject]@{ReturnValue=0}
    }
    Invoke-Key 'PressKey' 17
    $sync.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Invoke-Key 'ReleaseKey' 17
    Expect-Failure {Invoke-Key 'TypeKey' 13} 'WHOLE_RUN_DEADLINE_EXPIRED'
    Expect-Failure {Invoke-Key 'ReleaseKey' 17} 'WHOLE_RUN_DEADLINE_EXPIRED'
    Assert-True (($keyboard.Calls -join ',') -ceq 'PressKey:17,ReleaseKey:17') 'Deadline sent new or duplicate input'
    $sync.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(30)
    $keyboard.FailPress=$true
    Expect-Failure {Invoke-Key 'PressKey' 160} 'PRESS_RESPONSE_LOST'
    $sync.Deadline=[DateTimeOffset]::UtcNow.AddSeconds(-1)
    Invoke-Key 'ReleaseKey' 160
    Expect-Failure {Invoke-Key 'ReleaseKey' 161} 'WHOLE_RUN_DEADLINE_EXPIRED'
    Assert-True (($keyboard.Calls -join ',') -ceq 'PressKey:17,ReleaseKey:17,PressKey:160,ReleaseKey:160') 'Uncertain press not released exactly once'
}


foreach($kind in @('empty-array','single-array','null','object')){
    Test-SyncCase ("non-string decision "+$kind+" cannot certify sudo") {
        $request=New-Ai09SyncRequest -Context $context -Stage command-2-after -ImageSha256 ('B'*64)
        $response=$request.PSObject.Copy()
        switch($kind){
            'empty-array' {$response.Decision=@()}
            'single-array' {$response.Decision=@('SUDO_ROOT_EXIT0_OBSERVED')}
            'null' {$response.Decision=$null}
            'object' {$response.Decision=[pscustomobject]@{Value='SUDO_ROOT_EXIT0_OBSERVED'}}
        }
        Publish-Ai09SyncJson -Path (Join-Path $temp 'command-2-after.ack.json') -Value $response
        Expect-Failure {Receive-Ai09SyncResponse $context $request} 'ACK_DECISION_MISMATCH'
        Assert-True (-not $context.SudoRootObserved) 'Non-string decision enabled mount'
    }
}
# Independent block pins from retry2 SHA6DE66D53..., normalized LF for cross-platform checkouts.
function Get-FixtureBlockHash([string]$text){
    $hasher=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($text.Replace("`r`n","`n"))))).Replace('-','')}
    finally{$hasher.Dispose()}
}
$new=[IO.File]::ReadAllText($HelperPath).Replace("`r`n","`n")
$assignment=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -ceq '$fixedCommands'},$true))
Assert-True ($assignment.Count -eq 1 -and (Get-FixtureBlockHash $assignment[0].Right.Extent.Text) -ceq '93ACE06248065B7751537E4FFFE1E4FFDCADE076BBCC50652F4F2DE52C9461A4') 'Authorized fixed commands changed'
$start=$new.IndexOf('        foreach ($character in $command.ToCharArray())')
$end=$new.IndexOf('        $typedName',$start)
Assert-True ((Get-FixtureBlockHash $new.Substring($start,$end-$start)) -ceq '0DCA46956711AFA401AF7A0573659498EAC0B93CCB432F158A495ACF0ABB00DE') 'Encoder changed'
$start=$new.IndexOf('    if ($env:COMPUTERNAME')
$end=$new.IndexOf("    Save-GuestThumbnail 'before'",$start)
Assert-True ((Get-FixtureBlockHash $new.Substring($start,$end-$start)) -ceq 'C727F02A626CF7556A53ECF87B67C3D3D2235DE9B01931D3E0688BC15EBE57C0') 'Native identity preflight changed'
Write-Output ("SYNC_FIXTURE_PASS="+$passed+"; PARSE_ERRORS=0; ORIGINAL_COMMANDS_ENCODER_GUARDS_UNCHANGED; REAL_VM_INPUTS=0")

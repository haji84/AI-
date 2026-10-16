# Issue #1798. Fixed one-shot native session; no arbitrary command/path input.
[CmdletBinding()]
param([ValidateSet('Verify','Execute')][string]$Mode='Verify')
$ErrorActionPreference='Stop'

function Get-Ai09SessionScope {
    $repo='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\scripts'
    $temporary='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\tmp\ai09-network-session-bundle'
    return [pscustomobject]@{
        Root=(Join-Path $temporary 'ai09-network-recovery-session')
        ConsoleRoot=(Join-Path $temporary 'ai09-console-network-recovery')
        AuthRoot=(Join-Path $temporary 'ai09-console-network-auth')
        StageRoot=(Join-Path $temporary 'ai09-native-network-stage')
        NativePowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
        Pins=@(
            @{Name='Stage';Path=(Join-Path $temporary 'ai09-native-network-stage.ps1');Hash='CBF7E2F9DC6929D6225D6155E6F06F1B0D0C1F0122462105ABBF1D3A786C26F1'},
            @{Name='Auth';Path=(Join-Path $temporary 'ai09-console-network-auth.ps1');Hash='464A40FDBF38FF8A9226E63E758C51347BC3380DA63D6AFDC2CC1F80D09A5868'},
            @{Name='Console';Path=(Join-Path $temporary 'ai09-console-network-recovery.ps1');Hash='934F021C00BAAFC45BDF2E460E07C3F0C3C18EEACFD109788469705237A49163'},
            @{Name='Collect';Path=(Join-Path $repo 'ai09-collect-network-recovery.ps1');Hash='EF057617C16B8F0854AF578D00CF0C9E6CC1A1083BB26EDCECC1C171FF0A7440'},
            @{Name='PrepareHelper';Path=(Join-Path $repo 'ai09-prepare-bootstrap-disk.ps1');Hash='E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B'},
            @{Name='CollectorHelper';Path=(Join-Path $repo 'ai09-collect-bootstrap-result.ps1');Hash='6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391'},
            @{Name='RepairHelper';Path=(Join-Path $repo 'ai09-repair-seed-hostname.ps1');Hash='B46A1DD340E62705603448637763219224A6E5E3DEBF519EBB638406025EE7EE'},
            @{Name='StageHelper';Path=(Join-Path $repo 'ai09-stage-network-recovery.ps1');Hash='1624FF79246D462B2B28D01204E5ABCE50FC2893AE2F1C83E7A518C5567D79AF'},
            @{Name='Payload';Path=(Join-Path $repo 'ai09-network-recovery.sh');Hash='213E06BB5459C35E4535EB8C81C9DE5014D7BF85E30895F4C19F4864DEFE3CED'}
        )
    }
}
function Assert-Ai09SessionPath {
    param([string]$Path)
    if(-not [IO.Path]::IsPathRooted($Path)){throw 'SESSION_ABSOLUTE_PATH_REQUIRED'}
    $current=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    while($null -ne $current){
        if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'SESSION_REPARSE_PATH_REFUSED'}
        $current=if($current -is [IO.FileInfo]){$current.Directory}else{$current.Parent}
    }
}
function Get-Ai09SessionHash {
    param([byte[]]$Bytes)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','')}finally{$sha.Dispose()}
}
function Open-Ai09SessionPins {
    param($Scope)
    $locks=[Collections.Generic.List[IO.FileStream]]::new()
    try {
        foreach($pin in $Scope.Pins){
            if($pin.Hash -isnot [string] -or $pin.Hash -cnotmatch '^[0-9A-F]{64}$'){throw 'SESSION_UNPINNED_SOURCE'}
            Assert-Ai09SessionPath $pin.Path
            $handle=[IO.File]::Open($pin.Path,'Open','Read','Read');$locks.Add($handle)
            $sha=[Security.Cryptography.SHA256]::Create()
            try{$actual=([BitConverter]::ToString($sha.ComputeHash($handle))).Replace('-','')}finally{$sha.Dispose()}
            if($actual -cne $pin.Hash){throw ('SESSION_SOURCE_HASH_MISMATCH_'+$pin.Name)}
        }
        return ,$locks
    } catch {foreach($handle in $locks){$handle.Dispose()};throw}
}
function New-Ai09SessionContext {
    param([string]$Root,[string]$SourceHash,[double]$Seconds=1800)
    if($SourceHash -cnotmatch '^[0-9A-F]{64}$' -or $Seconds -le 0 -or $Seconds -gt 1800){throw 'INVALID_SESSION_CONTEXT'}
    return [pscustomobject]@{
        Root=$Root;RunId=[guid]::NewGuid().ToString('N');SourceHash=$SourceHash
        StartedAt=[DateTimeOffset]::UtcNow;Deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
        Seconds=$Seconds;Clock=[Diagnostics.Stopwatch]::StartNew()
        Stages=[Collections.Generic.HashSet[string]]::new();Consumed=[Collections.Generic.HashSet[string]]::new()
        Ready=$false;AuthHandoff=$false;ConsoleStartedAt=$null
    }
}
function Assert-Ai09SessionLive {
    param($Context)
    if($Context.Clock.Elapsed.TotalSeconds -ge $Context.Seconds -or [DateTimeOffset]::UtcNow -ge $Context.Deadline){throw 'SESSION_DEADLINE_EXPIRED'}
}
function Write-Ai09SessionJson {
    param([string]$Path,$Value)
    if(Test-Path -LiteralPath $Path){throw 'SESSION_OUTPUT_ALREADY_EXISTS'}
    Assert-Ai09SessionPath (Split-Path $Path -Parent)
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 12 -Compress))
    if($bytes.Length -gt 2097152){throw 'SESSION_OUTPUT_TOO_LARGE'}
    $pending=$Path+'.'+[guid]::NewGuid().ToString('N')+'.pending'
    $stream=[IO.File]::Open($pending,'CreateNew','Write','None')
    try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
    [IO.File]::Move($pending,$Path)
}
function Read-Ai09SessionEvidence {
    param([string]$Path,[int]$Limit=2097152,[switch]$Json,[switch]$Flat)
    Assert-Ai09SessionPath $Path
    $stream=[IO.File]::Open($Path,'Open','Read','Read')
    try {
        if($stream.Length -le 0 -or $stream.Length -gt $Limit){throw 'SESSION_EVIDENCE_SIZE'}
        $buffer=[IO.MemoryStream]::new()
        try{$stream.CopyTo($buffer);$bytes=$buffer.ToArray()}finally{$buffer.Dispose()}
    } finally {$stream.Dispose()}
    $result=[pscustomobject]@{Hash=(Get-Ai09SessionHash $bytes);Value=$null}
    if($Json){
        $parameters=@{InputObject=[Text.UTF8Encoding]::new($false,$true).GetString($bytes);ErrorAction='Stop'}
        if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$parameters.DateKind='String'}
        $result.Value=ConvertFrom-Json @parameters
        if($Flat -and ($result.Value -isnot [pscustomobject] -or [regex]::Matches($parameters.InputObject,'"[^"\\]+"\s*:').Count -ne @($result.Value.PSObject.Properties).Count)){throw 'SESSION_ACK_DUPLICATE_OR_NESTED_FIELDS'}
    }
    return $result
}
function New-Ai09SessionRequest {
    param($Context,[ValidateSet('SESSION_READY','AUTH_HANDOFF','COLLECT')][string]$Stage,[string]$ProofHash='')
    Assert-Ai09SessionLive $Context
    if(-not $Context.Stages.Add($Stage)){throw 'SESSION_STAGE_REPLAY'}
    if($Stage -ne 'SESSION_READY' -and -not $Context.Ready){throw 'SESSION_READINESS_REQUIRED'}
    if($Stage -eq 'COLLECT' -and (-not $Context.AuthHandoff -or $ProofHash -cnotmatch '^[0-9A-F]{64}$')){throw 'SESSION_COLLECTION_PROOF_REQUIRED'}
    if($Stage -ne 'COLLECT' -and $ProofHash -ne ''){throw 'SESSION_UNEXPECTED_PROOF'}
    $decision=@{SESSION_READY='READY';AUTH_HANDOFF='VERIFY_ROOT_MAY_START';COLLECT='GUEST_UNMOUNT_OBSERVED'}[$Stage]
    $expiry=[DateTimeOffset]::UtcNow.AddSeconds(600)
    if($expiry -gt $Context.Deadline){$expiry=$Context.Deadline}
    return [pscustomobject][ordered]@{
        Version='1';RunId=$Context.RunId;SourceSha256=$Context.SourceHash;Stage=$Stage
        Nonce=[guid]::NewGuid().ToString('N');ExpiresAt=$expiry.ToString('o');ProofSha256=$ProofHash;Decision=$decision
    }
}
function Test-Ai09SessionInteger {
    param($Value,[long]$Minimum,[long]$Maximum)
    return (($Value -is [int] -or $Value -is [long]) -and $Value -ge $Minimum -and $Value -le $Maximum)
}
function Assert-Ai09SessionResponse {
    param($Context,$Request,$Response)
    Assert-Ai09SessionLive $Context
    if([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::ParseExact($Request.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture)){throw 'SESSION_ACK_EXPIRED'}
    if($Context.Consumed.Contains($Request.Nonce)){throw 'SESSION_ACK_REPLAY'}
    $fields=@('Decision','ExpiresAt','Nonce','ProofSha256','RunId','SourceSha256','Stage','Version')
    if($Response.Decision -isnot [string]){throw 'SESSION_ACK_DECISION_TYPE'}
    $abort=$Response.Decision -ceq 'ABORT'
    if($Request.Stage -eq 'COLLECT' -and -not $abort){$fields+=@('GuestExitCode','UnmountExitCode','SeedDeviceUnmounted','MountpointExitCode')}
    if((@($Response.PSObject.Properties.Name|Sort-Object)-join '|') -cne (@($fields|Sort-Object)-join '|')){throw 'SESSION_ACK_FIELDS'}
    foreach($field in @('Version','RunId','SourceSha256','Stage','Nonce','ExpiresAt','ProofSha256')){
        if($Response.$field -isnot [string] -or $Response.$field -cne $Request.$field){throw ('SESSION_ACK_IDENTITY_'+$field)}
    }
    if(-not $abort -and $Response.Decision -cne $Request.Decision){throw 'SESSION_ACK_DECISION'}
    if($Request.Stage -eq 'COLLECT' -and -not $abort){
        if(-not(Test-Ai09SessionInteger $Response.GuestExitCode 0 255) -or
           -not(Test-Ai09SessionInteger $Response.UnmountExitCode 0 0) -or
           -not(Test-Ai09SessionInteger $Response.MountpointExitCode 32 32) -or
           $Response.SeedDeviceUnmounted -isnot [bool] -or -not $Response.SeedDeviceUnmounted){throw 'SESSION_ACK_OBSERVATION'}
    }
    return $true
}
function Receive-Ai09SessionResponse {
    param($Context,$Request)
    Assert-Ai09SessionLive $Context
    if($Context.Consumed.Contains($Request.Nonce)){throw 'SESSION_ACK_REPLAY'}
    $path=Join-Path $Context.Root ($Request.Stage+'.ack.json')
    if(-not(Test-Path -LiteralPath $path)){return $null}
    $before=Read-Ai09SessionEvidence -Path $path -Limit 4096 -Json -Flat
    $null=Assert-Ai09SessionResponse $Context $Request $before.Value
    $consumed=Join-Path $Context.Root ($Request.Stage+'.consumed.json')
    [IO.File]::Move($path,$consumed)
    $after=Read-Ai09SessionEvidence -Path $consumed -Limit 4096 -Json -Flat
    if($after.Hash -cne $before.Hash){throw 'SESSION_ACK_CHANGED'}
    $null=Assert-Ai09SessionResponse $Context $Request $after.Value
    $null=$Context.Consumed.Add($Request.Nonce)
    if($after.Value.Decision -ceq 'ABORT'){throw 'SESSION_OBSERVER_ABORTED'}
    if($Request.Stage -eq 'SESSION_READY'){$Context.Ready=$true}
    if($Request.Stage -eq 'AUTH_HANDOFF'){$Context.AuthHandoff=$true}
    return $after.Value
}
function Wait-Ai09SessionResponse {
    param($Context,$Request)
    Write-Ai09SessionJson -Path (Join-Path $Context.Root ($Request.Stage+'.request.json')) -Value $Request
    while($true){
        Assert-Ai09SessionLive $Context
        if([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::ParseExact($Request.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture)){throw 'SESSION_ACK_EXPIRED'}
        $response=Receive-Ai09SessionResponse $Context $Request
        if($null -ne $response){return $response}
        Start-Sleep -Milliseconds 100
    }
}
function Get-Ai09SessionConsoleProof {
    param($Scope,$Context)
    Assert-Ai09SessionLive $Context
    if($null -eq $Context.ConsoleStartedAt){throw 'SESSION_CONSOLE_NOT_STARTED'}
    $console=@($Scope.Pins|Where-Object Name -eq Console)[0]
    $receipt=Read-Ai09SessionEvidence -Path (Join-Path $Scope.ConsoleRoot 'receipt.json') -Json
    $r=$receipt.Value
    if($r.Success -isnot [bool] -or -not $r.Success -or $r.GuestExecutionVerified -isnot [bool] -or $r.GuestExecutionVerified -or
       $r.RunId -isnot [string] -or $r.RunId -cnotmatch '^[a-f0-9]{32}$' -or $r.SourceSha256 -isnot [string] -or $r.SourceSha256 -cne $console.Hash){throw 'SESSION_CONSOLE_RECEIPT'}
    if($r.StartedAt -isnot [string] -or $r.FinishedAt -isnot [string]){throw 'SESSION_CONSOLE_TIME_TYPE'}
    $start=[DateTimeOffset]::ParseExact($r.StartedAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    $finish=[DateTimeOffset]::ParseExact($r.FinishedAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    if($start -lt $Context.ConsoleStartedAt -or $finish -lt $start -or $finish -gt [DateTimeOffset]::UtcNow){throw 'SESSION_CONSOLE_STALE'}
    $frames=@()
    foreach($stage in @('command-6-after','command-8-after','command-9-after','command-10-after')){
        $request=Read-Ai09SessionEvidence -Path (Join-Path $Scope.ConsoleRoot ($stage+'.request.json')) -Limit 4096 -Json
        $consumed=Read-Ai09SessionEvidence -Path (Join-Path $Scope.ConsoleRoot ($stage+'.consumed.json')) -Limit 4096 -Json
        $image=Read-Ai09SessionEvidence -Path (Join-Path $Scope.ConsoleRoot ($stage+'.png')) -Limit 16777216
        foreach($message in @($request.Value,$consumed.Value)){
            $names=@('Decision','ExpiresAt','ImageSha256','Nonce','RunId','SourceSha256','Stage','Version')
            if((@($message.PSObject.Properties.Name|Sort-Object)-join '|') -cne ($names -join '|')){throw 'SESSION_FRAME_FIELDS'}
            foreach($field in $names){if($message.$field -isnot [string]){throw 'SESSION_FRAME_TYPE'}}
            if($message.Version -cne '1' -or $message.RunId -cne $r.RunId -or $message.SourceSha256 -cne $console.Hash -or
               $message.Stage -cne $stage -or $message.Decision -cne 'OBSERVED' -or $message.Nonce -cnotmatch '^[a-f0-9]{32}$' -or
               $message.ImageSha256 -cne $image.Hash){throw 'SESSION_FRAME_IDENTITY'}
            $null=[DateTimeOffset]::ParseExact($message.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture)
        }
        foreach($field in $names){if($request.Value.$field -cne $consumed.Value.$field){throw 'SESSION_FRAME_ACK_MISMATCH'}}
        $events=@($r.Events|Where-Object {$_.Event -is [string] -and $_.Event -ceq 'ObservationConsumed' -and $_.Stage -is [string] -and $_.Stage -ceq $stage})
        if($events.Count -ne 1 -or $events[0].Nonce -isnot [string] -or $events[0].ImageSha256 -isnot [string] -or $events[0].Decision -isnot [string] -or $events[0].Nonce -cne $request.Value.Nonce -or $events[0].ImageSha256 -cne $image.Hash -or $events[0].Decision -cne 'OBSERVED'){throw 'SESSION_FRAME_RECEIPT_MISMATCH'}
        $frames+=[pscustomobject][ordered]@{Stage=$stage;Nonce=$request.Value.Nonce;ImageSha256=$image.Hash;RequestSha256=$request.Hash;ConsumedSha256=$consumed.Hash}
    }
    $proof=[pscustomobject][ordered]@{ConsoleRunId=$r.RunId;ConsoleSourceSha256=$console.Hash;ReceiptSha256=$receipt.Hash;Frames=$frames}
    return [pscustomobject]@{Value=$proof;Hash=(Get-Ai09SessionHash ([Text.UTF8Encoding]::new($false).GetBytes(($proof|ConvertTo-Json -Depth 6 -Compress))))}
}
function Assert-Ai09SessionNative {
    if($env:COMPUTERNAME -cne 'HAJI' -or $PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or -not [Environment]::Is64BitProcess){throw 'SESSION_NATIVE_PS51_X64_HAJI_REQUIRED'}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'SESSION_EXISTING_ADMIN_REQUIRED'}
}
function Invoke-Ai09SessionChild {
    param($Scope,$Context,[ValidateSet('Stage','Auth','Console','Collect')][string]$Name,[Nullable[int]]$GuestExitCode)
    Assert-Ai09SessionLive $Context
    $pin=@($Scope.Pins|Where-Object Name -eq $Name)[0]
    $directory=Join-Path $Context.Root $Name
    if(Test-Path -LiteralPath $directory){throw 'SESSION_CHILD_ALREADY_STARTED'}
    $null=New-Item -ItemType Directory -Path $directory -ErrorAction Stop
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-File',('"'+$pin.Path+'"'))
    if($Name -eq 'Collect'){
        if($null -eq $GuestExitCode -or $GuestExitCode -lt 0 -or $GuestExitCode -gt 255){throw 'SESSION_GUEST_EXIT_REQUIRED'}
        $arguments+=@('-Mode','Collect','-GuestUnmountConfirmed','-ObservedGuestExitCode',([string]$GuestExitCode))
    }
    $record=[ordered]@{Name=$Name;Source=$pin.Path;SourceSha256=$pin.Hash;StartedAt=[DateTimeOffset]::UtcNow.ToString('o');Pid=$null;ExitCode=$null;TimedOut=$false;OutputComplete=$false;CleanupVerified=$false}
    try {
        Assert-Ai09SessionLive $Context
        $child=Start-Process -FilePath $Scope.NativePowerShell -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $directory 'stdout.txt') -RedirectStandardError (Join-Path $directory 'stderr.txt')
        $record.Pid=$child.Id
        while(-not $child.WaitForExit(100)){
            try{Assert-Ai09SessionLive $Context}catch{$record.TimedOut=$true;throw 'SESSION_CHILD_STILL_RUNNING_NO_KILL'}
        }
        $child.WaitForExit();$child.Refresh()
        if($null -eq $child.ExitCode){throw 'SESSION_NATIVE_EXIT_UNAVAILABLE'}
        $record.ExitCode=[int]$child.ExitCode;$record.OutputComplete=$true
        if($record.ExitCode -ne 0){throw ('SESSION_CHILD_EXIT_'+$Name+'_'+$record.ExitCode)}
        Assert-Ai09SessionLive $Context
        return [pscustomobject]$record
    } finally {
        $record.FinishedAt=[DateTimeOffset]::UtcNow.ToString('o')
        Write-Ai09SessionJson -Path (Join-Path $directory 'receipt.json') -Value $record
    }
}
function Assert-Ai09SessionAuthPrompt {
    param($Scope)
    $pin=@($Scope.Pins|Where-Object Name -eq Auth)[0]
    $proof=Read-Ai09SessionEvidence -Path (Join-Path $Scope.AuthRoot 'receipt.json') -Json
    $r=$proof.Value
    if($r.Success -isnot [bool] -or -not $r.Success -or $r.AuthenticationVerified -isnot [bool] -or $r.AuthenticationVerified -or
       $r.SuccessMeaning -isnot [string] -or $r.SuccessMeaning -cne 'FIXED_SUDO_PROMPT_SENT_ONLY' -or $r.SourceSha256 -isnot [string] -or $r.SourceSha256 -cne $pin.Hash){throw 'SESSION_AUTH_PROMPT_NOT_VERIFIED'}
    return $proof.Hash
}
function Invoke-Ai09NetworkRecoverySession {
    param([ValidateSet('Verify','Execute')][string]$Mode='Verify',[string]$SourceHash)
    $scope=Get-Ai09SessionScope
    $locks=Open-Ai09SessionPins $scope
    $context=$null;$report=$null
    try {
        if($Mode -eq 'Verify'){return [pscustomobject]@{Status='READ_ONLY_SESSION_SOURCE_VERIFIED';PinnedSources=$scope.Pins.Count;NativeStarted=$false;GuestUnmountVerified=$false}}
        Assert-Ai09SessionNative
        foreach($path in @($scope.Root,$scope.StageRoot,$scope.AuthRoot,$scope.ConsoleRoot)){
            if(Test-Path -LiteralPath $path){throw 'SESSION_ONE_SHOT_ALREADY_STARTED'}
            Assert-Ai09SessionPath (Split-Path $path -Parent)
        }
        $context=New-Ai09SessionContext -Root $scope.Root -SourceHash $SourceHash
        $null=New-Item -ItemType Directory -Path $context.Root -ErrorAction Stop
        $report=[ordered]@{RunId=$context.RunId;SourceSha256=$SourceHash;StartedAt=$context.StartedAt.ToString('o');Success=$false;SshVerified=$false;AuthenticationVerified=$false;CleanupVerified=$false;GuestExitCode=$null;Status='STARTED';Children=@()}
        $null=Wait-Ai09SessionResponse $context (New-Ai09SessionRequest $context SESSION_READY)
        $report.Children+=Invoke-Ai09SessionChild $scope $context Stage
        $report.Children+=Invoke-Ai09SessionChild $scope $context Auth
        $report.AuthPromptReceiptSha256=Assert-Ai09SessionAuthPrompt $scope
        $null=Wait-Ai09SessionResponse $context (New-Ai09SessionRequest $context AUTH_HANDOFF)
        Assert-Ai09SessionLive $context
        $context.ConsoleStartedAt=[DateTimeOffset]::UtcNow
        $report.Children+=Invoke-Ai09SessionChild $scope $context Console
        $proof=Get-Ai09SessionConsoleProof $scope $context
        Write-Ai09SessionJson -Path (Join-Path $context.Root 'collection-proof.json') -Value $proof.Value
        $request=New-Ai09SessionRequest $context COLLECT $proof.Hash
        $response=Wait-Ai09SessionResponse $context $request
        if((Get-Ai09SessionConsoleProof $scope $context).Hash -cne $proof.Hash){throw 'SESSION_CONSOLE_PROOF_CHANGED'}
        Assert-Ai09SessionLive $context
        $report.GuestExitCode=[int]$response.GuestExitCode
        $report.Children+=Invoke-Ai09SessionChild $scope $context Collect $report.GuestExitCode
        $report.Success=$report.GuestExitCode -eq 0
        $report.Status=if($report.Success){'RECOVERY_SEQUENCE_COLLECTED'}else{'GUEST_FAILED_EVIDENCE_COLLECTED'}
    } catch {
        if($null -ne $report){$report.Status='STOPPED';$report.Error=$_.Exception.Message}
        throw
    } finally {
        try {
            if($null -ne $report){$report.FinishedAt=[DateTimeOffset]::UtcNow.ToString('o');Write-Ai09SessionJson -Path (Join-Path $context.Root 'receipt.json') -Value $report}
        } finally {foreach($handle in $locks){$handle.Dispose()}}
    }
    return [pscustomobject]$report
}
if($MyInvocation.InvocationName -ne '.'){
    $self=$null
    try {
        Assert-Ai09SessionPath $PSCommandPath
        $self=[IO.File]::Open($PSCommandPath,'Open','Read','Read')
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$digest=([BitConverter]::ToString($sha.ComputeHash($self))).Replace('-','')}finally{$sha.Dispose()}
        $result=Invoke-Ai09NetworkRecoverySession -Mode $Mode -SourceHash $digest
        $result|ConvertTo-Json -Depth 8
        if($Mode -eq 'Execute' -and -not $result.Success){exit 1}
    } catch {Write-Error $_;exit 1}
    finally {if($self){$self.Dispose()}}
}

# Issue #1798: one-use read-only post-recovery diagnostics. No command payload is accepted.
$ErrorActionPreference = 'Stop'
function New-Ai09SyncContext {
    param([string]$Root, [string]$SourceSha256, [double]$WholeSeconds = 1800)
    if ($SourceSha256 -cnotmatch '^[0-9A-F]{64}$' -or $WholeSeconds -le 0 -or $WholeSeconds -gt 1800) { throw 'INVALID_SYNC_CONTEXT' }
    return [pscustomobject]@{ Root=$Root; RunId=[guid]::NewGuid().ToString('N'); SourceSha256=$SourceSha256
        Deadline=[DateTimeOffset]::UtcNow.AddSeconds($WholeSeconds); WholeSeconds=$WholeSeconds
        Clock=[Diagnostics.Stopwatch]::StartNew(); Stages=[Collections.Generic.HashSet[string]]::new()
        Consumed=[Collections.Generic.HashSet[string]]::new(); PressAttempted=[Collections.Generic.HashSet[uint32]]::new(); ReadyAccepted=$false; FreshBeforeAccepted=$false; ConfigFileObserved=$false }
}
function Assert-Ai09SyncLive {
    param($Context)
    if ($Context.Clock.Elapsed.TotalSeconds -ge $Context.WholeSeconds -or [DateTimeOffset]::UtcNow -ge $Context.Deadline) { throw 'WHOLE_RUN_DEADLINE_EXPIRED' }
}
function Publish-Ai09SyncJson {
    param([string]$Path, $Value)
    # Complete and close a unique file before publishing its final name; never overwrite.
    if (Test-Path -LiteralPath $Path) { throw 'SYNC_FILE_ALREADY_EXISTS' }
    $pending = $Path + '.' + [guid]::NewGuid().ToString('N') + '.pending'
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Compress -Depth 4))
    if ($bytes.Length -gt 2048) { throw 'SYNC_MESSAGE_TOO_LARGE' }
    $stream = [IO.File]::Open($pending, 'CreateNew', 'Write', 'None')
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    [IO.File]::Move($pending, $Path)
}
function Read-Ai09SyncJson {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'UNSAFE_SYNC_FILE' }
    $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read')
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt 2048) { throw 'INVALID_SYNC_SIZE' }
        $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false,$true), $false, 2048, $true)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $jsonParameters = @{ InputObject=$text; ErrorAction='Stop' }
        if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $jsonParameters.DateKind='String' }
        return ConvertFrom-Json @jsonParameters
    } finally { $stream.Dispose() }
}
function New-Ai09SyncRequest {
    param($Context, [string]$Stage, [string]$ImageSha256 = '', [double]$Seconds = 300)
    Assert-Ai09SyncLive $Context
    if ($Stage -cnotmatch '^(ready|before|awake|command-(?:[0-9]|10)-(?:typed|after))$' -or $Seconds -le 0 -or $Seconds -gt 300) { throw 'INVALID_SYNC_STAGE' }
    if (($Stage -eq 'ready' -and $ImageSha256 -ne '') -or ($Stage -ne 'ready' -and $ImageSha256 -cnotmatch '^[0-9A-F]{64}$')) { throw 'INVALID_IMAGE_DIGEST' }
    if (-not $Context.Stages.Add($Stage)) { throw 'STAGE_REPLAY_REFUSED' }
    $decision = if ($Stage -eq 'ready') { 'READY' } elseif ($Stage -eq 'command-5-after') { 'REGULAR_CONFIG_LE512_OBSERVED' } else { 'OBSERVED' }
    $expiry = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    if ($expiry -gt $Context.Deadline) { $expiry = $Context.Deadline }
    $request = [pscustomobject][ordered]@{ Version='1'; RunId=$Context.RunId; SourceSha256=$Context.SourceSha256
        Stage=$Stage; Nonce=[guid]::NewGuid().ToString('N'); ImageSha256=$ImageSha256
        ExpiresAt=$expiry.ToString('o'); Decision=$decision }
    Publish-Ai09SyncJson -Path (Join-Path $Context.Root ($Stage + '.request.json')) -Value $request
    return $request
}
function Assert-Ai09SyncResponse {
    param($Context, $Request, $Response)
    Assert-Ai09SyncLive $Context
    if ([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::ParseExact($Request.ExpiresAt, 'o', [Globalization.CultureInfo]::InvariantCulture)) { throw 'ACK_EXPIRED' }
    $expectedNames = @('Decision','ExpiresAt','ImageSha256','Nonce','RunId','SourceSha256','Stage','Version')
    if ((@($Response.PSObject.Properties.Name | Sort-Object) -join '|') -cne ($expectedNames -join '|')) { throw 'ACK_FIELDS_MISMATCH' }
    foreach ($field in @('Version','RunId','SourceSha256','Stage','Nonce','ImageSha256','ExpiresAt')) {
        if ($Response.$field -isnot [string] -or $Response.$field -cne $Request.$field) { throw ('ACK_IDENTITY_MISMATCH_' + $field) }
    }
    if ($Response.Decision -isnot [string] -or ($Response.Decision -cne $Request.Decision -and $Response.Decision -cne 'ABORT')) { throw 'ACK_DECISION_MISMATCH' }
}
function Receive-Ai09SyncResponse {
    param($Context, $Request)
    Assert-Ai09SyncLive $Context
    if ($Context.Consumed.Contains($Request.Nonce)) { throw 'ACK_REPLAY_REFUSED' }
    $path = Join-Path $Context.Root ($Request.Stage + '.ack.json')
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    $response = Read-Ai09SyncJson $path
    Assert-Ai09SyncResponse -Context $Context -Request $Request -Response $response
    $consumedPath = Join-Path $Context.Root ($Request.Stage + '.consumed.json')
    [IO.File]::Move($path, $consumedPath)
    $retained = Read-Ai09SyncJson $consumedPath
    Assert-Ai09SyncResponse -Context $Context -Request $Request -Response $retained
    if ($retained.Decision -cne $response.Decision) { throw 'ACK_CHANGED_DURING_CONSUME' }
    $null = $Context.Consumed.Add($Request.Nonce)
    if ($response.Decision -ceq 'ABORT') { throw 'OBSERVER_ABORTED' }
    if ($Request.Stage -eq 'ready') { $Context.ReadyAccepted=$true }
    elseif ($Request.Stage -eq 'before') {
        if (-not $Context.ReadyAccepted) { throw 'READINESS_REQUIRED' }
        $Context.FreshBeforeAccepted=$true
    } elseif ($Request.Stage -eq 'command-5-after') { $Context.ConfigFileObserved=$true }
    return $true
}
function Wait-Ai09SyncResponse {
    param($Context, $Request, [double]$Seconds)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
        Assert-Ai09SyncLive $Context
        if ([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::ParseExact($Request.ExpiresAt, 'o', [Globalization.CultureInfo]::InvariantCulture)) { throw 'ACK_EXPIRED' }
        if (Receive-Ai09SyncResponse -Context $Context -Request $Request) { return }
        Start-Sleep -Milliseconds 100
    }
    throw ('OBSERVER_TIMEOUT_' + $Request.Stage)
}
function Assert-Ai09InputReady {
    param($Context)
    Assert-Ai09SyncLive $Context
    if (-not $Context.ReadyAccepted -or -not $Context.FreshBeforeAccepted) { throw 'FRESH_OBSERVATION_REQUIRED_BEFORE_INPUT' }
}
function Assert-Ai09DiagnosticPath {
    param([string]$Path)
    if(-not [IO.Path]::IsPathRooted($Path)){throw 'DIAGNOSTIC_ABSOLUTE_PATH_REQUIRED'}
    $current=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    while($null -ne $current){
        if($current.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'DIAGNOSTIC_REPARSE_PATH_REFUSED'}
        $current=if($current -is [IO.FileInfo]){$current.Directory}else{$current.Parent}
    }
}
function Open-Ai09DiagnosticPinnedFile {
    param([string]$Path,[string]$Hash)
    Assert-Ai09DiagnosticPath $Path
    $stream=[IO.File]::Open($Path,'Open','Read','Read')
    try {
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$sha.Dispose()}
        if($Hash -cnotmatch '^[0-9A-F]{64}$' -or $actual -cne $Hash){throw 'DIAGNOSTIC_PINNED_FILE_HASH_MISMATCH'}
        return $stream
    }catch{$stream.Dispose();throw}
}
function Assert-Ai09PostRecoveryPreflight {
    param($Scope)
    $null=Assert-Ai09CollectionEnvironment -Scope $Scope -SeedAttached $false
    if((Get-Ai09CollectionVhd $Scope).Attached){throw 'DIAGNOSTIC_SEED_HOST_ATTACHED'}
}
function Get-Ai09PostRecoveryHostSnapshot {
    param($Scope)
    $adapter=@(Get-NetAdapter -Name 'vEthernet (Default Switch)' -ErrorAction Stop)
    if($adapter.Count -ne 1){throw 'DEFAULT_SWITCH_ADAPTER_NOT_UNIQUE'}
    $addresses=@(Get-NetIPAddress -InterfaceIndex $adapter[0].InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop |
        Select-Object InterfaceIndex,IPAddress,PrefixLength,AddressState,PrefixOrigin,SuffixOrigin)
    $rules=@(Get-VMNetworkAdapterExtendedAcl -VMName $Scope.VmName -ErrorAction Stop)
    if($rules.Count -ne 4 -or (Get-Ai09AclSha256 $rules) -cne $Scope.AclSha256){throw 'VM_ACL_CHANGED'}
    return [pscustomobject]@{
        ObservedAt=[DateTimeOffset]::UtcNow.ToString('o');GuestNetworkVerified=$false
        DefaultSwitchAdapter=($adapter[0]|Select-Object Name,InterfaceIndex,MacAddress,Status)
        DefaultSwitchIPv4=$addresses;AclSha256=$Scope.AclSha256
        Acl=@($rules|Select-Object Direction,Action,Weight,LocalIPAddress,RemoteIPAddress,LocalPort,RemotePort,Protocol,Stateful,IdleSessionTimeout)
    }
}
function Assert-Ai09DiagnosticCommandReady {
    param($Context,[int]$Index)
    Assert-Ai09InputReady $Context
    if($Index -ge 6 -and -not $Context.ConfigFileObserved){throw 'REGULAR_NONLINK_CONFIG_LE512_OBSERVATION_REQUIRED'}
}
function Get-Ai09PostRecoveryCommands {
    return @(
        'timeout -k 1s 5s hostname; echo $?',
        'timeout -k 1s 5s ip -4 -br address show eth0; echo $?',
        'timeout -k 1s 5s ip -4 route; echo $?',
        'timeout -k 1s 5s networkctl --no-pager -n 0 status eth0; echo $?',
        'timeout -k 1s 5s stat /run/systemd/network/09-ai09-bootstrap.network; echo $?',
        'timeout -k 1s 5s readlink -f /run/systemd/network/09-ai09-bootstrap.network; echo $?',
        'timeout -k 1s 5s sha256sum /run/systemd/network/09-ai09-bootstrap.network; echo $?',
        'timeout -k 1s 5s head -c 512 /run/systemd/network/09-ai09-bootstrap.network; echo $?',
        'timeout -k 1s 5s sha256sum /run/systemd/network/10-ai09.network; echo $?',
        'timeout -k 1s 5s journalctl -u systemd-networkd -n 10 --no-pager --no-full --truncate-newline --no-hostname -o short --utc; echo $?',
        'timeout -k 1s 5s date -u; echo $?'
    )
}
function Assert-Ai09DiagnosticRetryProof {
    param($Receipt,$Before,[string]$ImageHash)
    $run='5da8b683fa714b4796505665c5445820'
    $source='190E33522BB620AF520F217AAC01F3DBC705DB5465BF3A84750F29597DCCAF99'
    if($Receipt.RunId -isnot [string] -or $Receipt.RunId -cne $run -or
       $Receipt.SourceSha256 -isnot [string] -or $Receipt.SourceSha256 -cne $source -or
       $Receipt.Error -isnot [string] -or $Receipt.Error -cne 'OBSERVER_TIMEOUT_before'){throw 'DIAGNOSTIC_RETRY_TERMINAL_MISMATCH'}
    foreach($field in @('Success','GuestExecutionVerified','GuestNetworkVerified','AuthenticationVerified')){
        if($Receipt.$field -isnot [bool] -or $Receipt.$field){throw 'DIAGNOSTIC_RETRY_TERMINAL_MISMATCH'}
    }
    foreach($field in @('Version','RunId','SourceSha256','Stage','Nonce','ImageSha256','ExpiresAt','Decision')){
        if($Before.$field -isnot [string]){throw 'DIAGNOSTIC_RETRY_BEFORE_MISMATCH'}
    }
    if($Before.Version -cne '1' -or $Before.RunId -cne $run -or $Before.SourceSha256 -cne $source -or
       $Before.Stage -cne 'before' -or $Before.Decision -cne 'OBSERVED' -or
       $Before.Nonce -cne '5c7ae13562e1483b8f58d6a148acf312' -or $Before.ImageSha256 -cne $ImageHash){throw 'DIAGNOSTIC_RETRY_BEFORE_MISMATCH'}
    if($Receipt.StartedAt -isnot [string] -or $Receipt.FinishedAt -isnot [string]){throw 'DIAGNOSTIC_RETRY_TERMINAL_TIME'}
    $start=[DateTimeOffset]::ParseExact($Receipt.StartedAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    $finish=[DateTimeOffset]::ParseExact($Receipt.FinishedAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    $expiry=[DateTimeOffset]::ParseExact($Before.ExpiresAt,'o',[Globalization.CultureInfo]::InvariantCulture)
    if($finish -lt $expiry -or $start -ge $expiry -or $finish -gt [DateTimeOffset]::UtcNow){throw 'DIAGNOSTIC_RETRY_TERMINAL_TIME'}
    $events=@($Receipt.Events)
    if($events.Count -ne 9){throw 'DIAGNOSTIC_RETRY_INPUT_OR_ADVANCED_STAGE'}
    $keys=@(160,161,162,163,164,165)
    for($i=0;$i -lt 6;$i++){
        if($events[$i].Method -isnot [string] -or $events[$i].Method -cne 'IsKeyPressed' -or
           $events[$i].Key -ne $keys[$i] -or $events[$i].ReturnValue -ne 0 -or
           $events[$i].KeyState -isnot [bool] -or $events[$i].KeyState){throw 'DIAGNOSTIC_RETRY_INPUT_OR_ADVANCED_STAGE'}
    }
    $names=@('ThumbnailMetadata','ThumbnailDecoded','before')
    for($i=0;$i -lt 3;$i++){
        if($events[$i+6].Event -isnot [string] -or $events[$i+6].Event -cne $names[$i]){throw 'DIAGNOSTIC_RETRY_INPUT_OR_ADVANCED_STAGE'}
        if($i -lt 2 -and ($events[$i+6].Stage -isnot [string] -or $events[$i+6].Stage -cne 'before')){throw 'DIAGNOSTIC_RETRY_INPUT_OR_ADVANCED_STAGE'}
    }
}
function Get-Ai09DiagnosticOutputRoot {
    param([Collections.Generic.List[IO.FileStream]]$Locks)
    $original='C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\tmp\ai09-console-postrecovery-diagnostic'
    $retry=$original+'-retry1'
    if(Test-Path -LiteralPath $retry){throw 'DIAGNOSTIC_RETRY_ALREADY_STARTED'}
    if(-not(Test-Path -LiteralPath $original)){return $original}
    Assert-Ai09DiagnosticPath $original
    $pins=[ordered]@{
        'before-1024.raw'='24F8FD825EC6D0D066263095FEDA465A921016CDD1B3466335AC2B1AD3C06B7D'
        'before.png'='AE59E2DB9564011827DF400748EA4D16E3F22CFA90EB6ED455EFE262CFAADDBD'
        'before.request.json'='51E4CC07107D72377FB267F778ED2F69C9B6568B4DC40DFA406839C78A5461CA'
        'ready.consumed.json'='296EDB3AEAF544145436352AA66DAA5005A52AC78ED42F7D693CDC2FFB855039'
        'ready.request.json'='296EDB3AEAF544145436352AA66DAA5005A52AC78ED42F7D693CDC2FFB855039'
        'receipt.json'='7BFDB29801FCABB72078F2F26B63E120C2DF1047D5DCEF6DFB70967CE62AE68E'
    }
    $expected=(@($pins.Keys|Sort-Object)-join '|')
    if((@(Get-ChildItem -LiteralPath $original -Force|ForEach-Object Name|Sort-Object)-join '|') -cne $expected){throw 'DIAGNOSTIC_RETRY_FILE_SET_CHANGED'}
    $json=@{}
    foreach($name in $pins.Keys){
        $held=Open-Ai09DiagnosticPinnedFile (Join-Path $original $name) $pins[$name]
        $Locks.Add($held)
        if($name -in @('receipt.json','before.request.json')){
            if($held.Length -gt 16384){throw 'DIAGNOSTIC_RETRY_JSON_TOO_LARGE'}
            $held.Position=0
            $reader=[IO.StreamReader]::new($held,[Text.UTF8Encoding]::new($false,$true),$false,16384,$true)
            try{$parameters=@{InputObject=$reader.ReadToEnd();ErrorAction='Stop'}}finally{$reader.Dispose()}
            if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){$parameters.DateKind='String'}
            $json[$name]=ConvertFrom-Json @parameters
        }
    }
    Assert-Ai09DiagnosticRetryProof $json['receipt.json'] $json['before.request.json'] $pins['before.png']
    if((@(Get-ChildItem -LiteralPath $original -Force|ForEach-Object Name|Sort-Object)-join '|') -cne $expected){throw 'DIAGNOSTIC_RETRY_FILE_SET_CHANGED'}
    return $retry
}
function Invoke-Ai09PostRecoveryDiagnostic {
    param([string]$sourceHash)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$continuationLocks=[Collections.Generic.List[IO.FileStream]]::new()
try {
$outputRoot = Get-Ai09DiagnosticOutputRoot $continuationLocks
Assert-Ai09DiagnosticPath (Split-Path $outputRoot -Parent)
if (Test-Path -LiteralPath $outputRoot) { throw 'ONE_SHOT_ALREADY_STARTED' }
$null = New-Item -ItemType Directory -Path $outputRoot -ErrorAction Stop
$sync = New-Ai09SyncContext -Root $outputRoot -SourceSha256 $sourceHash
$report = [ordered]@{ RunId=$sync.RunId; SourceSha256=$sourceHash; StartedAt=[DateTimeOffset]::UtcNow.ToString('o'); Success=$false; SuccessMeaning='FIXED_READONLY_COMMANDS_OBSERVED'; GuestExecutionVerified=$false; GuestNetworkVerified=$false; AuthenticationVerified=$false; Commands=@(Get-Ai09PostRecoveryCommands); Events=@() }
if($outputRoot.EndsWith('-retry1')){$report.ContinuedFromRunId='5da8b683fa714b4796505665c5445820';$report.ContinuationReceiptSha256='7BFDB29801FCABB72078F2F26B63E120C2DF1047D5DCEF6DFB70967CE62AE68E'}
function Save-GuestThumbnail([string]$name) {
    $selected = $false
    foreach ($dimensions in @(@(1024,768), @(640,480), @(320,240))) {
        $width = [int]$dimensions[0]; $height = [int]$dimensions[1]
        $parameters = $service.GetMethodParameters('GetVirtualSystemThumbnailImage')
        $parameters['TargetSystem'] = $settings.__PATH
        $parameters['WidthPixels'] = [uint16]$width
        $parameters['HeightPixels'] = [uint16]$height
        $result = $service.InvokeMethod('GetVirtualSystemThumbnailImage', $parameters, $null)
        [byte[]]$raw = $result['ImageData']
        $actualLength = 0
        if ($null -ne $raw) { $actualLength = $raw.Length }
        $report.Events += [ordered]@{ Event = 'ThumbnailMetadata'; Stage = $name; RequestedWidth = $width; RequestedHeight = $height; ReturnValue = $result['ReturnValue']; ActualLength = $actualLength; ExpectedLength = $width * $height * 2; At = [DateTimeOffset]::UtcNow.ToString('o') }
        if ($actualLength -gt 0 -and $actualLength -le 16777216) {
            [IO.File]::WriteAllBytes((Join-Path $outputRoot ($name + '-' + $width + '.raw')), $raw)
        }
        $pixelOffset = 0
        if ($actualLength -eq ($width * $height * 2 + 4)) {
            # This native provider prepends a four-byte big-endian TOTAL length.
            # Verified against captured 1024x768, 640x480 and 320x240 frames.
            $prefixLength = [uint32]$raw[0] * 16777216 + [uint32]$raw[1] * 65536 + [uint32]$raw[2] * 256 + [uint32]$raw[3]
            if ($prefixLength -eq $actualLength) { $pixelOffset = 4 }
        }
        if ([uint32]$result['ReturnValue'] -eq 0 -and ($actualLength - $pixelOffset) -eq $width * $height * 2) {
            $report.Events += [ordered]@{ Event = 'ThumbnailDecoded'; Stage = $name; PixelOffset = $pixelOffset }
            $selected = $true; break
        }
    }
    if (-not $selected) { throw "NO_VALID_THUMBNAIL_STAGE_$name" }
    [byte[]]$rgba = New-Object byte[] ($width * $height * 4)
    for ($i = 0; $i -lt $width * $height; $i++) {
        $pixel = [int]$raw[$pixelOffset + $i * 2] -bor ([int]$raw[$pixelOffset + $i * 2 + 1] -shl 8)
        $rgba[$i * 4] = [byte](($pixel -band 31) * 255 / 31)
        $rgba[$i * 4 + 1] = [byte]((($pixel -shr 5) -band 63) * 255 / 63)
        $rgba[$i * 4 + 2] = [byte]((($pixel -shr 11) -band 31) * 255 / 31)
        $rgba[$i * 4 + 3] = 255
    }
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object Drawing.Bitmap($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $rect = New-Object Drawing.Rectangle(0, 0, $width, $height)
        $data = $bitmap.LockBits($rect, [Drawing.Imaging.ImageLockMode]::WriteOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            if ($data.Stride -ne ($width * 4)) { throw 'THUMBNAIL_STRIDE_MISMATCH' }
            [Runtime.InteropServices.Marshal]::Copy($rgba, 0, $data.Scan0, $rgba.Length)
        } finally { $bitmap.UnlockBits($data) }
        $bitmap.Save((Join-Path $outputRoot ($name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
    $report.Events += [ordered]@{ Event = $name; At = [DateTimeOffset]::UtcNow.ToString('o') }
}
function Invoke-Key([string]$method, [uint32]$key) {
    # Only release a modifier whose PressKey call this run attempted, once.
    # Cleanup remains permitted if the deadline expires or the press response is lost.
    $ownedRelease = $method -ceq 'ReleaseKey' -and $sync.PressAttempted.Remove($key)
    if (-not $ownedRelease) {
        Assert-Ai09InputReady $sync
        if ($method -ceq 'ReleaseKey') { throw 'UNOWNED_MODIFIER_RELEASE_REFUSED' }
    }
    $args = $keyboard.GetMethodParameters($method)
    $args.keyCode = $key
    if ($method -ceq 'PressKey') {
        if ($key -notin @(17,160)) { throw 'UNEXPECTED_MODIFIER_KEY' }
        $null = $sync.PressAttempted.Add($key)
    }
    $result = $keyboard.InvokeMethod($method, $args, $null)
    $report.Events += [ordered]@{ Method = $method; Key = $key; ReturnValue = $result.ReturnValue; At = [DateTimeOffset]::UtcNow.ToString('o') }
    if ([uint32]$result.ReturnValue -ne 0) { throw "KEY_METHOD_FAILED_$method" }
}
function Wait-ForImageObservation([string]$name) {
    $imagePath = Join-Path $outputRoot ($name + '.png')
    $expected = (Get-FileHash -LiteralPath $imagePath -Algorithm SHA256).Hash
    $request = New-Ai09SyncRequest -Context $sync -Stage $name -ImageSha256 $expected -Seconds 300
    Wait-Ai09SyncResponse -Context $sync -Request $request -Seconds 300
    $report.Events += [ordered]@{ Event='ObservationConsumed'; Stage=$name; Nonce=$request.Nonce; ImageSha256=$expected; Decision=$request.Decision }
}
function Assert-ModifiersReleased {
    # Query the actual left/right keys; generic VK_SHIFT/CONTROL/MENU always report false.
    foreach ($modifier in @(160,161,162,163,164,165)) {
        $parameters = $keyboard.GetMethodParameters('IsKeyPressed')
        $parameters['keyCode'] = [uint32]$modifier
        $state = $keyboard.InvokeMethod('IsKeyPressed', $parameters, $null)
        $report.Events += [ordered]@{ Method = 'IsKeyPressed'; Key = $modifier; ReturnValue = $state['ReturnValue']; KeyState = $state['keyState'] }
        if ([uint32]$state['ReturnValue'] -ne 0 -or $state['keyState'] -isnot [bool] -or $state['keyState']) { throw 'MODIFIER_STATE_NOT_RELEASED_NO_INPUT' }
    }
}
try {
    # Rendezvous precedes all native queries/input; readiness never substitutes a fresh frame.
    $ready = New-Ai09SyncRequest -Context $sync -Stage ready -Seconds 300
    Wait-Ai09SyncResponse -Context $sync -Request $ready -Seconds 300
    Assert-Ai09SyncLive $sync
    if ($env:COMPUTERNAME -ne 'HAJI') { throw 'WRONG_HOST' }
    if($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or -not [Environment]::Is64BitProcess){throw 'NATIVE_PS51_X64_REQUIRED'}
    $helperLocks = [Collections.Generic.List[IO.FileStream]]::new()
    $trustedRoot = 'C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\scripts'
    $trustedHelpers = @(
        @{ Name='ai09-prepare-bootstrap-disk.ps1'; Hash='E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B' },
        @{ Name='ai09-collect-bootstrap-result.ps1'; Hash='6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391' }
    )
    foreach ($trustedHelper in $trustedHelpers) {
        $trustedPath=Join-Path $trustedRoot $trustedHelper.Name
        $helperLocks.Add((Open-Ai09DiagnosticPinnedFile $trustedPath $trustedHelper.Hash))
    }
    foreach($trustedHelper in $trustedHelpers){ . (Join-Path $trustedRoot $trustedHelper.Name) }
    $collectionReceiptPath='C:\GORIQ-AI09\Reports\network-recovery-47ca6ef187fc4e09aaf47edd015f66ff\collection.json'
    $collectionHash='BCAA02E67F73391C3A800ECD22825E69C940A24E6FE21A83E4C0A96A50F6C59B'
    $helperLocks.Add((Open-Ai09DiagnosticPinnedFile $collectionReceiptPath $collectionHash))
    $report.CollectionReceiptSha256=$collectionHash
    Assert-Ai09Administrator
    $scope=Get-Ai09CollectionScope
    Assert-Ai09PostRecoveryPreflight $scope
    $report.HostPreflight=Get-Ai09PostRecoveryHostSnapshot $scope
    $vmId = '453b139b-cceb-446e-99fb-f45bf5895436'
    $vm = Get-VM -Id $vmId
    if ($vm.Name -ne 'GORIQ-AI09-Ubuntu' -or [string]$vm.State -ne 'Running') { throw 'WRONG_VM_OR_STATE' }
    $nic = @(Get-VMNetworkAdapter -VM $vm)
    if ($nic.Count -ne 1 -or $nic[0].MacAddress -ne '00155DDC2C00') { throw 'WRONG_NIC' }
    $system = @(Get-WmiObject -Namespace 'root\virtualization\v2' -Class Msvm_ComputerSystem -Filter "Name='$vmId'")
    if ($system.Count -ne 1 -or $system[0].ElementName -ne $vm.Name -or $system[0].EnabledState -ne 2) { throw 'WRONG_CIM_SYSTEM' }
    $keyboards = @($system[0].GetRelated('Msvm_Keyboard', 'Msvm_SystemDevice', $null, $null, 'PartComponent', 'GroupComponent', $false, $null))
    if ($keyboards.Count -ne 1 -or $keyboards[0].SystemName -ne $vmId) { throw 'WRONG_KEYBOARD' }
    $keyboard = $keyboards[0]
    $report.KeyboardProperties = $keyboard | Select-Object SystemName, UnicodeSupported, Layout, IsLocked, EnabledState, OperationalStatus
    if ($keyboard.IsLocked) { throw 'KEYBOARD_LOCKED_NO_UNLOCK_ATTEMPT' }
    Assert-ModifiersReleased
    $current = @($system[0].GetRelated('Msvm_VirtualSystemSettingData', 'Msvm_SettingsDefineState', $null, $null, $null, $null, $false, $null))
    if ($current.Count -ne 1 -or $current[0].VirtualSystemType -ne 'Microsoft:Hyper-V:System:Realized') { throw 'WRONG_CURRENT_SETTINGS' }
    $settings = $current[0]
    $services = @(Get-WmiObject -Namespace 'root\virtualization\v2' -Class Msvm_VirtualSystemManagementService)
    if ($services.Count -ne 1) { throw 'WRONG_SERVICE' }
    $service = $services[0]
    $report.VmId = $vmId
    $report.KeyboardPath = $keyboard.__PATH
    $report.Video = @(Get-WmiObject -Namespace 'root\virtualization\v2' -Class Msvm_VideoHead -Filter "SystemName='$vmId'" | Select-Object SystemName, DeviceID, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentBitsPerPixel, EnabledState)
    Save-GuestThumbnail 'before'
    # Require the observed idle ai09@848484 prompt. Never acknowledge authentication screens.
    Wait-ForImageObservation 'before'
    Assert-Ai09PostRecoveryPreflight $scope
    try { Invoke-Key 'PressKey' 17; Invoke-Key 'TypeKey' 67 } finally { Invoke-Key 'ReleaseKey' 17 }
    Start-Sleep -Seconds 1
    Save-GuestThumbnail 'awake'
    Wait-ForImageObservation 'awake'
    # Fixed read-only commands only. The observer confirms actual glyphs before each Enter.
    # command-5-after certifies prior stat/readlink: root-owned regular nonlink, size <=512,
    # and the exact /run/systemd/network/09-ai09-bootstrap.network path before hash/head.
    $fixedCommands = @(Get-Ai09PostRecoveryCommands)
    for ($commandIndex = 0; $commandIndex -lt $fixedCommands.Count; $commandIndex++) {
        Assert-Ai09SyncLive $sync
        Assert-Ai09PostRecoveryPreflight $scope
        Assert-Ai09DiagnosticCommandReady $sync $commandIndex
        try { Invoke-Key 'PressKey' 17; Invoke-Key 'TypeKey' 69; Invoke-Key 'TypeKey' 85 } finally { Invoke-Key 'ReleaseKey' 17 }
        Assert-ModifiersReleased
        $command = $fixedCommands[$commandIndex]
        $report.Events += [ordered]@{ Event='FixedCommandStart'; Index=$commandIndex; Command=$command }
        foreach ($character in $command.ToCharArray()) {
            $code = [int][char]$character
            $shift = $false
            if ($code -ge 97 -and $code -le 122) {
                $key = $code - 32
                if ($character -eq 'y') { $key = 90 }
                elseif ($character -eq 'z') { $key = 89 }
            }
            elseif ($code -ge 65 -and $code -le 90) {
                $key = $code; $shift = $true
                if ($character -eq 'Y') { $key = 90 }
                elseif ($character -eq 'Z') { $key = 89 }
            }
            elseif ($code -ge 48 -and $code -le 57) { $key = $code }
            elseif ($character -eq ' ') { $key = 32 }
            elseif ($character -eq '/') { $key = 111 }
            elseif ($character -eq '-') { $key = 109 }
            elseif ($character -eq '.') { $key = 190 }
            elseif ($character -eq ',') { $key = 188 }
            elseif ($character -eq ';') { $key = 188; $shift = $true }
            elseif ($character -eq '$') { $key = 52; $shift = $true }
            elseif ($character -eq '?') { $key = 189; $shift = $true }
            else { throw 'NON_ALLOWLISTED_CHARACTER' }
            # Croatian-layout candidates; actual glyphs MUST be inspected before every Enter.
            if ($shift) {
                try { Invoke-Key 'PressKey' 160; Invoke-Key 'TypeKey' $key }
                finally { Invoke-Key 'ReleaseKey' 160 }
            } else { Invoke-Key 'TypeKey' $key }
            Start-Sleep -Milliseconds 120
        }
        Start-Sleep -Seconds 1
        $typedName = 'command-' + $commandIndex + '-typed'
        Save-GuestThumbnail $typedName
        Wait-ForImageObservation $typedName
        Assert-Ai09PostRecoveryPreflight $scope
        Invoke-Key 'TypeKey' 13
        # Each read has a five-second timeout and one-second kill grace.
        $settleSeconds = 7
        for ($settle=0; $settle -lt $settleSeconds; $settle++) { Assert-Ai09SyncLive $sync; Start-Sleep -Seconds 1 }
        $afterName = 'command-' + $commandIndex + '-after'
        Save-GuestThumbnail $afterName
        # Parent must observe completed output and a normal prompt before the next command.
        Wait-ForImageObservation $afterName
    }
    Assert-Ai09SyncLive $sync
    Assert-Ai09PostRecoveryPreflight $scope
    $report.HostFinal=Get-Ai09PostRecoveryHostSnapshot $scope
    $report.Success = $true
} catch { $report.Error = $_.Exception.Message }
finally {
    if (Get-Variable -Name helperLocks -ErrorAction SilentlyContinue) { foreach ($heldHelper in $helperLocks) { $heldHelper.Dispose() } }
    $report.FinishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open((Join-Path $outputRoot 'receipt.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
if (-not $report.Success) { throw ('POSTRECOVERY_DIAGNOSTIC_STOPPED: ' + $report.Error) }

} finally {foreach($held in $continuationLocks){$held.Dispose()}}
}
if ($MyInvocation.InvocationName -ne '.') {
    $sourceLock = $null
    try {
        # Acquire the final self read handle before creating output or requesting readiness.
        if($args.Count){throw 'DIAGNOSTIC_ARGUMENTS_REFUSED'}
        Assert-Ai09DiagnosticPath $PSCommandPath
        $sourceLock = [IO.File]::Open($PSCommandPath, 'Open', 'Read', 'Read')
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $sourceHash = ([BitConverter]::ToString($hasher.ComputeHash($sourceLock))).Replace('-', '') }
        finally { $hasher.Dispose() }
        Invoke-Ai09PostRecoveryDiagnostic -sourceHash $sourceHash
    } finally { if ($sourceLock) { $sourceLock.Dispose() } }
}

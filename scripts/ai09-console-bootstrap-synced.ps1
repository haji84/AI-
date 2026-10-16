# Issue #1798: bounded observer synchronization; no command payload is accepted.
$ErrorActionPreference = 'Stop'
function New-Ai09SyncContext {
    param([string]$Root, [string]$SourceSha256, [double]$WholeSeconds = 1800)
    if ($SourceSha256 -cnotmatch '^[0-9A-F]{64}$' -or $WholeSeconds -le 0 -or $WholeSeconds -gt 1800) { throw 'INVALID_SYNC_CONTEXT' }
    return [pscustomobject]@{ Root=$Root; RunId=[guid]::NewGuid().ToString('N'); SourceSha256=$SourceSha256
        Deadline=[DateTimeOffset]::UtcNow.AddSeconds($WholeSeconds); WholeSeconds=$WholeSeconds
        Clock=[Diagnostics.Stopwatch]::StartNew(); Stages=[Collections.Generic.HashSet[string]]::new()
        Consumed=[Collections.Generic.HashSet[string]]::new(); PressAttempted=[Collections.Generic.HashSet[uint32]]::new(); ReadyAccepted=$false; FreshBeforeAccepted=$false; SudoRootObserved=$false }
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
    param($Context, [string]$Stage, [string]$ImageSha256 = '', [double]$Seconds = 90)
    Assert-Ai09SyncLive $Context
    if ($Stage -cnotmatch '^(ready|before|awake|command-(?:[0-9]|10)-(?:typed|after))$' -or $Seconds -le 0 -or $Seconds -gt 300) { throw 'INVALID_SYNC_STAGE' }
    if (($Stage -eq 'ready' -and $ImageSha256 -ne '') -or ($Stage -ne 'ready' -and $ImageSha256 -cnotmatch '^[0-9A-F]{64}$')) { throw 'INVALID_IMAGE_DIGEST' }
    if (-not $Context.Stages.Add($Stage)) { throw 'STAGE_REPLAY_REFUSED' }
    $decision = if ($Stage -eq 'ready') { 'READY' } elseif ($Stage -eq 'command-2-after') { 'SUDO_ROOT_EXIT0_OBSERVED' } else { 'OBSERVED' }
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
    } elseif ($Request.Stage -eq 'command-2-after') { $Context.SudoRootObserved=$true }
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
function Invoke-Ai09SyncedBootstrap {
    param([string]$sourceHash)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$outputRoot = 'C:\Users\qq113\OneDrive\Desktop\CAI-Software-Company\AI-\tmp\ai09-console-bootstrap-synced'
if (Test-Path -LiteralPath $outputRoot) { throw 'ONE_SHOT_ALREADY_STARTED' }
$null = New-Item -ItemType Directory -Path $outputRoot -ErrorAction Stop
$sync = New-Ai09SyncContext -Root $outputRoot -SourceSha256 $sourceHash
$report = [ordered]@{ RunId=$sync.RunId; SourceSha256=$sourceHash; StartedAt = [DateTimeOffset]::UtcNow.ToString('o'); Success = $false; GuestExecutionVerified = $false; Commands = @(
    'lsblk -f; echo . , U y $?',
    'mountpoint /mnt; echo $?',
    'sudo -n id; echo $?',
    'sudo -n timeout -k 5s 30s mount -U CA77-6E6C -o rw,nosuid,nodev,noexec /mnt; echo $?',
    'findmnt --mountpoint /mnt; echo $?',
    'sha256sum /mnt/bridge.sh; echo $?',
    'sudo -n timeout -k 5s 60s bash /mnt/bridge.sh; echo $?',
    'timeout -k 5s 30s sync; echo $?',
    'sudo -n timeout -k 5s 30s umount /mnt; echo $?',
    'lsblk -f; echo . , U y $?',
    'mountpoint /mnt; echo $?'
); Events = @() }
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
    $request = New-Ai09SyncRequest -Context $sync -Stage $name -ImageSha256 $expected -Seconds 90
    Wait-Ai09SyncResponse -Context $sync -Request $request -Seconds 90
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
    $helperLocks = [Collections.Generic.List[IO.FileStream]]::new()
    $trustedRoot = 'C:\Users\qq113\.codex\worktrees\ai09-bootstrap-1798\AI-\scripts'
    $trustedHelpers = @(
        @{ Name='ai09-prepare-bootstrap-disk.ps1'; Hash='E6E7B482E112609749C6982F051B1D35842EEE51FCDC563F4E9408B1D3C15B6B' },
        @{ Name='ai09-collect-bootstrap-result.ps1'; Hash='6A0E4D4264825A8D38C749F74BF9706FCCD39B59BDF8CF22CB8BFD3B6975F391' }
    )
    foreach ($trustedHelper in $trustedHelpers) {
        $trustedPath=Join-Path $trustedRoot $trustedHelper.Name
        $trustedHandle=[IO.File]::Open($trustedPath,'Open','Read','Read')
        $helperLocks.Add($trustedHandle)
        $trustedHasher=[Security.Cryptography.SHA256]::Create()
        try { $trustedHash=([BitConverter]::ToString($trustedHasher.ComputeHash($trustedHandle))).Replace('-','') }
        finally { $trustedHasher.Dispose() }
        if($trustedHash -cne $trustedHelper.Hash){throw 'TRUSTED_HELPER_HASH_MISMATCH'}
    }
    foreach($trustedHelper in $trustedHelpers){ . (Join-Path $trustedRoot $trustedHelper.Name) }
    $repairReceiptPath='C:\GORIQ-AI09\Reports\hostname-repair-02ea2f0d324543a1ab2973e73c97421d-23132217a79949de804c7c45dba978f4\repair-success.json'
    if((Get-FileHash -LiteralPath $repairReceiptPath -Algorithm SHA256).Hash -cne '48F19190680EC869EEE4AEF9888732530B1268FECAA6C233DB4B33F04DABF298'){throw 'REPAIR_RECEIPT_MISMATCH'}
    $scope=Get-Ai09CollectionScope
    $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
    $null=Get-Ai09CollectionVhd $scope
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
    # Require an observed idle ai09@848484 prompt after owner sudo authentication; never acknowledge an authentication screen. Clear one idle input line only.
    Wait-ForImageObservation 'before'
    $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
    $null=Get-Ai09CollectionVhd $scope
    try { Invoke-Key 'PressKey' 17; Invoke-Key 'TypeKey' 67 } finally { Invoke-Key 'ReleaseKey' 17 }
    Start-Sleep -Seconds 1
    Save-GuestThumbnail 'awake'
    Wait-ForImageObservation 'awake'
    # Exactly these eleven reviewed commands. Parent verifies identity, hash, actual exit codes and mount ownership from every frame. No ack supplies commands.
    $fixedCommands = @(
    'lsblk -f; echo . , U y $?',
    'mountpoint /mnt; echo $?',
    'sudo -n id; echo $?',
    'sudo -n timeout -k 5s 30s mount -U CA77-6E6C -o rw,nosuid,nodev,noexec /mnt; echo $?',
    'findmnt --mountpoint /mnt; echo $?',
    'sha256sum /mnt/bridge.sh; echo $?',
    'sudo -n timeout -k 5s 60s bash /mnt/bridge.sh; echo $?',
    'timeout -k 5s 30s sync; echo $?',
    'sudo -n timeout -k 5s 30s umount /mnt; echo $?',
    'lsblk -f; echo . , U y $?',
    'mountpoint /mnt; echo $?'
)
    for ($commandIndex = 0; $commandIndex -lt $fixedCommands.Count; $commandIndex++) {
        Assert-Ai09SyncLive $sync
        $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
        $null=Get-Ai09CollectionVhd $scope
        if ($commandIndex -ge 3 -and -not $sync.SudoRootObserved) { throw 'SUDO_ROOT_EXIT0_OBSERVATION_REQUIRED' }
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
        $null=Assert-Ai09CollectionEnvironment -Scope $scope -SeedAttached $true
        $null=Get-Ai09CollectionVhd $scope
        Invoke-Key 'TypeKey' 13
        # Mutating commands have explicit timeout/kill bounds; allow them to finish before snapshot.
        $settleSeconds = if ($commandIndex -eq 6) { 70 } elseif ($commandIndex -in @(3,7,8)) { 40 } else { 2 }
        for ($settle=0; $settle -lt $settleSeconds; $settle++) { Assert-Ai09SyncLive $sync; Start-Sleep -Seconds 1 }
        $afterName = 'command-' + $commandIndex + '-after'
        Save-GuestThumbnail $afterName
        # Parent must observe completed output and a normal prompt before the next command.
        Wait-ForImageObservation $afterName
    }
    Assert-Ai09SyncLive $sync
    $report.Success = $true
} catch { $report.Error = $_.Exception.Message }
finally {
    if (Get-Variable -Name helperLocks -ErrorAction SilentlyContinue) { foreach ($heldHelper in $helperLocks) { $heldHelper.Dispose() } }
    $report.FinishedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($report | ConvertTo-Json -Depth 8))
    $stream = [IO.File]::Open((Join-Path $outputRoot 'receipt.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
if (-not $report.Success) { throw ('SYNCED_BOOTSTRAP_STOPPED: ' + $report.Error) }

}
if ($MyInvocation.InvocationName -ne '.') {
    $sourceLock = $null
    try {
        # Acquire the final self read handle before creating output or requesting readiness.
        $sourceLock = [IO.File]::Open($PSCommandPath, 'Open', 'Read', 'Read')
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $sourceHash = ([BitConverter]::ToString($hasher.ComputeHash($sourceLock))).Replace('-', '') }
        finally { $hasher.Dispose() }
        Invoke-Ai09SyncedBootstrap -sourceHash $sourceHash
    } finally { if ($sourceLock) { $sourceLock.Dispose() } }
}
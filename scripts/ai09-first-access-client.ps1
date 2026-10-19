[CmdletBinding()]
param([string]$RequestPath,[string]$ExpectedRequestSha256,[switch]$Execute)
# SOURCE ONLY. No elevation, installation, guest writes or automated authentication.
# Run Execute only in an owner-visible console after the separate network gate.
# A request/hash supplied by an agent is not owner authorization. The external
# owner-controlled request channel and a single writer are trust prerequisites.
$ai09ClientArguments=@{}+$PSBoundParameters; $script:Ai09ClientSource=$PSCommandPath
$script:Ai09ClientInspector=Join-Path $PSScriptRoot 'ai09-first-access-inspect.py'
$script:Ai09ClientFingerprint='SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA'
$script:Ai09ClientPublic='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILryvuH/6LTW0dNGQaj2LW3I7dYDZw8lpIdqHEh6xCDp'
$dependency=Join-Path $PSScriptRoot 'ai09-first-access-host.ps1'
$dependencyLock=[IO.File]::Open($dependency,'Open','Read','Read')
try {
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$actual=([BitConverter]::ToString($hash.ComputeHash($dependencyLock))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose()}
  if ($actual -cne 'fea386a38e421727134f44af15574c0bf5217bc70aa19291cbd82d7da09fb7cc') {throw 'HOST_SOURCE_PIN_MISMATCH'}
  . $dependency # Pinned definitions only; does not invoke native host operations.
} finally {$dependencyLock.Dispose()}
function Read-Ai09ClientFile($Path,[int]$Limit) {
  $stream=[IO.File]::Open($Path,'Open','Read','Read'); try {return ,(Read-Ai09Bytes $stream $Limit)} finally {$stream.Dispose()}
}
function Assert-Ai09ClientIntegers($Value,[string[]]$Names) {
  foreach($name in $Names) {if ($Value.$name -isnot [int] -and $Value.$name -isnot [long]) {throw 'INTEGER_FIELD_REQUIRED'}}
}
function Assert-Ai09ClientFresh($Expires) {
  if ($Expires -isnot [string] -and $Expires -isnot [DateTime]) {throw 'REQUEST_EXPIRED_OR_UNBOUNDED'}
  try {$expiry=Get-Ai09Timestamp $Expires} catch {throw 'REQUEST_EXPIRED_OR_UNBOUNDED'}
  if ($expiry -le (Get-Ai09UtcNow) -or $expiry -gt (Get-Ai09UtcNow).AddHours(24)) {throw 'REQUEST_EXPIRED_OR_UNBOUNDED'}
}
function Get-Ai09ClientRequest($Path,$Expected) {
  if ($Expected -cnotmatch '^[a-f0-9]{64}$') {throw 'INDEPENDENT_REQUEST_PIN_REQUIRED'}
  $safe=Get-Ai09SafePath $Path; $bytes=Read-Ai09ClientFile $safe 16384
  if ((Get-Ai09ShaBytes $bytes) -cne $Expected) {throw 'REQUEST_PIN_MISMATCH'}
  $p=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)|ConvertFrom-Json
  Assert-Ai09Fields $p @('version','issue','profile','nonce','expiresAt','clientSha256','inspectorSha256','networkJournalPath','networkJournalSha256','networkPlanSha256','authorizationRef','hostAddress','guestAddress','port','user','hostKeyFingerprint','knownHostsPath','intentPath','receiptPath')
  Assert-Ai09ClientIntegers $p @('version','issue','port')
  foreach($field in @('profile','nonce','hostAddress','guestAddress','user','hostKeyFingerprint','authorizationRef')) {if ($p.$field -isnot [string]) {throw 'REQUEST_SCOPE_INVALID'}}
  if ($p.version -ne 1 -or $p.issue -ne 1219 -or $p.profile -cne 'AI09_PASSWORD_INSPECT_V1' -or $p.nonce -cnotmatch '^[a-f0-9]{32}$' -or $p.hostAddress -cne '172.27.128.1' -or $p.guestAddress -cne '172.27.140.254' -or $p.port -ne 22 -or $p.user -cne 'ai09' -or $p.hostKeyFingerprint -cne $script:Ai09ClientFingerprint -or $p.authorizationRef -cnotmatch '^[A-Za-z0-9:/#._-]{1,240}$') {throw 'REQUEST_SCOPE_INVALID'}
  foreach($name in @('clientSha256','inspectorSha256','networkJournalSha256','networkPlanSha256')) {if ($p.$name -cnotmatch '^[a-f0-9]{64}$') {throw 'REQUEST_SCOPE_INVALID'}}
  if ($p.clientSha256 -cne (Get-Ai09ShaBytes (Read-Ai09ClientFile $script:Ai09ClientSource 65536)) -or $p.inspectorSha256 -cne (Get-Ai09ShaBytes (Read-Ai09ClientFile $script:Ai09ClientInspector 65536))) {throw 'CLIENT_SOURCE_PIN_MISMATCH'}
  Assert-Ai09ClientFresh $p.expiresAt
  $seen=@($safe)
  foreach($name in @('networkJournalPath','knownHostsPath','intentPath','receiptPath')) {
    $value=Get-Ai09SafePath $p.$name
    if ($value -match '[%$"\r\n]' -or $value -in $seen) {throw 'PATH_ALIAS'}; $seen+=@($value)
  }
  return $p
}
function Assert-Ai09ClientNetwork($Request) {
  $bytes=Read-Ai09ClientFile (Get-Ai09SafePath $Request.networkJournalPath) 131072
  if ((Get-Ai09ShaBytes $bytes) -cne $Request.networkJournalSha256) {throw 'NETWORK_JOURNAL_PIN_MISMATCH'}
  $lines=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes).Split("`n")
  if ($lines.Count -ne 3 -or $lines[-1] -cne '') {throw 'NETWORK_JOURNAL_INVALID'}
  $before=$lines[0]|ConvertFrom-Json; $after=$lines[1]|ConvertFrom-Json
  Assert-Ai09Fields $before @('status','version','issue','profile','planSha256','authorizationRef','baseline','rule','observedAt')
  Assert-Ai09Fields $after @('status','version','issue','profile','planSha256','authorizationRef','baselineSha256','afterSha256','expiresAt','observedAt','candidateSource','guestAddressVerified','authenticatedConnectionVerified','activationReady','nativeAutomaticRuleExpiry')
  if ($before.status -cne 'PREPARED' -or $after.status -cne 'APPLIED_NETWORK_ONLY' -or $after.candidateSource -cne 'OWNER_APPROVED_VM_NIC_ENDPOINT') {throw 'NETWORK_JOURNAL_INVALID'}
  foreach($record in @($before,$after)) {
    Assert-Ai09ClientIntegers $record @('version','issue')
    if ($record.version -ne 1 -or $record.issue -ne 1219 -or $record.profile -cne 'AI09_FIRST_ACCESS_TCP22_V1' -or $record.planSha256 -cne $Request.networkPlanSha256 -or $record.authorizationRef -cne $Request.authorizationRef) {throw 'NETWORK_SCOPE_INVALID'}
  }
  foreach($field in @('guestAddressVerified','authenticatedConnectionVerified','activationReady','nativeAutomaticRuleExpiry')) {if ($after.$field -isnot [bool] -or $after.$field) {throw 'NETWORK_SCOPE_INVALID'}}
  Assert-Ai09ClientFresh $after.expiresAt
  if ((Get-Ai09Json $before.rule) -cne (Get-Ai09Json (New-Ai09FirstRule))) {throw 'NETWORK_SCOPE_INVALID'}
  # Reconstruct only a validation projection; no native guest observation occurs.
  $raw=Get-Ai09Json $before.baseline|ConvertFrom-Json; $raw|Add-Member -NotePropertyName guestAddressCandidates -NotePropertyValue @()
  foreach($disk in $raw.disks) {$disk|Add-Member -NotePropertyName fileSize -NotePropertyValue 1}
  $canonical=Get-Ai09FirstCanonical $raw; Assert-Ai09FirstPolicy $canonical $false
  if ((Get-Ai09Digest $canonical) -cne (Get-Ai09Digest $before.baseline) -or $after.baselineSha256 -cne (Get-Ai09Digest $canonical)) {throw 'NETWORK_BASELINE_INVALID'}
  $canonical.acls=@($canonical.acls)+@([pscustomobject](New-Ai09FirstRule))
  [string[]]$rows=@($canonical.acls|ForEach-Object {Get-Ai09Json $_}); [Array]::Sort($rows,[StringComparer]::Ordinal); $canonical.acls=@($rows|ForEach-Object {$_|ConvertFrom-Json})
  if ($after.afterSha256 -cne (Get-Ai09Digest $canonical)) {throw 'NETWORK_AFTER_INVALID'}
}
function Assert-Ai09ClientConsole {
  if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::MachineName -cne 'HAJI' -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected -or -not [Environment]::UserInteractive) {throw 'OWNER_INTERACTIVE_CONSOLE_REQUIRED'}
}
function Get-Ai09PinnedSsh {
  $path=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\OpenSSH\ssh.exe'
  for($cursor=$path;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)) {
    if ((Get-Item -LiteralPath $cursor -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) {throw 'SSH_BINARY_ALIAS'}
    if ([IO.Path]::GetPathRoot($cursor) -eq $cursor) {break}
  }
  if ((Get-Ai09ShaBytes (Read-Ai09ClientFile $path 16777216)) -cne '98d447730047f5df91373e852d057928a921c3d1e89938700ab656ba84b19dc8' -or (Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path).Status -ne 'Valid') {throw 'SSH_BINARY_PIN_MISMATCH'}
  return $path
}
function Get-Ai09SshArguments($Request,[byte[]]$Inspector) {
  $encoded=[Convert]::ToBase64String($Inspector)
  $python='import base64;exec(compile(base64.b64decode("'+$encoded+'"),"<ai09-first-access>","exec"))'
  $remote="/usr/bin/sudo -k -p '`nAI09 sudo password (owner only):`n' -- /usr/bin/python3 -B -I -c '"+$python+"' "+$Request.nonce
  $options=@(('UserKnownHostsFile="'+$Request.knownHostsPath.Replace('\','/')+'"'),'GlobalKnownHostsFile=NUL','HostKeyAlias=goriq-ai09-1219','HostKeyAlgorithms=ssh-ed25519','StrictHostKeyChecking=yes','UpdateHostKeys=no','CheckHostIP=no','VerifyHostKeyDNS=no','CanonicalizeHostname=no','BatchMode=no','PubkeyAuthentication=no','PasswordAuthentication=yes','KbdInteractiveAuthentication=no','PreferredAuthentications=password','NumberOfPasswordPrompts=1','IdentitiesOnly=yes','IdentityAgent=none','IdentityFile=none','ForwardAgent=no','ForwardX11=no','ClearAllForwardings=yes','PermitLocalCommand=no','ProxyCommand=none','ProxyJump=none','ControlMaster=no','ControlPersist=no','ControlPath=none','EscapeChar=none','ConnectTimeout=10','ConnectionAttempts=1','ServerAliveInterval=10','ServerAliveCountMax=1')
  $result=@('-F','NUL','-tt'); foreach($option in $options) {$result+=@('-o',$option)}
  return @($result)+@('-p','22','-l','ai09','172.27.140.254',$remote)
}
function ConvertTo-Ai09LegacyArgument([string]$Value) {
  # All call sites have no trailing backslashes; preserve embedded quotes in the
  # Windows PowerShell 5.1 native binder. PS7 is explicitly set to Legacy below.
  return $Value.Replace('"','""')
}
function Add-Ai09FrameLine($Frame,[string]$Line) {
  $line=$Line.TrimEnd([char]13); $Frame.bytes+=[Text.Encoding]::UTF8.GetByteCount($line)+1
  if ($Frame.bytes -gt 131072 -or $line.Length -gt 131072) {$Frame.failure='SSH_OUTPUT_BOUND'; throw 'SSH_OUTPUT_BOUND'}
  if ($line -ceq 'AI09_FIRST_ACCESS_BEGIN') {if ($Frame.state -ne 0) {throw 'GUEST_FRAME_INVALID'}; $Frame.state=1; return}
  if ($line -ceq 'AI09_FIRST_ACCESS_END') {if ($Frame.state -ne 1 -or $null -eq $Frame.json) {throw 'GUEST_FRAME_INVALID'}; $Frame.state=2; return}
  if ($Frame.state -eq 1) {if ($null -ne $Frame.json) {throw 'GUEST_FRAME_INVALID'}; $Frame.json=$line}
}
function Invoke-Ai09SshConsole($Ssh,$Arguments,$Frame) {
  $saved=@{}; foreach($name in @('SSH_ASKPASS','SSH_ASKPASS_REQUIRE','DISPLAY','SSH_AUTH_SOCK','SSH_AGENT_PID')) {$saved[$name]=[Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name,$null)}
  try {
    [Environment]::SetEnvironmentVariable('SSH_ASKPASS_REQUIRE','never')
    $PSNativeCommandArgumentPassing='Legacy'; $ErrorActionPreference='Continue'
    $nativeArguments=@($Arguments|ForEach-Object {ConvertTo-Ai09LegacyArgument $_})
    # Preserve native stdin AND stderr on the owner's console. Capture only
    # stdout: local authentication prompts/diagnostics never enter the frame.
    # PowerShell buffers native lines before this callback: this is a retained
    # frame cap, not a hard raw-output allocation or wall/tree-cleanup guarantee.
    & $Ssh @nativeArguments | ForEach-Object -ErrorAction Stop { $line=[string]$_; Add-Ai09FrameLine $Frame $line; Write-Host $line }
    return $LASTEXITCODE
  } catch {
    if ($Frame.ContainsKey('failure')) {throw $Frame.failure}; throw 'SSH_NATIVE_PIPELINE_FAILED'
  } finally {foreach($name in $saved.Keys) {[Environment]::SetEnvironmentVariable($name,$saved[$name])}}
}
function Get-Ai09ValidatedGuest($Frame,$Nonce) {
  if ($Frame.state -ne 2 -or $null -eq $Frame.json) {throw 'GUEST_FRAME_MISSING'}
  $g=$Frame.json|ConvertFrom-Json
  Assert-Ai09Fields $g @('version','issue','status','nonce','observedAt','hostname','mac','addresses','effectiveUid','hostKeyFingerprint','inventory','mutationsPerformed','activationReady','physicalE2EVerified')
  Assert-Ai09ClientIntegers $g @('version','issue','effectiveUid')
  foreach($field in @('status','nonce','hostname','mac','hostKeyFingerprint')) {if ($g.$field -isnot [string]) {throw 'GUEST_IDENTITY_INVALID'}}
  if ($g.version -ne 1 -or $g.issue -ne 1219 -or $g.status -cne 'AUTHENTICATED_ROOT_BASELINE' -or $g.nonce -cne $Nonce -or $g.hostname -cne '848484' -or $g.mac -cne '00:15:5d:dc:2c:00' -or $g.effectiveUid -ne 0 -or @($g.addresses).Count -ne 1 -or $g.addresses[0] -cne '172.27.140.254/20' -or $g.hostKeyFingerprint -cne $script:Ai09ClientFingerprint) {throw 'GUEST_IDENTITY_INVALID'}
  foreach($name in @('mutationsPerformed','activationReady','physicalE2EVerified')) {if ($g.$name -isnot [bool] -or $g.$name) {throw 'GUEST_CLAIM_INVALID'}}
  $observed=[DateTimeOffset]::MinValue; if (-not [DateTimeOffset]::TryParse([string]$g.observedAt,[ref]$observed)) {throw 'GUEST_FRAME_INVALID'}
  Assert-Ai09Fields $g.inventory @('writesPerformed','observationsIncomplete','executables','account','sshPolicy','sshUnits','osRelease','architecture','pathMetadata')
  if ($g.inventory.writesPerformed -isnot [bool] -or $g.inventory.writesPerformed) {throw 'GUEST_CLAIM_INVALID'}
  foreach($name in @($g.inventory.observationsIncomplete)) {if ($name -cnotin @('account','sshPolicy','sshUnits','osRelease','architecture')) {throw 'GUEST_FRAME_INVALID'}}
  Assert-Ai09Fields $g.inventory.executables @('python3','node','docker','podman')
  foreach($property in $g.inventory.executables.PSObject.Properties) {if ($property.Value -cnotin @('present','missing')) {throw 'GUEST_FRAME_INVALID'}}
  Assert-Ai09Fields $g.inventory.pathMetadata @('/home/ai09','/home/ai09/.ssh','/home/ai09/.ssh/authorized_keys','/home/ai09/.bashrc','/etc/ssh','/etc/ssh/sshd_config')
  foreach($property in $g.inventory.pathMetadata.PSObject.Properties) {
    $v=$property.Value
    if ($v.PSObject.Properties['status']) {Assert-Ai09Fields $v @('status'); if ($v.status -cne 'UNAVAILABLE') {throw 'GUEST_FRAME_INVALID'}} else {Assert-Ai09Fields $v @('uid','gid','mode','symlink'); if ($v.uid -lt 0 -or $v.gid -lt 0 -or $v.mode -cnotmatch '^0o[0-7]{1,4}$' -or $v.symlink -isnot [bool]) {throw 'GUEST_FRAME_INVALID'}}
  }
  foreach($name in @('account','sshPolicy','sshUnits','osRelease','architecture')) {
    $v=$g.inventory.$name
    if ($v.PSObject.Properties['status']) {Assert-Ai09Fields $v @('status'); if ($v.status -cne 'UNAVAILABLE') {throw 'GUEST_FRAME_INVALID'}; continue}
    if ($name -eq 'account') {Assert-Ai09Fields $v @('name','uid','gid','home','shell'); if ($v.name -cne 'ai09' -or $v.uid -lt 0 -or $v.gid -lt 0 -or ([string]$v.home).Length -gt 1024 -or ([string]$v.shell).Length -gt 1024) {throw 'GUEST_FRAME_INVALID'}}
    elseif ($name -eq 'sshPolicy') {foreach($property in $v.PSObject.Properties) {if ($property.Name -cnotin @('passwordauthentication','kbdinteractiveauthentication','usepam','pubkeyauthentication','authorizedkeysfile','authorizedkeyscommand','trustedusercakeys','permituserenvironment','permituserrc','acceptenv','forcecommand','allowusers','denyusers','allowgroups','denygroups') -or $property.Value -isnot [string]) {throw 'GUEST_FRAME_INVALID'}}}
    elseif ($v -isnot [string] -or [Text.Encoding]::UTF8.GetByteCount($v) -gt 32768) {throw 'GUEST_FRAME_INVALID'}
  }
  return $g
}
function Write-Ai09ClientRecord($Stream,$Value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $Value)+"`n"); if ($bytes.Length -gt 131072) {throw 'RECEIPT_BOUND'}
  $Stream.Write($bytes,0,$bytes.Length); $Stream.Flush($true)
}
function Invoke-Ai09FirstAccessClient {
  param($RequestPath,$ExpectedRequestSha256,[switch]$Execute)
  $ErrorActionPreference='Stop'; $files=@(); $receipt=$null
  $result=[ordered]@{version=1;issue=1219;status='PREPARATION_ONLY';authenticatedConnectionVerified=$false;rootExecutionAttested=$false;trustedGuestShellRequired=$true;activationReady=$false;physicalE2EVerified=$false;guestMutationsPerformed=$false;hardRawOutputBound=$false;hardWallDeadline=$false;processTreeCleanupVerified=$false}
  try {
    if (-not $RequestPath -and -not $ExpectedRequestSha256 -and -not $Execute) {return $result}
    $p=Get-Ai09ClientRequest $RequestPath $ExpectedRequestSha256
    $result.requestSha256=$ExpectedRequestSha256; $result.nonce=$p.nonce; $result.inspectorSha256=$p.inspectorSha256
    if (-not $Execute) {$result.status='VALIDATED_PREPARATION_ONLY'; return $result}
    Assert-Ai09ClientConsole; Assert-Ai09ClientNetwork $p; $ssh=Get-Ai09PinnedSsh
    foreach($path in @($p.knownHostsPath,$p.intentPath,$p.receiptPath)) {if (Test-Path -LiteralPath $path) {throw 'ATTEMPT_ALREADY_PREPARED'}}
    foreach($path in @($p.knownHostsPath,$p.intentPath,$p.receiptPath)) {$files+=@(New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read,4096,[IO.FileOptions]::WriteThrough))}
    $receipt=$files[2]; $key=[Text.Encoding]::ASCII.GetBytes('goriq-ai09-1219 '+$script:Ai09ClientPublic+"`n"); $files[0].Write($key,0,$key.Length); $files[0].Flush($true)
    # Windows OpenSSH's public lookup cannot share an existing writer. Retire
    # that handle, then retain a read-only guard that still denies other writers.
    $files[0].Dispose(); $files[0]=[IO.File]::Open((Get-Ai09SafePath $p.knownHostsPath),'Open','Read','Read')
    if ((Get-Ai09ShaBytes (Read-Ai09Bytes $files[0] $key.Length)) -cne (Get-Ai09ShaBytes $key)) {throw 'KNOWN_HOSTS_BYTES_CHANGED'}
    Write-Ai09ClientRecord $files[1] ([ordered]@{version=1;issue=1219;status='PREPARED_READ_ONLY_SSH';requestSha256=$ExpectedRequestSha256;nonce=$p.nonce;networkJournalSha256=$p.networkJournalSha256;observedAt=(Get-Ai09UtcNow).ToString('o');authenticatedConnectionVerified=$false;physicalE2EVerified=$false})
    $inspector=Read-Ai09ClientFile $script:Ai09ClientInspector 65536
    if ((Get-Ai09ShaBytes $inspector) -cne $p.inspectorSha256) {throw 'CLIENT_SOURCE_PIN_MISMATCH'}
    Assert-Ai09ClientFresh $p.expiresAt
    $frame=@{state=0;json=$null;bytes=0}; $exit=Invoke-Ai09SshConsole $ssh (Get-Ai09SshArguments $p $inspector) $frame
    if ($exit -ne 0) {throw 'SSH_AUTHENTICATION_OR_COMMAND_FAILED'}
    $guest=Get-Ai09ValidatedGuest $frame $p.nonce
    # SSH authenticates the host, not a root execution attestation. The existing
    # guest shell/rc must be trusted; validated stdout remains a guest report.
    $result.status='AUTHENTICATED_GUEST_BASELINE'; $result.authenticatedConnectionVerified=$true; $result.guest=$guest
  } catch {
    $result.status='BLOCKED'; $code=[string]$_.Exception.Message; if ($code -cnotmatch '^[A-Z][A-Z0-9_]{1,80}$') {$code='CLIENT_OR_NATIVE_FAILURE'}; $result.code=$code
    $result.authenticatedConnectionVerified=$false
  } finally {
    if ($receipt) {try {Write-Ai09ClientRecord $receipt $result} catch {$result.status='BLOCKED'; $result.code='RECEIPT_WRITE_UNCONFIRMED'; $result.authenticatedConnectionVerified=$false}}
    foreach($file in $files) {$file.Dispose()}
  }
  return $result
}
if ($MyInvocation.InvocationName -ne '.') {
  $result=Invoke-Ai09FirstAccessClient @ai09ClientArguments; $result|ConvertTo-Json -Depth 20
  if ($result.status -in @('PREPARATION_ONLY','VALIDATED_PREPARATION_ONLY','AUTHENTICATED_GUEST_BASELINE')) {exit 0} else {exit 1}
}

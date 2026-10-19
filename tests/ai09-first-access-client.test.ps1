Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/ai09-first-access-client.ps1'
if (-not (Test-Path -LiteralPath $source)) {throw 'ASSERT:FIRST_ACCESS_CLIENT_MISSING'}
. $source
$script:Assertions=0
function Equal($Actual,$Expected,$Label) {$script:Assertions++; if ($Actual -cne $Expected) {throw "ASSERT:$Label expected=$Expected actual=$Actual"}}
function Yes($Value,$Label) {$script:Assertions++; if (-not $Value) {throw "ASSERT:$Label"}}
function Reject($Action,$Code) {$script:Assertions++; try {& $Action; throw 'ASSERT:EXPECTED_REJECTION'} catch {if ($_.Exception.Message -cne $Code) {throw}}}
function Assert-Ai09OwnerPath {param($Path)} # Only filesystem ACL authority is external in these fixtures.
function Assert-Ai09ClientConsole {}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-client-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
$script:NativeCalls=0
$script:RealSshConsole=(Get-Command Invoke-Ai09SshConsole).ScriptBlock
function Invoke-Ai09SshConsole {param($Ssh,$Arguments,$Frame)
  $script:NativeCalls++
  foreach($line in $script:WireLines) {Add-Ai09FrameLine $Frame $line}
  return $script:WireExit
}
$script:RealPinnedSsh=(Get-Command Get-Ai09PinnedSsh).ScriptBlock
function Get-Ai09PinnedSsh {return 'fixture-never-executed'}
function New-Request($Changes=@{}) {
  $p=[ordered]@{version=1;issue=1219;profile='AI09_PASSWORD_INSPECT_V1';nonce=([guid]::NewGuid().ToString('N'));expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(10).ToString('o');clientSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();inspectorSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../scripts/ai09-first-access-inspect.py') -Algorithm SHA256).Hash.ToLowerInvariant();networkJournalPath=(Join-Path $root ([guid]::NewGuid().ToString('N')+'.network'));networkJournalSha256=('1'*64);networkPlanSha256=('2'*64);authorizationRef='fixture-owner-reference';hostAddress='172.27.128.1';guestAddress='172.27.140.254';port=22;user='ai09';hostKeyFingerprint='SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA';knownHostsPath=(Join-Path $root ([guid]::NewGuid().ToString('N')+'.known'));intentPath=(Join-Path $root ([guid]::NewGuid().ToString('N')+'.intent'));receiptPath=(Join-Path $root ([guid]::NewGuid().ToString('N')+'.receipt'))}
  foreach($key in $Changes.Keys) {$p[$key]=$Changes[$key]}
  $path=Join-Path $root ([guid]::NewGuid().ToString('N')+'.request')
  [IO.File]::WriteAllText($path,($p|ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
  return @{RequestPath=$path;ExpectedRequestSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
}
function Guest($Nonce) {
  return [ordered]@{version=1;issue=1219;status='AUTHENTICATED_ROOT_BASELINE';nonce=$Nonce;observedAt=[DateTimeOffset]::UtcNow.ToString('o');hostname='848484';mac='00:15:5d:dc:2c:00';addresses=@('172.27.140.254/20');effectiveUid=0;hostKeyFingerprint='SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA';inventory=@{writesPerformed=$false;observationsIncomplete=@();executables=@{python3='present';node='missing';docker='missing';podman='missing'};account=@{name='ai09';uid=1000;gid=1000;home='/home/ai09';shell='/bin/bash'};sshPolicy=@{passwordauthentication='yes'};sshUnits='Id=ssh.service';osRelease='ID=ubuntu';architecture='x86_64';pathMetadata=@{'/home/ai09'=@{uid=1000;gid=1000;mode='0o750';symlink=$false};'/home/ai09/.ssh'=@{status='UNAVAILABLE'};'/home/ai09/.ssh/authorized_keys'=@{status='UNAVAILABLE'};'/home/ai09/.bashrc'=@{uid=1000;gid=1000;mode='0o644';symlink=$false};'/etc/ssh'=@{uid=0;gid=0;mode='0o755';symlink=$false};'/etc/ssh/sshd_config'=@{uid=0;gid=0;mode='0o644';symlink=$false}}};mutationsPerformed=$false;activationReady=$false;physicalE2EVerified=$false}
}
function Set-Wire($Request,$Changes=@{}) {
  $p=Get-Content -LiteralPath $Request.RequestPath -Raw|ConvertFrom-Json
  $g=Guest $p.nonce; foreach($key in $Changes.Keys) {$g[$key]=$Changes[$key]}
  $script:WireLines=@('unretained banner','AI09_FIRST_ACCESS_BEGIN',($g|ConvertTo-Json -Depth 20 -Compress),'AI09_FIRST_ACCESS_END')
  $script:WireExit=0
}
function Add-NetworkProof($Request,$Changes=@{}) {
  $p=Get-Content -LiteralPath $Request.RequestPath -Raw|ConvertFrom-Json
  $state=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';generation=2;nic=[ordered]@{id='Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D';name='Network Adapter';mac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';switchName='Default Switch'};switch=[ordered]@{id='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';name='Default Switch';type='Internal'};hostAddress='172.27.128.1';guestAddress='172.27.140.254';hostInterfaceIndex=21;hostPrefixLength=20;disks=@([ordered]@{path='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx';controllerType='SCSI';controllerNumber=0;controllerLocation=0;diskIdentifier='9D28872E-0087-4A33-ABFA-AE0DEF1E66B8';parentPath='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx';vhdType='Differencing';vhdFormat='VHDX';size=42949672960});acls=@(Get-Ai09FirstOriginalRules)}
  [string[]]$rows=@($state.acls|ForEach-Object {Get-Ai09Json $_}); [Array]::Sort($rows,[StringComparer]::Ordinal); $state.acls=@($rows|ForEach-Object {$_|ConvertFrom-Json})
  $first=[ordered]@{status='PREPARED';version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';planSha256=$p.networkPlanSha256;authorizationRef=$p.authorizationRef;baseline=$state;rule=(New-Ai09FirstRule);observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $next=Get-Ai09Json $state|ConvertFrom-Json; $next.acls=@($next.acls)+@([pscustomobject](New-Ai09FirstRule)); [string[]]$rows=@($next.acls|ForEach-Object {Get-Ai09Json $_}); [Array]::Sort($rows,[StringComparer]::Ordinal); $next.acls=@($rows|ForEach-Object {$_|ConvertFrom-Json})
  $last=[ordered]@{status='APPLIED_NETWORK_ONLY';version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';planSha256=$p.networkPlanSha256;authorizationRef=$p.authorizationRef;baselineSha256=(Get-Ai09Digest $state);afterSha256=(Get-Ai09Digest $next);expiresAt=$p.expiresAt;observedAt=[DateTimeOffset]::UtcNow.ToString('o');candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false}
  foreach($key in $Changes.Keys) {$last[$key]=$Changes[$key]}
  [IO.File]::WriteAllText($p.networkJournalPath,((Get-Ai09Json $first)+"`n"+(Get-Ai09Json $last)+"`n"),(New-Object Text.UTF8Encoding($false)))
  $p.networkJournalSha256=(Get-FileHash -LiteralPath $p.networkJournalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($Request.RequestPath,($p|ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
  $Request.ExpectedRequestSha256=(Get-FileHash -LiteralPath $Request.RequestPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
try {
  $before=@(Get-ChildItem -LiteralPath $root).Count
  $result=Invoke-Ai09FirstAccessClient
  Equal $result.status 'PREPARATION_ONLY' 'default never connects'; Equal $result.authenticatedConnectionVerified $false 'default authentication false'; Equal $script:NativeCalls 0 'default no SSH'; Equal @(Get-ChildItem -LiteralPath $root).Count $before 'default no files'
  $request=New-Request; $p=Get-Content -LiteralPath $request.RequestPath -Raw|ConvertFrom-Json
  Equal (Invoke-Ai09FirstAccessClient @request).status 'VALIDATED_PREPARATION_ONLY' 'validation does not require applied journal'; Yes (-not (Test-Path -LiteralPath $p.networkJournalPath)) 'no fabricated network proof'; Yes (-not (Test-Path -LiteralPath $p.knownHostsPath)) 'validation no knownhosts write'
  foreach($change in @(@{version='1'},@{nonce='bad'},@{expiresAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')},@{expiresAt=[DateTimeOffset]::UtcNow.AddHours(25).ToString('o')},@{guestAddress='172.27.140.253'},@{user='root'},@{port=2222},@{hostKeyFingerprint='SHA256:other'},@{clientSha256=('0'*64)},@{inspectorSha256=('0'*64)},@{extra='authority'})) {
    $request=New-Request $change; Equal (Invoke-Ai09FirstAccessClient @request).status 'BLOCKED' 'invalid request cannot execute'
  }
  $request=New-Request; $request.ExpectedRequestSha256='0'*64; Equal (Invoke-Ai09FirstAccessClient @request).code 'REQUEST_PIN_MISMATCH' 'independent request pin'
  $request=New-Request; Equal (Invoke-Ai09FirstAccessClient @request -Execute).status 'BLOCKED' 'missing network proof refuses'; Equal $script:NativeCalls 0 'missing proof never connects'
  foreach($change in @(@{version='1'},@{status='UNCERTAIN'},@{afterSha256=('0'*64)},@{profile='other'},@{activationReady=$true},@{expiresAt=[DateTimeOffset]::UtcNow.AddSeconds(-1).ToString('o')})) {
    $request=New-Request; Add-NetworkProof $request $change; Equal (Invoke-Ai09FirstAccessClient @request -Execute).status 'BLOCKED' 'wrong network proof refuses'; Equal $script:NativeCalls 0 'wrong proof never connects'
  }
  $request=New-Request; Add-NetworkProof $request; Set-Wire $request
  $result=Invoke-Ai09FirstAccessClient @request -Execute
  Equal $result.status 'AUTHENTICATED_GUEST_BASELINE' ('fixture frame accepted '+($result|ConvertTo-Json -Compress -Depth 20)); Equal $script:NativeCalls 1 'one invocation only'; Equal $result.physicalE2EVerified $false 'never physical E2E'
  Equal $result.rootExecutionAttested $false 'remote shell output is not root attestation'; Equal $result.trustedGuestShellRequired $true 'existing guest shell trust is required'
  $p=Get-Content -LiteralPath $request.RequestPath -Raw|ConvertFrom-Json
  Yes ([IO.File]::ReadAllText($p.knownHostsPath).StartsWith('goriq-ai09-1219 ssh-ed25519 AAAAC3')) 'fixed historical key only'
  Yes (-not [IO.File]::ReadAllText($p.receiptPath).Contains('unretained banner')) 'banner not persisted'
  Equal (Invoke-Ai09FirstAccessClient @request -Execute).status 'BLOCKED' 'create-only replay refused'; Equal $script:NativeCalls 1 'replay no SSH'
  foreach($change in @(@{nonce=('0'*32)},@{effectiveUid=$false},@{effectiveUid='0'},@{effectiveUid=1000},@{hostname='other'},@{hostKeyFingerprint='other'},@{physicalE2EVerified=$true},@{mutationsPerformed=$true},@{activationReady=$true},@{unknown='secret'})) {
    $request=New-Request; Add-NetworkProof $request; Set-Wire $request $change
    Equal (Invoke-Ai09FirstAccessClient @request -Execute).status 'BLOCKED' 'wrong frame refuses'
    $p=Get-Content -LiteralPath $request.RequestPath -Raw|ConvertFrom-Json; Yes (-not [IO.File]::ReadAllText($p.receiptPath).Contains('secret')) 'unvalidated frame not persisted'
  }
  foreach($mode in @('no-frame','duplicate','unterminated','nonzero','too-large')) {
    $request=New-Request; Add-NetworkProof $request; Set-Wire $request
    switch($mode) {'no-frame' {$script:WireLines=@('password unavailable')} 'duplicate' {$script:WireLines+=@('AI09_FIRST_ACCESS_BEGIN')} 'unterminated' {$script:WireLines=$script:WireLines[0..2]} 'nonzero' {$script:WireExit=1} 'too-large' {$script:WireLines=@('AI09_FIRST_ACCESS_BEGIN',('x'*131073),'AI09_FIRST_ACCESS_END')}}
    Equal (Invoke-Ai09FirstAccessClient @request -Execute).status 'BLOCKED' "wire failure:$mode"
  }
  $request=New-Request; $p=Get-Content -LiteralPath $request.RequestPath -Raw|ConvertFrom-Json
  $inspector=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '../scripts/ai09-first-access-inspect.py'))
  $arguments=Get-Ai09SshArguments $p $inspector
  Equal $arguments[-2] '172.27.140.254' 'only fixed remote endpoint'; Yes ($arguments -contains 'NumberOfPasswordPrompts=1') 'single SSH password prompt'; Yes ($arguments -contains 'PubkeyAuthentication=no') 'no ambient key authentication'; Yes ($arguments -contains 'StrictHostKeyChecking=yes') 'strict host pin'
  Yes ($arguments[-1].StartsWith("/usr/bin/sudo -k -p '")) 'absolute sudo with fresh owner authentication'; Yes ($arguments[-1].Contains("`n")) 'sudo prompt newline'; Yes ($arguments[-1].Contains('/usr/bin/python3 -B -I -c ')) 'isolated no-bytecode Python'
  # A real native argv process catches PowerShell 5.1's embedded-quote loss.
  $probe='python3'; if ([Environment]::OSVersion.Platform -eq 'Win32NT') {$probe='python'; if (Test-Path Variable:PSNativeCommandArgumentPassing) {$PSNativeCommandArgumentPassing='Legacy'}}
  $probeArgs=@('-B','-c','import json,sys;print(json.dumps(sys.argv[1:]))')+@($arguments[-1], 'UserKnownHostsFile="C:/Owner Files/fixed.known"')
  if ([Environment]::OSVersion.Platform -eq 'Win32NT') {$probeArgs=@($probeArgs|ForEach-Object {ConvertTo-Ai09LegacyArgument $_})}
  $roundTrip=& $probe @probeArgs|ConvertFrom-Json
  Equal $LASTEXITCODE 0 'real argv fixture exit'; Equal $roundTrip[0] $arguments[-1] 'full remote command survives native quoting'; Equal $roundTrip[1] 'UserKnownHostsFile="C:/Owner Files/fixed.known"' 'quoted path survives native quoting'
  # The real pipeline must propagate a collector refusal; no SSH is invoked here.
  Reject {& $script:RealSshConsole $probe @('-B','-c','import sys; print("x"*131073); print("UNRETAINED_AFTER_BOUND")') @{state=0;json=$null;bytes=0}} 'SSH_OUTPUT_BOUND'
  if ([Environment]::OSVersion.Platform -eq 'Win32NT') {
    # -G only evaluates fixed options; it does not connect or run remote commands.
    $ssh=Join-Path $env:SystemRoot 'System32/OpenSSH/ssh.exe'
    $gArgs=@(@('-G')+$arguments|ForEach-Object {ConvertTo-Ai09LegacyArgument $_})
    $config=@(& $ssh @gArgs)
    Equal $LASTEXITCODE 0 'actual system SSH configuration parse'; Yes ($config -contains 'hostname 172.27.140.254') 'actual fixed hostname'; Yes ($config -contains 'user ai09') 'actual fixed user'; Yes ($config -contains 'port 22') 'actual fixed port'; Yes ($config -contains 'numberofpasswordprompts 1') 'actual single password prompt'; Yes ($config -contains 'hostkeyalias goriq-ai09-1219') 'actual historical alias'
  }
  Write-Output "AI09_FIRST_ACCESS_CLIENT_FIXTURES_PASS assertions=$script:Assertions : SOURCE_ONLY no network/authentication/native VM calls"
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-client-fixture-*') {Remove-Item -LiteralPath $resolved -Recurse -Force}
}

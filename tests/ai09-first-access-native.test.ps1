Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '../scripts/ai09-first-access-native.ps1'
if (-not (Test-Path -LiteralPath $source)) {throw 'ASSERT:NATIVE_ORCHESTRATOR_MISSING'}
. $source
$script:CoreInvoke=(Get-Command Invoke-Ai09FirstAccessHost).ScriptBlock
$script:Assertions=0
function Equal($Actual,$Expected,$Label) {$script:Assertions++; if ($Actual -cne $Expected) {throw "ASSERT:$Label expected=$Expected actual=$Actual"}}
function Yes($Value,$Label) {$script:Assertions++; if (-not $Value) {throw "ASSERT:$Label"}}
function Assert-Ai09OwnerPath {param($Path)}
function Assert-Ai09NativeAuthority {$script:AuthorityCalls++; if ($script:NoAdmin) {throw 'ADMIN_REQUIRED'}}
function Get-Ai09UtcNow {return $script:Clock}
function Get-Ai09FirstNativeSnapshot {return ($script:State|ConvertTo-Json -Depth 20|ConvertFrom-Json)}
function Add-Ai09NativeRule {param($State,$Rule)
  $script:Adds++; Yes (Test-Path -LiteralPath (Join-Path $script:Output 'intent.json')) 'intent precedes add'
  Yes (Test-Path -LiteralPath (Join-Path $script:Output 'plan.json')) 'plan precedes add'
  Yes (Test-Path -LiteralPath (Join-Path $script:Output 'receipt.json')) 'receipt reserved before add'
  $script:State.acls=@($script:State.acls)+@($Rule)
}
function Invoke-Ai09FirstAccessHost {
  param($Mode='Inspect',$PlanPath,$ExpectedPlanSha256,$AuthorizationReference,$JournalPath)
  if ($Mode -eq 'Apply') {
    $script:Applies++; $script:PassedPlan=[IO.File]::ReadAllText($PlanPath)|ConvertFrom-Json
    if ($script:BadResult) {return @{status='PASS'}}
    if ($script:ThrowApply) {throw 'FIXTURE_INTERRUPTED'}
  }
  return & $script:CoreInvoke @PSBoundParameters
}
$root=Join-Path ([IO.Path]::GetTempPath()) ('ai09-native-fixture-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $root
function Reset-Fixture {
  $script:Clock=[DateTimeOffset]::UtcNow; $script:Applies=0; $script:Adds=0; $script:AuthorityCalls=0; $script:NoAdmin=$false; $script:BadResult=$false; $script:ThrowApply=$false
  $script:Output=Join-Path $root ([guid]::NewGuid().ToString('N')); $null=New-Item -ItemType Directory -Path $script:Output
  $script:State=[ordered]@{hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';vmName='GORIQ-AI09-Ubuntu';vmState='Running';generation=2
    nic=[ordered]@{id='Microsoft:453B139B-CCEB-446E-99FB-F45BF5895436\796BBDF2-8959-42DE-BD42-E248AA53EB9D';name='Network Adapter';mac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';switchName='Default Switch'}
    switch=[ordered]@{id='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';name='Default Switch';type='Internal'}
    hostAddress='172.27.128.1';guestAddress='172.27.140.254';guestAddressCandidates=@();hostInterfaceIndex=21;hostPrefixLength=20
    disks=@([ordered]@{path='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx';controllerType='SCSI';controllerNumber=0;controllerLocation=0;diskIdentifier='9D28872E-0087-4A33-ABFA-AE0DEF1E66B8';parentPath='C:\GORIQ-AI09\Disks\GORIQ-AI09-Ubuntu.vhdx';vhdType='Differencing';vhdFormat='VHDX';size=42949672960;fileSize=32768})
    acls=@(Get-Ai09FirstOriginalRules)}
}
function Envelope($Changes=@{}) {
  $e=[ordered]@{version=1;issue=1219;action='APPLY_ONLY_FIXED_TCP22';hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';nicMac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';hostAddress='172.27.128.1';guestAddress='172.27.140.254';candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;guestEndpointPhotoSha256='1ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4';expiresAt=$script:Clock.AddHours(1).ToString('o');authorizationRef='fixture-owner-reference';wrapperSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();executorSha256='c4c1fed72a8059b1175aa1c33cb2644e8f937fc20873a99554477e586c0e3668';dependencySha256='1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64';outputDirectory=$script:Output}
  foreach($k in $Changes.Keys) {$e[$k]=$Changes[$k]}
  $path=Join-Path $root ([guid]::NewGuid().ToString('N')+'.json'); [IO.File]::WriteAllText($path,($e|ConvertTo-Json -Depth 20 -Compress),(New-Object Text.UTF8Encoding($false)))
  return @{EnvelopePath=$path;ExpectedEnvelopeSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();AuthorizationReference='fixture-owner-reference'}
}
try {
  Reset-Fixture; $args=Envelope; $checked=Invoke-Ai09FirstAccessNative @args
  Equal $checked.status 'VALIDATED_NETWORK_REQUEST_ONLY' ('default validation '+($checked|ConvertTo-Json -Compress)); Equal $script:AuthorityCalls 0 'default no native admin lookup'; Equal $script:Applies 0 'default no Apply'; Equal @(Get-ChildItem -LiteralPath $script:Output).Count 0 'default no writes'; Equal $checked.ownerApprovalVerified $false 'artifact is not approval issuer'
  $args.Mode='Execute'; $done=Invoke-Ai09FirstAccessNative @args
  Equal $done.status 'APPLIED_NETWORK_ONLY' ('single execution '+($done|ConvertTo-Json -Depth 20 -Compress)); Equal $script:Applies 1 'Apply invoked once'; Equal $script:Adds 1 'only one fake rule mutation'
  Equal $script:PassedPlan.baselineSha256 $done.baselineSha256 'fresh baseline pinned'; Equal $script:PassedPlan.authorizationRef 'fixture-owner-reference' 'external approval retained'; Equal $script:PassedPlan.guestAddressVerified $false 'candidate remains unverified'; Equal @($script:PassedPlan.PSObject.Properties).Count 21 'exact core schema'
  Equal $done.authenticatedConnectionVerified $false 'no SSH claim'; Equal $done.nativeAutomaticRuleExpiry $false 'no automatic TTL claim'; Equal $done.activationReady $false 'no verifier readiness claim'
  $receipt=[IO.File]::ReadAllText((Join-Path $script:Output 'receipt.json'))|ConvertFrom-Json; Equal $receipt.status 'APPLIED_NETWORK_ONLY' 'durable final receipt'
  Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'reuse refused'; Equal $script:Applies 1 'no repeated apply'
  foreach($change in @(@{action='Rollback'},@{guestAddress='172.27.140.253'},@{hostName='other'},@{candidateSource='KVP'},@{guestAddressVerified=$true},@{guestEndpointPhotoSha256=('0'*64)},@{wrapperSha256=('0'*64)},@{executorSha256=('0'*64)},@{dependencySha256=('0'*64)},@{expiresAt=$script:Clock.AddSeconds(-1).ToString('o')},@{expiresAt=$script:Clock.AddHours(25).ToString('o')},@{extraCommand='hostname'},@{issue=@(1219,1219)})) {
    Reset-Fixture; $args=Envelope $change; $args.Mode='Execute'; Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'invalid envelope refuses'; Equal $script:Applies 0 'invalid no Apply'; Equal @(Get-ChildItem -LiteralPath $script:Output).Count 0 'invalid no output'
  }
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $args.ExpectedEnvelopeSha256='0'*64; Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'external pin required'; Equal $script:Applies 0 'pin no Apply'
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $args.AuthorizationReference='other'; Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'external approval ref required'
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $script:NoAdmin=$true; Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'already native admin required'; Equal @(Get-ChildItem -LiteralPath $script:Output).Count 0 'admin refusal no files'
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $script:State.acls[0].RemotePort='9'; Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'fresh native drift refuses'; Equal $script:Applies 0 'drift no Apply'
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $script:State.acls+=@(New-Ai09FirstRule); Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' 'existing rule never reapproved'; Equal $script:Applies 0 'no duplicate Apply'
  foreach($file in @('intent.json','plan.json','journal.ndjson','receipt.json')) {
    Reset-Fixture; $args=Envelope; $args.Mode='Execute'; [IO.File]::WriteAllText((Join-Path $script:Output $file),'original')
    Equal (Invoke-Ai09FirstAccessNative @args).status 'BLOCKED' "existing output:$file"; Equal $script:Applies 0 'existing no Apply'; Equal ([IO.File]::ReadAllText((Join-Path $script:Output $file))) 'original' 'never overwrite output'
  }
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $script:BadResult=$true; Equal (Invoke-Ai09FirstAccessNative @args).status 'UNCERTAIN' 'unconfirmed core result is not PASS'
  Reset-Fixture; $args=Envelope; $args.Mode='Execute'; $script:ThrowApply=$true; Equal (Invoke-Ai09FirstAccessNative @args).status 'UNCERTAIN' 'interrupted core is not PASS'; Equal ([IO.File]::ReadAllText((Join-Path $script:Output 'receipt.json'))|ConvertFrom-Json).status 'UNCERTAIN' 'uncertain retained'
  Write-Output "AI09_FIRST_NATIVE_FIXTURES_PASS assertions=$script:Assertions : SOURCE_ONLY native boundaries mocked"
} finally {
  $resolved=[IO.Path]::GetFullPath($root)
  if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-native-fixture-*') {Remove-Item -LiteralPath $resolved -Recurse -Force}
}

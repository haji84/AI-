[CmdletBinding()]
param([ValidateSet('ValidateOnly','Execute')][string]$Mode='ValidateOnly',[string]$EnvelopePath,[string]$ExpectedEnvelopeSha256,[string]$AuthorizationReference)
# No elevation/server/queue/commands. Execute requires an existing native admin
# and an owner approval received OUTSIDE these artifacts. The SHA-pinned envelope
# authorizes exactly one fixed-rule attempt after fresh native guards; deriving
# the core plan supplies fresh evidence, never new authority. Execution expiry
# does not expire the Hyper-V rule. Separately approved exact rollback is required.
$ai09NativeArguments=@{}+$PSBoundParameters; $script:Ai09NativeSource=$PSCommandPath
$script:Ai09NativeCoreSha='fea386a38e421727134f44af15574c0bf5217bc70aa19291cbd82d7da09fb7cc'
$corePath=Join-Path $PSScriptRoot 'ai09-first-access-host.ps1'; $coreLock=[IO.File]::Open($corePath,'Open','Read','Read')
try {
  $h=[Security.Cryptography.SHA256]::Create()
  try {$actual=([BitConverter]::ToString($h.ComputeHash($coreLock))).Replace('-','').ToLowerInvariant()} finally {$h.Dispose()}
  if ($actual -cne $script:Ai09NativeCoreSha) {throw 'CORE_PIN_MISMATCH'}
  . $corePath
} finally {$coreLock.Dispose()}
function Get-Ai09NativeEnvelope($Path,$Expected,$Reference) {
  if ($Expected -cnotmatch '^[a-f0-9]{64}$' -or $Reference -notmatch '^[A-Za-z0-9:/#._-]{1,240}$') {throw 'EXTERNAL_OWNER_BINDING_REQUIRED'}
  $path=Get-Ai09SafePath $Path; $s=[IO.File]::Open($path,'Open','Read','Read'); try {$bytes=Read-Ai09Bytes $s 16384} finally {$s.Dispose()}
  if ((Get-Ai09ShaBytes $bytes) -cne $Expected) {throw 'ENVELOPE_PIN_MISMATCH'}
  $e=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)|ConvertFrom-Json
  Assert-Ai09Fields $e @('version','issue','action','hostName','vmId','nicMac','switchId','hostAddress','guestAddress','candidateSource','guestAddressVerified','guestEndpointPhotoSha256','expiresAt','authorizationRef','wrapperSha256','executorSha256','dependencySha256','outputDirectory')
  if (($e.version -isnot [int] -and $e.version -isnot [long]) -or ($e.issue -isnot [int] -and $e.issue -isnot [long]) -or $e.version -ne 1 -or $e.issue -ne 1219 -or $e.guestAddressVerified -isnot [bool] -or $e.guestAddressVerified) {throw 'ENVELOPE_SCOPE_INVALID'}
  $fixed=@{action='APPLY_ONLY_FIXED_TCP22';hostName='HAJI';vmId='453b139b-cceb-446e-99fb-f45bf5895436';nicMac='00155DDC2C00';switchId='c08cb7b8-9b3c-408e-8e30-5e16a3aeb444';hostAddress='172.27.128.1';guestAddress='172.27.140.254';candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestEndpointPhotoSha256='1ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4';authorizationRef=$Reference;executorSha256=$script:Ai09NativeCoreSha;dependencySha256=$script:Ai09FirstDependency}
  foreach($name in $fixed.Keys) {if ($e.$name -isnot [string] -or $e.$name -cne $fixed[$name]) {throw 'ENVELOPE_SCOPE_INVALID'}}
  if ($e.wrapperSha256 -isnot [string] -or $e.wrapperSha256 -cne (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($script:Ai09NativeSource))) -or (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($script:Ai09FirstSource))) -cne $script:Ai09NativeCoreSha -or (Get-Ai09ShaBytes ([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'ai09-access-host.ps1')))) -cne $script:Ai09FirstDependency) {throw 'SOURCE_PIN_MISMATCH'}
  $expires=Get-Ai09Timestamp $e.expiresAt; $now=Get-Ai09UtcNow
  if ($expires -le $now -or $expires -gt $now.AddHours(24)) {throw 'ENVELOPE_EXPIRED'}
  if ($e.outputDirectory -isnot [string] -or -not [IO.Directory]::Exists($e.outputDirectory)) {throw 'EXISTING_OUTPUT_DIRECTORY_REQUIRED'}
  $null=Get-Ai09SafePath $e.outputDirectory; return $e
}
function New-Ai09NativeJson($Path,$Value) {
  $path=Get-Ai09SafePath $Path; $s=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
  try {$b=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $Value)+"`n"); $s.Write($b,0,$b.Length); $s.Flush($true)} finally {$s.Dispose()}
}
function Invoke-Ai09FirstAccessNative {
  param([ValidateSet('ValidateOnly','Execute')]$Mode='ValidateOnly',$EnvelopePath,$ExpectedEnvelopeSha256,$AuthorizationReference)
  $ErrorActionPreference='Stop'; $receiptStream=$null; $attempted=$false
  try {
    $e=Get-Ai09NativeEnvelope $EnvelopePath $ExpectedEnvelopeSha256 $AuthorizationReference
    $result=[ordered]@{status='VALIDATED_NETWORK_REQUEST_ONLY';version=1;issue=1219;envelopeSha256=$ExpectedEnvelopeSha256;authorizationRef=$AuthorizationReference;ownerApprovalVerified=$false;executionPerformed=$false;candidateSource='OWNER_APPROVED_VM_NIC_ENDPOINT';guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false}
    if ($Mode -eq 'ValidateOnly') {return $result}
    $paths=@{}; foreach($name in @('intent.json','plan.json','journal.ndjson','receipt.json')) {
      $paths[$name]=Get-Ai09SafePath (Join-Path $e.outputDirectory $name)
      if (Test-Path -LiteralPath $paths[$name]) {throw 'OUTPUT_ALREADY_EXISTS'}
    }
    Assert-Ai09NativeAuthority
    $before=Invoke-Ai09FirstAccessHost -Mode Inspect
    if ($before.status -cne 'OBSERVED_NETWORK_ONLY') {throw 'FRESH_NATIVE_BASELINE_UNAVAILABLE'}
    Assert-Ai09FirstPolicy $before.baseline $false
    $null=Get-Ai09NativeEnvelope $EnvelopePath $ExpectedEnvelopeSha256 $AuthorizationReference
    New-Ai09NativeJson $paths['intent.json'] ([ordered]@{status='PREPARED';version=1;issue=1219;action=$e.action;envelopeSha256=$ExpectedEnvelopeSha256;authorizationRef=$AuthorizationReference;baselineSha256=$before.baselineSha256;observedAt=$before.observedAt})
    $plan=[ordered]@{version=1;issue=1219;profile='AI09_FIRST_ACCESS_TCP22_V1';action='Apply';hostName=$e.hostName;vmId=$e.vmId;nicMac=$e.nicMac;switchId=$e.switchId;hostAddress=$e.hostAddress;guestAddress=$e.guestAddress;candidateSource=$e.candidateSource;guestAddressVerified=$false;guestEndpointPhotoSha256=$e.guestEndpointPhotoSha256;expiresAt=$e.expiresAt;baselineObservedAt=$before.observedAt;baselineSha256=$before.baselineSha256;authorizationRef=$AuthorizationReference;executorSha256=$e.executorSha256;dependencySha256=$e.dependencySha256;permitPlanSha256='';journalSha256=''}
    New-Ai09NativeJson $paths['plan.json'] $plan
    $planSha=Get-Ai09ShaBytes ([IO.File]::ReadAllBytes($paths['plan.json']))
    $receiptStream=New-Object IO.FileStream($paths['receipt.json'],[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough)
    $null=Get-Ai09NativeEnvelope $EnvelopePath $ExpectedEnvelopeSha256 $AuthorizationReference
    $attempted=$true
    $core=Invoke-Ai09FirstAccessHost -Mode Apply -PlanPath $paths['plan.json'] -ExpectedPlanSha256 $planSha -AuthorizationReference $AuthorizationReference -JournalPath $paths['journal.ndjson']
    $result.status='UNCERTAIN'; $result.executionPerformed=$true; $result.planSha256=$planSha; $result.baselineSha256=$before.baselineSha256; $result.coreReceipt=$core
    if ($core.status -ceq 'BLOCKED') {$result.status='BLOCKED'}
    elseif ($core.status -ceq 'APPLIED_NETWORK_ONLY' -and $core.planSha256 -ceq $planSha -and $core.baselineSha256 -ceq $before.baselineSha256 -and $core.afterSha256 -cmatch '^[a-f0-9]{64}$' -and $core.guestAddressVerified -is [bool] -and -not $core.guestAddressVerified -and $core.authenticatedConnectionVerified -is [bool] -and -not $core.authenticatedConnectionVerified -and $core.activationReady -is [bool] -and -not $core.activationReady -and $core.nativeAutomaticRuleExpiry -is [bool] -and -not $core.nativeAutomaticRuleExpiry) {$result.status='APPLIED_NETWORK_ONLY'}
  } catch {
    $code=[string]$_.Exception.Message; if ($code -cnotmatch '^[A-Z][A-Z0-9_]{1,80}$') {$code='NATIVE_OR_IO_FAILURE'}
    $status='BLOCKED'; if ($attempted) {$status='UNCERTAIN'}
    $result=[ordered]@{status=$status;code=$code;version=1;issue=1219;envelopeSha256=$ExpectedEnvelopeSha256;executionPerformed=$attempted;ownerApprovalVerified=$false;guestAddressVerified=$false;authenticatedConnectionVerified=$false;activationReady=$false;nativeAutomaticRuleExpiry=$false}
  }
  if ($receiptStream) {
    try {$b=[Text.Encoding]::UTF8.GetBytes((Get-Ai09Json $result)+"`n"); $receiptStream.Write($b,0,$b.Length); $receiptStream.Flush($true)}
    catch {$result.status='UNCERTAIN'; $result.receiptWriteUnconfirmed=$true}
    finally {$receiptStream.Dispose()}
  }
  return $result
}
if ($MyInvocation.InvocationName -ne '.') {
  $result=Invoke-Ai09FirstAccessNative @ai09NativeArguments; $result|ConvertTo-Json -Depth 20
  if ($result.status -in @('VALIDATED_NETWORK_REQUEST_ONLY','APPLIED_NETWORK_ONLY')) {exit 0} else {exit 1}
}

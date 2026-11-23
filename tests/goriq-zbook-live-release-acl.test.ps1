$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$helper = Join-Path $PSScriptRoot '..\scripts\goriq-zbook-fixed-acl-repair.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($helper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'FIXED_HELPER_PARSE_FAILED' }
function Import-RepairFunction([string]$name) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
  if (-not $definition) { throw "FIXED_HELPER_FUNCTION_MISSING_$name" }
  . ([scriptblock]::Create(($definition.Extent.Text -replace '^function ', 'function script:')))
}
foreach ($name in @('Get-FixedTargets', 'Initialize-FixedNative', 'New-FixedDescriptor', 'Get-FixedHash',
    'Get-FixedRecord', 'Assert-FixedRecord', 'Open-FixedHandles', 'Close-FixedHandles',
    'Invoke-FixedTransition', 'Restore-FixedRecords', 'Claim-FixedApplyAttempt')) {
  Import-RepairFunction $name
}
Initialize-FixedNative
$nativeType = [GoriqFixedAclNative]
if (-not $nativeType.GetMethod('OpenDaclOnlyDirectory') -or -not $nativeType.GetMethod('ApplyDaclOnly')) {
  throw 'FIXED_HELPER_DACL_ONLY_INTERFACE_MISSING'
}
foreach ($name in @('Stop-FixedHost', 'Recover-FixedHost')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $true)
  $commands = @($definition.FindAll({
    param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Get-OwnedTree'
  }, $true))
  if (-not $commands.Count -or @($commands | Where-Object { $_.Extent.Text -notmatch '\s-preserveAdb\s' }).Count) {
    throw 'FIXED_HELPER_ADB_STOP_NOT_GUARDED'
  }
}
function Assert-FixedExpiry {}
$claim = Join-Path ([IO.Path]::GetTempPath()) ('goriq-live-release-claim-test-' + [guid]::NewGuid().ToString('N'))
$script:repairAttemptClaimed = $false
try {
  Claim-FixedApplyAttempt $claim ('a' * 40)
  $originalClaim = [IO.File]::ReadAllText($claim)
  if (-not $repairAttemptClaimed -or $originalClaim -notmatch '^a{40} ') { throw 'FIXTURE_CLAIM_MISSING' }
  $duplicateRefused = $false
  try { Claim-FixedApplyAttempt $claim ('b' * 40) }
  catch {
    if ($_.Exception.Message -cne 'APPLY_ATTEMPT_ALREADY_CLAIMED') { throw }
    $duplicateRefused = $true
  }
  if (-not $duplicateRefused -or [IO.File]::ReadAllText($claim) -cne $originalClaim) { throw 'FIXTURE_CLAIM_REUSED' }
} finally { [IO.File]::Delete($claim) }
Write-Output 'Fixed repair scoped native interface, stop guard wiring and one-shot claim PASS'
if ($env:OS -ne 'Windows_NT') { return }

function Read-Sddl([string]$path) {
  (Get-Acl -LiteralPath $path -Audit).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$readerSid = 'S-1-1-0'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('goriq-live-release-test-' + [guid]::NewGuid().ToString('N'))
$nativeCwd = [Environment]::CurrentDirectory
$script:handles = @()
$null = New-Item -ItemType Directory -Path $fixture
try {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($identity.User.Value, 'S-1-5-18')) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  }
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($readerSid)), 'ReadAndExecute,Synchronize', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier('S-1-5-21-1-2-3-1001')), 'WriteData', 'ContainerInherit,ObjectInherit', 'None', 'Deny')))
  $acl.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule(
    $identity.User, 'ReadData', 'ContainerInherit,ObjectInherit', 'None', 'Success')))
  Set-Acl -LiteralPath $fixture -AclObject $acl
  $targets = @(Get-FixedTargets $fixture)
  if ($targets.Count -ne 5 -or -not $targets[2].directory) { throw 'FIXTURE_SCOPE_MISMATCH' }
  foreach ($entry in $targets) {
    if ($entry.directory) { $null = New-Item -ItemType Directory -Path $entry.path }
    else { [IO.File]::WriteAllText($entry.path, 'disposable fixture bytes') }
    $owned = Get-Acl -LiteralPath $entry.path -Audit
    $owned.SetOwner($identity.User)
    Set-Acl -LiteralPath $entry.path -AclObject $owned
  }
  $child = Join-Path $targets[2].path 'node_modules'
  $null = New-Item -ItemType Directory -Path $child
  $sentinel = Join-Path $child 'fixture.txt'
  [IO.File]::WriteAllText($sentinel, 'unchanged child')
  $untouched = @($fixture, $child, $sentinel)
  $before = @{}
  foreach ($path in $untouched) { $before[$path] = Read-Sddl $path }
  $sentinelHash = (Get-FileHash -LiteralPath $sentinel).Hash
  $dependencyGuard = [GoriqFixedAclNative]::Open($child, $false, $true)
  try {
    [Environment]::CurrentDirectory = $targets[2].path
    $rejectedMaximum = $false
    try { Open-FixedHandles $true }
    catch {
      $failure = $_.Exception
      while ($failure.InnerException) { $failure = $failure.InnerException }
      if ($failure.Message -cne 'HANDLE_REJECTED_32') { throw }
      $rejectedMaximum = $true
    }
    if (-not $rejectedMaximum -or $handles.Count -ne 0) { throw 'FIXTURE_EXPECTED_SHARING_32' }
    Open-FixedHandles $true -DaclOnlyActiveRelease
    if ($handles.Count -ne 5) { throw 'FIXTURE_FIVE_HANDLES_REQUIRED' }

    $records = @(for ($i = 0; $i -lt 5; $i++) { Get-FixedRecord $targets[$i] $handles[$i] })
    $wanted = @(for ($i = 0; $i -lt 5; $i++) {
      New-FixedDescriptor $records[$i].descriptor $identity.User.Value $readerSid $targets[$i].directory -WithoutAutoInherited:($i -eq 2)
    })
    # Verify rollback after the third change as well as after the complete transaction.
    foreach ($changeCount in @(3, 5)) {
      for ($i = 0; $i -lt $changeCount; $i++) {
        Invoke-FixedTransition $targets[$i] $handles[$i] $records[$i] $wanted[$i] -DaclOnly:($i -eq 2)
      }
      foreach ($path in $untouched) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'FIXTURE_DESCENDANT_OR_ANCESTOR_CHANGED' } }
      Restore-FixedRecords $targets $handles $records $wanted -DaclOnlyActiveRelease
      for ($i = 0; $i -lt 5; $i++) { Assert-FixedRecord $records[$i] (Get-FixedRecord $targets[$i] $handles[$i]) }
      foreach ($path in $untouched) { if ((Read-Sddl $path) -cne $before[$path]) { throw 'FIXTURE_ROLLBACK_PROPAGATED' } }
    }
    if ((Get-FileHash -LiteralPath $sentinel).Hash -cne $sentinelHash) { throw 'FIXTURE_CHILD_BYTES_CHANGED' }
  } finally { $dependencyGuard.Dispose() }
  Write-Output 'Live release: Windows sharing 32, scoped five-object repair, partial and exact rollback PASS'
} finally {
  Close-FixedHandles
  [Environment]::CurrentDirectory = $nativeCwd
  Remove-Item -LiteralPath $fixture -Recurse -Force
}

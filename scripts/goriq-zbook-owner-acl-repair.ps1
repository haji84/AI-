param([switch]$OwnerApproved,[Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedRepairSha256)
# One-time same-Owner ACL narrowing. Never grants access or changes ownership.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval';$changed=$false;$restored=$false
$expires=[datetimeoffset]::Parse('2026-10-02T11:18:17Z')
function Test-KnownReadOnlyRights([long]$rights) {
  return ($rights -gt 0 -and ($rights -band (-bnot [long]0x1200A9)) -eq 0)
}
function Select-RepairCandidate([object[]]$facts) {
  $extra=@($facts | Where-Object {$_.accessType -eq 'Allow' -and -not $_.approvedPrincipal})
  if($extra.Count -ne 1){throw 'ACL_CANDIDATE_REJECTED'}
  $candidate=$extra[0]
  if($candidate.inherited -or -not $candidate.translatable -or $candidate.wellKnown -or
    -not $candidate.accountSid -or -not $candidate.sameAccountDomain -or $candidate.tokenMember -or
    -not $candidate.knownReadOnlyRights -or -not $candidate.containerInherit -or
    -not $candidate.objectInherit -or $candidate.inheritanceOnly){throw 'ACL_CANDIDATE_REJECTED'}
  return $candidate
}
function Assert-OwnedNative([string]$path,$identity) {
  $item=Get-Item -LiteralPath $path -ErrorAction Stop
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OWNER_BOUNDARY_REJECTED'}
  $owner=(Get-Acl -LiteralPath $path).Owner
  $ownerSid=if($owner -match '^S-1-'){([Security.Principal.SecurityIdentifier]$owner).Value}else{
    ([Security.Principal.NTAccount]$owner).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($ownerSid -ne $identity.User.Value){throw 'OWNER_BOUNDARY_REJECTED'}
}
function Get-RuleFacts($acl,$identity) {
  $tokenSids=@($identity.Groups | ForEach-Object {$_.Value})
  $facts=@()
  foreach($rule in $acl.Access){
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier])
    $wellKnown=$false
    foreach($name in [Enum]::GetNames([Security.Principal.WellKnownSidType])){
      try{
        $kind=[Enum]::Parse([Security.Principal.WellKnownSidType],$name)
        if($sid.IsWellKnown($kind)){$wellKnown=$true;break}
      }catch{}
    }
    $sameDomain=$false
    try{$sameDomain=$sid.IsAccountSid() -and $null -ne $identity.User.AccountDomainSid -and
      $sid.AccountDomainSid.Value -eq $identity.User.AccountDomainSid.Value}catch{}
    $translatable=$true
    try{$null=$sid.Translate([Security.Principal.NTAccount])}catch{$translatable=$false}
    $facts+=@{rule=$rule;accessType=[string]$rule.AccessControlType;
      approvedPrincipal=($sid.Value -in @($identity.User.Value,'S-1-5-18'));
      inherited=[bool]$rule.IsInherited;translatable=$translatable;wellKnown=$wellKnown;
      accountSid=[bool]$sid.IsAccountSid();sameAccountDomain=$sameDomain;
      tokenMember=($tokenSids -contains $sid.Value);
      knownReadOnlyRights=(Test-KnownReadOnlyRights ([long]$rule.FileSystemRights));
      containerInherit=[bool]($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit);
      objectInherit=[bool]($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit);
      inheritanceOnly=[bool]($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)}
  }
  return $facts
}
function Assert-StrictSurface([string]$path,$identity) {
  Assert-OwnedNative $path $identity
  foreach($fact in @(Get-RuleFacts (Get-Acl -LiteralPath $path) $identity)){
    if($fact.accessType -eq 'Allow' -and -not $fact.approvedPrincipal){throw 'ACL_VERIFICATION_FAILED'}
  }
}
try {
  if(-not $OwnerApproved){throw 'OWNER_APPROVAL_REQUIRED'}
  if([datetimeoffset]::UtcNow -ge $expires){throw 'SCOPE_EXPIRED'}
  if($ExpectedRepairSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedRepairSha256){
    throw 'REPAIR_ARTIFACT_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$'){throw 'SOURCE_REJECTED'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw 'OWNER_ADMIN_CONTEXT_REQUIRED'}
  $stage='source'
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&per_page=100') -TimeoutSec 15
  if($main.object.sha -ne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and
    $_.head_sha -eq $SourceRevision -and $_.status -eq 'completed' -and $_.conclusion -eq 'success'}).Count){
    throw 'EXACT_MAIN_CI_REQUIRED'}
  $stage='boundary'
  $root=Join-Path $env:USERPROFILE 'JARVIS'
  $production=Join-Path $root 'production'
  $releases=Join-Path $root 'releases'
  $oldRoot=Join-Path $releases 'ff761733c66f60a49e8c25c5ab0450a7a5e679c5'
  $config=Join-Path $production 'config.dpapi'
  $launcher=Join-Path $production 'launch-current.ps1'
  foreach($path in @($root,$production,$releases,$oldRoot,$config,$launcher)){
    Assert-OwnedNative $path $identity
  }
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  if($task.State -ne 'Running' -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password'){throw 'RUNTIME_BOUNDARY_REJECTED'}
  $rootAcl=Get-Acl -LiteralPath $root
  $originalSddl=$rootAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
  $candidate=Select-RepairCandidate @(Get-RuleFacts $rootAcl $identity)
  $stage='backup'
  $backupParent=Join-Path $production 'runtime-refresh'
  $backupRoot=Join-Path $backupParent $SourceRevision
  foreach($directory in @($backupParent,$backupRoot)){
    if(-not (Test-Path -LiteralPath $directory)){New-Item -ItemType Directory -Path $directory | Out-Null}
  }
  $backupPath=Join-Path $backupRoot 'jarvis-root-acl-before.dpapi'
  if(Test-Path -LiteralPath $backupPath){throw 'BACKUP_ALREADY_EXISTS'}
  $encrypted=$originalSddl | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
  [IO.File]::WriteAllText($backupPath,$encrypted,(New-Object Text.UTF8Encoding($false)))
  $stage='repair'
  $rootAcl.RemoveAccessRuleSpecific($candidate.rule)
  Set-Acl -LiteralPath $root -AclObject $rootAcl
  $changed=$true
  $stage='verify'
  $strict=$false
  for($attempt=0;$attempt -lt 20;$attempt++){
    try{
      foreach($path in @($root,$production,$releases,$oldRoot,$config,$launcher,$backupPath)){
        Assert-StrictSurface $path $identity
      }
      $strict=$true;break
    }catch{Start-Sleep -Milliseconds 250}
  }
  if(-not $strict){throw 'ACL_VERIFICATION_FAILED'}
  if((Get-ScheduledTask -TaskName 'JARVIS Remote Host').State -ne 'Running' -or
    @((Get-NetTCPConnection -State Listen -LocalPort @(3000,8787,8790,8792) -ErrorAction SilentlyContinue).LocalPort |
      Select-Object -Unique).Count -ne 4){throw 'RUNTIME_BOUNDARY_REJECTED'}
  @{version=1;issue=1662;goalIssue=1219;nodeId='zbook';
    permissionChange='remove-one-inherited-source-readonly-account-ace';sourceRevision=$SourceRevision;
    backupProtected=$true;removedPrincipalClass='same-domain-account-not-in-owner-token';
    affectedRootOnly=$true;strictSurfaces=7;runtimeUnchanged=$true;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
}catch{
  $known=@('OWNER_APPROVAL_REQUIRED','SCOPE_EXPIRED','REPAIR_ARTIFACT_REJECTED','SOURCE_REJECTED',
    'OWNER_ADMIN_CONTEXT_REQUIRED','EXACT_MAIN_CI_REQUIRED','OWNER_BOUNDARY_REJECTED',
    'RUNTIME_BOUNDARY_REJECTED','ACL_CANDIDATE_REJECTED','BACKUP_ALREADY_EXISTS','ACL_VERIFICATION_FAILED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'ACL_REPAIR_FAILED'}
  if($changed){
    try{
      $restore=Get-Acl -LiteralPath $root
      $restore.SetSecurityDescriptorSddlForm($originalSddl,[Security.AccessControl.AccessControlSections]::All)
      Set-Acl -LiteralPath $root -AclObject $restore
      $restored=((Get-Acl -LiteralPath $root).GetSecurityDescriptorSddlForm(
        [Security.AccessControl.AccessControlSections]::All) -ceq $originalSddl)
    }catch{$restored=$false}
  }
  @{version=1;issue=1662;nodeId='zbook';failedStage=$stage;failureReason=$reason;
    permissionChanged=$changed;restored=$restored;observedAt=[datetimeoffset]::UtcNow.ToString('o')} |
    ConvertTo-Json -Compress
  exit 1
}finally{$originalSddl=$null;$encrypted=$null;$candidate=$null}

param([ValidateSet('plan','apply')][string]$Phase='plan',[switch]$OwnerApproved,
  [Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedRepairSha256,
  [switch]$RecoverOriginalDacl,[string]$OriginalBaselinePath)
# #1662 approval5968751360: exactly two native production files, owner restoration only.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval';$changed=@();$backupPath=$null
function Select-RuntimeOwnerAction([string]$ownerSid,[string]$currentUserSid){
  if($ownerSid -ceq $currentUserSid){return 'none'}
  if($ownerSid -ceq 'S-1-5-32-544'){return 'restore'}
  throw 'OWNER_REJECTED'
}
function Restore-RuntimeFileOwner([string]$path,[Security.Principal.SecurityIdentifier]$owner){
  # Set-Acl with an empty descriptor drops explicit ACEs. Retain the actual
  # target descriptor before changing Owner, including its existing DACL.
  $acl=Get-Acl -LiteralPath $path
  $acl.SetOwner($owner)
  Set-Acl -LiteralPath $path -AclObject $acl
}
function Assert-ApprovedRuntimeDacl([string]$dacl,[Security.Principal.SecurityIdentifier]$owner){
  $raw=New-Object Security.AccessControl.RawSecurityDescriptor($dacl)
  if($null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -lt 1){throw 'ORIGINAL_DACL_REJECTED'}
  foreach($ace in $raw.DiscretionaryAcl){
    if($ace -isnot [Security.AccessControl.CommonAce] -or
      $ace.SecurityIdentifier.Value -notin @($owner.Value,'S-1-5-18') -or
      $ace.AceQualifier -notin @([Security.AccessControl.AceQualifier]::AccessAllowed,[Security.AccessControl.AceQualifier]::AccessDenied)){
      throw 'ORIGINAL_DACL_REJECTED'
    }
  }
}
function Restore-OriginalRuntimeDacl([string]$path,[Security.Principal.SecurityIdentifier]$owner,[string]$dacl){
  Assert-ApprovedRuntimeDacl $dacl $owner
  $acl=Get-Acl -LiteralPath $path
  $raw=New-Object Security.AccessControl.RawSecurityDescriptor($dacl)
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $owner.Value -or
    $acl.AreAccessRulesProtected -ne [bool]($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected)){
    throw 'ORIGINAL_DACL_REJECTED'
  }
  $acl.SetSecurityDescriptorSddlForm($dacl,[Security.AccessControl.AccessControlSections]::Access)
  Set-Acl -LiteralPath $path -AclObject $acl
}
function Assert-NativeBoundary([string]$path,[bool]$requireOwner){
  $item=Get-Item -LiteralPath $path
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PATH_REJECTED'}
  $acl=Get-Acl -LiteralPath $path
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if($requireOwner -and $owner -cne $identity.User.Value){throw 'OWNER_REJECTED'}
  if(@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($identity.User.Value,'S-1-5-18')
  }).Count){throw 'DACL_REJECTED'}
  return $acl
}
function Assert-Runtime{
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  $taskSid=[string]$task.Principal.UserId
  if($taskSid -notmatch '^S-1-'){$taskSid=([Security.Principal.NTAccount]$taskSid).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($taskSid -cne $identity.User.Value -or $task.State -ne 'Running' -or
    $task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Password'){throw 'TASK_REJECTED'}
  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  if($health.ok -ne $true -or @((Get-NetTCPConnection -State Listen -LocalPort @(3000,8787,8790,8792) -ErrorAction Stop).LocalPort | Select-Object -Unique).Count -ne 4){throw 'HEALTH_REJECTED'}
}
try{
  Write-Host 'OWNER_REPAIR_STAGE=approval'
  $now=[datetimeoffset]::UtcNow
  if($now -lt [datetimeoffset]::Parse('2026-10-03T11:31:58Z') -or
    $now -ge [datetimeoffset]::Parse('2026-10-04T11:31:58Z') -or
    ($Phase -eq 'apply' -and -not $OwnerApproved)){throw 'APPROVAL_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$' -or
    $ExpectedRepairSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedRepairSha256){throw 'ARTIFACT_REJECTED'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $stage='source';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&per_page=100') -TimeoutSec 15
  if($main.object.sha -cne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and
    $_.head_sha -eq $SourceRevision -and $_.status -eq 'completed' -and $_.conclusion -eq 'success'
  }).Count){throw 'MAIN_CI_REJECTED'}
  $stage='boundary';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
  $root=Join-Path $env:USERPROFILE 'JARVIS'
  $production=Join-Path $root 'production'
  if((Get-Item -LiteralPath $env:USERPROFILE).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PATH_REJECTED'}
  $null=Assert-NativeBoundary $root $true
  $null=Assert-NativeBoundary $production $true
  $paths=@((Join-Path $production 'config.dpapi'),(Join-Path $production 'launch-current.ps1'))
  $labels=@('protected-config','native-launcher');$baseline=@()
  for($i=0;$i -lt 2;$i++){
    if(-not (Get-Item -LiteralPath $paths[$i]).PSIsContainer){
      $acl=Assert-NativeBoundary $paths[$i] $false
    }else{throw 'PATH_REJECTED'}
    $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $baseline+=@{surface=$labels[$i];path=$paths[$i];owner=$owner;action=(Select-RuntimeOwnerAction $owner $identity.User.Value);
      hash=(Get-FileHash -LiteralPath $paths[$i] -Algorithm SHA256).Hash;
      dacl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)}
  }
  $backupSnapshot=$baseline | ConvertTo-Json -Depth 5 -Compress
  foreach($entry in $baseline){$entry.currentDacl=$entry.dacl}
  if($RecoverOriginalDacl){
    $stage='original-baseline';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
    if(-not $OriginalBaselinePath){throw 'ORIGINAL_BASELINE_REJECTED'}
    $originalPath=[IO.Path]::GetFullPath($OriginalBaselinePath)
    if([IO.Path]::GetDirectoryName($originalPath) -ine $production -or
      [IO.Path]::GetFileName($originalPath) -notmatch '^runtime-owner-before-[a-f0-9]{32}\.dpapi$'){
      throw 'ORIGINAL_BASELINE_REJECTED'
    }
    $null=Assert-NativeBoundary $originalPath $true
    $originalSecure=ConvertTo-SecureString ([IO.File]::ReadAllText($originalPath))
    $originalEntries=((New-Object Management.Automation.PSCredential('original',$originalSecure)).GetNetworkCredential().Password) | ConvertFrom-Json
    if($originalEntries -isnot [array] -or $originalEntries.Count -ne 2){throw 'ORIGINAL_BASELINE_COUNT_REJECTED'}
    foreach($entry in $baseline){
      $matches=@($originalEntries | Where-Object {$_.surface -ceq $entry.surface -and $_.path -ieq $entry.path})
      if($matches.Count -ne 1){throw 'ORIGINAL_BASELINE_MAPPING_REJECTED'}
      if($matches[0].owner -cne 'S-1-5-32-544' -or $matches[0].action -cne 'restore'){throw 'ORIGINAL_BASELINE_PROVENANCE_REJECTED'}
      if($matches[0].hash -cne $entry.hash){throw 'ORIGINAL_BASELINE_CONTENT_REJECTED'}
      if($entry.owner -cne $identity.User.Value){throw 'ORIGINAL_BASELINE_CURRENT_OWNER_REJECTED'}
      Assert-ApprovedRuntimeDacl $matches[0].dacl $identity.User
      $originalRaw=New-Object Security.AccessControl.RawSecurityDescriptor($matches[0].dacl)
      $liveAcl=Get-Acl -LiteralPath $entry.path
      if($liveAcl.AreAccessRulesProtected -ne [bool]($originalRaw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected)){
        throw 'ORIGINAL_BASELINE_PROTECTION_REJECTED'
      }
      $entry.dacl=$matches[0].dacl
      $entry.action=if($entry.currentDacl -ceq $entry.dacl){'none'}else{'restore-dacl'}
    }
    $originalSecure=$null;$originalEntries=$null
  }
  # Inspect the unchanged current release too: diagnostic, not repair authority.
  $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($paths[0]).Trim())
  $configuration=((New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password) | ConvertFrom-Json
  if($configuration.commit -notmatch '^[a-f0-9]{40}$' -or
    [IO.Path]::GetFullPath($configuration.releaseRoot) -ine (Join-Path $root ('releases\'+$configuration.commit))){throw 'PATH_REJECTED'}
  $releaseAcl=Assert-NativeBoundary $configuration.releaseRoot $false
  $releaseOwner=$releaseAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $releaseOwnerClass=if($releaseOwner -ceq $identity.User.Value){'current-user'}elseif($releaseOwner -ceq 'S-1-5-32-544'){'administrators'}else{'other'}
  $configuration=$null;$secure=$null
  Assert-Runtime
  $taskXml=Export-ScheduledTask -TaskName 'JARVIS Remote Host'
  if($Phase -eq 'apply'){
    $stage='backup';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
    # Unique host-local DPAPI baseline, no existing backup overwritten.
    $backupPath=Join-Path $production ('runtime-owner-before-'+[guid]::NewGuid().ToString('N')+'.dpapi')
    $encrypted=$backupSnapshot | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
    $stream=New-Object IO.FileStream($backupPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $stream.Dispose()
    Restore-RuntimeFileOwner $backupPath $identity.User
    $null=Assert-NativeBoundary $backupPath $true
    [IO.File]::WriteAllText($backupPath,$encrypted,(New-Object Text.UTF8Encoding($false)))
    $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($backupPath))
    $plain=(New-Object Management.Automation.PSCredential('baseline',$secure)).GetNetworkCredential().Password
    if($plain -cne $backupSnapshot){throw 'BACKUP_REJECTED'}
    $plain=$null;$secure=$null;$encrypted=$null
    $stage='restore';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
    foreach($entry in $baseline){
      $acl=Assert-NativeBoundary $entry.path $false
      if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $entry.owner -or
        $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $entry.currentDacl -or
        (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -cne $entry.hash){throw 'BASELINE_CHANGED'}
      if($entry.action -eq 'restore'){
        Restore-RuntimeFileOwner $entry.path $identity.User
        $changed+=($entry.surface)
      }elseif($entry.action -eq 'restore-dacl'){
        Restore-OriginalRuntimeDacl $entry.path $identity.User $entry.dacl
        $changed+=($entry.surface)
      }
    }
    $stage='verify';Write-Host ('OWNER_REPAIR_STAGE='+$stage)
    foreach($entry in $baseline){
      $acl=Assert-NativeBoundary $entry.path $true
      if($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $entry.dacl -or
        (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -cne $entry.hash){throw 'VERIFICATION_FAILED'}
    }
    Assert-Runtime
    if((Export-ScheduledTask -TaskName 'JARVIS Remote Host') -cne $taskXml){throw 'VERIFICATION_FAILED'}
  }
  Write-Host 'OWNER_REPAIR_STAGE=complete'
  @{version=1;issue=1662;goalIssue=1219;nodeId='zbook';phase=$Phase;sourceRevision=$SourceRevision;readOnly=($Phase -eq 'plan');
    verified=$true;ownersRestored=($Phase -eq 'apply');originalDaclRecovery=[bool]$RecoverOriginalDacl;contentsPreserved=$true;daclPreserved=$true;taskUnchanged=$true;
    currentReleaseOwnerClass=$releaseOwnerClass;changedSurfaces=$changed;observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 -Compress
}catch{
  $known=@('OWNER_REJECTED','PATH_REJECTED','DACL_REJECTED','TASK_REJECTED','HEALTH_REJECTED','APPROVAL_REJECTED',
    'ORIGINAL_DACL_REJECTED','ORIGINAL_BASELINE_REJECTED','ORIGINAL_BASELINE_COUNT_REJECTED',
    'ORIGINAL_BASELINE_MAPPING_REJECTED','ORIGINAL_BASELINE_PROVENANCE_REJECTED','ORIGINAL_BASELINE_CONTENT_REJECTED',
    'ORIGINAL_BASELINE_CURRENT_OWNER_REJECTED','ORIGINAL_BASELINE_PROTECTION_REJECTED','ARTIFACT_REJECTED','ADMIN_REQUIRED','MAIN_CI_REJECTED','BACKUP_REJECTED','BASELINE_CHANGED','VERIFICATION_FAILED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'OWNER_REPAIR_FAILED'}
  @{version=1;issue=1662;nodeId='zbook';phase=$Phase;failedStage=$stage;failureReason=$reason;verified=$false;
    changedSurfaces=$changed;backupRetained=($null -ne $backupPath);observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 -Compress
  exit 1
}finally{$baseline=$null;$encrypted=$null;$plain=$null;$secure=$null}

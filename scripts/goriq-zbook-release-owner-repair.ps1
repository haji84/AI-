param([ValidateSet('plan','apply')][string]$Phase='plan',[switch]$OwnerApproved,
  [Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedRepairSha256)
# #1662 approval5969709096: ONE fixed release directory, Owner ONLY, no recursion.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval';$changed=$false;$backupPath=$null;$restored=$false
function Assert-ReleaseOwnerAction([string]$ownerSid,[string]$currentUserSid){
  if($ownerSid -cne $currentUserSid -and $ownerSid -cne 'S-1-5-32-544'){throw 'OWNER_REJECTED'}
}
function Restore-ReleaseDirectoryOwner([string]$path,[Security.Principal.SecurityIdentifier]$owner){
  if(-not ('GoriqDirectoryOwnerNative' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GoriqDirectoryOwnerNative {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
  public static extern uint SetNamedSecurityInfoW(string path, uint objectType,
    uint securityInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
}
'@
  }
  $bytes=New-Object byte[] $owner.BinaryLength
  $owner.GetBinaryForm($bytes,0)
  $pointer=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try{
    [Runtime.InteropServices.Marshal]::Copy($bytes,0,$pointer,$bytes.Length)
    # SE_FILE_OBJECT=1; OWNER_SECURITY_INFORMATION=1 ONLY. No ACL propagation.
    $result=[GoriqDirectoryOwnerNative]::SetNamedSecurityInfoW($path,1,1,$pointer,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
    if($result -ne 0){throw 'OWNER_WRITE_FAILED'}
  }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)}
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
  Write-Host 'RELEASE_OWNER_STAGE=approval'
  $now=[datetimeoffset]::UtcNow
  if($now -lt [datetimeoffset]::Parse('2026-10-03T13:38:22Z') -or
    $now -ge [datetimeoffset]::Parse('2026-10-04T13:38:22Z') -or
    ($Phase -eq 'apply' -and -not $OwnerApproved)){throw 'APPROVAL_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$' -or
    $ExpectedRepairSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedRepairSha256){throw 'ARTIFACT_REJECTED'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $stage='source';Write-Host ('RELEASE_OWNER_STAGE='+$stage)
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&per_page=100') -TimeoutSec 15
  if($main.object.sha -cne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and
    $_.head_sha -eq $SourceRevision -and $_.status -eq 'completed' -and $_.conclusion -eq 'success'
  }).Count){throw 'MAIN_CI_REJECTED'}
  $stage='boundary';Write-Host ('RELEASE_OWNER_STAGE='+$stage)
  $root=Join-Path $env:USERPROFILE 'JARVIS'
  $production=Join-Path $root 'production'
  $releases=Join-Path $root 'releases'
  if((Get-Item -LiteralPath $env:USERPROFILE).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PATH_REJECTED'}
  foreach($parent in @($root,$production,$releases)){
    if(-not (Get-Item -LiteralPath $parent).PSIsContainer){throw 'PATH_REJECTED'}
    $null=Assert-NativeBoundary $parent $true
  }
  $configPath=Join-Path $production 'config.dpapi'
  $launcherPath=Join-Path $production 'launch-current.ps1'
  $fileBaseline=@()
  foreach($file in @($configPath,$launcherPath)){
    if((Get-Item -LiteralPath $file).PSIsContainer){throw 'PATH_REJECTED'}
    $acl=Assert-NativeBoundary $file $true
    $fileBaseline+=@{path=$file;hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;
      security=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access)}
  }
  $secure=ConvertTo-SecureString ([IO.File]::ReadAllText($configPath).Trim())
  $configuration=((New-Object Management.Automation.PSCredential('config',$secure)).GetNetworkCredential().Password) | ConvertFrom-Json
  $approvedRelease='0eca8f701877d3176114b09c1540b550359f6fdf'
  $release=Join-Path $releases $approvedRelease
  if($configuration.version -ne 1 -or $configuration.commit -cne $approvedRelease -or
    [IO.Path]::GetFullPath($configuration.releaseRoot) -ine $release){throw 'RELEASE_BINDING_REJECTED'}
  $secure=$null;$configuration=$null
  if(-not (Get-Item -LiteralPath $release).PSIsContainer){throw 'PATH_REJECTED'}
  $releaseAcl=Assert-NativeBoundary $release $false
  $beforeOwner=$releaseAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  Assert-ReleaseOwnerAction $beforeOwner $identity.User.Value
  $beforeDacl=$releaseAcl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
  $manifest=Get-Content -LiteralPath (Join-Path $release 'jarvis-release.json') -Raw | ConvertFrom-Json
  if($manifest.commit -cne $approvedRelease){throw 'RELEASE_BINDING_REJECTED'}
  Assert-Runtime
  $taskXml=Export-ScheduledTask -TaskName 'JARVIS Remote Host'
  if($Phase -eq 'apply' -and $beforeOwner -cne $identity.User.Value){
    $stage='backup';Write-Host ('RELEASE_OWNER_STAGE='+$stage)
    $backupPath=Join-Path $production ('release-owner-before-'+[guid]::NewGuid().ToString('N')+'.dpapi')
    $stream=New-Object IO.FileStream($backupPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $stream.Dispose()
    $backupAcl=Get-Acl -LiteralPath $backupPath
    $backupAcl.SetOwner($identity.User)
    Set-Acl -LiteralPath $backupPath -AclObject $backupAcl
    $null=Assert-NativeBoundary $backupPath $true
    $snapshot=@{version=1;issue=1662;release=$approvedRelease;owner=$beforeOwner;dacl=$beforeDacl;sourceRevision=$SourceRevision;observedAt=$now.ToString('o')} | ConvertTo-Json -Compress
    $encoded=$snapshot | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
    [IO.File]::WriteAllText($backupPath,$encoded,(New-Object Text.UTF8Encoding($false)))
    $stage='restore';Write-Host ('RELEASE_OWNER_STAGE='+$stage)
    $live=Assert-NativeBoundary $release $false
    if($live.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $beforeOwner -or
      $live.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $beforeDacl){throw 'BASELINE_CHANGED'}
    foreach($file in $fileBaseline){
      $acl=Assert-NativeBoundary $file.path $true
      if((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash -cne $file.hash -or
        $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access) -cne $file.security){throw 'BASELINE_CHANGED'}
    }
    if((Export-ScheduledTask -TaskName 'JARVIS Remote Host') -cne $taskXml){throw 'BASELINE_CHANGED'}
    Assert-Runtime
    Restore-ReleaseDirectoryOwner $release $identity.User
    $changed=$true
  }
  $stage='verify';Write-Host ('RELEASE_OWNER_STAGE='+$stage)
  $after=Assert-NativeBoundary $release ($Phase -eq 'apply')
  $expectedOwner=if($Phase -eq 'apply'){$identity.User.Value}else{$beforeOwner}
  if($after.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $expectedOwner -or
    $after.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -cne $beforeDacl){throw 'VERIFICATION_FAILED'}
  foreach($file in $fileBaseline){
    $acl=Assert-NativeBoundary $file.path $true
    if((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash -cne $file.hash -or
      $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access) -cne $file.security){throw 'VERIFICATION_FAILED'}
  }
  if((Export-ScheduledTask -TaskName 'JARVIS Remote Host') -cne $taskXml){throw 'VERIFICATION_FAILED'}
  Assert-Runtime
  Write-Host 'RELEASE_OWNER_STAGE=complete'
  @{version=1;issue=1662;goalIssue=1219;nodeId='zbook';phase=$Phase;sourceRevision=$SourceRevision;
    releaseRevision=$approvedRelease;verified=$true;readOnly=($Phase -eq 'plan');ownerRestored=($Phase -eq 'apply');
    changedSurfaces=@(if($changed){'current-release-directory'});daclPreserved=$true;
    productionFilesPreserved=$true;taskUnchanged=$true;healthOk=$true;recursive=$false;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 4 -Compress
}catch{
  # Only the original Owner may be restored; never write/propagate DACL or touch children.
  if($changed){
    try{
      Restore-ReleaseDirectoryOwner $release (New-Object Security.Principal.SecurityIdentifier($beforeOwner))
      $rollback=Get-Acl -LiteralPath $release
      $restored=($rollback.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $beforeOwner -and
        $rollback.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access) -ceq $beforeDacl)
    }catch{$restored=$false}
  }
  $known=@('APPROVAL_REJECTED','ARTIFACT_REJECTED','ADMIN_REQUIRED','MAIN_CI_REJECTED','PATH_REJECTED','OWNER_REJECTED',
    'DACL_REJECTED','TASK_REJECTED','HEALTH_REJECTED','RELEASE_BINDING_REJECTED','BASELINE_CHANGED','OWNER_WRITE_FAILED','VERIFICATION_FAILED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'RELEASE_OWNER_REPAIR_FAILED'}
  @{version=1;issue=1662;nodeId='zbook';phase=$Phase;failedStage=$stage;failureReason=$reason;
    verified=$false;permissionChanged=$changed;restored=$restored;backupRetained=($null -ne $backupPath);
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}finally{$secure=$null;$configuration=$null;$snapshot=$null;$encoded=$null}

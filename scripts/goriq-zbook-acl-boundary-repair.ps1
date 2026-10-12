param([ValidateSet('plan','apply')][string]$Phase='plan',[switch]$OwnerApproved,
  [Parameter(Mandatory=$true)][string]$SourceRevision,
  [Parameter(Mandatory=$true)][string]$ExpectedRepairSha256)
# #1662/#1787: owner approval6124098637; only two directory inheritance boundaries.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$stage='approval';$changed=$false;$restored=$false;$backupId=$null;$snapshot=$null
$sections=[Security.AccessControl.AccessControlSections]::All
function Import-AclPredicates([string]$source) {
  # Reuse selectors, not the expired historical root-repair entry point.
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
  if($errors.Count){throw 'SOURCE_REJECTED'}
  foreach($name in @('Test-KnownReadOnlyRights','Get-RuleFacts','Assert-OwnedNative','Select-RepairCandidate')){
    $definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
    if($null -eq $definition){throw 'SOURCE_REJECTED'}
    # Install only these named functions in script scope.
    Invoke-Expression ($definition.Extent.Text.Replace(('function '+$name),('function script:'+$name)))
  }
}
function Assert-BoundaryReader([object[]]$facts,[string]$reader,[bool]$protected) {
  $extra=@($facts | Where-Object {$_.accessType -eq 'Allow' -and -not $_.approvedPrincipal})
  if($protected -or $extra.Count -ne 1){throw 'BOUNDARY_REJECTED'}
  $fact=$extra[0]
  if($fact.sidValue -cne $reader -or -not $fact.inherited -or $fact.rights -ne 0x1200A9 -or
    -not $fact.containerInherit -or -not $fact.objectInherit -or $fact.inheritanceOnly){throw 'BOUNDARY_REJECTED'}
}
function Assert-SameSnapshot([object[]]$before,[object[]]$after) {
  if($before.Count -ne $after.Count){throw 'BASELINE_CHANGED'}
  for($i=0;$i -lt $before.Count;$i++){
    if($before[$i].path -cne $after[$i].path -or $before[$i].descriptor -cne $after[$i].descriptor -or
      $before[$i].directory -ne $after[$i].directory -or $before[$i].identity -cne $after[$i].identity){throw 'BASELINE_CHANGED'}
  }
}
function Write-BoundaryBackup([string]$path,[string]$plain) {
  Add-Type -AssemblyName System.Security
  # Raw CurrentUser DPAPI handles large tree baselines; SecureString has a size limit.
  $bytes=[Text.Encoding]::UTF8.GetBytes($plain)
  $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $stream=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($encrypted,0,$encrypted.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  $decoded=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path),$null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser)
  if([Text.Encoding]::UTF8.GetString($decoded) -cne $plain){throw 'BACKUP_REJECTED'}
}
function Initialize-BoundaryFileInfo {
  if('GoriqBoundaryFileInfo' -as [type]){return}
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class GoriqBoundaryFileInfo {
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
    public System.Runtime.InteropServices.ComTypes.FILETIME Access;
    public System.Runtime.InteropServices.ComTypes.FILETIME Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security,
    uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  public static Info Read(string path) {
    using (var handle=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
      Info info;
      if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info)) throw new Exception("FILE_INFO_REJECTED");
      return info;
    }
  }
}
'@
}
function New-BoundaryDacl($acl,[string]$reader) {
  if($acl.AreAccessRulesProtected){throw 'BOUNDARY_REJECTED'}
  $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ceq $reader})
  if($rules.Count -ne 1 -or -not $rules[0].IsInherited -or [long]$rules[0].FileSystemRights -ne 0x1200A9 -or
    [string]$rules[0].InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or
    [string]$rules[0].PropagationFlags -ne 'None'){throw 'BOUNDARY_REJECTED'}
  # On PowerShell5.1, preserveInheritance=true leaves in-memory ACEs marked
  # inherited until persisted. Convert them explicitly before selecting removal.
  $inherited=@($acl.GetAccessRules($false,$true,[Security.Principal.SecurityIdentifier]))
  $acl.SetAccessRuleProtection($true,$false)
  foreach($rule in $inherited){
    $copy=New-Object Security.AccessControl.FileSystemAccessRule($rule.IdentityReference,
      $rule.FileSystemRights,$rule.InheritanceFlags,$rule.PropagationFlags,$rule.AccessControlType)
    $acl.AddAccessRule($copy)
  }
  $explicit=@($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]) | Where-Object {
    $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ceq $reader})
  if($explicit.Count -ne 1){throw 'BOUNDARY_REJECTED'}
  $acl.RemoveAccessRuleSpecific($explicit[0])
  return $acl
}
function Get-BoundarySnapshot([string[]]$roots) {
  Initialize-BoundaryFileInfo
  $records=New-Object 'Collections.Generic.List[object]'
  $pending=New-Object 'Collections.Generic.Stack[string]'
  foreach($root in $roots){$pending.Push($root)}
  while($pending.Count){
    $path=$pending.Pop()
    $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
    # Never traverse or alter a junction/symlink or its target.
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_REJECTED'}
    $info=[GoriqBoundaryFileInfo]::Read($path)
    if($info.Attributes -band 0x400){throw 'REPARSE_REJECTED'}
    if(-not $item.PSIsContainer -and $info.Links -ne 1){throw 'HARDLINK_REJECTED'}
    $acl=Get-Acl -LiteralPath $path -Audit -ErrorAction Stop
    $records.Add([pscustomobject]@{path=$path;directory=[bool]$item.PSIsContainer;
      identity=('{0}:{1}:{2}' -f $info.Volume,$info.IndexHigh,$info.IndexLow);
      descriptor=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)})
    if($records.Count -gt 200000){throw 'SNAPSHOT_LIMIT'}
    if($item.PSIsContainer){
      foreach($child in @(Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop)){$pending.Push($child.FullName)}
    }
  }
  return @($records | Sort-Object -Property path)
}
function Restore-BoundaryBaseline([object[]]$baseline,[string[]]$roots) {
  # Restore the two changed boundaries first; descendants should regain inheritance.
  foreach($root in $roots){
    $entry=@($baseline | Where-Object {$_.path -ceq $root})
    if($entry.Count -ne 1){throw 'RESTORE_REJECTED'}
    $item=Get-Item -LiteralPath $root -Force -ErrorAction Stop
    Assert-BoundaryIdentity $root $entry[0]
    $acl=Get-Acl -LiteralPath $root
    $acl.SetSecurityDescriptorSddlForm($entry[0].descriptor,[Security.AccessControl.AccessControlSections]::Access)
    Set-Acl -LiteralPath $root -AclObject $acl
  }
  # No explicit child ACL write. Restoration must match the captured entire trees.
  Assert-SameSnapshot $baseline (Get-BoundarySnapshot $roots)
}
function Assert-BoundaryIdentity([string]$path,$entry) {
  $item=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'BOUNDARY_REJECTED'}
  $info=[GoriqBoundaryFileInfo]::Read($path)
  if(($info.Attributes -band 0x400) -or ('{0}:{1}:{2}' -f $info.Volume,$info.IndexHigh,$info.IndexLow) -cne $entry.identity){throw 'BASELINE_CHANGED'}
}
function Get-ExpectedSnapshot([object[]]$baseline,[string[]]$roots,[string]$reader) {
  $descriptors=@{}
  foreach($entry in $baseline){$descriptors[$entry.path]=$entry.descriptor}
  $expected=@()
  foreach($entry in $baseline){
    $acl=if($entry.directory){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
    $acl.SetSecurityDescriptorSddlForm($entry.descriptor,$sections)
    if($roots -ccontains $entry.path){$acl=New-BoundaryDacl $acl $reader}else{
      # Protected descendants stop propagation, including all children below them.
      $reachable=-not $acl.AreAccessRulesProtected
      $parent=[IO.Path]::GetDirectoryName($entry.path)
      while($reachable -and $roots -cnotcontains $parent){
        if(-not $descriptors.ContainsKey($parent)){throw 'BOUNDARY_REJECTED'}
        $parentRaw=New-Object Security.AccessControl.RawSecurityDescriptor($descriptors[$parent])
        if($parentRaw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected){$reachable=$false;break}
        $parent=[IO.Path]::GetDirectoryName($parent)
      }
      if(-not $reachable){
        $expected+=[pscustomobject]@{path=$entry.path;directory=$entry.directory;identity=$entry.identity;descriptor=$entry.descriptor}
        continue
      }
      if(@($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]) | Where-Object {
        $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ceq $reader}).Count){throw 'BOUNDARY_REJECTED'}
      foreach($rule in @($acl.GetAccessRules($false,$true,[Security.Principal.SecurityIdentifier]))){
        if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ceq $reader){
          # Remove an inherited ACE in the expected descriptor only; never write it.
          $raw=New-Object Security.AccessControl.RawSecurityDescriptor($entry.descriptor)
          for($i=$raw.DiscretionaryAcl.Count-1;$i -ge 0;$i--){
            $ace=$raw.DiscretionaryAcl[$i]
            if($ace -is [Security.AccessControl.CommonAce] -and
              $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
              ($ace.AceFlags -band [Security.AccessControl.AceFlags]::Inherited) -and
              $ace.SecurityIdentifier.Value -ceq $reader){$raw.DiscretionaryAcl.RemoveAce($i)}
          }
          $acl.SetSecurityDescriptorSddlForm($raw.GetSddlForm($sections),$sections)
          break
        }
      }
    }
    $expected+=[pscustomobject]@{path=$entry.path;directory=$entry.directory;identity=$entry.identity;descriptor=$acl.GetSecurityDescriptorSddlForm($sections)}
  }
  return $expected
}
function Assert-RuntimeUnchanged {
  if((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -cne $configHash -or
    (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash -cne $launcherHash -or
    (Export-ScheduledTask -TaskName 'JARVIS Remote Host') -cne $taskXml){throw 'RUNTIME_CHANGED'}
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  if($task.State -ne 'Running'){throw 'RUNTIME_CHANGED'}
  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
  if($health.ok -ne $true){throw 'RUNTIME_CHANGED'}
}
function Assert-AncestorsUnchanged {
  if((Get-Acl -LiteralPath $root -Audit).GetSecurityDescriptorSddlForm($sections) -cne $ancestorBefore -or
    (Get-Acl -LiteralPath $env:USERPROFILE -Audit).GetSecurityDescriptorSddlForm($sections) -cne $profileBefore){throw 'ANCESTOR_CHANGED'}
}
try {
  $now=[datetimeoffset]::UtcNow
  if($now -lt [datetimeoffset]::Parse('2026-10-12T12:15:19Z') -or
    $now -ge [datetimeoffset]::Parse('2026-10-13T11:12:13.845Z') -or
    ($Phase -eq 'apply' -and -not $OwnerApproved)){throw 'APPROVAL_REJECTED'}
  if($env:OS -ne 'Windows_NT' -or $SourceRevision -notmatch '^[a-f0-9]{40}$' -or
    $ExpectedRepairSha256 -notmatch '^[a-f0-9]{64}$' -or
    (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedRepairSha256){throw 'ARTIFACT_REJECTED'}
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMIN_REQUIRED'}
  $stage='source';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
  $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $head=(& git -C $repository rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $SourceRevision){throw 'SOURCE_REJECTED'}
  foreach($relative in @('scripts/goriq-zbook-acl-boundary-repair.ps1','scripts/goriq-zbook-owner-acl-repair.ps1')){
    $expectedBlob=(& git -C $repository rev-parse ($SourceRevision+':'+$relative)).Trim()
    if($LASTEXITCODE -ne 0){throw 'SOURCE_REJECTED'}
    $actualBlob=(& git -C $repository hash-object ('--path='+$relative) (Join-Path $repository $relative)).Trim()
    if($LASTEXITCODE -ne 0 -or $actualBlob -cne $expectedBlob){throw 'SOURCE_REJECTED'}
  }
  $main=Invoke-RestMethod -Uri 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main' -TimeoutSec 15
  $runs=Invoke-RestMethod -Uri ('https://api.github.com/repos/haji84/AI-/actions/runs?head_sha='+$SourceRevision+'&event=push&per_page=100') -TimeoutSec 15
  if($main.object.sha -cne $SourceRevision -or -not @($runs.workflow_runs | Where-Object {
    $_.name -eq 'CI' -and $_.event -eq 'push' -and $_.head_branch -eq 'main' -and
    $_.head_sha -eq $SourceRevision -and $_.status -eq 'completed' -and $_.conclusion -eq 'success'}).Count){throw 'MAIN_CI_REQUIRED'}
  Import-AclPredicates (Join-Path $PSScriptRoot 'goriq-zbook-owner-acl-repair.ps1')
  $stage='boundary';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
  $root=Join-Path $env:USERPROFILE 'JARVIS'
  $production=Join-Path $root 'production';$releases=Join-Path $root 'releases'
  $roots=@($production,$releases)
  $oldRoot=Join-Path $releases 'a49c458d69a28c0266be8fcad5b26253e5ed8d75'
  $config=Join-Path $production 'config.dpapi';$launcher=Join-Path $production 'launch-current.ps1'
  foreach($path in @($env:USERPROFILE,$root,$production,$releases,$oldRoot,$config,$launcher)){
    Assert-OwnedNative $path $identity
  }
  $ancestorBefore=(Get-Acl -LiteralPath $root -Audit).GetSecurityDescriptorSddlForm($sections)
  $profileBefore=(Get-Acl -LiteralPath $env:USERPROFILE -Audit).GetSecurityDescriptorSddlForm($sections)
  $facts=@(Get-RuleFacts (Get-Acl -LiteralPath $root) $identity)
  $candidate=Select-RepairCandidate $facts
  if([long]$candidate.rule.FileSystemRights -ne 0x1200A9 -or
    [string]$candidate.rule.PropagationFlags -ne 'None'){throw 'BOUNDARY_REJECTED'}
  foreach($path in $roots){
    $acl=Get-Acl -LiteralPath $path
    $facts=@(Get-RuleFacts $acl $identity)
    foreach($fact in $facts){$fact.rights=[long]$fact.rule.FileSystemRights}
    Assert-BoundaryReader $facts $candidate.sidValue $acl.AreAccessRulesProtected
  }
  $task=Get-ScheduledTask -TaskName 'JARVIS Remote Host'
  $taskSid=[string]$task.Principal.UserId
  if($taskSid -notmatch '^S-1-'){$taskSid=([Security.Principal.NTAccount]$taskSid).Translate([Security.Principal.SecurityIdentifier]).Value}
  if($taskSid -cne $identity.User.Value -or $task.Principal.RunLevel -ne 'Limited' -or
    $task.Principal.LogonType -ne 'Password'){throw 'RUNTIME_CHANGED'}
  $taskXml=Export-ScheduledTask -TaskName 'JARVIS Remote Host'
  $configHash=(Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
  $launcherHash=(Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash
  Assert-RuntimeUnchanged
  $stage='snapshot';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
  $snapshot=Get-BoundarySnapshot $roots
  $expected=Get-ExpectedSnapshot $snapshot $roots $candidate.sidValue
  if($Phase -eq 'apply'){
    $stage='backup';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
    if((Get-Item -LiteralPath $env:LOCALAPPDATA).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'REPARSE_REJECTED'}
    $backupId=[guid]::NewGuid().ToString('N')
    $backupPath=Join-Path $env:LOCALAPPDATA ('goriq-acl-boundary-before-'+$backupId+'.dpapi')
    $plain=@{version=1;issue=1662;repairIssue=1787;sourceRevision=$SourceRevision;roots=$roots;baseline=$snapshot} | ConvertTo-Json -Depth 6 -Compress
    Write-BoundaryBackup $backupPath $plain
    $plain=$null;$decoded=$null;$secure=$null;$encrypted=$null
    Assert-SameSnapshot $snapshot (Get-BoundarySnapshot $roots)
    Assert-RuntimeUnchanged
    if([datetimeoffset]::UtcNow -ge [datetimeoffset]::Parse('2026-10-13T11:12:13.845Z')){throw 'APPROVAL_REJECTED'}
    $stage='isolate';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
    foreach($path in $roots){
      Assert-OwnedNative $path $identity
      Assert-AncestorsUnchanged
      $acl=Get-Acl -LiteralPath $path -Audit
      $original=@($snapshot | Where-Object {$_.path -ceq $path})
      if($original.Count -ne 1 -or $acl.GetSecurityDescriptorSddlForm($sections) -cne $original[0].descriptor){throw 'BASELINE_CHANGED'}
      Assert-BoundaryIdentity $path $original[0]
      $acl=New-BoundaryDacl $acl $candidate.sidValue
      $changed=$true
      Set-Acl -LiteralPath $path -AclObject $acl
    }
    $stage='verify';Write-Host ('ACL_BOUNDARY_STAGE='+$stage)
    Assert-SameSnapshot $expected (Get-BoundarySnapshot $roots)
    Assert-AncestorsUnchanged
    foreach($path in @($production,$releases,$oldRoot,$config,$launcher)){
      foreach($fact in @(Get-RuleFacts (Get-Acl -LiteralPath $path) $identity)){
        if($fact.accessType -eq 'Allow' -and -not $fact.approvedPrincipal){throw 'VERIFICATION_FAILED'}
      }
    }
    Assert-RuntimeUnchanged
  }
  @{version=1;issue=1662;repairIssue=1787;nodeId='zbook';phase=$Phase;sourceRevision=$SourceRevision;
    readOnly=($Phase -eq 'plan');verified=$true;permissionChanged=$changed;boundaryCount=2;
    inspectedSurfaceCount=$snapshot.Count;backupId=$backupId;runtimeUnchanged=$true;ancestorUnchanged=$true;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
}catch {
  $known=@('APPROVAL_REJECTED','ARTIFACT_REJECTED','ADMIN_REQUIRED','SOURCE_REJECTED','MAIN_CI_REQUIRED',
    'OWNER_BOUNDARY_REJECTED','ACL_CANDIDATE_REJECTED','BOUNDARY_REJECTED','BASELINE_CHANGED',
    'REPARSE_REJECTED','HARDLINK_REJECTED','SNAPSHOT_LIMIT','BACKUP_REJECTED','RUNTIME_CHANGED','ANCESTOR_CHANGED','VERIFICATION_FAILED')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'BOUNDARY_REPAIR_FAILED'}
  if($changed){
    try{Restore-BoundaryBaseline $snapshot $roots;Assert-RuntimeUnchanged;Assert-AncestorsUnchanged;$restored=$true}catch{$restored=$false}
  }
  @{version=1;issue=1662;repairIssue=1787;nodeId='zbook';phase=$Phase;failedStage=$stage;
    failureReason=$reason;permissionChanged=$changed;restored=$restored;backupId=$backupId;
    observedAt=[datetimeoffset]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
  exit 1
}finally{$snapshot=$null;$expected=$null;$candidate=$null;$plain=$null;$decoded=$null;$secure=$null;$encrypted=$null;$bytes=$null}

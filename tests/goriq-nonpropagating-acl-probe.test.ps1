Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Disposable fixture experiment only. Never reads or repairs USERPROFILE/JARVIS.
$fixtureSource=Join-Path $PSScriptRoot 'fixtures\goriq-nonpropagating-acl-probe.ps1'
if(-not (Test-Path -LiteralPath $fixtureSource)){throw 'nonpropagating-fixture-missing'}
$tokens=$null;$errors=$null
$null=[Management.Automation.Language.Parser]::ParseFile($fixtureSource,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'nonpropagating-fixture-parse'}
if($env:OS -ne 'Windows_NT'){Write-Output 'Non-propagating fixture syntax PASS; native Windows required';return}
. $fixtureSource
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-nonprop-probe-'+[guid]::NewGuid().ToString('N'))
$script:ProbeFixtureRoot=$fixture
[GoriqNonPropagatingAclProbe]::Root=$fixture
$location=Get-Location
$links=@();$handles=@()
try {
  $null=New-Item -ItemType Directory -Path $fixture
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetOwner($identity.User);$acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($identity.User.Value,'S-1-5-18')){
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
      (New-Object Security.Principal.SecurityIdentifier($sid)),'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  $reader='S-1-1-0'
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($reader)),'ReadAndExecute,Synchronize','ContainerInherit,ObjectInherit','None','Allow')))
  $acl.AddAuditRule((New-Object Security.AccessControl.FileSystemAuditRule($identity.User,'ReadData','ContainerInherit,ObjectInherit','None','Success')))
  Set-Acl -LiteralPath $fixture -AclObject $acl
  $production=Join-Path $fixture 'production';$releases=Join-Path $fixture 'releases'
  $old=Join-Path $releases 'old-release'
  $dependencies=Join-Path $old 'node_modules'
  $outside=Join-Path $fixture 'outside-target'
  foreach($path in @($production,$releases,$old,$dependencies,$outside)){$null=New-Item -ItemType Directory -Path $path}
  $config=Join-Path $production 'config.bin';$launcher=Join-Path $production 'launcher.bin'
  $package=Join-Path $dependencies 'package.bin';$target=Join-Path $outside 'target.bin'
  foreach($path in @($config,$launcher,$package,$target)){[IO.File]::WriteAllText($path,'public fixture bytes')}
  $alias=Join-Path $outside 'package-alias.bin'
  $null=New-Item -ItemType HardLink -Path $alias -Target $package
  $link=Join-Path $dependencies 'package-link'
  $null=New-Item -ItemType SymbolicLink -Path $link -Target $outside
  $links+=($link)
  $objects=@($production,$releases,$old,$config,$launcher)
  $untouched=@($fixture,$dependencies,$outside,$package,$target,$alias,$link)
  $all=@($objects)+@($untouched)
  $before=@{};$wanted=@{}
  foreach($path in $all){$before[$path]=(Get-Acl -LiteralPath $path -Audit).Sddl}
  foreach($path in $objects){$wanted[$path]=Get-ProbeNarrowDescriptor $before[$path] $reader}
  # Reproduce an active host's current directory while requesting MAXIMUM_ALLOWED.
  Set-Location $old
  foreach($path in $objects){$handles+=,[GoriqNonPropagatingAclProbe]::Open($path)}
  for($i=0;$i -lt $objects.Count;$i++){
    [GoriqNonPropagatingAclProbe]::Apply($handles[$i],$wanted[$objects[$i]])
  }
  foreach($path in $objects){
    if((Get-Acl -LiteralPath $path -Audit).Sddl -cne $wanted[$path]){throw 'probe-object-delta-mismatch'}
  }
  foreach($path in $untouched){
    if((Get-Acl -LiteralPath $path -Audit).Sddl -cne $before[$path]){throw 'probe-child-or-alias-mutated'}
  }
  foreach($path in @($config,$launcher,$package,$target,$alias)){
    if([IO.File]::ReadAllText($path) -cne 'public fixture bytes'){throw 'probe-content-mutated'}
  }
  Write-Output 'MAXIMUM_ALLOWED five-object narrowing, CWD compatibility, no child/link/hardlink propagation, audit/content PASS'
  # Restore ancestors before their children, with the same no-propagation API.
  for($i=0;$i -lt $objects.Count;$i++){
    [GoriqNonPropagatingAclProbe]::Apply($handles[$i],$before[$objects[$i]])
  }
  foreach($path in $all){
    if((Get-Acl -LiteralPath $path -Audit).Sddl -cne $before[$path]){throw 'probe-full-restore-mismatch'}
  }
  [GoriqNonPropagatingAclProbe]::Apply($handles[0],$wanted[$objects[0]])
  [GoriqNonPropagatingAclProbe]::Apply($handles[0],$before[$objects[0]])
  foreach($path in $all){
    if((Get-Acl -LiteralPath $path -Audit).Sddl -cne $before[$path]){throw 'probe-partial-restore-mismatch'}
  }
  foreach($unsafe in @('O:SYG:SY','D:')){
    $rejected=$false
    try{[GoriqNonPropagatingAclProbe]::Apply($handles[0],$unsafe)}catch{$rejected=$true}
    if(-not $rejected){throw 'probe-null-or-empty-dacl-accepted'}
  }
  foreach($unsafePath in @($link,$alias)){
    $rejected=$false
    try{$unsafeHandle=[GoriqNonPropagatingAclProbe]::Open($unsafePath);$unsafeHandle.Dispose()}catch{$rejected=$true}
    if(-not $rejected){throw 'probe-reparse-or-hardlink-target-accepted'}
  }
  Write-Output 'MAXIMUM_ALLOWED full/partial exact rollback, null-DACL/reparse/hardlink rejection PASS (temporary fixtures only)'
}finally {
  Set-Location $location
  foreach($handle in $handles){$handle.Dispose()}
  foreach($link in $links){if(Test-Path -LiteralPath $link){[IO.Directory]::Delete($link)}}
  if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Recurse -Force}
  $script:ProbeFixtureRoot=$null
}

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Import-Fixture([string]$relative,[string[]]$names){
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot ('..\'+$relative)),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'fixture-parse'}
 foreach($name in $names){
  $def=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
  if($null -eq $def){throw 'fixture-function'}
  Invoke-Expression ($def.Extent.Text.Replace(('function '+$name),('function script:'+$name)))
 }
}
Import-Fixture 'scripts/goriq-completion-native-activate.ps1' @('Write-CompletionPointer','Assert-CompletionNative')
Import-Fixture 'scripts/goriq-zbook-fixed-acl-repair.ps1' @('Initialize-FixedNative','Get-FixedBytes','Get-FixedHash','Get-FixedRecord','Assert-FixedRecord')
Import-Fixture 'scripts/goriq-pc-runtime-refresh-windows.ps1' @('Replace-Bytes','Same-Bytes')
# Runtime/state guards have separate tests. This fixture exercises actual Windows files/ACL/IDs.
function Assert-CompletionState {}
function Assert-StoppedInstallation {}
function Assert-FixedExpiry {}
Initialize-FixedNative
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('goriq-1858-pointer-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$targets=@($null,$null,$null);$pointerRecords=@();$old=@();$ids=@()
try{
 foreach($name in @('config.dpapi','launch-current.ps1')){
  $path=Join-Path $fixture $name
  [IO.File]::WriteAllText($path,'original fixture')
  $acl=Get-Acl -LiteralPath $path -Audit
  $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  Set-Acl -LiteralPath $path -AclObject $acl
  $entry=[pscustomobject]@{path=$path;directory=$false};$targets+=,$entry
  $h=[GoriqFixedAclNative]::Open($path,$false,$false)
  try{$record=Get-FixedRecord $entry $h;$pointerRecords+=,$record;$old+=,$record;$ids+=,$record.identity}finally{$h.Dispose()}
 }
 Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('new fixture'))
 if($pointerRecords[0].identity -ceq $ids[0] -or $pointerRecords[0].descriptor -cne $old[0].descriptor){throw 'replacement-not-recorded'}
 Write-CompletionPointer 3 ([Text.Encoding]::UTF8.GetBytes('original fixture'))
 if($pointerRecords[0].hash -cne $old[0].hash -or $pointerRecords[0].descriptor -cne $old[0].descriptor){throw 'pointer-recovery-failed'}
 # A write by a different actor is not accepted as our expected pointer state.
 [IO.File]::WriteAllText($targets[4].path,'unexpected writer')
 $rejected=$false;try{Write-CompletionPointer 4 ([Text.Encoding]::UTF8.GetBytes('new fixture'))}catch{$rejected=$true}
 if(-not $rejected -or [IO.File]::ReadAllText($targets[4].path) -cne 'unexpected writer'){throw 'drift-not-rejected-before-write'}
 $h=[GoriqFixedAclNative]::Open($targets[3].path,$false,$false)
 try{$rejected=$false;try{Assert-CompletionNative $h $targets[4].path}catch{$rejected=$true};if(-not $rejected){throw 'native-alias-accepted'}}finally{$h.Dispose()}
 Write-Output 'Completion real pointer apply/rollback, full descriptor preservation, writer drift and native alias refusal PASS'
}finally{
 if([IO.Path]::GetFullPath($fixture) -notlike ([IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\goriq-1858-pointer-*')){throw 'cleanup-boundary'}
 Remove-Item -LiteralPath $fixture -Recurse -Force
}

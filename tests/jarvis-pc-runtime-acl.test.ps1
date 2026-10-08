Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Load only pure ACL predicates, never execute the host refresh script.
$source=Join-Path $PSScriptRoot '..\scripts\goriq-pc-runtime-refresh-windows.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'runtime-script-parse'}
foreach($name in @('Test-KnownReadOnlyRights','Test-NativeAllowSid')){
  $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if($null -ne $function){Invoke-Expression $function.Extent.Text}
}
$identity=@{User=@{Value='fixture-owner'}}
$cases=@(
  @{phase='plan';sid='unidentified-reader';rights=0x1200A9;want=$true;label='known-read-execute-synchronize-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x20089;want=$true;label='known-read-plan'},
  @{phase='apply';sid='unidentified-reader';rights=0x1200A9;want=$false;label='reader-still-rejected-apply'},
  @{phase='plan';sid='unidentified-reader';rights=0x1201BF;want=$false;label='writer-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x10000;want=$false;label='delete-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x40000;want=$false;label='change-acl-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x80000;want=$false;label='take-ownership-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x40000000;want=$false;label='generic-write-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x10000000;want=$false;label='generic-all-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0x200000;want=$false;label='unknown-bits-rejected-plan'},
  @{phase='plan';sid='unidentified-reader';rights=0;want=$false;label='empty-rights-rejected-plan'},
  @{phase='apply';sid='fixture-owner';rights=0x1F01FF;want=$true;label='owner-unchanged'},
  @{phase='apply';sid='S-1-5-18';rights=0x1F01FF;want=$true;label='system-unchanged'},
  @{phase='apply';sid='S-1-5-32-544';rights=0x1F01FF;want=$false;label='administrator-still-rejected-apply'}
)
foreach($case in $cases){
  $Phase=$case.phase
  if((Test-NativeAllowSid $case.sid $case.rights) -ne $case.want){throw ('ACL predicate regression: '+$case.label)}
}
Write-Output ('ACL predicate fixtures PASS: '+$cases.Count)

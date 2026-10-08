Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\tmp'))) ('watchdog-launcher-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$cscript=Join-Path $env:WINDIR 'System32\cscript.exe'
$program="Option Explicit`r`nDim shell`r`nWScript.Echo ""fixture-once""`r`n"
$single=Join-Path $root 'single.vbs';$duplicate=Join-Path $root 'duplicate.vbs'
[IO.File]::WriteAllText($single,$program,[Text.Encoding]::Unicode)
[IO.File]::WriteAllText($duplicate,($program+$program),[Text.Encoding]::Unicode)
foreach($case in @('single','duplicate')) {
  $out=Join-Path $root ($case+'.out');$err=Join-Path $root ($case+'.err')
  $process=Start-Process -FilePath $cscript -ArgumentList @('//Nologo',('"'+(Join-Path $root ($case+'.vbs'))+'"')) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  if($case -eq 'duplicate'){
    if($process.ExitCode -eq 0 -or (Get-Content $out -Raw) -match 'fixture-once'){throw 'duplicate-program-was-not-rejected-before-execution'}
    Write-Host 'Duplicated VBS program rejected before execution.'
  }elseif($process.ExitCode -ne 0 -or (Get-Content $out -Raw).Trim() -ne 'fixture-once'){throw 'single-program-failed'}
}
. (Join-Path $PSScriptRoot '..\scripts\gai-zbook-launcher-file.ps1')
$target=Join-Path $root 'published.vbs'
Write-GaiLauncherFile $target $program
$expected=[Text.Encoding]::Unicode.GetPreamble()+[Text.Encoding]::Unicode.GetBytes($program)
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String($expected)){throw 'publication-bytes-mismatch'}
$before=[IO.File]::GetLastWriteTimeUtc($target)
Write-GaiLauncherFile $target $program
if([IO.File]::GetLastWriteTimeUtc($target) -ne $before){throw 'unchanged-file-rewritten'}
$lock=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try{$rejected=$false;try{Write-GaiLauncherFile $target ($program+'changed')}catch{$rejected=$_.Exception.InnerException -is [IO.IOException]};if(-not $rejected){throw 'locked-target-overwritten'}}finally{$lock.Dispose()}
if([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String($expected)){throw 'failed-replacement-damaged-target'}
$aclBefore=(Get-Acl -LiteralPath $target).Sddl
$unicode=$program+'Rem '+[char]0x65e5+[char]0x672c+"`r`n"
Write-GaiLauncherFile $target $unicode
if([IO.File]::ReadAllText($target) -cne $unicode){throw 'unicode-changed'}
$aclAfter=(Get-Acl -LiteralPath $target).Sddl
if($aclAfter -cne $aclBefore){throw "fixture-acl-changed: before=$aclBefore after=$aclAfter"}
$helper=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\gai-zbook-launcher-file.ps1'))
$writer=Join-Path $root 'writer.ps1'
@('param([string]$Helper,[string]$Target,[string]$Label)','$ErrorActionPreference=''Stop''','. $Helper','for($i=0;$i -lt 12;$i++){Write-GaiLauncherFile $Target ("Option Explicit`r`nDim shell`r`nWScript.Echo ""fixture-once""`r`nRem "+$Label+"`r`n")}','Write-Output "completed-$Label"','exit 0') | Set-Content $writer -Encoding UTF8
$children=@()
foreach($label in @('a','b','c')){
  $children+=Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$writer+'"'),'-Helper',('"'+$helper+'"'),'-Target',('"'+$target+'"'),'-Label',$label) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root ($label+'.out')) -RedirectStandardError (Join-Path $root ($label+'.err'))
}
foreach($child in $children){if(-not $child.WaitForExit(30000)){throw 'concurrent-publisher-timeout'}}
foreach($label in @('a','b','c')){
  if((Get-Item (Join-Path $root ($label+'.err'))).Length -ne 0){throw 'concurrent-publisher-error'}
  if((Get-Content (Join-Path $root ($label+'.out')) -Raw).Trim() -cne ('completed-'+$label)){throw 'concurrent-publisher-incomplete'}
}
$published=[IO.File]::ReadAllText($target)
$valid=@('a','b','c') | Where-Object {$published -ceq ($program+'Rem '+$_+"`r`n")}
if(@($valid).Count -ne 1){throw 'concurrent-publication-incomplete'}
if((Get-Acl -LiteralPath $target).Sddl -cne $aclBefore){throw 'concurrent-publication-acl-changed'}
if(@(Get-ChildItem $root -Filter '.gai-launcher-*.tmp').Count){throw 'temporary-left-behind'}
Write-Host 'Concurrent publication preserves one complete candidate and target ACL.'
Write-Host 'Complete, idempotent, failure-preserving launcher publication PASS.'
exit 0

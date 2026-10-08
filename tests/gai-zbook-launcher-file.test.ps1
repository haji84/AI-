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
if((Get-GaiComparableFileSddl $aclAfter) -cne (Get-GaiComparableFileSddl $aclBefore)){throw "fixture-acl-changed: before=$aclBefore after=$aclAfter"}
$sddl='O:BAG:BAD:(A;ID;FA;;;BA)'
if((Get-GaiComparableFileSddl $sddl) -cne (Get-GaiComparableFileSddl 'O:BAG:BAD:AI(A;ID;FA;;;BA)')){throw 'auto-inherited-bookkeeping-not-normalized'}
foreach($different in @('O:SYG:BAD:(A;ID;FA;;;BA)','O:BAG:SYD:(A;ID;FA;;;BA)','O:BAG:BAD:P(A;ID;FA;;;BA)','O:BAG:BAD:(A;ID;FR;;;BA)','O:BAG:BAD:(A;;FA;;;BA)','O:BAG:BAD:(A;ID;FA;;;SY)')){
  if((Get-GaiComparableFileSddl $sddl) -ceq (Get-GaiComparableFileSddl $different)){throw 'actual-authority-change-ignored'}
}
# Inject documented partial replacement: original moved to backup, new target absent.
$nativeReplace=(Get-Command Invoke-GaiNativeFileReplace).ScriptBlock
try {
  function Invoke-GaiNativeFileReplace([string]$temporary,[string]$target,[string]$backup){[IO.File]::Move($target,$backup);throw [IO.IOException]::new('injected-partial-replacement')}
  $rejected=$false;try{Write-GaiLauncherFile $target ($unicode+'different')}catch{$rejected=$_.Exception.Message -eq 'injected-partial-replacement'}
  if(-not $rejected -or [IO.File]::ReadAllText($target) -cne $unicode -or (Get-Acl -LiteralPath $target).Sddl -cne $aclAfter){throw 'partial-replacement-not-restored'}
}finally{Set-Item Function:Invoke-GaiNativeFileReplace $nativeReplace}
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
if((Get-GaiComparableFileSddl (Get-Acl -LiteralPath $target).Sddl) -cne (Get-GaiComparableFileSddl $aclBefore)){throw 'concurrent-publication-acl-changed'}
if(@(Get-ChildItem $root -Filter '.gai-launcher-*.tmp').Count){throw 'temporary-left-behind'}
if(@(Get-ChildItem $root -Filter '.gai-replace-*.bak').Count){throw 'replacement-backup-left-behind'}
Write-Host 'Concurrent publication preserves one complete candidate and target ACL.'
Write-Host 'Complete, idempotent, failure-preserving launcher publication PASS.'
exit 0

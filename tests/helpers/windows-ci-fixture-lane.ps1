param([Parameter(Mandatory=$true)][ValidateSet('atomic','media')][string]$Lane)
$ErrorActionPreference='Stop'
if($Lane -ceq 'atomic') {
 $paths=@(
  './tests/goriq-pc-runtime-replace.test.ps1',
  './tests/goriq-zbook-runtime-owner-repair.test.ps1',
  './tests/goriq-pc-runtime-launch.test.ps1',
  './tests/gai-zbook-launcher-file.test.ps1',
  './tests/goriq-zbook-watchdog-launcher-repair.test.ps1',
  './tests/completion-native-transaction.test.ps1',
  './tests/completion-native-pointer.test.ps1',
  './tests/goriq-zbook-fixed-acl-repair.test.ps1'
 )
}else {
 $paths=@(
  './tests/ai09-access-media.test.ps1',
  './tests/ai09-access-media-windows-acl.test.ps1',
  './tests/ai09-access-media-lifecycle.test.ps1'
 )
}
foreach($path in $paths) {
 & $path
 if(-not $?){throw 'CI_FIXTURE_SCRIPT_FAILED'}
}
if(Test-Path variable:LASTEXITCODE){exit $LASTEXITCODE}

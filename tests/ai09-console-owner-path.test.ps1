Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ai09-console-access.ps1')
$profileRoot=[Environment]::GetFolderPath('UserProfile')
$probeRoot=Join-Path $profileRoot ('ai09-console-owned-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($probeRoot)
try {
  # Exercise the real Windows ACL reader. The operating-system drive's owner
  # need not own a user-controlled, non-reparse child directory or its files.
  $newFile=Join-Path $probeRoot 'new-plan.json'
  if ((Get-Ai09ConsoleSafePath $newFile) -cne $newFile) {throw 'REAL_OWNED_NEW_PATH_REJECTED'}
  [IO.File]::WriteAllText($newFile,'public fixture')
  if ((Get-Ai09ConsoleSafePath $newFile) -cne $newFile) {throw 'REAL_OWNED_EXISTING_PATH_REJECTED'}
  $rejected=$false
  try {$null=Get-Ai09ConsoleSafePath (Join-Path $PSScriptRoot 'forbidden-plan.json')} catch {if ($_.Exception.Message -cne 'EXTERNAL_PATH_REQUIRED') {throw}; $rejected=$true}
  if (-not $rejected) {throw 'REPOSITORY_PLAN_NOT_REJECTED'}
  'AI09_CONSOLE_REAL_OWNER_PATH_PASS'
} finally {
  $resolved=[IO.Path]::GetFullPath($probeRoot)
  $temporary=[IO.Path]::GetFullPath($profileRoot).TrimEnd('\')+'\'
  if ($resolved.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'ai09-console-owned-*') {Remove-Item -LiteralPath $resolved -Recurse -Force}
}

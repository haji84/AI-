param(
  [ValidateSet('plan','apply')][string]$Phase='plan',
  [Parameter(Mandatory=$true)][string]$EvidenceDirectory
)
# Owner-invoked transport only. The unchanged child enforces all source, expiry,
# native ownership, ACL, process, state, activation and rollback boundaries.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Invoke-RuntimeProcess([string]$executable,[string[]]$arguments,[string]$directory,[string]$label) {
  $stdout=Join-Path $directory ($label+'-stdout.log')
  $stderr=Join-Path $directory ($label+'-stderr.log')
  if((Test-Path -LiteralPath $stdout) -or (Test-Path -LiteralPath $stderr)){throw 'RUNTIME_LOG_ALREADY_EXISTS'}
  $process=Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $exitCode=$process.ExitCode
  if($null -eq $exitCode){throw 'RUNTIME_EXIT_CODE_MISSING'}
  return @{exitCode=[int]$exitCode;stdout=$stdout;stderr=$stderr}
}
function Assert-RuntimeReceipt($receipt,[string]$phase,[string]$revision) {
  if($null -eq $receipt -or $receipt.issue -ne 1662 -or $receipt.nodeId -ne 'zbook' -or
    $receipt.phase -ne $phase -or $receipt.revision -ne $revision -or
    $receipt.taskUnchanged -isnot [bool] -or -not $receipt.taskUnchanged){throw 'RUNTIME_RECEIPT_REJECTED'}
  if($phase -eq 'apply') {
    foreach($field in @('runtimeExact','identityPreserved','schemaPreserved')) {
      if($receipt.$field -isnot [bool] -or -not $receipt.$field){throw 'RUNTIME_RECEIPT_REJECTED'}
    }
  } else {
    foreach($field in @('readOnly','schemaCompatible','quiescent','nativeLauncherSupported')) {
      if($receipt.$field -isnot [bool] -or -not $receipt.$field){throw 'RUNTIME_RECEIPT_REJECTED'}
    }
  }
}
$result=$null
try {
  $revision=$env:GORIQ_PC_APPROVED_REVISION
  if($env:OS -ne 'Windows_NT' -or $revision -notmatch '^[a-f0-9]{40}$'){throw 'RUNTIME_LAUNCH_CONTEXT_REQUIRED'}
  $sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  if(([IO.Path]::GetFullPath((Get-Location).Path)) -ine $sourceRoot){throw 'RUNTIME_LAUNCH_SOURCE_REQUIRED'}
  $evidence=[IO.Path]::GetFullPath($EvidenceDirectory)
  if(-not (Test-Path -LiteralPath $evidence -PathType Container)){throw 'RUNTIME_EVIDENCE_DIRECTORY_REQUIRED'}
  $child=Join-Path $PSScriptRoot 'goriq-pc-runtime-refresh-windows.ps1'
  if($child.Contains('"')){throw 'RUNTIME_LAUNCH_SOURCE_REQUIRED'}
  $executable=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $label='runtime-'+$Phase+'-'+[guid]::NewGuid().ToString('N')
  $result=Invoke-RuntimeProcess $executable @('-NoProfile','-ExecutionPolicy','RemoteSigned','-File',('"'+$child+'"'),'-Phase',$Phase) $evidence $label
  if($result.exitCode -ne 0){throw 'RUNTIME_CHILD_FAILED'}
  $json=@(Get-Content -LiteralPath $result.stdout | Where-Object {$_.StartsWith('{')}) | Select-Object -Last 1
  if(-not $json){throw 'RUNTIME_RECEIPT_MISSING'}
  $receipt=$json | ConvertFrom-Json
  Assert-RuntimeReceipt $receipt $Phase $revision
  @{version=1;issue=1662;verified=$true;childExitCode=$result.exitCode;receipt=$receipt;stdout=$result.stdout;stderr=$result.stderr} | ConvertTo-Json -Depth 8 -Compress
} catch {
  $known=@('RUNTIME_LOG_ALREADY_EXISTS','RUNTIME_EXIT_CODE_MISSING','RUNTIME_RECEIPT_REJECTED','RUNTIME_LAUNCH_CONTEXT_REQUIRED','RUNTIME_LAUNCH_SOURCE_REQUIRED','RUNTIME_EVIDENCE_DIRECTORY_REQUIRED','RUNTIME_CHILD_FAILED','RUNTIME_RECEIPT_MISSING')
  $reason=if($_.Exception.Message -in $known){$_.Exception.Message}else{'RUNTIME_LAUNCH_FAILED'}
  @{version=1;issue=1662;verified=$false;reason=$reason;processResult=$result} | ConvertTo-Json -Depth 5 -Compress
  exit 1
}

[CmdletBinding()]
param([switch]$Apply,[string]$AuthorizationPath)
if(-not $Apply){Write-Output 'PLAN ONLY: dedicated Owner rotation acceptance worker requires fresh rotation authority; no configuration or native service was accessed.';exit 0}
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$rotationWorkerAuthorizationPath=$AuthorizationPath
. (Join-Path $PSScriptRoot 'rotate-jarvis-owner-code-windows.ps1')
$checkpoint={
 param([string]$Event)
 if($Event -notin @('before-rotation','before-commit','after-rollback')){throw 'ROTATION_PROTOCOL_FAILED'}
 [Console]::Out.WriteLine((@{event=$Event}|ConvertTo-Json -Compress));[Console]::Out.Flush()
 $read=[Console]::In.ReadLineAsync()
 if(-not $read.Wait(15000)){throw 'ROTATION_PROTOCOL_FAILED'}
 $line=$read.Result;if(-not $line -or $line.Length -gt 1024){throw 'ROTATION_PROTOCOL_FAILED'}
 $ack=$line|ConvertFrom-Json
 if(@($ack.PSObject.Properties).Count -ne 2 -or $ack.event -cne $Event -or $ack.accepted -isnot [bool]){throw 'ROTATION_PROTOCOL_FAILED'}
 return $ack.accepted
}
try{$result=Invoke-OwnerRotationMain -Apply -AuthorizationPath $rotationWorkerAuthorizationPath -Checkpoint $checkpoint -Controlled}catch{$result=New-OwnerRotationResult;$result.failureCode='ROTATION_PROTOCOL_FAILED';$result.failedStage='protocol'}
[Console]::Out.WriteLine((@{event='result';result=$result}|ConvertTo-Json -Depth 4 -Compress));[Console]::Out.Flush()
if(-not $result.complete){exit 1}

# Separate inert process fixture: do not make successful compilation/format
# cases and a deliberate 25s timeout share one 55s outer process budget.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'observe-private-owner.ps1')
$wire=New-OwnerProbeFailure 'UNSUPPORTED_PLATFORM'
$literal=$wire.Replace('"','""')
$marker=Join-Path ([IO.Path]::GetTempPath()) ('goriq-owner-timeout-fixture-'+[Guid]::NewGuid().ToString('N')+'.txt')
$markerLiteral=$marker.Replace('"','""')
$slow='public static class GoriqPrivateOwnerProbe { public static string ObserveJson() { using(var s=System.IO.File.Open(@"'+$markerLiteral+'",System.IO.FileMode.CreateNew,System.IO.FileAccess.Write,System.IO.FileShare.Read)){var b=System.Text.Encoding.UTF8.GetBytes("INERT_TIMEOUT_STARTED");s.Write(b,0,b.Length);s.Flush();} System.Threading.Thread.Sleep(60000); return @"'+$literal+'"; } }'
try{
  $result=Invoke-OwnerProbeObservation -NativeSource $slow | ConvertFrom-Json
  $expected='UNSUPPORTED_PLATFORM'
  if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){
    $expected='TIMEOUT'
    if(-not [IO.File]::Exists($marker) -or [IO.File]::ReadAllText($marker) -cne 'INERT_TIMEOUT_STARTED'){throw 'INERT_TIMEOUT_DID_NOT_REACH_COMPILED_ENTRY'}
  }
  if($result.reason -cne $expected -or $result.recovered -or $result.historicalStateProven -or $result.observations.Count -ne 0){throw ('INERT_TIMEOUT_FIXTURE_FAILED_'+$result.reason)}
  Write-Output ('PASS inert_timeout_reason_'+$result.reason)
  Write-Output 'TOTAL_PASS=1'
}finally{[IO.File]::Delete($marker)}

[CmdletBinding()]
param([switch]$Prepare,[switch]$PreparePublic,[switch]$BootstrapPublicCutover,[switch]$StartOnly)

# This entry defines only preparation capabilities. Default invocation is inert.
$script:ownerRotationEntryCodec=$null

# Pure fixed-template DATA compilation, never a native or START_ONLY grant.
# Genuine private installation/activation/task/source/Owner checks remain the
# only route to execution; no caller command or environment-name input exists.
function New-OwnerCutoverCleanStartCommandData($Data){
 try{
  $fields=@('profile','windowsDirectory','systemPowerShellPath','ownerProfile','ownerLocalAppData','retainedNodePath','installRoot','releaseRoot','startupStateDirectory','entrySha256','sourceRevision');Assert-OwnerRotationEntryShape $Data $fields
  foreach($key in $fields){if($Data.$key -isnot [string]){throw 'INVALID_DATA'}}
  if($Data.profile -cne 'goriq-clean-start-command-data-v1' -or $Data.entrySha256 -cnotmatch '^[a-f0-9]{64}$' -or $Data.sourceRevision -cnotmatch '^[a-f0-9]{40}$'){throw 'INVALID_DATA'}
  $forbidden=@(0,10,13,33,34,37,38,39,40,41,59,60,62,94,96,124)
  foreach($key in @('windowsDirectory','systemPowerShellPath','ownerProfile','ownerLocalAppData','retainedNodePath','installRoot','releaseRoot','startupStateDirectory')){
   $path=$Data.$key;if($path.Length -gt 512 -or $path -cnotmatch '^[A-Za-z]:\\[^:]+$' -or $path.Contains('/') -or $path.EndsWith('\')){throw 'INVALID_PATH'}
   foreach($character in $path.ToCharArray()){if($forbidden -contains [int]$character){throw 'INVALID_PATH'}}
   foreach($part in $path.Substring(3).Split([char]92)){if(-not $part -or $part -cin @('.','..') -or $part -match '[. ]$'){throw 'INVALID_PATH'}}
  }
  $system=$Data.windowsDirectory+'\System32';$ps=$system+'\WindowsPowerShell\v1.0\powershell.exe';$cmd=$system+'\cmd.exe'
  if($Data.systemPowerShellPath -ine $ps -or $Data.retainedNodePath -ine ($Data.ownerProfile+'\JARVIS\tools\node-v24.19.0-win-x64\node.exe') -or -not $Data.ownerLocalAppData.StartsWith($Data.ownerProfile+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $Data.installRoot.StartsWith($Data.ownerProfile+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $Data.startupStateDirectory.StartsWith($Data.installRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'INVALID_BINDING'}
  $metadata=[ordered]@{installRoot=$Data.installRoot;entrySha256=$Data.entrySha256;sourceRevision=$Data.sourceRevision};$payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($metadata|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)))
  $body=@'
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
function Read-FixedStartBytes([string]$p){$f=$null;$m=[IO.MemoryStream]::new();try{$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$b=New-Object byte[] 8192;while(($n=$f.Read($b,0,$b.Length)) -gt 0){if($m.Length+$n -gt 262144){throw 'REFUSE'};$m.Write($b,0,$n)};return ,$m.ToArray()}finally{if($f){$f.Dispose()};$m.Dispose()}}
try{$d=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('FIXED_PAYLOAD')))|Microsoft.PowerShell.Utility\ConvertFrom-Json;$p=$d.installRoot+'\scripts\owner-code-rotation-native-1218.ps1';$b=Read-FixedStartBytes $p;$h=[Security.Cryptography.SHA256]::Create();try{$x=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};if($x -cne $d.entrySha256){throw 'REFUSE'};$script:ownerCutoverRetainedStartupEntryContext=$d;&([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($b))) -StartOnly;exit 1}catch{[Console]::Error.WriteLine('GORIQ_NORMAL_START_REFUSED');exit 1}
'@
  $body=$body.Replace('FIXED_PAYLOAD',$payload);$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body));$statements=[Collections.Generic.List[string]]::new()
  foreach($name in @('HTTPS_PROXY','HTTP_PROXY','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_CLUSTER_SCHED_POLICY','NODE_COMPILE_CACHE','NODE_COMPILE_CACHE_PORTABLE','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_DISABLE_COMPILE_CACHE','NODE_EXTRA_CA_CERTS','NODE_ICU_DATA','NODE_NO_WARNINGS','NODE_OPTIONS','NODE_PATH','NODE_PENDING_DEPRECATION','NODE_PENDING_PIPE_INSTANCES','NODE_PRESERVE_SYMLINKS','NODE_PRESERVE_SYMLINKS_MAIN','NODE_REDIRECT_WARNINGS','NODE_REPL_EXTERNAL_MODULE','NODE_REPL_HISTORY','NODE_SKIP_PLATFORM_CHECK','NODE_TEST_CONTEXT','NODE_TLS_REJECT_UNAUTHORIZED','NODE_UNIQUE_ID','NODE_USE_ENV_PROXY','NODE_USE_SYSTEM_CA','NODE_V8_COVERAGE','OPENSSL_CONF','OPENSSL_CONF_INCLUDE','OPENSSL_ENGINES','OPENSSL_MALLOC_FAILURES','OPENSSL_MALLOC_FD','OPENSSL_MALLOC_SEED','OPENSSL_MODULES','OPENSSL_WIN32_UTF8','OPENSSL_ia32cap','SSL_CERT_DIR','SSL_CERT_FILE','WATCH_REPORT_DEPENDENCIES','http_proxy','https_proxy','NODE_DISABLE_COLORS','FORCE_COLOR','NO_COLOR','TZ','UV_THREADPOOL_SIZE','COR_ENABLE_PROFILING','COR_PROFILER','COR_PROFILER_PATH','COR_PROFILER_PATH_32','COR_PROFILER_PATH_64','COR_PROFILER_PATH_ARM64','APPDOMAIN_MANAGER_ASM','APPDOMAIN_MANAGER_TYPE','DEVPATH','COMPLUS_ProfAPI_ProfilerCompatibilitySetting','COMPLUS_MDA','PSModuleAnalysisCachePath','PSDisableModuleAnalysisCacheCleanup')){$statements.Add('set "'+$name+'="')}
  $nodeDirectory=$Data.retainedNodePath.Substring(0,$Data.retainedNodePath.LastIndexOf([char]92))
  $bound=[ordered]@{SystemRoot=$Data.windowsDirectory;WINDIR=$Data.windowsDirectory;ComSpec=$cmd;USERPROFILE=$Data.ownerProfile;HOME=$Data.ownerProfile;LOCALAPPDATA=$Data.ownerLocalAppData;TEMP=$Data.startupStateDirectory;TMP=$Data.startupStateDirectory;PATH=($nodeDirectory+';'+$system+';'+$Data.windowsDirectory);PATHEXT='.COM;.EXE;.BAT;.CMD';PSModulePath=($system+'\WindowsPowerShell\v1.0\Modules')}
  foreach($key in $bound.Keys){$statements.Add('set "'+$key+'='+$bound[$key]+'"')}
  $statements.Add('"'+$ps+'" -NoLogo -NoProfile -NonInteractive -EncodedCommand '+$encoded)
  $arguments='/d /v:off /s /c "'+[string]::Join(' & ',$statements.ToArray())+'"';if($arguments.Length -gt 8191){throw 'COMMAND_LIMIT'}
  return [pscustomobject][ordered]@{profile='goriq-clean-start-command-data-v1';execute=$cmd;arguments=$arguments;workingDirectory=$Data.releaseRoot;effectCapability=$false}
 }catch{throw 'ROTATION_CUTOVER_START_PREFIX_REJECTED'}
}


# Readonly helper-local bound, never an administrative clock/capability. The
# original parent independently validates/owns the actual process and channel.
function Get-OwnerCutoverPeerProbePlatform {return @{windows=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);major=[int]$PSVersionTable.PSVersion.Major;nativeSystem=[Environment]::GetFolderPath('System')}}
function Get-OwnerCutoverPeerProbeSelfId {return [int]$PID}
function Get-OwnerCutoverPeerProbeElapsedMs {return [long][Math]::Floor($script:ownerCutoverPeerProbeState.stopwatch.Elapsed.TotalMilliseconds)}
function Assert-OwnerCutoverPeerProbeBudget {
 $elapsed=Get-OwnerCutoverPeerProbeElapsedMs
 if(($elapsed -isnot [long] -and $elapsed -isnot [int]) -or $elapsed -lt 0 -or $elapsed -gt 10000 -or $elapsed -lt $script:ownerCutoverPeerProbeState.lastElapsed){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 $script:ownerCutoverPeerProbeState.lastElapsed=[long]$elapsed
}
# Fixed diagnostic progress only; ordinary producer calls remain silent.
function Write-OwnerCutoverPeerProbeDiagnosticProgress {
 if($args.Count -ne 0){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 $state=$script:ownerCutoverPeerProbeState;if(-not $state.diagnosticProgress){return}
 Assert-OwnerCutoverPeerProbeBudget
 $phases=@('PLATFORM','ROW_READ','PROCESS_QUERY','PROCESS_OPEN','OWNER_QUERY','NATIVE_COMPILE','IMAGE_OPEN','IMAGE_IDENTITY','IMAGE_READ','IMAGE_RECHECK','SIGNATURE','ROW_SHAPE','ROW_BINDING','CHAIN_BINDING','COMPLETE')
 if($state.phase -cnotin $phases -or $state.index -isnot [int] -or $state.index -lt 0 -or $state.index -gt 2){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 $key=$state.phase+' '+$state.index;if($state.lastProgress -ceq $key){return}
 $line='GORIQ_PUBLIC_PEER_PROBE_PHASE '+$key;$bytes=[Text.Encoding]::UTF8.GetByteCount($line)+2
 if($state.progressRows -ge 96 -or $state.progressBytes+$bytes -gt 8192){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 [Console]::Out.WriteLine($line);$state.lastProgress=$key;$state.progressRows++;$state.progressBytes+=$bytes
}
function Initialize-OwnerCutoverPeerFileNative {
 Assert-OwnerCutoverPeerProbeBudget;$existing='GoriqCutoverPeerFileNative' -as [type];$owned=Get-Variable ownerCutoverPeerFileNativeType -Scope Script -ErrorAction SilentlyContinue
 if($owned){if(-not [object]::ReferenceEquals($existing,$owned.Value)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};return};if($existing){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 Add-Type -ErrorAction Stop -TypeDefinition @'
using System;using System.IO;using System.Text;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class GoriqCutoverPeerFileNative {
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder b,uint n,uint f);
 public static string[] Identity(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i)||(i.Attributes&16)!=0||(i.Attributes&1024)!=0)throw new IOException();var b=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(h,b,(uint)b.Capacity,0);if(n==0||n>=b.Capacity)throw new IOException();return new[]{i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8"),b.ToString(),i.Links.ToString()};}
}
'@|Out-Null
 Assert-OwnerCutoverPeerProbeBudget;$script:ownerCutoverPeerFileNativeType='GoriqCutoverPeerFileNative' -as [type];if(-not $script:ownerCutoverPeerFileNativeType){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
}
function Read-OwnerCutoverPeerProcessData {
 # No PID parameter: only the original own-derived, validated chain cursor.
 Assert-OwnerCutoverPeerProbeBudget;$id=$script:ownerCutoverPeerProbeState.cursor
 if($id -isnot [int] -or $id -le 0){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 $process=$null;$stream=$null;$hash=[Security.Cryptography.SHA256]::Create()
 try{
  Assert-OwnerCutoverPeerProbeBudget;$script:ownerCutoverPeerProbeState.phase='PROCESS_QUERY';Write-OwnerCutoverPeerProbeDiagnosticProgress;$rows=@(CimCmdlets\Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = '+$id) -OperationTimeoutSec 10 -ErrorAction Stop);Assert-OwnerCutoverPeerProbeBudget
  if($rows.Count -ne 1 -or [long]$rows[0].ProcessId -ne $id -or $rows[0].ParentProcessId -isnot [uint32] -or $rows[0].ParentProcessId -gt [int]::MaxValue){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$row=$rows[0]
  $script:ownerCutoverPeerProbeState.phase='PROCESS_OPEN';Write-OwnerCutoverPeerProbeDiagnosticProgress;$process=[Diagnostics.Process]::GetProcessById($id);Assert-OwnerCutoverPeerProbeBudget;$null=$process.Handle;Assert-OwnerCutoverPeerProbeBudget;$creation=$process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);Assert-OwnerCutoverPeerProbeBudget;$session=$process.SessionId;Assert-OwnerCutoverPeerProbeBudget;$image=$process.MainModule.FileName;Assert-OwnerCutoverPeerProbeBudget
  $script:ownerCutoverPeerProbeState.phase='OWNER_QUERY';Write-OwnerCutoverPeerProbeDiagnosticProgress;$owner=CimCmdlets\Invoke-CimMethod -InputObject $row -MethodName GetOwnerSid -OperationTimeoutSec 10 -ErrorAction Stop;Assert-OwnerCutoverPeerProbeBudget
  if($owner.ReturnValue -isnot [uint32] -or $owner.ReturnValue -ne 0 -or $owner.Sid -isnot [string] -or $owner.Sid -cnotmatch '^S-1-[0-9]+(?:-[0-9]+)+$' -or $image -isnot [string] -or $image -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]+$'){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
  $script:ownerCutoverPeerProbeState.phase='NATIVE_COMPILE';Write-OwnerCutoverPeerProbeDiagnosticProgress;Initialize-OwnerCutoverPeerFileNative;Assert-OwnerCutoverPeerProbeBudget;$script:ownerCutoverPeerProbeState.phase='IMAGE_OPEN';Write-OwnerCutoverPeerProbeDiagnosticProgress;$stream=[IO.File]::Open($image,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);Assert-OwnerCutoverPeerProbeBudget;$script:ownerCutoverPeerProbeState.phase='IMAGE_IDENTITY';Write-OwnerCutoverPeerProbeDiagnosticProgress;$before=[GoriqCutoverPeerFileNative]::Identity($stream.SafeFileHandle);Assert-OwnerCutoverPeerProbeBudget
  $final=$before[1];if($final.StartsWith('\\?\')){$final=$final.Substring(4)};if($final -ine $image -or $stream.Length -lt 1 -or $stream.Length -gt 134217728 -or ($script:ownerCutoverPeerProbeState.index -eq 1 -and $before[2] -cne '1')){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
  $script:ownerCutoverPeerProbeState.phase='IMAGE_READ';Write-OwnerCutoverPeerProbeDiagnosticProgress;$buffer=New-Object byte[] 65536;$length=[long]0
  while($true){Assert-OwnerCutoverPeerProbeBudget;$count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPeerProbeBudget;if($count -eq 0){break};$length+=$count;if($length -gt 134217728){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$null=$hash.TransformBlock($buffer,0,$count,$buffer,0)};$null=$hash.TransformFinalBlock([byte[]]@(),0,0);Assert-OwnerCutoverPeerProbeBudget
  $script:ownerCutoverPeerProbeState.phase='IMAGE_RECHECK';Write-OwnerCutoverPeerProbeDiagnosticProgress;$after=[GoriqCutoverPeerFileNative]::Identity($stream.SafeFileHandle);Assert-OwnerCutoverPeerProbeBudget;if($before[0] -cne $after[0] -or $before[1] -cne $after[1] -or $before[2] -cne $after[2] -or $length -ne $stream.Length -or $process.HasExited -or $creation -cne $process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Assert-OwnerCutoverPeerProbeBudget
  $script:ownerCutoverPeerProbeState.phase='SIGNATURE';Write-OwnerCutoverPeerProbeDiagnosticProgress;$status='NOT_REQUIRED';$publisher='';if($script:ownerCutoverPeerProbeState.index -ne 1){$signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $image -ErrorAction Stop;Assert-OwnerCutoverPeerProbeBudget;$status=[string]$signature.Status;$publisher=if($signature.SignerCertificate -and $signature.SignerCertificate.Subject -match '(?:^|,\s*)O=Microsoft Corporation(?:,|$)'){'Microsoft Corporation'}else{'OTHER'}}
  return [pscustomobject][ordered]@{pid=$id;parentPid=[int]$row.ParentProcessId;creationTicks=$creation;sessionId=[int]$session;imagePath=$image;imageSha256=([BitConverter]::ToString($hash.Hash)).Replace('-','').ToLowerInvariant();imageIdentityKey=$before[0];ownerSidSha256=(Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes($owner.Sid)));signatureStatus=$status;publisher=$publisher}
 }finally{if($stream){$stream.Dispose()};if($process){$process.Dispose()};$hash.Dispose()}
}
function Get-OwnerCutoverPeerAncestryData {
 # No external PID/server/path/command/clock is accepted by this entry.
 $script:ownerCutoverPeerProbeState=@{stopwatch=[Diagnostics.Stopwatch]::StartNew();lastElapsed=[long]0;cursor=$null;index=0;phase='PLATFORM';exceptionClass='NONE';actualExceptionHResult=$null;diagnosticProgress=([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue));lastProgress='';progressRows=0;progressBytes=0}
 try{
  Write-OwnerCutoverPeerProbeDiagnosticProgress;Assert-OwnerCutoverPeerProbeBudget;$platform=Get-OwnerCutoverPeerProbePlatform;Assert-OwnerCutoverPeerProbeBudget
  if($platform.windows -isnot [bool] -or -not $platform.windows -or $platform.major -isnot [int] -or $platform.major -ne 5 -or $platform.nativeSystem -isnot [string] -or $platform.nativeSystem -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]+\\System32$'){throw 'REFUSE'}
  $script:ownerCutoverPeerProbeState.cursor=Get-OwnerCutoverPeerProbeSelfId;Assert-OwnerCutoverPeerProbeBudget;$rows=@();$seen=@{}
  for($index=0;$index -lt 3;$index++){
   $id=$script:ownerCutoverPeerProbeState.cursor;if($id -isnot [int] -or $id -le 0 -or $seen.ContainsKey($id)){throw 'REFUSE'};$seen[$id]=$true;$script:ownerCutoverPeerProbeState.index=$index
   Assert-OwnerCutoverPeerProbeBudget;$script:ownerCutoverPeerProbeState.phase='ROW_READ';Write-OwnerCutoverPeerProbeDiagnosticProgress;$row=Read-OwnerCutoverPeerProcessData;Assert-OwnerCutoverPeerProbeBudget
   $script:ownerCutoverPeerProbeState.phase='ROW_SHAPE';Write-OwnerCutoverPeerProbeDiagnosticProgress;Assert-OwnerRotationEntryShape $row @('pid','parentPid','creationTicks','sessionId','imagePath','imageSha256','imageIdentityKey','ownerSidSha256','signatureStatus','publisher')
   if($row.pid -isnot [int] -or $row.pid -ne $id -or $row.parentPid -isnot [int] -or $row.parentPid -le 0 -or $row.creationTicks -isnot [string] -or $row.creationTicks -cnotmatch '^[1-9][0-9]{10,18}$' -or $row.sessionId -isnot [int] -or $row.sessionId -lt 0){throw 'REFUSE'}
   foreach($name in @('imageSha256','ownerSidSha256')){if($row.$name -isnot [string] -or $row.$name -cnotmatch '^[a-f0-9]{64}$'){throw 'REFUSE'}}
   if($row.imageIdentityKey -isnot [string] -or -not $row.imageIdentityKey -or $row.imageIdentityKey.Length -gt 512){throw 'REFUSE'}
   $script:ownerCutoverPeerProbeState.phase='ROW_BINDING';Write-OwnerCutoverPeerProbeDiagnosticProgress;$fixed=$platform.nativeSystem+'\WindowsPowerShell\v1.0\powershell.exe'
   if($index -eq 1){if($row.imagePath -isnot [string] -or $row.imagePath -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]+\\node.exe$' -or $row.imageSha256 -cne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237' -or $row.signatureStatus -cne 'NOT_REQUIRED' -or $row.publisher -cne ''){throw 'REFUSE'}}elseif($row.imagePath -isnot [string] -or -not $row.imagePath.Equals($fixed,[StringComparison]::OrdinalIgnoreCase) -or $row.signatureStatus -isnot [string] -or $row.signatureStatus -cne 'Valid' -or $row.publisher -isnot [string] -or $row.publisher -cne 'Microsoft Corporation'){throw 'REFUSE'}
   if($index -gt 0 -and ($row.ownerSidSha256 -cne $rows[0].ownerSidSha256 -or $row.sessionId -ne $rows[0].sessionId -or [long]$row.creationTicks -gt [long]$rows[$index-1].creationTicks)){throw 'REFUSE'}
   $rows+=,$row;$script:ownerCutoverPeerProbeState.cursor=$row.parentPid
  }
  $script:ownerCutoverPeerProbeState.phase='CHAIN_BINDING';Write-OwnerCutoverPeerProbeDiagnosticProgress;if($rows[0].imageSha256 -cne $rows[2].imageSha256){throw 'REFUSE'};Assert-OwnerCutoverPeerProbeBudget
  $script:ownerCutoverPeerProbeState.phase='COMPLETE';Write-OwnerCutoverPeerProbeDiagnosticProgress;return [pscustomobject][ordered]@{profile='goriq-owned-node-peer-ancestry-data-v1';effectCapability=$false;helper=$rows[0];node=$rows[1];bootstrap=$rows[2]}
 }catch{$exception=$_.Exception;$script:ownerCutoverPeerProbeState.actualExceptionHResult=[int]$exception.HResult;$script:ownerCutoverPeerProbeState.exceptionClass=switch($exception.GetType().FullName){'System.Management.Automation.RuntimeException'{'RUNTIME'};'System.Management.Automation.MethodInvocationException'{'METHOD_INVOCATION'};'Microsoft.Management.Infrastructure.CimException'{'CIM'};'System.IO.IOException'{'IO'};'System.UnauthorizedAccessException'{'ACCESS'};default{'OTHER'}};throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}finally{$script:ownerCutoverPeerProbeState.stopwatch.Stop()}
}

# Explicit readonly diagnostic DATA. This invokes the same no-input producer;
# it never returns process facts, exception text, or a native capability.
function Get-OwnerCutoverPeerAncestryDiagnosticData {
 if($args.Count -ne 0){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 $completed=$false;$script:ownerCutoverPeerProbeDiagnosticRequest=$true;try{$null=Get-OwnerCutoverPeerAncestryData;$completed=$true}catch{}finally{Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue}
 $state=$script:ownerCutoverPeerProbeState
 $phases=@('PLATFORM','ROW_READ','PROCESS_QUERY','PROCESS_OPEN','OWNER_QUERY','NATIVE_COMPILE','IMAGE_OPEN','IMAGE_IDENTITY','IMAGE_READ','IMAGE_RECHECK','SIGNATURE','ROW_SHAPE','ROW_BINDING','CHAIN_BINDING','COMPLETE')
 if($state.phase -cnotin $phases -or $state.index -isnot [int] -or $state.index -lt 0 -or $state.index -gt 2 -or $state.exceptionClass -cnotin @('NONE','RUNTIME','METHOD_INVOCATION','CIM','IO','ACCESS','OTHER') -or ($null -ne $state.actualExceptionHResult -and $state.actualExceptionHResult -isnot [int]) -or ($completed -and ($state.phase -cne 'COMPLETE' -or $state.exceptionClass -cne 'NONE' -or $null -ne $state.actualExceptionHResult))){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
 return [pscustomobject][ordered]@{profile='goriq-readonly-peer-probe-diagnostic-v1';ancestryCompleted=$completed;lastEnteredPhase=$state.phase;rowIndex=$state.index;exceptionClass=$state.exceptionClass;actualExceptionHResult=$state.actualExceptionHResult;hresultMeaning='ACTUAL_DOTNET_EXCEPTION_NOT_UNDERLYING_NATIVE_CAUSE';nativeAuthority=$false;effectCapability=$false}
}

function Get-OwnerRotationEntrySources {
 return @('scripts/owner-code-rotation-acceptance.mjs','scripts/owner-code-fleet-preservation.mjs','scripts/owner-code-pc-preservation.mjs','scripts/owner-code-rotation-worker.ps1','scripts/rotate-jarvis-owner-code-windows.ps1','scripts/read-jarvis-production-config.ps1','scripts/validate-jarvis-production-config.mjs','scripts/jarvis-production-config.mjs','scripts/jarvis-windows-install-paths.mjs')
}
function Get-OwnerRotationEntryDigest([byte[]]$Bytes) {
 $sha=[Security.Cryptography.SHA256]::Create();try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-OwnerRotationEntryCodec {
 if (-not $script:ownerRotationEntryCodec) {
  $null=[Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
  $script:ownerRotationEntryCodec=[Web.Script.Serialization.JavaScriptSerializer]::new();$script:ownerRotationEntryCodec.MaxJsonLength=65536;$script:ownerRotationEntryCodec.RecursionLimit=12
 }
 return $script:ownerRotationEntryCodec
}
function ConvertFrom-OwnerRotationEntryDictionary($Value) {
 if ($Value -is [Collections.IDictionary]) {
  $properties=[ordered]@{};foreach ($key in $Value.Keys) { $properties.Add($key,(ConvertFrom-OwnerRotationEntryDictionary $Value[$key])) };return [pscustomobject]$properties
 }
 if ($Value -is [array]) { $items=@(foreach ($item in $Value) { ConvertFrom-OwnerRotationEntryDictionary $item });return ,$items }
 return $Value
}
function ConvertFrom-OwnerRotationEntryJson([string]$Text) {
 if ([IO.Path]::DirectorySeparatorChar -ne [char]92) { return ($Text|ConvertFrom-Json -DateKind String) }
 return (ConvertFrom-OwnerRotationEntryDictionary ((Get-OwnerRotationEntryCodec).DeserializeObject($Text)))
}
function ConvertTo-OwnerRotationEntryJson($Value) {
 $wire=$Value|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 8 -Compress
 if ([Text.Encoding]::UTF8.GetByteCount($wire) -gt 65536) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 return $wire
}
function Assert-OwnerRotationEntryShape($Value,[string[]]$Keys) {
 if ($null -eq $Value -or $Value -isnot [pscustomobject] -or @($Value.PSObject.Properties).Count -ne $Keys.Count) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 foreach ($key in $Keys) { if ($Value.PSObject.Properties.Name -cnotcontains $key) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
}
function Assert-OwnerRotationEntryScope {
 param($Scope,$Environment,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
 $flags=@('credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval')
 $strings=@('scopeId','ownerSid','issuedAt','expiresAt','sourceRevision','configSha256','taskSha256','nodeSha256','runtimeRevision','dbPath','attemptId','workflowRunId')
 $integers=@('maxAttempts','maxDurationSeconds','recoveryReserveSeconds','workflowRunAttempt')
 Assert-OwnerRotationEntryShape $Scope ($strings+$integers+@('sourceHashes','cohortAuthority','pcSidecars')+$flags)
 foreach ($key in $strings) { if ($Scope.$key -isnot [string]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 foreach ($key in $integers) { if ($Scope.$key -isnot [int] -and $Scope.$key -isnot [long]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 foreach ($key in $flags) { if ($Scope.$key -isnot [bool] -or $Scope.$key -ne $true) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Environment.GITHUB_ACTOR -cne 'haji84' -or $Environment.GITHUB_REPOSITORY -cne 'haji84/AI-' -or $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$' -or $Environment.GITHUB_RUN_ID -cnotmatch '^\d+$' -or $Environment.GITHUB_RUN_ATTEMPT -cne '1') { throw 'ROTATION_ENTRY_CONTEXT_REQUIRED' }
 if ($Scope.scopeId -cne 'issue:1218:owner-code-rotation' -or $Scope.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $Scope.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Scope.runtimeRevision -cnotmatch '^[a-f0-9]{40}$' -or $Scope.maxAttempts -ne 1 -or $Scope.maxDurationSeconds -ne 900 -or $Scope.recoveryReserveSeconds -ne 120 -or $Scope.workflowRunAttempt -ne 1 -or $Scope.workflowRunId -cnotmatch '^\d+$' -or $Scope.attemptId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($Scope.sourceRevision -cne $Environment.GITHUB_SHA -or $Scope.workflowRunId -cne $Environment.GITHUB_RUN_ID) { throw 'ROTATION_ENTRY_CONTEXT_REQUIRED' }
 foreach ($key in @('configSha256','taskSha256','nodeSha256')) { if ($Scope.$key -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Scope.dbPath -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]*$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 foreach ($part in $Scope.dbPath.Split([char]92)) { if ($part -in @('.','..') -or $part -match '[. ]$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 try { $issued=[datetimeoffset]::Parse($Scope.issuedAt);$expires=[datetimeoffset]::Parse($Scope.expiresAt) } catch { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($issued -gt $Now -or $expires -le $Now -or ($expires-$issued).TotalSeconds -gt 7200 -or ($expires-$Now).TotalSeconds -lt 900) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $files=Get-OwnerRotationEntrySources;Assert-OwnerRotationEntryShape $Scope.sourceHashes $files
 foreach ($file in $files) { if ($Scope.sourceHashes.$file -isnot [string] -or $Scope.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 Assert-OwnerRotationEntryShape $Scope.pcSidecars @('profile','expectedTaskFile','expectedObservationFile')
 foreach ($key in @('profile','expectedTaskFile','expectedObservationFile')) { if ($Scope.pcSidecars.$key -isnot [string]) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 if ($Scope.pcSidecars.profile -cne 'jarvis-pc-sidecars-v1' -or $Scope.pcSidecars.expectedTaskFile -cnotin @('present','absent') -or $Scope.pcSidecars.expectedObservationFile -cnotin @('present','absent')) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $cohort=$Scope.cohortAuthority
 if ($null -eq $cohort -or $cohort.kind -isnot [string] -or ($cohort.expectedCount -isnot [int] -and $cohort.expectedCount -isnot [long]) -or $cohort.expectedCount -ne 38) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 if ($cohort.kind -ceq 'approved-active-capture') { Assert-OwnerRotationEntryShape $cohort @('kind','expectedCount') }
 elseif ($cohort.kind -ceq 'original-cohort-digest') { Assert-OwnerRotationEntryShape $cohort @('kind','expectedCount','cohortSha256');if ($cohort.cohortSha256 -isnot [string] -or $cohort.cohortSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' } }
 else { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
}
# Check every existing component before reading bytes, including the checkout root.
# The original protected-path guard is imported only from this verified snapshot.
function Get-OwnerRotationEntrySafePath([string]$Path) {
 if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\r\n\0]' -or $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 $full=[IO.Path]::GetFullPath($Path);$pathRoot=[IO.Path]::GetPathRoot($full);$currentPath=$pathRoot
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92 -and ($full -notmatch '^[A-Za-z]:\\[^:]*$' -or ([IO.DriveInfo]::new($pathRoot)).DriveType -ne [IO.DriveType]::Fixed)) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 foreach ($part in @('')+$full.Substring($pathRoot.Length).Split([IO.Path]::DirectorySeparatorChar)) {
  if ($part) { $currentPath=[IO.Path]::Combine($currentPath,$part) }
  try { $attributes=[IO.File]::GetAttributes($currentPath) } catch { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
 }
 return $full
}
function Get-OwnerRotationEntrySourceSnapshot($Root,$Scope) {
 $snapshot=@{}
 foreach ($file in (Get-OwnerRotationEntrySources)) {
  $path=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($Root,$file));$item=[IO.FileInfo]::new($path);$item.Refresh()
  if (-not $item.Exists -or $item.Length -gt 1048576 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $bytes=[IO.File]::ReadAllBytes($path)
  if ($bytes.Length -gt 1048576 -or (Get-OwnerRotationEntryDigest $bytes) -cne $Scope.sourceHashes.$file) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $snapshot.Add($file,$bytes)
 }
 return $snapshot
}
function Assert-OwnerRotationEntryProtectedPath([string]$Path,[string]$OwnerSid) {
 # Omit OwnerProfile deliberately: the unchanged guard must walk all ancestors.
 try { Assert-OwnerRotationProtectedPath -Path $Path -OwnerSid $OwnerSid -NativeMetadata } catch { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
}
function Get-OwnerRotationEntryNode($Scope) {
 try {
  $commands=@(Get-Command node.exe -CommandType Application -ErrorAction Stop)
  if ($commands.Count -ne 1 -or [string]$commands[0].CommandType -cne 'Application' -or -not [IO.Path]::IsPathRooted($commands[0].Source)) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  $path=Get-OwnerRotationEntrySafePath $commands[0].Source
  if (-not [string]::Equals($path,$commands[0].Source,[StringComparison]::OrdinalIgnoreCase)) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  Assert-OwnerRotationEntryProtectedPath -Path $path -OwnerSid $Scope.ownerSid
  $item=[IO.FileInfo]::new($path);$item.Refresh()
  if (-not $item.Exists -or $item.Length -gt 268435456 -or (Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($path))) -cne $Scope.nodeSha256) { throw 'ROTATION_ENTRY_NODE_REJECTED' }
  return $path
 } catch { throw 'ROTATION_ENTRY_NODE_REJECTED' }
}
function Get-OwnerRotationEntryAdmission {
 $encoded=$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64
 if (-not $encoded -or $encoded.Length -gt 87384 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256 -cnotmatch '^[a-f0-9]{64}$' -or $env:JARVIS_PRODUCTION_CONFIG) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 try {
  $bytes=[Convert]::FromBase64String($encoded)
  if ($bytes.Length -gt 65536 -or [Convert]::ToBase64String($bytes) -cne $encoded) { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
  $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes);$scope=ConvertFrom-OwnerRotationEntryJson $text
 } catch { throw 'ROTATION_ENTRY_SCOPE_REQUIRED' }
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
 Assert-OwnerRotationEntryScope -Scope $scope -Environment $environment
 if ($env:OS -cne 'Windows_NT' -or [IO.Path]::DirectorySeparatorChar -ne [char]92 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage') { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' }
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 try { if ($identity.IsSystem -or $identity.User.Value -cne $scope.ownerSid -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or -not [Environment]::UserInteractive) { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' } } finally { $identity.Dispose() }
 $ownerProfile=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
 if (-not $ownerProfile -or -not $env:USERPROFILE -or -not [string]::Equals([IO.Path]::GetFullPath($ownerProfile),[IO.Path]::GetFullPath($env:USERPROFILE),[StringComparison]::OrdinalIgnoreCase)) { throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED' }
 return @{scope=$scope;scopeBytes=$bytes;scopeHash=(Get-OwnerRotationEntryDigest $bytes);descriptorHash=$env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256;root=[IO.Path]::GetDirectoryName($PSScriptRoot);profile=[IO.Path]::GetFullPath($ownerProfile)}
}
function New-OwnerRotationEntryClaim($Admission) {
 $scope=$Admission.scope;$stage=[IO.Path]::Combine($Admission.profile,('.goriq-owner-rotation-1218-'+$scope.attemptId));$claimPath=$stage+'.claim'
 if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage)) { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
 $record=[ordered]@{schemaVersion=1;attemptId=$scope.attemptId;originalDescriptorSha256=$Admission.descriptorHash;runtimeScopeSha256=$Admission.scopeHash;sourceRevision=$scope.sourceRevision;workflowRunId=$scope.workflowRunId;workflowRunAttempt=$scope.workflowRunAttempt}
 $bytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $record));$stream=$null
 if($Admission.protectedClaim){try{New-OwnerLauncherProtectedFile -Path $claimPath -Bytes $bytes -OwnerSid $scope.ownerSid}catch{throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'};return $claimPath}
 try {
  try { $stream=[IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None) } catch [IO.IOException] { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
  $stream.Write($bytes,0,$bytes.Length);$stream.Flush()
 } finally { if ($stream) { $stream.Dispose() } }
 return $claimPath
}
function Write-OwnerRotationEntryNewFile([string]$Path,[byte[]]$Bytes) {
 $stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try { $stream.Write($Bytes,0,$Bytes.Length);$stream.Flush() } finally { $stream.Dispose() }
}
function Get-OwnerRotationPublicResource([string]$Uri) {
 if($Uri -cnotmatch '^https://(?:api\.github\.com/repos/haji84/AI-/|raw\.githubusercontent\.com/haji84/AI-/)[A-Za-z0-9?=._/-]+$'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $request=[Net.HttpWebRequest]::Create($Uri);$request.Method='GET';$request.AllowAutoRedirect=$false;$request.Timeout=10000;$request.ReadWriteTimeout=10000;$request.UserAgent='GORIQ-1218-public-rotation-grant';$request.Accept='application/vnd.github+json'
 $response=$null;$stream=$null;$memory=[IO.MemoryStream]::new()
 try{$response=$request.GetResponse();if([int]$response.StatusCode -ne 200){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$stream=$response.GetResponseStream();$buffer=New-Object byte[] 8192;while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){if($memory.Length+$count -gt 1048576){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$memory.Write($buffer,0,$count)};return ,$memory.ToArray()}finally{if($stream){$stream.Dispose()};if($response){$response.Dispose()};$memory.Dispose()}
}
function Assert-OwnerRotationPublicSource($Grant,[string]$Root) {
 $files=@((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')
 Assert-OwnerRotationEntryShape $Grant.sourceHashes $files
 if($Grant.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Grant.ciRunId -cnotmatch '^[1-9][0-9]{0,19}$' -or $Grant.ciRunAttempt -ne 1){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 $base='https://api.github.com/repos/haji84/AI-/'
 $main=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'git/ref/heads/main'))))
 $run=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'actions/runs/'+$Grant.ciRunId))))
 $jobs=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString((Get-OwnerRotationPublicResource ($base+'actions/runs/'+$Grant.ciRunId+'/attempts/1/jobs?per_page=100'))))
 if($main.object.sha -cne $Grant.sourceRevision -or [string]$run.id -cne $Grant.ciRunId -or $run.run_attempt -ne 1 -or $run.name -cne 'CI' -or $run.path -cne '.github/workflows/ci.yml' -or $run.event -cne 'push' -or $run.head_branch -cne 'main' -or $run.head_sha -cne $Grant.sourceRevision -or $run.status -cne 'completed' -or $run.conclusion -cne 'success' -or @($jobs.jobs).Count -ne 4){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 foreach($name in @('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures')){if(@($jobs.jobs|Where-Object{$_.name -ceq $name -and $_.status -ceq 'completed' -and $_.conclusion -ceq 'success'}).Count -ne 1){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}}
 foreach($file in $files){
  if($Grant.sourceHashes.$file -isnot [string] -or $Grant.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $path=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($Root,$file));$item=[IO.FileInfo]::new($path);if($item.Length -gt 1048576){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $remote=Get-OwnerRotationPublicResource ('https://raw.githubusercontent.com/haji84/AI-/'+$Grant.sourceRevision+'/'+$file)
  if((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($path))) -cne $Grant.sourceHashes.$file -or (Get-OwnerRotationEntryDigest $remote) -cne $Grant.sourceHashes.$file){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 }
}

# The public boundary never accepts the private scope. Paths and runtime hashes
# below are acquired only from this same host, then retained in protected objects.
function Assert-OwnerRotationEntrySingleLink([string]$Path,[long]$Limit=1048576) {
 $safe=Get-OwnerRotationEntrySafePath $Path;$stream=$null;$other=$null
 try {
  $stream=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if($stream.Length -gt $Limit){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
  $first=Get-OwnerLauncherHandleIdentity -Stream $stream -Path $safe
  $other=[IO.File]::Open((Get-OwnerRotationEntrySafePath $safe),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $after=Get-OwnerLauncherHandleIdentity -Stream $other -Path $safe
  if($first.links -ne 1 -or $after.links -ne 1 -or $first.finalPath -ine $safe -or $after.finalPath -ine $safe -or $first.key -cne $after.key -or $stream.Length -ne $other.Length){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 } finally {if($other){$other.Dispose()};if($stream){$stream.Dispose()}}
}
function Get-OwnerRotationPublicAdmission {
 $encoded=$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64
 if(-not $encoded -or $encoded.Length -gt 87384 -or $encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $env:JARVIS_PRODUCTION_CONFIG){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 try{$bytes=[Convert]::FromBase64String($encoded);if([Convert]::ToBase64String($bytes) -cne $encoded -or $bytes.Length -gt 65536){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};$grant=ConvertFrom-OwnerRotationEntryJson ([Text.UTF8Encoding]::new($false,$true).GetString($bytes))}catch{throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 if($grant.kind -cne 'NONSECRET_ORIGINAL_ROTATION_GRANT' -or $grant.profile -cne 'jarvis-owner-production-v1' -or $grant.operation -cne 'rotate-verify-restore-verify-original'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $root=[IO.Path]::GetDirectoryName($PSScriptRoot)
 # Authenticate public source against official current-main CI before importing code.
 Assert-OwnerRotationPublicSource -Grant $grant -Root $root
 $snapshot=Get-OwnerRotationEntrySourceSnapshot -Root $root -Scope $grant
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($snapshot['scripts/rotate-jarvis-owner-code-windows.ps1']))) -Apply:$false -AuthorizationPath ''
 $launcher=[IO.Path]::Combine($root,'scripts','owner-code-launcher-binding-inspection-1218.ps1')
 $safe=Get-OwnerRotationEntrySafePath $launcher;$helperBytes=[IO.File]::ReadAllBytes($safe)
 if($helperBytes.Length -gt 262144 -or (Get-OwnerRotationEntryDigest $helperBytes) -cne $grant.sourceHashes.'scripts/owner-code-launcher-binding-inspection-1218.ps1'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($helperBytes))) -Inspect:$false -AuthorizationPath ''
 $kernel=Get-OwnerLauncherKernelContext
 if($kernel.isSystem -or $kernel.sessionId -le 0 -or -not $kernel.interactive -or $kernel.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or (Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes($kernel.ownerSid))) -cne $grant.ownerSidSha256 -or $kernel.profile -ine $kernel.environmentProfile){throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED'}
 $profile=Get-OwnerRotationEntrySafePath $kernel.profile
 foreach($candidate in @([IO.Path]::Combine($profile,('.goriq-owner-rotation-1218-'+$grant.approvalId)),([IO.Path]::Combine($profile,('.goriq-owner-rotation-1218-'+$grant.approvalId))+'.claim'))){try{$null=[IO.File]::GetAttributes($candidate);throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'}catch [IO.FileNotFoundException]{}catch [IO.DirectoryNotFoundException]{}}
 Assert-OwnerRotationEntryProtectedPath -Path $profile -OwnerSid $kernel.ownerSid
 foreach($file in @((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){Assert-OwnerRotationEntryProtectedPath -Path ([IO.Path]::Combine($root,$file)) -OwnerSid $kernel.ownerSid}
 # No alternate executable is selected. The PATH interpreter must be the actual
 # parent Node executable, independently protected before any configuration read.
 $command=@(Get-Command node.exe -CommandType Application -ErrorAction Stop)
 if($command.Count -ne 1 -or [string]$command[0].CommandType -cne 'Application'){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 $node=Get-OwnerRotationEntrySafePath $command[0].Source
 Assert-OwnerRotationEntryProtectedPath -Path $node -OwnerSid $kernel.ownerSid
 $nodeItem=[IO.FileInfo]::new($node);if($nodeItem.Length -gt 268435456){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 Assert-OwnerRotationEntrySingleLink -Path $node -Limit 268435456
 $nodeHash=Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($node))
 $self=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$PID) -ErrorAction Stop
 $parent=CimCmdlets\Get-CimInstance Win32_Process -Filter ('ProcessId='+$self.ParentProcessId) -ErrorAction Stop
 if(-not $parent.ExecutablePath -or [IO.Path]::GetFullPath([string]$parent.ExecutablePath) -ine $node){throw 'ROTATION_ENTRY_NODE_REJECTED'}
 # Execute only already protected exact public source. This independently checks
 # closed/canonical grant, actual workflow context and official current-main CI.
 $env:GORIQ_OWNER_ROTATION_DESCRIPTOR_SHA256=Get-OwnerRotationEntryDigest $bytes
 $entry=[IO.Path]::Combine($root,'scripts','owner-code-rotation-native-1218.mjs')
 $entryBytes=[IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $entry))
 if((Get-OwnerRotationEntryDigest $entryBytes) -cne $grant.sourceHashes.'scripts/owner-code-rotation-native-1218.mjs'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 $proof=@(& $node $entry --verify-public-grant 2>$null)
 if($LASTEXITCODE -ne 0 -or $proof.Count -ne 1 -or $proof[0] -cne 'PUBLIC_ROTATION_GRANT_VERIFIED'){throw 'ROTATION_ENTRY_SOURCE_REJECTED'}
 foreach($file in @((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){Assert-OwnerRotationEntrySingleLink -Path ([IO.Path]::Combine($root,$file))}
 Assert-OwnerRotationEntrySingleLink -Path ([IO.Path]::Combine($profile,'JARVIS','production','config.dpapi'))
 $admission=New-OwnerRotationLocalScope -Grant $grant -GrantBytes $bytes -Root $root -Kernel $kernel -Profile $profile -Node $node -NodeHash $nodeHash
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
 Assert-OwnerRotationEntryScope -Scope $admission.scope -Environment $environment
 Assert-OwnerRotationEntrySingleLink -Path $admission.scope.dbPath -Limit 268435456
 foreach($suffix in @('.pc-tasks.json','.pc-observations.json')){if([IO.File]::Exists($admission.scope.dbPath+$suffix)){Assert-OwnerRotationEntrySingleLink -Path ($admission.scope.dbPath+$suffix) -Limit 8388608}}
 $admission.helperBytes=$helperBytes
 return $admission
}
function Get-OwnerRotationHostTask { ScheduledTasks\Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop }
function Read-OwnerRotationHostConfiguration([string]$Path,[scriptblock]$Consumer) { & ([IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot),'scripts','read-jarvis-production-config.ps1')) -Path $Path -ConfigurationConsumer $Consumer|Out-Null }
function New-OwnerRotationLocalScope {
 param($Grant,[byte[]]$GrantBytes,[string]$Root,$Kernel,[string]$Profile,[string]$Node,[string]$NodeHash)
 $config=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($profile,'JARVIS','production','config.dpapi'))
 Assert-OwnerRotationEntryProtectedPath -Path $config -OwnerSid $kernel.ownerSid
 if((Get-Acl -LiteralPath $config -ErrorAction Stop).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $kernel.ownerSid){throw 'ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED'}
 $configItem=[IO.FileInfo]::new($config);if($configItem.Length -gt 1048576){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $configHash=Get-OwnerRotationHash $config;$task=Get-OwnerRotationHostTask
 if($task.State -cne 'Running'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 $taskHash=Get-OwnerRotationTaskHash $task
 $capture=@{value=$null};$consumer={param($configuration)$capture.value=$configuration}.GetNewClosure()
 try {
  Read-OwnerRotationHostConfiguration -Path $config -Consumer $consumer|Out-Null
  if(-not $capture.value -or $capture.value.commit -cnotmatch '^[a-f0-9]{40}$'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
  $configuration=$capture.value;$db=Get-OwnerRotationSafePath ([string]$configuration.environment.JARVIS_DB_PATH)
  $scope=[ordered]@{scopeId='issue:1218:owner-code-rotation';ownerSid=$kernel.ownerSid;issuedAt=$grant.issuedAt;expiresAt=$grant.expiresAt;sourceRevision=$grant.sourceRevision;sourceHashes=[ordered]@{};configSha256=$configHash;taskSha256=$taskHash;nodeSha256=$nodeHash;runtimeRevision=$configuration.commit;dbPath=$db;attemptId=$grant.approvalId;maxAttempts=1;maxDurationSeconds=900;recoveryReserveSeconds=120;cohortAuthority=$grant.cohortAuthority;pcSidecars=$grant.pcSidecars;workflowRunId=$env:GITHUB_RUN_ID;workflowRunAttempt=1}
  foreach($file in (Get-OwnerRotationEntrySources)){$scope.sourceHashes[$file]=$grant.sourceHashes.$file}
  foreach($flag in @('credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval')){$scope[$flag]=$grant.$flag}
  $scope=ConvertFrom-OwnerRotationEntryJson (ConvertTo-OwnerRotationEntryJson $scope)
  $context=[pscustomobject]@{Task=$task;NodePath=$node}
  Assert-OwnerRotationRuntimeConfiguration -Authorization $scope -Context $context -Configuration $configuration
  Assert-OwnerRotationDatabase -Authorization $scope -Context $context
  $release=Get-OwnerRotationEntrySafePath ([string]$configuration.releaseRoot);Assert-OwnerRotationEntryProtectedPath -Path $release -OwnerSid $kernel.ownerSid
  # Capture must not silently bind a mixed context across decryption or task I/O.
  if((Get-OwnerRotationHash $config) -cne $configHash -or (Get-OwnerRotationTaskHash (Get-OwnerRotationHostTask)) -cne $taskHash -or (Get-OwnerRotationHash $node) -cne $nodeHash){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
  foreach($pair in @(@('.pc-tasks.json','expectedTaskFile'),@('.pc-observations.json','expectedObservationFile'))){$exists=[IO.File]::Exists($db+$pair[0]);if($exists -ne ($scope.pcSidecars.($pair[1]) -ceq 'present')){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}}
  $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT}
  $scopeBytes=[Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $scope))
  return @{scope=$scope;scopeBytes=$scopeBytes;scopeHash=(Get-OwnerRotationEntryDigest $scopeBytes);descriptorHash=(Get-OwnerRotationEntryDigest $GrantBytes);root=$root;profile=$profile;protectedClaim=$true;publicGrantBytes=$GrantBytes;publicGrant=$grant}
 } finally {$capture.value=$null;$configuration=$null}
}

function Initialize-OwnerRotationEntryStage {
 param($PublicAdmission)
 $ErrorActionPreference='Stop';$answer=[ordered]@{schemaVersion=1;complete=$false;failureCode='ROTATION_ENTRY_PREPARATION_FAILED';profileMatchesEnvironment=$false}
 try {
  $admission=if($null -ne $PublicAdmission){$PublicAdmission}else{Get-OwnerRotationEntryAdmission};$answer.profileMatchesEnvironment=$true;$scope=$admission.scope
  $snapshot=Get-OwnerRotationEntrySourceSnapshot -Root $admission.root -Scope $scope
  . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($snapshot['scripts/rotate-jarvis-owner-code-windows.ps1']))) -Apply:$false -AuthorizationPath ''
  if($admission.protectedClaim){
   . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($admission.helperBytes))) -Inspect:$false -AuthorizationPath ''
   foreach($extra in @('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1')){
    $source=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($admission.root,$extra));Assert-OwnerRotationEntryProtectedPath -Path $source -OwnerSid $scope.ownerSid
    $data=[IO.File]::ReadAllBytes($source);if($data.Length -gt 1048576 -or (Get-OwnerRotationEntryDigest $data) -cne $admission.publicGrant.sourceHashes.$extra){throw 'ROTATION_ENTRY_SOURCE_REJECTED'};$snapshot[$extra]=$data
   }
  }
  # Import the exact verified bytes, avoiding a second unbound read before import.
  $ownerProfile=Get-OwnerRotationEntrySafePath $admission.profile
  Assert-OwnerRotationEntryProtectedPath -Path $ownerProfile -OwnerSid $scope.ownerSid
  foreach ($file in (Get-OwnerRotationEntrySources)) { Assert-OwnerRotationEntryProtectedPath -Path ([IO.Path]::Combine($admission.root,$file)) -OwnerSid $scope.ownerSid }
  $null=Get-OwnerRotationEntryNode -Scope $scope
  $claimPath=New-OwnerRotationEntryClaim -Admission $admission
  Assert-OwnerRotationEntryProtectedPath -Path $claimPath -OwnerSid $scope.ownerSid
  $stage=[IO.Path]::Combine($ownerProfile,('.goriq-owner-rotation-1218-'+$scope.attemptId))
  if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage)) { throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED' }
  $security=[Security.AccessControl.DirectorySecurity]::new();$security.SetAccessRuleProtection($true,$false);$security.SetOwner([Security.Principal.SecurityIdentifier]::new($scope.ownerSid))
  foreach ($sid in @($scope.ownerSid,'S-1-5-18','S-1-5-32-544')) { $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)) }
  # Create with security at creation; never repair or update an existing DACL.
  ([IO.DirectoryInfo]::new($stage)).Create($security)
  Assert-OwnerRotationEntryProtectedPath -Path $stage -OwnerSid $scope.ownerSid
  $null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'scripts'));$null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($stage,'.gai-results'))
  foreach ($file in $snapshot.Keys) {
   $target=[IO.Path]::Combine($stage,$file);Write-OwnerRotationEntryNewFile -Path $target -Bytes $snapshot[$file]
   Assert-OwnerRotationEntryProtectedPath -Path $target -OwnerSid $scope.ownerSid
   if ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $target)))) -cne $(if($admission.protectedClaim){$admission.publicGrant.sourceHashes.$file}else{$scope.sourceHashes.$file})) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  }
  if($admission.protectedClaim){New-OwnerLauncherProtectedFile -Path ([IO.Path]::Combine($stage,'.gai-results','original-grant.json')) -Bytes $admission.publicGrantBytes -OwnerSid $scope.ownerSid}
  $receipt=[IO.Path]::Combine([IO.Path]::Combine($stage,'.gai-results'),'owner-code-rotation-scope.json')
  Write-OwnerRotationEntryNewFile -Path $receipt -Bytes $admission.scopeBytes
  Assert-OwnerRotationEntryProtectedPath -Path $receipt -OwnerSid $scope.ownerSid
  if ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes((Get-OwnerRotationEntrySafePath $receipt)))) -cne $admission.scopeHash) { throw 'ROTATION_ENTRY_SOURCE_REJECTED' }
  $answer.complete=$true;$answer.failureCode=$null
 } catch {
  $code=[string]$_.Exception.Message
  if ($code -cin @('ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED','ROTATION_ENTRY_PREPARATION_FAILED')) { $answer.failureCode=$code }
 }
 return $answer
}
function Get-OwnerRotationProfileSelection {
 param([object]$Encoded,$Environment,[datetimeoffset]$Now=[datetimeoffset]::UtcNow)
 # DATA selector only. It performs no OS identity/config/Node/API operation.
 if($Encoded -isnot [string] -or -not $Encoded -or $Encoded.Length -gt 87384 -or $Encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 try{$bytes=[Convert]::FromBase64String($Encoded);if($bytes.Length -gt 65536 -or [Convert]::ToBase64String($bytes) -cne $Encoded){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};$text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes);$g=ConvertFrom-OwnerRotationEntryJson $text;if((ConvertTo-OwnerRotationEntryJson $g) -cne $text){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}catch{throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $flags=@('credentialRotationApproval','existingTaskRestartApproval','configPersistenceApproval','normalLoopbackCookieApproval','confirmationApproval','automationConfirmationApproval','fleetReadOnlyApproval','pcSidecarReadOnlyApproval')
 $fields=@('schemaVersion','kind','scopeId','issue','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','sourceHashes','ciRunId','ciRunAttempt','workflowPath','ownerSidSha256','profile','operation','issuedAt','expiresAt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds','cohortAuthority','pcSidecars')+$flags
 if($g.profile -isnot [string]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $cutover=$g.profile -ceq 'jarvis-owner-production-cutover-v1'
 if(-not $cutover -and $g.profile -cne 'jarvis-owner-production-v1'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 if($cutover){$fields+=@('taskActionMigration','knownRecoveryTask','protectedNodeBootstrap','credentialProof');if($bytes.Length -gt 32768 -or $Encoded.Length -gt 43692){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 Assert-OwnerRotationEntryShape $g $fields
 foreach($key in @('schemaVersion','issue','ciRunAttempt','maxAttempts','maxDurationSeconds','recoveryReserveSeconds')){if($g.$key -isnot [int] -and $g.$key -isnot [long]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 foreach($key in @('kind','scopeId','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','ciRunId','workflowPath','ownerSidSha256','profile','operation','issuedAt','expiresAt')){if($g.$key -isnot [string]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 foreach($key in $flags){if($g.$key -isnot [bool] -or -not $g.$key){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 if($g.schemaVersion -ne $(if($cutover){2}else{1}) -or $g.kind -cne 'NONSECRET_ORIGINAL_ROTATION_GRANT' -or $g.scopeId -cne 'issue:1218:owner-code-rotation' -or $g.issue -ne 1218 -or $g.goalId -cne 'goal-fcc81c97e09153f7' -or $g.authorityType -cne 'FRESH_OWNER_HIGH_ROTATION_RESTORATION_APPROVAL' -or $g.issuedBy -cne 'owner-approved-task-operator' -or $g.operation -cne $(if($cutover){'cutover-rotate-verify-restore-verify-original'}else{'rotate-verify-restore-verify-original'}) -or $g.maxAttempts -ne 1 -or $g.maxDurationSeconds -ne 900 -or $g.recoveryReserveSeconds -ne 120 -or $g.ciRunAttempt -ne 1 -or $g.workflowPath -cne '.github/workflows/gai-zbook-diagnostic-1218.yml'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 if($g.approvalId -cnotmatch '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' -or $g.approvalReference -cnotmatch '^owner-approval:[a-f0-9]{64}$' -or $g.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $g.ownerSidSha256 -cnotmatch '^[a-f0-9]{64}$' -or $g.ciRunId -cnotmatch '^[1-9][0-9]{0,19}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $dates=@();foreach($key in @('issuedAt','expiresAt')){$d=[datetimeoffset]::MinValue;if(-not [datetimeoffset]::TryParseExact($g.$key,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$d)){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};$dates+=$d}
 if($dates[0] -gt $Now -or ($dates[1]-$Now).TotalSeconds -lt 900 -or ($dates[1]-$dates[0]).TotalSeconds -gt 7200 -or $dates[1] -gt [datetimeoffset]::Parse('2026-11-10T08:00:00Z')){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 $files=@((Get-OwnerRotationEntrySources))+@('scripts/owner-code-rotation-native-1218.mjs','scripts/owner-code-rotation-native-1218.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/owner-code-rotation-exercise.mjs','scripts/owner-code-rotation-exercise.ps1');if($cutover){$files+=@('scripts/owner-code-production-cutover-1218.ps1')};Assert-OwnerRotationEntryShape $g.sourceHashes $files
 foreach($file in $files){if($g.sourceHashes.$file -isnot [string] -or $g.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 Assert-OwnerRotationEntryShape $g.cohortAuthority @('kind','expectedCount');if($g.cohortAuthority.kind -isnot [string] -or $g.cohortAuthority.kind -cne 'approved-active-capture' -or ($g.cohortAuthority.expectedCount -isnot [int] -and $g.cohortAuthority.expectedCount -isnot [long]) -or $g.cohortAuthority.expectedCount -ne 38){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
 Assert-OwnerRotationEntryShape $g.pcSidecars @('profile','expectedTaskFile','expectedObservationFile');if($g.pcSidecars.profile -isnot [string] -or $g.pcSidecars.profile -cne 'jarvis-pc-sidecars-v1'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};foreach($key in @('expectedTaskFile','expectedObservationFile')){if($g.pcSidecars.$key -isnot [string] -or $g.pcSidecars.$key -cnotin @('present','absent')){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 if($cutover){
  Assert-OwnerRotationEntryShape $g.taskActionMigration @('approved','taskName','taskPath','target');if($g.taskActionMigration.approved -isnot [bool] -or -not $g.taskActionMigration.approved){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
  foreach($pair in @(@('taskName','JARVIS Remote Host'),@('taskPath','\'),@('target','bound-direct-node'))){if($g.taskActionMigration.($pair[0]) -isnot [string] -or $g.taskActionMigration.($pair[0]) -cne $pair[1]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
  Assert-OwnerRotationEntryShape $g.knownRecoveryTask @('approved','profile','maxTasks','allowedOperations','disposition');$recovery=$g.knownRecoveryTask
  if($recovery.approved -isnot [bool] -or -not $recovery.approved -or ($recovery.maxTasks -isnot [int] -and $recovery.maxTasks -isnot [long]) -or $recovery.maxTasks -ne 1 -or $recovery.profile -isnot [string] -or $recovery.profile -cne 'interactive-owner-limited-manual-v1' -or $recovery.disposition -isnot [string] -or $recovery.disposition -cne 'retain-until-password-primary-healthy' -or $recovery.allowedOperations -isnot [array] -or $recovery.allowedOperations.Count -ne 2 -or $recovery.allowedOperations[0] -isnot [string] -or $recovery.allowedOperations[0] -cne 'preflight' -or $recovery.allowedOperations[1] -isnot [string] -or $recovery.allowedOperations[1] -cne 'recover-known-runtime'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}
  $node=[ordered]@{approved=$true;version='24.19.0';architecture='x64';archiveSha256='57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';nodeSha256='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';signerCertificateSha256='c5b94f1334367cb4fa004504d0cb62a558d30e1c3c712f729a02333bf5011522';publisher='OpenJS Foundation';retention='while-referenced'}
  Assert-OwnerRotationEntryShape $g.protectedNodeBootstrap @($node.Keys);foreach($key in $node.Keys){if($node[$key] -is [bool]){if($g.protectedNodeBootstrap.$key -isnot [bool] -or $g.protectedNodeBootstrap.$key -ne $node[$key]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}elseif($g.protectedNodeBootstrap.$key -isnot [string] -or $g.protectedNodeBootstrap.$key -cne $node[$key]){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
  Assert-OwnerRotationEntryShape $g.credentialProof @('runId','jobId','artifactId','approvalBase64','archiveBase64','dispatchLedgerSha256','independentVerdictSha256');foreach($key in @('runId','jobId','artifactId')){if($g.credentialProof.$key -isnot [string] -or $g.credentialProof.$key -cnotmatch '^[1-9][0-9]{0,19}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}};foreach($key in @('dispatchLedgerSha256','independentVerdictSha256')){if($g.credentialProof.$key -isnot [string] -or $g.credentialProof.$key -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
  foreach($pair in @(@('approvalBase64',1024),@('archiveBase64',16384))){$value=$g.credentialProof.($pair[0]);if($value -isnot [string] -or $value -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'};try{$data=[Convert]::FromBase64String($value);if($data.Length -gt $pair[1] -or [Convert]::ToBase64String($data) -cne $value){throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}catch{throw 'ROTATION_ENTRY_SCOPE_REQUIRED'}}
 }
 $ambient=$Environment.PSObject.Properties['JARVIS_PRODUCTION_CONFIG'];if($Environment.GITHUB_ACTOR -cne 'haji84' -or $Environment.GITHUB_REPOSITORY -cne 'haji84/AI-' -or $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_SHA -cne $g.sourceRevision -or $Environment.GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]{0,19}$' -or $Environment.GITHUB_RUN_ATTEMPT -cne '1' -or $Environment.GITHUB_WORKFLOW_REF -cne 'haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main' -or ($ambient -and $ambient.Value)){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 return [pscustomobject][ordered]@{schemaVersion=1;profile=$(if($cutover){'CUTOVER_V1'}else{'OLD_V1'});originalGrantSha256=(Get-OwnerRotationEntryDigest $bytes);sourceRevision=$g.sourceRevision;effectCapability=$false;nativeCalls=0}
}

# Public-source/job observations are process-private DATA, never native effects.
function Get-OwnerCutoverUtcNow {[datetimeoffset]::UtcNow}
function Get-OwnerCutoverMonotonicStamp {[Diagnostics.Stopwatch]::GetTimestamp()}
function Get-OwnerCutoverMonotonicFrequency {[Diagnostics.Stopwatch]::Frequency}
function New-OwnerCutoverPublicRequest([string]$Uri){
 if($Uri -cnotmatch '^https://(?:api\.github\.com/repos/haji84/AI-/|raw\.githubusercontent\.com/haji84/AI-/)[A-Za-z0-9?=._/-]+$'){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 return [Net.HttpWebRequest]::Create($Uri)
}
function Get-OwnerCutoverPublicTimeout($State){$clock=Read-OwnerCutoverClock $State;if($clock.remainingForwardMs -le 0){throw 'ROTATION_CUTOVER_FORWARD_RESERVE'};return [int][Math]::Max(1,[Math]::Min(10000,$clock.remainingForwardMs))}
function Get-OwnerCutoverBootstrapPublicResource([string]$Uri,$State){
 Assert-OwnerCutoverPublicBudget $State
 $base='https://api.github.com/repos/haji84/AI-/';$raw='https://raw.githubusercontent.com/haji84/AI-/'+$State.sourceRevision+'/'
 $allowed=@(($base+'actions/runs/'+$State.workflowRunId),($base+'actions/runs/'+$State.workflowRunId+'/attempts/1/jobs?per_page=100'),($base+'git/ref/heads/main'),($base+'actions/runs/'+$State.grant.ciRunId),($base+'actions/runs/'+$State.grant.ciRunId+'/attempts/1/jobs?per_page=100'),($raw+'.github/workflows/gai-zbook-diagnostic-1218.yml'));foreach($file in $State.grant.sourceHashes.PSObject.Properties.Name){$allowed+=($raw+$file)}
 if($Uri -isnot [string] -or $allowed -cnotcontains $Uri){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 $request=$null;$response=$null;$stream=$null;$memory=[IO.MemoryStream]::new()
 try{
  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
  Assert-OwnerCutoverPublicBudget $State;$request=New-OwnerCutoverPublicRequest $Uri;Assert-OwnerCutoverPublicBudget $State
  $timeout=Get-OwnerCutoverPublicTimeout $State;$request.Method='GET';$request.AllowAutoRedirect=$false;$request.Timeout=$timeout;$request.ReadWriteTimeout=$timeout;$request.UseDefaultCredentials=$false;$request.Credentials=$null;$request.PreAuthenticate=$false;$request.UserAgent='GORIQ-1218-source-clock-bootstrap';$request.Accept='application/vnd.github+json'
  Assert-OwnerCutoverPublicBudget $State;$response=$request.GetResponse();Assert-OwnerCutoverPublicBudget $State
  $status=$response.StatusCode;Assert-OwnerCutoverPublicBudget $State;$responseUri=$response.ResponseUri;Assert-OwnerCutoverPublicBudget $State
  if([int]$status -ne 200 -or $responseUri -isnot [uri] -or $responseUri.AbsoluteUri -cne $Uri){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
  $stream=$response.GetResponseStream();Assert-OwnerCutoverPublicBudget $State
  $buffer=New-Object byte[] 8192
  while($true){
   Assert-OwnerCutoverPublicBudget $State;$canTimeout=$stream.CanTimeout;Assert-OwnerCutoverPublicBudget $State
   if($canTimeout -isnot [bool] -or -not $canTimeout){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
   $stream.ReadTimeout=Get-OwnerCutoverPublicTimeout $State;Assert-OwnerCutoverPublicBudget $State
   $count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPublicBudget $State
   if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $memory.Length+$count -gt 1048576){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$memory.Write($buffer,0,$count)
  }
  Assert-OwnerCutoverPublicBudget $State;return ,$memory.ToArray()
 }finally{
  # Close only this owned transport. Abort prevents draining unread bodies after
  # expiry; no later response read or protected Owner operation is permitted.
  if($request){try{$request.Abort()}catch{}};if($stream){try{$stream.Dispose()}catch{}};if($response){try{$response.Dispose()}catch{}};$memory.Dispose()
 }
}

function Test-OwnerCutoverInteger($Value){return (($Value -is [int] -or $Value -is [long]) -and $Value -gt 0 -and $Value -le 9007199254740991)}
function Assert-OwnerCutoverMetadataFields($Value,$Expected){
 if($null -eq $Value -or $Value -isnot [pscustomobject]){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 foreach($key in $Expected.Keys){$p=$Value.PSObject.Properties[$key];if(-not $p){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$want=$Expected[$key];if($null -eq $want){if($null -ne $p.Value){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}}elseif($want -is [string]){if($p.Value -isnot [string] -or $p.Value -cne $want){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}}elseif(-not(Test-OwnerCutoverInteger $p.Value) -or $p.Value -ne $want){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}}
}
function Read-OwnerCutoverClock($State){
 $store=Get-Variable -Name ownerCutoverPublicLifetimes -Scope Script -ErrorAction SilentlyContinue;$registered=$null
 if(-not $store -or -not $script:ownerCutoverPublicLifetimes.ContainsKey('states') -or $null -eq $State -or -not $script:ownerCutoverPublicLifetimes.states.TryGetValue($State,[ref]$registered) -or -not [object]::ReferenceEquals($State,$registered)){throw 'ROTATION_CUTOVER_CLOCK_INVALID'}
 if($State.terminal){throw $State.terminal}
 try{
  $utc=Get-OwnerCutoverUtcNow;$stamp=Get-OwnerCutoverMonotonicStamp;$frequency=Get-OwnerCutoverMonotonicFrequency
  if($utc -isnot [datetimeoffset] -or ($stamp -isnot [long] -and $stamp -isnot [int]) -or $stamp -lt 0 -or ($frequency -isnot [long] -and $frequency -isnot [int]) -or $frequency -le 0 -or $frequency -ne $State.frequency -or $stamp -lt $State.lastStamp -or $utc -lt $State.lastUtc){throw 'INVALID_ORIGINAL_CLOCK'}
  $State.lastUtc=$utc;$State.lastStamp=$stamp;$elapsed=([double]($stamp-$State.originStamp)/[double]$frequency)*1000.0
  $remaining=[Math]::Min(($State.hardEnd-$utc).TotalMilliseconds,($State.hardEnd-$State.originUtc).TotalMilliseconds-$elapsed)
  if([double]::IsNaN($remaining) -or [double]::IsInfinity($remaining) -or $remaining -le 0){throw 'INVALID_ORIGINAL_CLOCK'}
  return @{remainingHardMs=[long][Math]::Floor($remaining);remainingForwardMs=[long][Math]::Max(0,[Math]::Floor($remaining-120000))}
 }catch{$State.terminal='ROTATION_CUTOVER_CLOCK_INVALID';throw 'ROTATION_CUTOVER_CLOCK_INVALID'}
}
# Original registered-clock endpoint DATA only. No QPC association, phase,
# channel, native capability or live capture is created by these functions.
function Get-OwnerCutoverOriginalClockEndpointData {
 param([object]$PublicToken)
function Resolve-OwnerCutoverClockEndpointState($Token){
 $storeVariable=Get-Variable -Name ownerCutoverPublicLifetimes -Scope Script -ErrorAction SilentlyContinue
 if(-not $storeVariable -or $null -eq $Token){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
 $store=$storeVariable.Value
 if($store -isnot [hashtable] -or $store.tokens -isnot [Runtime.CompilerServices.ConditionalWeakTable[object,object]] -or $store.states -isnot [Runtime.CompilerServices.ConditionalWeakTable[object,object]] -or $store.allocations -isnot [hashtable]){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
 $state=$null;$registered=$null
 if(-not $store.tokens.TryGetValue($Token,[ref]$state) -or $state -isnot [hashtable] -or -not $store.states.TryGetValue($state,[ref]$registered) -or -not [object]::ReferenceEquals($state,$registered) -or -not [object]::ReferenceEquals($Token,$state.token) -or $state.workflowRunId -isnot [string] -or $state.workflowRunId -cnotmatch '^[1-9][0-9]{0,19}$'){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
 $allocation='haji84/AI-|haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main|'+$state.workflowRunId+'|1|inspect'
 if(-not $store.allocations.ContainsKey($allocation) -or -not [object]::ReferenceEquals($store.allocations[$allocation],$state)){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
 return $state
}
function Get-OwnerCutoverClockEndpointPins($State){
 if($State.phase -cne 'PUBLIC_SOURCE_BOUND' -or $State.originUtc -isnot [datetimeoffset] -or $State.lastUtc -isnot [datetimeoffset] -or $State.hardEnd -isnot [datetimeoffset]){throw 'ENDPOINT_BINDING_REQUIRED'}
 foreach($name in @('originStamp','lastStamp','frequency')){if(($State[$name] -isnot [long] -and $State[$name] -isnot [int]) -or $State[$name] -lt 0){throw 'ENDPOINT_BINDING_REQUIRED'}}
 if($State.frequency -le 0 -or $State.lastStamp -lt $State.originStamp -or $State.lastUtc -lt $State.originUtc -or $State.hardEnd -le $State.originUtc -or ($State.hardEnd-$State.originUtc).Ticks -gt 9000000000L){throw 'ENDPOINT_BINDING_REQUIRED'}
 if($State.grant -isnot [pscustomobject] -or $State.sourceFiles -isnot [hashtable] -or $State.sourceRevision -isnot [string] -or $State.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $State.grantHash -isnot [string] -or $State.grantHash -cnotmatch '^[a-f0-9]{64}$' -or $State.workflowHash -isnot [string] -or $State.workflowHash -cnotmatch '^[a-f0-9]{64}$' -or $State.jobId -isnot [string] -or $State.jobId -cnotmatch '^[1-9][0-9]{0,19}$' -or $State.jobStartedAt -isnot [string]){throw 'ENDPOINT_BINDING_REQUIRED'}
 $job=[datetimeoffset]::MinValue;$expiry=[datetimeoffset]::MinValue
 if(-not [datetimeoffset]::TryParseExact($State.jobStartedAt,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$job) -or -not [datetimeoffset]::TryParseExact($State.grant.expiresAt,'yyyy-MM-ddTHH:mm:ss.fffZ',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$expiry)){throw 'ENDPOINT_BINDING_REQUIRED'}
 if($job -gt $State.lastUtc -or $State.hardEnd -gt $job.AddSeconds(900) -or $State.hardEnd -gt $expiry -or $State.grant.maxDurationSeconds -ne 900 -or $State.grant.recoveryReserveSeconds -ne 120 -or $State.grant.sourceRevision -cne $State.sourceRevision -or (Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $State.grant)))) -cne $State.grantHash){throw 'ENDPOINT_BINDING_REQUIRED'}
 $references=[Array]::AsReadOnly([object[]]@($State.grant,$State.grant.sourceHashes,$State.sourceFiles));$values=[Array]::AsReadOnly([object[]]@($State.root,$State.sourceRevision,$State.grantHash,$State.workflowRunId,$State.workflowHash,$State.jobId,$State.jobStartedAt,$State.originUtc.UtcDateTime.Ticks,[long]$State.originStamp,[long]$State.frequency));$providers=[Array]::AsReadOnly([object[]]@((Get-Command Read-OwnerCutoverClock -CommandType Function).ScriptBlock,(Get-Command Get-OwnerCutoverUtcNow -CommandType Function).ScriptBlock,(Get-Command Get-OwnerCutoverMonotonicStamp -CommandType Function).ScriptBlock,(Get-Command Get-OwnerCutoverMonotonicFrequency -CommandType Function).ScriptBlock));return [Tuple[object,object,object]]::new($references,$values,$providers)
}
function Test-OwnerCutoverClockEndpointPins($Before,$After){
 if($Before -isnot [Tuple[object,object,object]] -or $After -isnot [Tuple[object,object,object]]){return $false}
 foreach($name in @('Item1','Item2','Item3')){if($Before.$name -isnot [Collections.ObjectModel.ReadOnlyCollection[object]] -or $After.$name -isnot [Collections.ObjectModel.ReadOnlyCollection[object]] -or $Before.$name.Count -ne $After.$name.Count){return $false};for($i=0;$i -lt $Before.$name.Count;$i++){if($name -ceq 'Item2'){if(-not [object]::Equals($Before.$name[$i],$After.$name[$i])){return $false}}elseif(-not [object]::ReferenceEquals($Before.$name[$i],$After.$name[$i])){return $false}}};return $true
}
function Test-OwnerCutoverClockEndpointBookkeeping($Lifetime,$History){
 if($Lifetime -isnot [Tuple[object,object]] -or $History -isnot [Tuple[object,object,bool]] -or -not [object]::ReferenceEquals($Lifetime,$History.Item1) -or $History.Item3){return $false}
 $mirror=$Lifetime.Item2;$names=@('previousHard','previousForward','previousHardEnd','lastUtc','lastStamp')
 if($mirror -isnot [hashtable] -or $mirror.Count -ne 6 -or -not $mirror.ContainsKey('terminal') -or $mirror.terminal -isnot [bool] -or $mirror.terminal){return $false}
 if($null -ne $History.Item2 -and $History.Item2 -isnot [Tuple[long,long,long,long,long]]){return $false}
 for($i=0;$i -lt $names.Count;$i++){$name=$names[$i];if(-not $mirror.ContainsKey($name)){return $false};if($null -eq $History.Item2){if($null -ne $mirror[$name]){return $false}}else{$item='Item'+($i+1);if($mirror[$name] -isnot [long] -or -not [object]::Equals($mirror[$name],$History.Item2.$item)){return $false}}};return $true
}
 $state=$null;$record=$null;$lifetime=$null;$history=$null;$originalPins=$null;$latchOriginal=$false
 try{
  if($args.Count -ne 0 -or $PSBoundParameters.Count -ne 1 -or -not $PSBoundParameters.ContainsKey('PublicToken')){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
  $state=Resolve-OwnerCutoverClockEndpointState $PublicToken
  $storeVariable=Get-Variable -Name ownerCutoverClockEndpointRecords -Scope Script -ErrorAction SilentlyContinue
  if(-not $storeVariable){
   if((Get-Variable -Name ownerCutoverClockEndpointPins -Scope Script -ErrorAction SilentlyContinue) -or (Get-Variable -Name ownerCutoverClockEndpointHistory -Scope Script -ErrorAction SilentlyContinue)){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
   $script:ownerCutoverClockEndpointRecords=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();$script:ownerCutoverClockEndpointPins=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();$script:ownerCutoverClockEndpointHistory=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()
  }
  $pinStore=Get-Variable -Name ownerCutoverClockEndpointPins -Scope Script -ErrorAction SilentlyContinue
  $historyStore=Get-Variable -Name ownerCutoverClockEndpointHistory -Scope Script -ErrorAction SilentlyContinue
  if($script:ownerCutoverClockEndpointRecords -isnot [Runtime.CompilerServices.ConditionalWeakTable[object,object]] -or -not $pinStore -or $pinStore.Value -isnot [Runtime.CompilerServices.ConditionalWeakTable[object,object]] -or -not $historyStore -or $historyStore.Value -isnot [Runtime.CompilerServices.ConditionalWeakTable[object,object]]){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  $hasHistory=$script:ownerCutoverClockEndpointHistory.TryGetValue($state,[ref]$history)
  if(-not $script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$lifetime)){
   $orphanPins=$null;if($hasHistory -or $script:ownerCutoverClockEndpointPins.TryGetValue($state,[ref]$orphanPins)){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
   $record=@{terminal=$false;previousHard=$null;previousForward=$null;previousHardEnd=$null;lastUtc=$null;lastStamp=$null};$initialPins=$null
   try{$initialPins=Get-OwnerCutoverClockEndpointPins $state}catch{$record.terminal=$true}
   $lifetime=[Tuple[object,object]]::new($initialPins,$record);$history=[Tuple[object,object,bool]]::new($lifetime,$null,[bool]$record.terminal);$script:ownerCutoverClockEndpointRecords.Add($state,$lifetime);$script:ownerCutoverClockEndpointHistory.Add($state,$history);if($initialPins){$script:ownerCutoverClockEndpointPins.Add($state,$initialPins)}
  }
  # Issued lifetime, accepted minima and terminal history are immutable and
  # separate from the mutable mirror. Null/replaced bookkeeping is never first use.
  if(-not (Test-OwnerCutoverClockEndpointBookkeeping $lifetime $history) -or $lifetime.Item1 -isnot [Tuple[object,object,object]]){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  $record=$lifetime.Item2;$originalPins=$lifetime.Item1
  $accepted=$history.Item2
  $issuedPins=$null;if(-not $script:ownerCutoverClockEndpointPins.TryGetValue($state,[ref]$issuedPins) -or -not [object]::ReferenceEquals($issuedPins,$originalPins)){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  if($state.terminal){throw 'ENDPOINT_ORIGINAL_INVALID'}
  try{$pins=Get-OwnerCutoverClockEndpointPins $state}catch{$latchOriginal=$true;throw}
  if(-not (Test-OwnerCutoverClockEndpointPins $originalPins $pins)){$latchOriginal=$true;throw 'ENDPOINT_BINDING_CHANGED'}
  if($null -ne $accepted){
   $reserve=[System.Numerics.BigInteger]::Multiply([System.Numerics.BigInteger]120,[System.Numerics.BigInteger]$state.frequency);$expectedForward=[System.Numerics.BigInteger]::Max([System.Numerics.BigInteger]::Zero,[System.Numerics.BigInteger]::Subtract([System.Numerics.BigInteger]$accepted.Item1,$reserve))
   if([System.Numerics.BigInteger]$accepted.Item2 -ne $expectedForward){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
   if($state.hardEnd.UtcDateTime.Ticks -gt $accepted.Item3 -or $state.lastUtc.UtcDateTime.Ticks -lt $accepted.Item4 -or $state.lastStamp -lt $accepted.Item5){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  }
  $null=Read-OwnerCutoverClock $state
  $stillRegistered=Resolve-OwnerCutoverClockEndpointState $PublicToken;if(-not [object]::ReferenceEquals($stillRegistered,$state)){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
  if($state.terminal){throw 'ENDPOINT_ORIGINAL_INVALID'}
  $firstUtc=$state.lastUtc;$firstStamp=[long]$state.lastStamp
  $firstHardEnd=$state.hardEnd
  $samplePins=Get-OwnerCutoverClockEndpointPins $state
  if(-not (Test-OwnerCutoverClockEndpointPins $pins $samplePins)){$latchOriginal=$true;throw 'ENDPOINT_BINDING_CHANGED'}
  # A genuine same-provider monotonic observation BEFORE the second UTC read.
  $pre=Get-OwnerCutoverMonotonicStamp
  if(($pre -isnot [long] -and $pre -isnot [int]) -or $pre -lt $firstStamp){$latchOriginal=$true;throw 'ENDPOINT_ORIGINAL_OBSERVATION_INVALID'}
  $null=Read-OwnerCutoverClock $state
  if($state.hardEnd -gt $firstHardEnd){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  if($state.lastStamp -lt $pre -or $state.lastUtc -lt $firstUtc){$latchOriginal=$true;throw 'ENDPOINT_ORIGINAL_OBSERVATION_INVALID'}
  if($state.terminal){throw 'ENDPOINT_ORIGINAL_INVALID'}
  $afterPins=Get-OwnerCutoverClockEndpointPins $state
  if(-not (Test-OwnerCutoverClockEndpointPins $pins $afterPins)){$latchOriginal=$true;throw 'ENDPOINT_BINDING_CHANGED'}
  $stillRegistered=Resolve-OwnerCutoverClockEndpointState $PublicToken;if(-not [object]::ReferenceEquals($stillRegistered,$state)){throw 'ENDPOINT_REGISTRATION_REQUIRED'}
  $currentLifetime=$null;$currentHistory=$null;if(-not $script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$currentLifetime) -or -not $script:ownerCutoverClockEndpointHistory.TryGetValue($state,[ref]$currentHistory) -or -not [object]::ReferenceEquals($currentLifetime,$lifetime) -or -not [object]::ReferenceEquals($currentHistory,$history) -or -not (Test-OwnerCutoverClockEndpointBookkeeping $lifetime $history)){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  $o=[System.Numerics.BigInteger]$state.originUtc.UtcDateTime.Ticks;$h=[System.Numerics.BigInteger]$state.hardEnd.UtcDateTime.Ticks;$u=[System.Numerics.BigInteger]$state.lastUtc.UtcDateTime.Ticks;$p=[System.Numerics.BigInteger]$state.originStamp;$f=[System.Numerics.BigInteger]$state.frequency;$s=[System.Numerics.BigInteger]$state.lastStamp;$b=[System.Numerics.BigInteger]$pre;$t=[System.Numerics.BigInteger]10000000;$limit=[System.Numerics.BigInteger][long]::MaxValue
  $duration=[System.Numerics.BigInteger]::Subtract($h,$o);$utcRemaining=[System.Numerics.BigInteger]::Subtract($h,$u)
  if($duration -le 0 -or $duration -gt 9000000000L -or $utcRemaining -le 0){throw 'ENDPOINT_RANGE_REQUIRED'}
  $nominal=[System.Numerics.BigInteger]::Add($p,[System.Numerics.BigInteger]::Divide([System.Numerics.BigInteger]::Multiply($duration,$f),$t))
  if($nominal -lt 0 -or $nominal -gt $limit){throw 'ENDPOINT_RANGE_REQUIRED'}
  $utcCap=[System.Numerics.BigInteger]::Add($b,[System.Numerics.BigInteger]::Divide([System.Numerics.BigInteger]::Multiply($utcRemaining,$f),$t));$hard=[System.Numerics.BigInteger]::Min($nominal,$utcCap)
  if($null -ne $accepted){$hard=[System.Numerics.BigInteger]::Min($hard,[System.Numerics.BigInteger]$accepted.Item1)}
  $reserve=[System.Numerics.BigInteger]::Multiply([System.Numerics.BigInteger]120,$f);$forward=[System.Numerics.BigInteger]::Max([System.Numerics.BigInteger]::Zero,[System.Numerics.BigInteger]::Subtract($hard,$reserve));$remainingHard=[System.Numerics.BigInteger]::Subtract($hard,$s);$remainingForward=[System.Numerics.BigInteger]::Max([System.Numerics.BigInteger]::Zero,[System.Numerics.BigInteger]::Subtract($forward,$s))
  if($remainingHard -le 0){throw 'ENDPOINT_CONSERVATIVE_CUT_REACHED'}
  foreach($value in @($hard,$forward,$remainingHard,$remainingForward)){if($value -lt 0 -or $value -gt $limit){throw 'ENDPOINT_RANGE_REQUIRED'}}
  if($null -ne $accepted -and $forward -gt [System.Numerics.BigInteger]$accepted.Item2){throw 'ENDPOINT_BOOKKEEPING_REQUIRED'}
  $record.previousHard=[long]$hard;$record.previousForward=[long]$forward;$record.previousHardEnd=[long]$h;$record.lastUtc=[long]$u;$record.lastStamp=[long]$s
  $nextAccepted=[Tuple[long,long,long,long,long]]::new([long]$hard,[long]$forward,[long]$h,[long]$u,[long]$s);$null=$script:ownerCutoverClockEndpointHistory.Remove($state);$script:ownerCutoverClockEndpointHistory.Add($state,[Tuple[object,object,bool]]::new($lifetime,$nextAccepted,$false))
  $culture=[Globalization.CultureInfo]::InvariantCulture
  return [pscustomobject][ordered]@{schemaVersion=1;profile='goriq-original-clock-endpoints-data-v1';sourceRevision=$state.sourceRevision;originalGrantSha256=$state.grantHash;workflowRunId=$state.workflowRunId;officialJobId=$state.jobId;originUtcTicks=$o.ToString($culture);originStamp=$p.ToString($culture);frequency=$f.ToString($culture);sampleUtcTicks=$u.ToString($culture);sampleStamp=$s.ToString($culture);hardEndUtcTicks=$h.ToString($culture);hardStampEndpoint=$hard.ToString($culture);forwardStampEndpoint=$forward.ToString($culture);remainingHardTicks=$remainingHard.ToString($culture);remainingForwardTicks=$remainingForward.ToString($culture);nativeAuthority=$false;effectCapability=$false;qpcAssociationVerified=$false}
 }catch{
  # Refusal history cannot be cleared by repairing/replacing the mutable mirror.
  if($state){try{$terminalStore=Get-Variable -Name ownerCutoverClockEndpointHistory -Scope Script -ErrorAction SilentlyContinue;$terminalHistory=$null;if($terminalStore -and $terminalStore.Value -is [Runtime.CompilerServices.ConditionalWeakTable[object,object]] -and $terminalStore.Value.TryGetValue($state,[ref]$terminalHistory) -and $terminalHistory -is [Tuple[object,object,bool]]){$null=$terminalStore.Value.Remove($state);$terminalStore.Value.Add($state,[Tuple[object,object,bool]]::new($terminalHistory.Item1,$terminalHistory.Item2,$true))}}catch{}}
  # Re-resolve all genuine registrations before any additional original latch.
  if($latchOriginal -and $state){try{$recognized=Resolve-OwnerCutoverClockEndpointState $PublicToken;if([object]::ReferenceEquals($recognized,$state)){$issued=$null;$current=$null;if($script:ownerCutoverClockEndpointPins.TryGetValue($state,[ref]$issued) -and $script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$current) -and $current -is [Tuple[object,object]] -and [object]::ReferenceEquals($issued,$originalPins) -and [object]::ReferenceEquals($current.Item1,$issued)){$state.terminal='ROTATION_CUTOVER_CLOCK_INVALID'}}}catch{}}
  throw 'ROTATION_CUTOVER_CLOCK_ENDPOINT_DATA_REJECTED'
 }
}

function Assert-OwnerCutoverPublicBudget($State){$clock=Read-OwnerCutoverClock $State;if($clock.remainingForwardMs -le 0){throw 'ROTATION_CUTOVER_FORWARD_RESERVE'}}
function Read-OwnerCutoverPublicBytes($State,[string]$Uri){
 Assert-OwnerCutoverPublicBudget $State
 try{$bytes=Get-OwnerCutoverBootstrapPublicResource $Uri $State}catch{throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 Assert-OwnerCutoverPublicBudget $State
 if($bytes -isnot [byte[]] -or $bytes.Length -eq 0 -or $bytes.Length -gt 1048576){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 return ,$bytes
}
function Read-OwnerCutoverPublicJson($State,[string]$Uri){try{return (ConvertFrom-OwnerRotationEntryJson ([Text.UTF8Encoding]::new($false,$true).GetString((Read-OwnerCutoverPublicBytes $State $Uri))))}catch{if($State.terminal){throw $State.terminal};throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}}
function Get-OwnerCutoverMetadataTime($Value){
 if($Value -isnot [string]){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 $stamp=[datetimeoffset]::MinValue;if(-not [datetimeoffset]::TryParseExact($Value,[string[]]@('yyyy-MM-ddTHH:mm:ssZ','yyyy-MM-ddTHH:mm:ss.fffZ'),[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$stamp)){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};return $stamp
}
function Get-OwnerCutoverPublicReadiness {
 $root=Get-OwnerCutoverEntryWorkspace
 $allocation=$env:GITHUB_REPOSITORY+'|'+$env:GITHUB_WORKFLOW_REF+'|'+$env:GITHUB_RUN_ID+'|1|inspect'
 $previousStore=Get-Variable -Name ownerCutoverPublicLifetimes -Scope Script -ErrorAction SilentlyContinue
 if($previousStore -and $script:ownerCutoverPublicLifetimes.allocations.ContainsKey($allocation)){$previous=$script:ownerCutoverPublicLifetimes.allocations[$allocation];if($previous.terminal){throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'};$null=Read-OwnerCutoverClock $previous}
 $utc=Get-OwnerCutoverUtcNow;$stamp=Get-OwnerCutoverMonotonicStamp;$frequency=Get-OwnerCutoverMonotonicFrequency
 if($utc -isnot [datetimeoffset] -or ($stamp -isnot [long] -and $stamp -isnot [int]) -or $stamp -lt 0 -or ($frequency -isnot [long] -and $frequency -isnot [int]) -or $frequency -le 0){throw 'ROTATION_CUTOVER_CLOCK_INVALID'}
 $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT;GITHUB_WORKFLOW_REF=$env:GITHUB_WORKFLOW_REF;JARVIS_PRODUCTION_CONFIG=$env:JARVIS_PRODUCTION_CONFIG}
 $selection=Get-OwnerRotationProfileSelection -Encoded $env:GORIQ_OWNER_ROTATION_SCOPE_BASE64 -Environment $environment -Now $utc;if($selection.profile -cne 'CUTOVER_V1'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 $g=ConvertFrom-OwnerRotationEntryJson ([Text.UTF8Encoding]::new($false,$true).GetString([Convert]::FromBase64String($env:GORIQ_OWNER_ROTATION_SCOPE_BASE64)))
 $allocation=$env:GITHUB_REPOSITORY+'|'+$env:GITHUB_WORKFLOW_REF+'|'+$env:GITHUB_RUN_ID+'|1|inspect'
 $store=Get-Variable -Name ownerCutoverPublicLifetimes -Scope Script -ErrorAction SilentlyContinue
 if(-not $store){$script:ownerCutoverPublicLifetimes=@{allocations=@{};tokens=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();states=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}}
 if($script:ownerCutoverPublicLifetimes.allocations.ContainsKey($allocation)){
  $existing=$script:ownerCutoverPublicLifetimes.allocations[$allocation]
  if($existing.grantHash -cne $selection.originalGrantSha256 -or $existing.root -cne $root -or $existing.terminal -or $existing.phase -cne 'PUBLIC_SOURCE_BOUND'){throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'}
  $null=Read-OwnerCutoverClock $existing;return $existing.token
 }
 $expiry=[datetimeoffset]::Parse($g.expiresAt);$provisional=$utc.AddSeconds(900);if($expiry -lt $provisional){$provisional=$expiry}
 $state=@{root=$root;grantHash=$selection.originalGrantSha256;grant=$g;sourceRevision=$g.sourceRevision;originUtc=$utc;originStamp=[long]$stamp;lastUtc=$utc;lastStamp=[long]$stamp;frequency=[long]$frequency;hardEnd=$provisional;terminal=$null;phase='DISCOVERING_PUBLIC_SOURCE';token=[object]::new();sourceFiles=@{};workflowHash=$null;jobId=$null;jobStartedAt=$null;workflowRunId=$env:GITHUB_RUN_ID}
 $script:ownerCutoverPublicLifetimes.allocations[$allocation]=$state;$script:ownerCutoverPublicLifetimes.states.Add($state,$state)
 try{
  $base='https://api.github.com/repos/haji84/AI-/';$run=Read-OwnerCutoverPublicJson $state ($base+'actions/runs/'+$env:GITHUB_RUN_ID)
  Assert-OwnerCutoverMetadataFields $run @{id=[long]$env:GITHUB_RUN_ID;run_attempt=1;name='GORIQ Owner Code 1218 Bounded Native Acceptance';path='.github/workflows/gai-zbook-diagnostic-1218.yml';event='workflow_dispatch';head_sha=$g.sourceRevision;head_branch='main';status='in_progress';conclusion=$null};Assert-OwnerCutoverMetadataFields $run.repository @{full_name='haji84/AI-'};Assert-OwnerCutoverMetadataFields $run.actor @{login='haji84'}
  $jobs=Read-OwnerCutoverPublicJson $state ($base+'actions/runs/'+$env:GITHUB_RUN_ID+'/attempts/1/jobs?per_page=100')
  if($jobs.jobs -isnot [array] -or $jobs.jobs.Count -lt 1 -or $jobs.jobs.Count -gt 2 -or -not(Test-OwnerCutoverInteger $jobs.total_count) -or $jobs.total_count -ne $jobs.jobs.Count){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
  $inspect=@($jobs.jobs|Where-Object {$_.name -ceq 'inspect'});if($inspect.Count -ne 1){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$job=$inspect[0]
  Assert-OwnerCutoverMetadataFields $job @{run_id=[long]$env:GITHUB_RUN_ID;run_attempt=1;name='inspect';head_sha=$g.sourceRevision;status='in_progress';conclusion=$null;completed_at=$null}
  if(-not(Test-OwnerCutoverInteger $job.id) -or $job.labels -isnot [array] -or @($job.labels).Count -ne 3){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};foreach($label in @('self-hosted','Windows','X64')){if(@($job.labels|Where-Object {$_ -is [string] -and $_ -ceq $label}).Count -ne 1){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}}
  foreach($other in $jobs.jobs){if($other -ne $job){Assert-OwnerCutoverMetadataFields $other @{name='iphone-visibility';status='completed';conclusion='skipped'}}}
  $start=Get-OwnerCutoverMetadataTime $job.started_at;if($start -gt (Get-OwnerCutoverUtcNow)){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$hard=$start.AddSeconds(900);$officialHard=$start.AddMinutes(24);foreach($bound in @($state.hardEnd,$expiry,$officialHard)){if($bound -lt $hard){$hard=$bound}};$state.hardEnd=$hard;$state.jobId=[string]$job.id;$state.jobStartedAt=$start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');Assert-OwnerCutoverPublicBudget $state
  $main=Read-OwnerCutoverPublicJson $state ($base+'git/ref/heads/main');Assert-OwnerCutoverMetadataFields $main.object @{sha=$g.sourceRevision}
  $ci=Read-OwnerCutoverPublicJson $state ($base+'actions/runs/'+$g.ciRunId);Assert-OwnerCutoverMetadataFields $ci @{id=[long]$g.ciRunId;run_attempt=1;name='CI';path='.github/workflows/ci.yml';event='push';head_sha=$g.sourceRevision;head_branch='main';status='completed';conclusion='success'}
  $ciJobs=Read-OwnerCutoverPublicJson $state ($base+'actions/runs/'+$g.ciRunId+'/attempts/1/jobs?per_page=100');if($ciJobs.jobs -isnot [array] -or $ciJobs.jobs.Count -ne 4 -or -not(Test-OwnerCutoverInteger $ciJobs.total_count) -or $ciJobs.total_count -ne 4){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};foreach($name in @('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures')){$match=@($ciJobs.jobs|Where-Object {$_.name -is [string] -and $_.name -ceq $name});if($match.Count -ne 1){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};Assert-OwnerCutoverMetadataFields $match[0] @{name=$name;status='completed';conclusion='success'}}
  $files=@($g.sourceHashes.PSObject.Properties.Name)
  foreach($file in $files){
   $remote=Read-OwnerCutoverPublicBytes $state ('https://raw.githubusercontent.com/haji84/AI-/'+$g.sourceRevision+'/'+$file);if((Get-OwnerRotationEntryDigest $remote) -cne $g.sourceHashes.$file){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
   $path=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($root,$file));$info=[IO.FileInfo]::new($path);if(-not $info.Exists -or $info.Length -gt 1048576){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};Assert-OwnerCutoverPublicBudget $state;$local=[IO.File]::ReadAllBytes($path);Assert-OwnerCutoverPublicBudget $state;if((Get-OwnerRotationEntryDigest $local) -cne $g.sourceHashes.$file){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$state.sourceFiles[$file]=$remote
  }
  $workflow='.github/workflows/gai-zbook-diagnostic-1218.yml';$remote=Read-OwnerCutoverPublicBytes $state ('https://raw.githubusercontent.com/haji84/AI-/'+$g.sourceRevision+'/'+$workflow);$localPath=Get-OwnerRotationEntrySafePath ([IO.Path]::Combine($root,$workflow));if(([IO.FileInfo]::new($localPath)).Length -gt 1048576){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};Assert-OwnerCutoverPublicBudget $state;$local=[IO.File]::ReadAllBytes($localPath);Assert-OwnerCutoverPublicBudget $state;$digest=Get-OwnerRotationEntryDigest $remote;if((Get-OwnerRotationEntryDigest $local) -cne $digest){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};$state.workflowHash=$digest
  $state.phase='PUBLIC_SOURCE_BOUND';$script:ownerCutoverPublicLifetimes.tokens.Add($state.token,$state);return $state.token
 }catch{if(-not $state.terminal){$state.terminal='ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'};throw $state.terminal}
}
function Get-OwnerCutoverPublicReadinessStatus {
 param([object]$Token)
 $state=$null;if($null -eq $Token -or -not $script:ownerCutoverPublicLifetimes.tokens.TryGetValue($Token,[ref]$state) -or $state.phase -cne 'PUBLIC_SOURCE_BOUND'){throw 'ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED'}
 $clock=Read-OwnerCutoverClock $state
 return [pscustomobject][ordered]@{schemaVersion=1;phase='PUBLIC_SOURCE_BOUND';sourceRevision=$state.sourceRevision;originalGrantSha256=$state.grantHash;sourceFilesVerified=$state.sourceFiles.Count;nativeWorkflowSha256=$state.workflowHash;officialJobId=$state.jobId;officialJobStartedAt=$state.jobStartedAt;hardEndUtc=$state.hardEnd.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');remainingHardMs=$clock.remainingHardMs;remainingForwardMs=$clock.remainingForwardMs;effectCapability=$false;privateContextVerified=$false;claimConsumed=$false;protectedStageBound=$false}
}

# Private kernel DATA is retained in a closed module, never reconstructed from
# a status object. Only the original public-token reference supplies its clock.
function New-OwnerCutoverPrivateModule($State){
 Assert-OwnerCutoverPublicBudget $State
 $clock=(Get-Command Read-OwnerCutoverClock -CommandType Function -ErrorAction Stop).ScriptBlock
 $sources=@{}
 foreach($name in @('scripts/rotate-jarvis-owner-code-windows.ps1','scripts/owner-code-launcher-binding-inspection-1218.ps1')){
  $bytes=$State.sourceFiles[$name]
  if($bytes -isnot [byte[]] -or (Get-OwnerRotationEntryDigest $bytes) -cne $State.grant.sourceHashes.$name){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  $sources[$name]=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
 }
 $module=New-Module -ArgumentList $State,$clock,$sources -ScriptBlock {
  param($OriginalState,$ClockReader,$Sources)
  $script:originalState=$OriginalState;$script:originalClockReader=$ClockReader;$script:kernelBaseline=$null
  . ([scriptblock]::Create($Sources['scripts/rotate-jarvis-owner-code-windows.ps1'])) -Apply:$false -AuthorizationPath ''
  . ([scriptblock]::Create($Sources['scripts/owner-code-launcher-binding-inspection-1218.ps1']))
  function Assert-OwnerCutoverPrivateClock {
   $value=&$script:originalClockReader $script:originalState
   if($value.remainingForwardMs -le 0){throw 'ROTATION_CUTOVER_FORWARD_RESERVE'}
  }
  function Get-OwnerCutoverKernelPlatform {return @{windows=([IO.Path]::DirectorySeparatorChar -eq [char]92);major=$PSVersionTable.PSVersion.Major;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;separator=[int][IO.Path]::DirectorySeparatorChar}}
  function Get-OwnerCutoverCurrentProcess {return [Diagnostics.Process]::GetCurrentProcess()}
  function Get-OwnerCutoverKnownFolder([string]$Name){return [Environment]::GetFolderPath($Name)}
  function Get-OwnerCutoverKernelProcess {
   Assert-OwnerCutoverPrivateClock;$process=Get-OwnerCutoverCurrentProcess
   try{Assert-OwnerCutoverPrivateClock;$processId=$process.Id;Assert-OwnerCutoverPrivateClock;$start=$process.StartTime;Assert-OwnerCutoverPrivateClock;$session=$process.SessionId;Assert-OwnerCutoverPrivateClock;$module=$process.MainModule;Assert-OwnerCutoverPrivateClock;$actual=$module.FileName;Assert-OwnerCutoverPrivateClock;$interactive=[Environment]::UserInteractive;Assert-OwnerCutoverPrivateClock;$system=Get-OwnerCutoverKnownFolder 'System';Assert-OwnerCutoverPrivateClock;return @{pid=$processId;creationTicks=$start.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);sessionId=$session;interactive=$interactive;actual=$actual;fixed=[IO.Path]::Combine($system,'WindowsPowerShell','v1.0','powershell.exe')}}finally{$process.Dispose()}
  }
  function Get-OwnerCutoverKernelIdentity {
   $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
   try{return @{sid=$identity.User.Value;isSystem=$identity.IsSystem}}finally{$identity.Dispose()}
  }
  function Get-OwnerCutoverKernelFolders {Assert-OwnerCutoverPrivateClock;$profile=Get-OwnerCutoverKnownFolder 'UserProfile';Assert-OwnerCutoverPrivateClock;$local=Get-OwnerCutoverKnownFolder 'LocalApplicationData';Assert-OwnerCutoverPrivateClock;return @{profile=$profile;localAppData=$local;environmentProfile=$env:USERPROFILE;environmentLocalAppData=$env:LOCALAPPDATA}}
  function Get-OwnerCutoverKernelSignature([string]$Path){$signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop;return @{status=[string]$signature.Status;subject=$(if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{''})}}
  function Assert-OwnerCutoverKernelPath($Path){
   if($Path -isnot [string] -or $Path -cnotmatch '^[A-Za-z]:\\[^:\r\n\0]+$' -or $Path.Contains('/') -or $Path.EndsWith('\')){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   foreach($part in $Path.Substring(3).Split([char]92)){if(-not $part -or $part -cin @('.','..') -or $part -match '[. ]$'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}}
  }
  function Read-OwnerCutoverPrivateKernel {
   Assert-OwnerCutoverPrivateClock;$platform=Get-OwnerCutoverKernelPlatform;Assert-OwnerCutoverPrivateClock
   if($platform.windows -isnot [bool] -or -not $platform.windows -or $platform.major -isnot [int] -or $platform.major -ne 5 -or $platform.separator -isnot [int] -or $platform.separator -ne 92 -or $platform.languageMode -cne 'FullLanguage'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $process=Get-OwnerCutoverKernelProcess;Assert-OwnerCutoverPrivateClock
   foreach($key in @('actual','fixed')){Assert-OwnerCutoverKernelPath $process[$key]}
   if($process.pid -isnot [int] -or $process.pid -le 0 -or $process.sessionId -isnot [int] -or $process.sessionId -le 0 -or $process.interactive -isnot [bool] -or -not $process.interactive -or $process.creationTicks -isnot [string] -or $process.creationTicks -cnotmatch '^[1-9][0-9]{10,18}$' -or $process.actual -ine $process.fixed){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $identity=Get-OwnerCutoverKernelIdentity;Assert-OwnerCutoverPrivateClock
   if($identity.sid -isnot [string] -or $identity.sid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or $identity.isSystem -isnot [bool] -or $identity.isSystem){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   if((Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes($identity.sid))) -cne $script:originalState.grant.ownerSidSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $folders=Get-OwnerCutoverKernelFolders;Assert-OwnerCutoverPrivateClock
   foreach($key in @('profile','localAppData','environmentProfile','environmentLocalAppData')){Assert-OwnerCutoverKernelPath $folders[$key]}
   if($folders.profile -ine $folders.environmentProfile -or $folders.localAppData -ine $folders.environmentLocalAppData -or -not $folders.localAppData.StartsWith($folders.profile+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $signature=Get-OwnerCutoverKernelSignature $process.fixed;Assert-OwnerCutoverPrivateClock
   if($signature.status -isnot [string] -or $signature.status -cne 'Valid' -or $signature.subject -isnot [string] -or $signature.subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $current=@{pid=$process.pid;creationTicks=$process.creationTicks;sessionId=$process.sessionId;processPath=$process.actual;ownerSid=$identity.sid;profile=$folders.profile;localAppData=$folders.localAppData}
   if($script:kernelBaseline){foreach($key in $current.Keys){if($current[$key] -cne $script:kernelBaseline[$key]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}}}else{$script:kernelBaseline=$current}
   Assert-OwnerCutoverPrivateClock
  }
  $script:sourceHandles=[Collections.Generic.List[object]]::new();$script:immutableFileBindings=@{};$script:parentHandles=[Collections.Generic.List[object]]::new();$script:claimConsumed=$false;$script:stagePath=$null;$script:stageTerminal=$false;$script:ownedNativeType=$null
  function Get-OwnerCutoverParentPath([string]$Path){if($Path -cmatch '^[A-Za-z]:\\$'){return $null};$i=$Path.LastIndexOf([char]92);if($i -le 2){return $Path.Substring(0,3)};return $Path.Substring(0,$i)}
  function Get-OwnerCutoverPathObservation([string]$Path){
   $item=Get-OwnerRotationNativeItem $Path;Assert-OwnerCutoverPrivateClock;if($null -eq $item){return @{exists=$false}}
   $attributes=$item.Attributes;Assert-OwnerCutoverPrivateClock;$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]'Access,Owner');Assert-OwnerCutoverPrivateClock
   $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);Assert-OwnerCutoverPrivateClock
   $aces=@(foreach($rule in $rules){Assert-OwnerCutoverPrivateClock;if($rule.IdentityReference -isnot [Security.Principal.SecurityIdentifier]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};@{allow=($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow);sid=$rule.IdentityReference.Value;rights=[long]$rule.FileSystemRights}})
   return @{exists=$true;directory=($item -is [IO.DirectoryInfo]);reparse=(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0);fullPath=$item.FullName;ownerSid=$owner;aces=$aces}
  }
  function Assert-OwnerCutoverPrivateProtectedPath([string]$Path){
   Assert-OwnerCutoverKernelPath $Path;$current=$Path;$depth=0;$owner=$script:kernelBaseline.ownerSid;$owners=@($owner,'S-1-5-18','S-1-5-32-544');$writers=$owners+@('S-1-3-0');$full=[long][Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership';$ancestor=[long][Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
   while($current){
    Assert-OwnerCutoverPrivateClock;$observation=Get-OwnerCutoverPathObservation $current;Assert-OwnerCutoverPrivateClock
    if($observation.exists -isnot [bool] -or -not $observation.exists -or $observation.reparse -isnot [bool] -or $observation.reparse -or $observation.directory -isnot [bool] -or ($depth -gt 0 -and -not $observation.directory) -or $observation.fullPath -isnot [string] -or $observation.fullPath -ine $current -or $observation.ownerSid -isnot [string] -or $owners -cnotcontains $observation.ownerSid -or $observation.aces -isnot [array]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $mask=if($depth -le 1){$full}else{$ancestor}
    foreach($ace in $observation.aces){Assert-OwnerCutoverPrivateClock;if($ace.allow -isnot [bool] -or $ace.sid -isnot [string] -or ($ace.rights -isnot [long] -and $ace.rights -isnot [int]) -or $ace.rights -lt 0 -or $ace.rights -gt [int]::MaxValue){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};if($ace.allow -and ($ace.rights -band $mask) -ne 0 -and $writers -cnotcontains $ace.sid){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}}
    $current=Get-OwnerCutoverParentPath $current;$depth++;if($depth -gt 256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   }
  }
  function Initialize-OwnerCutoverOwnedNative {
   Assert-OwnerCutoverPrivateClock;$existing='GoriqLauncherInspectionNative' -as [type]
   if($script:ownedNativeType){if(-not [object]::ReferenceEquals($existing,$script:ownedNativeType)){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};return}
   if($existing){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   Initialize-OwnerLauncherNative;Assert-OwnerCutoverPrivateClock;$script:ownedNativeType='GoriqLauncherInspectionNative' -as [type];if(-not $script:ownedNativeType){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  }
  function Open-OwnerCutoverParentHandles([string]$Path){
   Initialize-OwnerCutoverOwnedNative;$chain=[Collections.Generic.List[string]]::new();$parent=Get-OwnerCutoverParentPath $Path
   while($parent){$chain.Insert(0,$parent);$parent=Get-OwnerCutoverParentPath $parent;if($chain.Count -gt 256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}}
   foreach($part in $chain){Assert-OwnerCutoverPrivateClock;$handle=[GoriqLauncherInspectionNative]::HoldDirectory($part);$script:parentHandles.Add($handle);Assert-OwnerCutoverPrivateClock}
  }
  function New-OwnerCutoverPrivateFile([string]$Path,[byte[]]$Bytes){
   Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock;$security=New-OwnerLauncherSecurity $script:kernelBaseline.ownerSid $false;Assert-OwnerCutoverPrivateClock;$stream=$null
   try{$stream=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$security);Assert-OwnerCutoverPrivateClock;$offset=0;while($offset -lt $Bytes.Length){Assert-OwnerCutoverPrivateClock;$count=[Math]::Min(8192,$Bytes.Length-$offset);$stream.Write($Bytes,$offset,$count);Assert-OwnerCutoverPrivateClock;$offset+=$count};$stream.Flush($true);Assert-OwnerCutoverPrivateClock}finally{if($stream){$stream.Dispose()}}
  }
  function New-OwnerCutoverPrivateDirectory([string]$Path){
   Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock;$security=New-OwnerLauncherSecurity $script:kernelBaseline.ownerSid $true;Assert-OwnerCutoverPrivateClock;[GoriqLauncherInspectionNative]::NewDirectory($Path,$security.GetSecurityDescriptorBinaryForm());Assert-OwnerCutoverPrivateClock;Assert-OwnerCutoverPrivateProtectedPath $Path
  }
  function Open-OwnerCutoverImmutableFile([string]$Path){return [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)}
  function Get-OwnerCutoverFileIdentity($Stream,[string]$Path){Initialize-OwnerCutoverOwnedNative;return (Get-OwnerLauncherHandleIdentity -Stream $Stream -Path $Path)}
  function Hold-OwnerCutoverSourceFile([string]$Path,[string]$ExpectedHash){
   Assert-OwnerCutoverPrivateProtectedPath $Path;Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock;$stream=Open-OwnerCutoverImmutableFile $Path;$script:sourceHandles.Add($stream);Assert-OwnerCutoverPrivateClock
   $identity=Get-OwnerCutoverFileIdentity $stream $Path;Assert-OwnerCutoverPrivateClock
   if($identity.links -isnot [int] -or $identity.links -ne 1 -or $identity.finalPath -isnot [string] -or $identity.finalPath -ine $Path -or $identity.key -isnot [string] -or -not $identity.key -or $stream.Length -gt 1048576){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $other=$null;$memory=[IO.MemoryStream]::new()
   try{
    $other=Open-OwnerCutoverImmutableFile $Path;Assert-OwnerCutoverPrivateClock;$again=Get-OwnerCutoverFileIdentity $other $Path;Assert-OwnerCutoverPrivateClock
    if($again.links -isnot [int] -or $again.links -ne 1 -or $again.finalPath -ine $Path -or $again.key -cne $identity.key -or $other.Length -ne $stream.Length){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $buffer=New-Object byte[] 8192
    while($true){Assert-OwnerCutoverPrivateClock;$count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPrivateClock;if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $memory.Length+$count -gt 1048576){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$memory.Write($buffer,0,$count)}
    if((Get-OwnerLauncherDigest $memory.ToArray()) -cne $ExpectedHash){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $script:immutableFileBindings[$Path]=@{identityKey=$identity.key;sha256=$ExpectedHash;stream=$stream}
   }finally{if($other){$other.Dispose()};$memory.Dispose()}
  }
  function Initialize-OwnerCutoverPrivateSource {
   Read-OwnerCutoverPrivateKernel
   if($script:stageTerminal){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   if($script:stagePath){throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'}
   $profile=$script:kernelBaseline.profile;Assert-OwnerCutoverPrivateProtectedPath $profile
   $stage=$profile+'\.goriq-owner-rotation-1218-'+$script:originalState.grant.approvalId;$claim=$stage+'.claim'
   foreach($path in @($stage,$claim)){Assert-OwnerCutoverPrivateClock;$before=Get-OwnerCutoverPathObservation $path;Assert-OwnerCutoverPrivateClock;if($before.exists -isnot [bool] -or $before.exists){throw 'ROTATION_ENTRY_ATTEMPT_CONSUMED'}}
   # Reservation is consumed before CreateNew: an ambiguous throw cannot mint a
   # second claim/module or retry the original attempt.
   $script:claimConsumed=$true
   try{
    $record=[ordered]@{schemaVersion=1;approvalId=$script:originalState.grant.approvalId;originalGrantSha256=$script:originalState.grantHash;sourceRevision=$script:originalState.sourceRevision;workflowRunId=$script:originalState.workflowRunId;officialJobId=$script:originalState.jobId;hardEndUtc=$script:originalState.hardEnd.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($record|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress));$script:claimPath=$claim;$script:claimSha256=Get-OwnerLauncherDigest $bytes;New-OwnerCutoverPrivateFile $claim $bytes
    New-OwnerCutoverPrivateDirectory $stage;$script:stagePath=$stage;New-OwnerCutoverPrivateDirectory ($stage+'\scripts')
    foreach($name in $script:originalState.grant.sourceHashes.PSObject.Properties.Name){
     Assert-OwnerCutoverPrivateClock;$bytes=$script:originalState.sourceFiles[$name];if($bytes -isnot [byte[]] -or (Get-OwnerLauncherDigest $bytes) -cne $script:originalState.grant.sourceHashes.$name){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
     $target=$stage+'\'+$name.Replace('/','\');New-OwnerCutoverPrivateFile $target $bytes;Hold-OwnerCutoverSourceFile $target $script:originalState.grant.sourceHashes.$name
    }
    Assert-OwnerCutoverPrivateClock;return [pscustomobject]@{phase='SOURCE_STAGE_BOUND';sourceFilesVerified=$script:sourceHandles.Count;claimConsumed=$true;effectCapability=$false;privateContextVerified=$false}
   }catch{$script:stageTerminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  }
  $script:nodeStream=$null;$script:nodeIdentity=$null;$script:nodeTerminal=$false;$script:nodePath=$null
  function New-OwnerCutoverNodeRequest {return [Net.HttpWebRequest]::Create('https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip')}
  function Read-OwnerCutoverNodeArchive {
   $request=$null;$response=$null;$stream=$null;$memory=[IO.MemoryStream]::new();$sha=[Security.Cryptography.SHA256]::Create()
   try{
    Assert-OwnerCutoverPrivateClock;$request=New-OwnerCutoverNodeRequest;Assert-OwnerCutoverPrivateClock
    $clock=&$script:originalClockReader $script:originalState;$timeout=[int][Math]::Max(1,[Math]::Min(10000,$clock.remainingForwardMs));$request.Method='GET';$request.AllowAutoRedirect=$false;$request.Timeout=$timeout;$request.ReadWriteTimeout=$timeout;$request.UseDefaultCredentials=$false;$request.Credentials=$null;$request.PreAuthenticate=$false;$request.UserAgent='GORIQ-1218-fixed-public-node'
    Assert-OwnerCutoverPrivateClock;$response=$request.GetResponse();Assert-OwnerCutoverPrivateClock;$status=$response.StatusCode;Assert-OwnerCutoverPrivateClock;$uri=$response.ResponseUri;Assert-OwnerCutoverPrivateClock;$length=$response.ContentLength;Assert-OwnerCutoverPrivateClock
    if([int]$status -ne 200 -or $uri -isnot [uri] -or $uri.AbsoluteUri -cne 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip' -or $length -ne 37304352){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $stream=$response.GetResponseStream();Assert-OwnerCutoverPrivateClock;$buffer=New-Object byte[] 65536
    while($true){Assert-OwnerCutoverPrivateClock;$canTimeout=$stream.CanTimeout;Assert-OwnerCutoverPrivateClock;if($canTimeout -isnot [bool] -or -not $canTimeout){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$clock=&$script:originalClockReader $script:originalState;$stream.ReadTimeout=[int][Math]::Max(1,[Math]::Min(10000,$clock.remainingForwardMs));Assert-OwnerCutoverPrivateClock;$count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPrivateClock;if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $memory.Length+$count -gt 37304352){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$memory.Write($buffer,0,$count);$null=$sha.TransformBlock($buffer,0,$count,$buffer,0)}
    $null=$sha.TransformFinalBlock([byte[]]@(),0,0);$hash=([BitConverter]::ToString($sha.Hash)).Replace('-','').ToLowerInvariant();Assert-OwnerCutoverPrivateClock
    if($memory.Length -ne 37304352 -or $hash -cne $script:originalState.grant.protectedNodeBootstrap.archiveSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};return ,$memory.ToArray()
   }finally{if($request){try{$request.Abort()}catch{}};if($stream){try{$stream.Dispose()}catch{}};if($response){try{$response.Dispose()}catch{}};$sha.Dispose();$memory.Dispose()}
  }
  function Open-OwnerCutoverProtectedNodeFile([string]$Path){
   Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock;$security=New-OwnerLauncherSecurity $script:kernelBaseline.ownerSid $false;Assert-OwnerCutoverPrivateClock
   return [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$security)
  }
  function Copy-OwnerCutoverFixedNodeArchive([byte[]]$Bytes){
   Assert-OwnerCutoverPrivateClock
   if($Bytes.Length -ne 37304352 -or (Get-OwnerLauncherDigest $Bytes) -cne $script:originalState.grant.protectedNodeBootstrap.archiveSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   Assert-OwnerCutoverPrivateClock;$null=[Reflection.Assembly]::Load('System.IO.Compression');Assert-OwnerCutoverPrivateClock
   $memory=[IO.MemoryStream]::new($Bytes,$false);$archive=$null;$inputStream=$null;$output=$null;$sha=[Security.Cryptography.SHA256]::Create()
   try{
    $archive=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true);Assert-OwnerCutoverPrivateClock;$entries=@($archive.Entries);if($entries.Count -gt 3000){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$selected=$null;$matches=0
    foreach($entry in $entries){Assert-OwnerCutoverPrivateClock;if($entry.FullName -ieq 'node-v24.19.0-win-x64/node.exe'){$matches++;if($entry.FullName -cne 'node-v24.19.0-win-x64/node.exe' -or $entry.Length -ne 92825416){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$selected=$entry}}
    if($matches -ne 1){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$inputStream=$selected.Open();Assert-OwnerCutoverPrivateClock
    $path=$script:kernelBaseline.profile+'\JARVIS\tools\node-v24.19.0-win-x64\node.exe';$script:nodeCreationAttempted=$true
    $output=Open-OwnerCutoverProtectedNodeFile $path;Assert-OwnerCutoverPrivateClock;$buffer=New-Object byte[] 65536;$total=[long]0
    while($true){Assert-OwnerCutoverPrivateClock;$count=$inputStream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPrivateClock;if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $total+$count -gt 92825416){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$output.Write($buffer,0,$count);Assert-OwnerCutoverPrivateClock;$null=$sha.TransformBlock($buffer,0,$count,$buffer,0);$total+=$count}
    $null=$sha.TransformFinalBlock([byte[]]@(),0,0);$hash=([BitConverter]::ToString($sha.Hash)).Replace('-','').ToLowerInvariant();if($total -ne 92825416 -or $hash -cne $script:originalState.grant.protectedNodeBootstrap.nodeSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$output.Flush($true);Assert-OwnerCutoverPrivateClock
   }finally{if($output){$output.Dispose()};if($inputStream){$inputStream.Dispose()};if($archive){$archive.Dispose()};$memory.Dispose();$sha.Dispose()}
  }
  function Install-OwnerCutoverPublicNode {
   if(-not $script:stagePath -or -not $script:claimConsumed -or $script:stageTerminal -or $script:nodeTerminal){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $profile=$script:kernelBaseline.profile;Assert-OwnerCutoverPrivateProtectedPath $profile
   foreach($relative in @('JARVIS','JARVIS\tools','JARVIS\tools\node-v24.19.0-win-x64')){
    $path=$profile+'\'+$relative;Assert-OwnerCutoverPrivateClock;$before=Get-OwnerCutoverPathObservation $path;Assert-OwnerCutoverPrivateClock
    if($before.exists -isnot [bool]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};if($before.exists){if($before.directory -isnot [bool] -or -not $before.directory){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};Assert-OwnerCutoverPrivateProtectedPath $path}else{New-OwnerCutoverPrivateDirectory $path}
   }
   # Only this exact public image is copied, using protected CreateNew. Other
   # ZIP entries are data and never extracted, installed or executed.
   $archiveBytes=Read-OwnerCutoverNodeArchive;Copy-OwnerCutoverFixedNodeArchive $archiveBytes
  }
  function Get-OwnerCutoverNodeImageFacts([string]$Path){
   Assert-OwnerCutoverPrivateProtectedPath $Path;Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock
   if(-not $script:nodeStream){$script:nodeStream=Open-OwnerCutoverImmutableFile $Path;$script:sourceHandles.Add($script:nodeStream);Assert-OwnerCutoverPrivateClock;$script:nodeIdentity=Get-OwnerCutoverFileIdentity $script:nodeStream $Path;Assert-OwnerCutoverPrivateClock}
   $stream=$script:nodeStream;$identity=$script:nodeIdentity;$other=$null;$sha=[Security.Cryptography.SHA256]::Create();$prefix=[IO.MemoryStream]::new()
   try{
    $other=Open-OwnerCutoverImmutableFile $Path;Assert-OwnerCutoverPrivateClock;$again=Get-OwnerCutoverFileIdentity $other $Path;Assert-OwnerCutoverPrivateClock
    $length=$stream.Length;Assert-OwnerCutoverPrivateClock
    if($identity.links -isnot [int] -or $identity.links -ne 1 -or $identity.finalPath -ine $Path -or $identity.key -isnot [string] -or -not $identity.key -or $again.links -isnot [int] -or $again.links -ne 1 -or $again.key -cne $identity.key -or $again.finalPath -ine $Path -or $other.Length -ne $length -or $length -ne 92825416){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $stream.Position=0;Assert-OwnerCutoverPrivateClock;$buffer=New-Object byte[] 65536;$total=[long]0
    while($true){Assert-OwnerCutoverPrivateClock;$count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPrivateClock;if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $total+$count -gt 92825416){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};if($prefix.Length -lt 8192){$prefix.Write($buffer,0,[Math]::Min($count,8192-$prefix.Length))};$null=$sha.TransformBlock($buffer,0,$count,$buffer,0);$total+=$count}
    $null=$sha.TransformFinalBlock([byte[]]@(),0,0);$hash=([BitConverter]::ToString($sha.Hash)).Replace('-','').ToLowerInvariant();$head=$prefix.ToArray()
    if($total -ne $length -or $head.Length -lt 64 -or $head[0] -ne 77 -or $head[1] -ne 90){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $pe=[BitConverter]::ToInt32($head,60);if($pe -lt 64 -or $pe -gt $head.Length-26 -or [BitConverter]::ToUInt32($head,$pe) -ne 17744){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    return @{length=$length;sha256=$hash;machine=[int][BitConverter]::ToUInt16($head,$pe+4);magic=[int][BitConverter]::ToUInt16($head,$pe+24);singleLink=$true}
   }finally{if($other){$other.Dispose()};$sha.Dispose();$prefix.Dispose()}
  }
  function Get-OwnerCutoverNodeSignature([string]$Path){
   Assert-OwnerCutoverPrivateClock;$signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop;Assert-OwnerCutoverPrivateClock
   return @{status=[string]$signature.Status;certificateSha256=$(if($signature.SignerCertificate){Get-OwnerLauncherDigest $signature.SignerCertificate.GetRawCertData()}else{''});subject=$(if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{''})}
  }
  function Initialize-OwnerCutoverProtectedNode {
   Read-OwnerCutoverPrivateKernel
   if(-not $script:claimConsumed -or -not $script:stagePath -or $script:stageTerminal -or $script:sourceHandles.Count -lt 15 -or $script:nodeTerminal){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $path=$script:kernelBaseline.profile+'\JARVIS\tools\node-v24.19.0-win-x64\node.exe'
   try{
    Assert-OwnerCutoverPrivateClock;$existing=Get-OwnerCutoverPathObservation $path;Assert-OwnerCutoverPrivateClock
    if($existing.exists -isnot [bool]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    if(-not $existing.exists){Install-OwnerCutoverPublicNode}
    Assert-OwnerCutoverPrivateProtectedPath $path;$facts=Get-OwnerCutoverNodeImageFacts $path;Assert-OwnerCutoverPrivateClock
    if(($facts.length -isnot [int] -and $facts.length -isnot [long]) -or $facts.length -ne 92825416 -or $facts.sha256 -isnot [string] -or $facts.sha256 -cne $script:originalState.grant.protectedNodeBootstrap.nodeSha256 -or $facts.machine -isnot [int] -or $facts.machine -ne 34404 -or $facts.magic -isnot [int] -or $facts.magic -ne 523 -or $facts.singleLink -isnot [bool] -or -not $facts.singleLink){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $signature=Get-OwnerCutoverNodeSignature $path;Assert-OwnerCutoverPrivateClock
    # Normal WinTrust decides timestamp/chain/revocation; certificate NotAfter is
    # not independently substituted for that policy and no trust is added.
    if($signature.status -isnot [string] -or $signature.status -cne 'Valid' -or $signature.certificateSha256 -isnot [string] -or $signature.certificateSha256 -cne $script:originalState.grant.protectedNodeBootstrap.signerCertificateSha256 -or $signature.subject -isnot [string] -or $signature.subject -notmatch '(?:^|,\s*)O=OpenJS Foundation(?:,|$)'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $script:nodePath=$path;return [pscustomobject]@{phase='PROTECTED_NODE_BOUND';retainedDependency=$true;effectCapability=$false;privateContextVerified=$false}
   }catch{$script:nodeTerminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  }
  # Unknown compiled/default crypto inputs refuse BEFORE starting Node or
  # decrypting configuration for a Node consumer. The fixed-path observer
  # retains actual protected ancestry identities for this controller lifetime.
  $script:nodeStartupPolicyLifetime=@{token=$null;record=$null;terminal=$false;records=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}
  # This role is limited to the official image's literal compiled-default
  # ancestry. It never changes the generic Owner/source/config trust policy.
  $script:compiledDefaultBindings=@{};$script:compiledDefaultFingerprint=$null
  function Assert-OwnerCutoverCompiledDefaultPath([string]$Path){
   if($Path -cnotin @('C:\','C:\Program Files','C:\Program Files\Common Files','C:\Program Files\Common Files\SSL','C:\Program Files\Common Files\SSL\openssl.cnf')){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
  }
  function Get-OwnerCutoverCompiledDefaultDriveType {return [IO.DriveInfo]::new('C:\').DriveType}
  function Read-OwnerCutoverCompiledDefaultAttributes([string]$Path){Assert-OwnerCutoverCompiledDefaultPath $Path;return [IO.File]::GetAttributes($Path)}
  function Get-OwnerCutoverCompiledDefaultPathState([string]$Path){
   Assert-OwnerCutoverCompiledDefaultPath $Path;Assert-OwnerCutoverPrivateClock
   try{$attributes=Read-OwnerCutoverCompiledDefaultAttributes $Path;Assert-OwnerCutoverPrivateClock;if($attributes -isnot [IO.FileAttributes]){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};return [pscustomobject]@{exists=$true;attributes=$attributes}}
   catch{Assert-OwnerCutoverPrivateClock;$e=$_.Exception;while($e -is [Management.Automation.MethodInvocationException] -and $e.InnerException){$e=$e.InnerException};if(($e.GetType() -eq [IO.FileNotFoundException] -and ($e.HResult -band 65535) -eq 2) -or ($e.GetType() -eq [IO.DirectoryNotFoundException] -and ($e.HResult -band 65535) -eq 3)){return [pscustomobject]@{exists=$false;attributes=$null}};throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
  }
  function Read-OwnerCutoverCompiledDefaultSecurity([string]$Path){
   Assert-OwnerCutoverCompiledDefaultPath $Path;Assert-OwnerCutoverPrivateClock;$directory=[IO.DirectoryInfo]::new($Path);$security=$directory.GetAccessControl([Security.AccessControl.AccessControlSections]'Owner,Access');Assert-OwnerCutoverPrivateClock;$bytes=$security.GetSecurityDescriptorBinaryForm();Assert-OwnerCutoverPrivateClock;$raw=[Security.AccessControl.RawSecurityDescriptor]::new($bytes,0)
   if(-not($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -or $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -gt 256 -or $null -eq $raw.Owner){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   $aces=@();foreach($ace in $raw.DiscretionaryAcl){if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};$qualifier=switch($ace.AceQualifier){'AccessAllowed'{'ALLOW'}'AccessDenied'{'DENY'}default{throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}};$aces+=,[pscustomobject]@{kind='COMMON';callback=[bool]$ace.IsCallback;flags=[int]$ace.AceFlags;qualifier=$qualifier;sid=$ace.SecurityIdentifier.Value;mask=[long]$ace.AccessMask}}
   Assert-OwnerCutoverPrivateClock;return [pscustomobject]@{ownerSid=$raw.Owner.Value;aces=$aces;descriptorSha256=(Get-OwnerLauncherDigest $bytes)}
  }
  function Open-OwnerCutoverCompiledDefaultDirectory([string]$Path){Assert-OwnerCutoverCompiledDefaultPath $Path;Initialize-OwnerCutoverOwnedNative;Assert-OwnerCutoverPrivateClock;return [GoriqLauncherInspectionNative]::HoldDirectory($Path)}
  function Get-OwnerCutoverCompiledDefaultIdentity($Handle,[string]$Path){
   Assert-OwnerCutoverCompiledDefaultPath $Path;Assert-OwnerCutoverPrivateClock;$parts=[GoriqLauncherInspectionNative]::Identity($Handle);Assert-OwnerCutoverPrivateClock;$final=$parts[1];if($final.StartsWith('\\?\')){$final=$final.Substring(4)};if($Path -ceq 'C:\'){$final=$final.TrimEnd('\')+'\'}else{$final=$final.TrimEnd('\')};return [pscustomobject]@{key=$parts[0];finalPath=$final}
  }
  function Assert-OwnerCutoverCompiledDefaultSecurity($Security,[string]$Path,[bool]$ProgramFilesHeld){
   Assert-OwnerLauncherShape $Security @('ownerSid','aces','descriptorSha256')
   $trusted=@('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
   if($Security.ownerSid -isnot [string] -or $Security.ownerSid -cnotin $trusted -or $Security.descriptorSha256 -isnot [string] -or $Security.descriptorSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Security.aces -isnot [array] -or $Security.aces.Count -gt 256){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   $danger=[long](2 -bor 4 -bor 16 -bor 256 -bor 64 -bor 65536 -bor 262144 -bor 524288)
   foreach($ace in $Security.aces){
    Assert-OwnerLauncherShape $ace @('kind','callback','flags','qualifier','sid','mask')
    if($ace.kind -isnot [string] -or $ace.kind -cne 'COMMON' -or $ace.callback -isnot [bool] -or $ace.callback -or $ace.flags -isnot [int] -or $ace.flags -lt 0 -or ($ace.flags -band (-bnot 31)) -ne 0 -or $ace.qualifier -isnot [string] -or $ace.qualifier -cnotin @('ALLOW','DENY') -or $ace.sid -isnot [string] -or $ace.sid -cnotmatch '^S-1-[0-9]+(?:-[0-9]+)+$' -or ($ace.mask -isnot [int] -and $ace.mask -isnot [long]) -or $ace.mask -lt 0 -or ($ace.mask -band (-bnot [long]2032127)) -ne 0){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
    if(($ace.flags -band 8) -ne 0){continue}
    if($ace.sid -ceq 'S-1-3-0'){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
    if($ace.qualifier -ceq 'ALLOW' -and $ace.sid -cnotin $trusted){$allowedDanger=$danger;if($Path -ceq 'C:\' -and $ProgramFilesHeld){$allowedDanger=$danger -band (-bnot [long]4)};if(($ace.mask -band $allowedDanger) -ne 0){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}}
   }
  }
  function Get-OwnerCutoverCompiledDefaultSnapshot {
   Assert-OwnerCutoverPrivateClock;$drive=Get-OwnerCutoverCompiledDefaultDriveType;Assert-OwnerCutoverPrivateClock;if($drive -isnot [IO.DriveType] -or $drive -ne [IO.DriveType]::Fixed){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   $paths=@('C:\','C:\Program Files','C:\Program Files\Common Files','C:\Program Files\Common Files\SSL','C:\Program Files\Common Files\SSL\openssl.cnf');$existing=@();$missing=$null
   foreach($path in $paths){$state=Get-OwnerCutoverCompiledDefaultPathState $path;if(-not $state.exists){$missing=$path;break};if($path -ceq $paths[4] -or -not($state.attributes -band [IO.FileAttributes]::Directory) -or ($state.attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};$existing+=,$path}
   if($null -eq $missing -or $existing.Count -lt 1){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   $rows=@();foreach($path in $existing){
    Assert-OwnerCutoverPrivateClock;$security=Read-OwnerCutoverCompiledDefaultSecurity $path;Assert-OwnerCutoverPrivateClock;Assert-OwnerCutoverCompiledDefaultSecurity $security $path ($existing -ccontains 'C:\Program Files');Assert-OwnerCutoverPrivateClock
    if(-not $script:compiledDefaultBindings.ContainsKey($path)){$handle=$null;try{Assert-OwnerCutoverPrivateClock;$handle=Open-OwnerCutoverCompiledDefaultDirectory $path;Assert-OwnerCutoverPrivateClock;if($null -eq $handle){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};$script:compiledDefaultBindings[$path]=@{handle=$handle;identity=$null};$handle=$null}finally{if($null -ne $handle){try{$handle.Dispose()}catch{}}}}
    $binding=$script:compiledDefaultBindings[$path];Assert-OwnerCutoverPrivateClock;$identity=Get-OwnerCutoverCompiledDefaultIdentity $binding.handle $path;Assert-OwnerCutoverPrivateClock;Assert-OwnerLauncherShape $identity @('key','finalPath')
    if($identity.key -isnot [string] -or -not $identity.key -or $identity.key.Length -gt 512 -or $identity.finalPath -isnot [string] -or -not $identity.finalPath.Equals($path,[StringComparison]::OrdinalIgnoreCase)){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
    if($null -ne $binding.identity -and $binding.identity -cne $identity.key){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};$binding.identity=$identity.key
    $rows+=,[ordered]@{path=$path;identity=$identity.key;descriptorSha256=$security.descriptorSha256}
   }
   Assert-OwnerCutoverPrivateClock;return (Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes((([ordered]@{role='compiled-node24-default-platform-ancestry-only';missing=$missing;existing=$rows})|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 5 -Compress))))
  }
  function Get-OwnerCutoverNodeStartupPolicyObservation {
   Assert-OwnerCutoverPrivateClock;if($script:nodeStartupPolicyLifetime.terminal){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   try{$first=Get-OwnerCutoverCompiledDefaultSnapshot;Assert-OwnerCutoverPrivateClock;$second=Get-OwnerCutoverCompiledDefaultSnapshot;Assert-OwnerCutoverPrivateClock;if($first -cne $second -or ($null -ne $script:compiledDefaultFingerprint -and $first -cne $script:compiledDefaultFingerprint)){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};$script:compiledDefaultFingerprint=$first
    return [pscustomobject]@{profile='goriq-node24-compiled-openssl-conf-absence-v1';nodeSha256=$script:originalState.grant.protectedNodeBootstrap.nodeSha256;entrySourceSha256=$script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.ps1';compilerEvidenceSha256='cf88e5151743025a5c2800eedfb78da0efd923445f20355038f576f3d874c55a';configPath='C:\Program Files\Common Files\SSL\openssl.cnf';configDisposition='ABSENT';absenceParentIdentitySha256=$first}
   }catch{$script:nodeStartupPolicyLifetime.terminal=$true;foreach($binding in $script:compiledDefaultBindings.Values){try{$binding.handle.Dispose()}catch{}};throw}
  }
  function Get-OwnerCutoverNodeStartupPolicyHash($Observation){
   Assert-OwnerLauncherShape $Observation @('profile','nodeSha256','entrySourceSha256','compilerEvidenceSha256','configPath','configDisposition','absenceParentIdentitySha256')
   foreach($key in @('profile','nodeSha256','entrySourceSha256','compilerEvidenceSha256','configPath','configDisposition','absenceParentIdentitySha256')){if($Observation.$key -isnot [string]){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}}
   if($Observation.profile -cne 'goriq-node24-compiled-openssl-conf-absence-v1' -or $Observation.nodeSha256 -cne $script:originalState.grant.protectedNodeBootstrap.nodeSha256 -or $Observation.entrySourceSha256 -cne $script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.ps1' -or $Observation.compilerEvidenceSha256 -cne 'cf88e5151743025a5c2800eedfb78da0efd923445f20355038f576f3d874c55a' -or $Observation.configPath -cne 'C:\Program Files\Common Files\SSL\openssl.cnf' -or $Observation.configDisposition -cne 'ABSENT' -or $Observation.absenceParentIdentitySha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   $canonical=[ordered]@{};foreach($key in @('profile','nodeSha256','entrySourceSha256','compilerEvidenceSha256','configPath','configDisposition','absenceParentIdentitySha256')){$canonical[$key]=$Observation.$key};return (Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes(($canonical|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))))
  }
  function Initialize-OwnerCutoverNodeStartupPolicy {
   Assert-OwnerCutoverPrivateClock
   if($script:nodeStartupPolicyLifetime.terminal -or $script:nodePath -isnot [string] -or -not $script:nodePath){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   if($script:nodeStartupPolicyLifetime.token){Assert-OwnerCutoverNodeStartupPolicy;return}
   try{
    Read-OwnerCutoverPrivateKernel;$observation=Get-OwnerCutoverNodeStartupPolicyObservation;Assert-OwnerCutoverPrivateClock;$hash=Get-OwnerCutoverNodeStartupPolicyHash $observation;Assert-OwnerCutoverPrivateClock
    $identity=[object]::new();$record=@{state=$script:originalState;nodePath=$script:nodePath;nodeSha256=$script:originalState.grant.protectedNodeBootstrap.nodeSha256;observationSha256=$hash};$script:nodeStartupPolicyLifetime.records.Add($identity,$record);$script:nodeStartupPolicyLifetime.token=$identity;$script:nodeStartupPolicyLifetime.record=$record
   }catch{$script:nodeStartupPolicyLifetime.terminal=$true;$code=$_.Exception.Message;if($code -cin @('ROTATION_CUTOVER_CLOCK_INVALID','ROTATION_CUTOVER_FORWARD_RESERVE')){throw $code};throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
  }
  function Assert-OwnerCutoverNodeStartupPolicy {
   Assert-OwnerCutoverPrivateClock;$record=$null
   if($script:nodeStartupPolicyLifetime.terminal -or $null -eq $script:nodeStartupPolicyLifetime.token -or -not $script:nodeStartupPolicyLifetime.records.TryGetValue($script:nodeStartupPolicyLifetime.token,[ref]$record) -or -not [object]::ReferenceEquals($record,$script:nodeStartupPolicyLifetime.record) -or -not [object]::ReferenceEquals($record.state,$script:originalState) -or $record.nodePath -cne $script:nodePath -or $record.nodeSha256 -cne $script:originalState.grant.protectedNodeBootstrap.nodeSha256){$script:nodeStartupPolicyLifetime.terminal=$true;throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
   try{$observation=Get-OwnerCutoverNodeStartupPolicyObservation;Assert-OwnerCutoverPrivateClock;if((Get-OwnerCutoverNodeStartupPolicyHash $observation) -cne $record.observationSha256){throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'};Assert-OwnerCutoverPrivateClock}catch{$script:nodeStartupPolicyLifetime.terminal=$true;$code=$_.Exception.Message;if($code -cin @('ROTATION_CUTOVER_CLOCK_INVALID','ROTATION_CUTOVER_FORWARD_RESERVE')){throw $code};throw 'ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED'}
  }
  $script:configurationBinding=$null;$script:configurationTerminal=$false;$script:configurationReleaseRoot=$null
  function Open-OwnerCutoverMutableFile([string]$Path){return [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))}
  function Get-OwnerCutoverMutableAclHash([string]$Path){
   Assert-OwnerCutoverPrivateClock;$item=Get-OwnerRotationNativeItem $Path;Assert-OwnerCutoverPrivateClock;$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]'Owner,Group,Access');Assert-OwnerCutoverPrivateClock
   return (Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Group,Access'))))
  }
  function Read-OwnerCutoverMutableSnapshot([string]$Path,[int]$Limit,[ValidateSet('NONEMPTY','FIXED_FALLBACK')][string]$Role='NONEMPTY'){
   $minimum=1;if($Role -ceq 'FIXED_FALLBACK'){if($null -eq $script:configurationBinding -or $Path -cnotin @(($script:configurationBinding.releaseRoot+'\.env'),($script:configurationBinding.releaseRoot+'\.env.local')) -or $Limit -ne 65536){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$minimum=0}
   Assert-OwnerCutoverPrivateProtectedPath $Path;Open-OwnerCutoverParentHandles $Path;Assert-OwnerCutoverPrivateClock;$aclBefore=Get-OwnerCutoverMutableAclHash $Path;Assert-OwnerCutoverPrivateClock
   $stream=$null;$other=$null;$memory=[IO.MemoryStream]::new()
   try{
    $stream=Open-OwnerCutoverMutableFile $Path;Assert-OwnerCutoverPrivateClock;$first=Get-OwnerCutoverFileIdentity $stream $Path;Assert-OwnerCutoverPrivateClock;$length=$stream.Length;Assert-OwnerCutoverPrivateClock
    if($first.links -isnot [int] -or $first.links -ne 1 -or $first.finalPath -ine $Path -or $first.key -isnot [string] -or -not $first.key -or $length -lt $minimum -or $length -gt $Limit){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $buffer=New-Object byte[] 8192
    while($true){Assert-OwnerCutoverPrivateClock;$count=$stream.Read($buffer,0,$buffer.Length);Assert-OwnerCutoverPrivateClock;if($count -eq 0){break};if($count -lt 0 -or $count -gt $buffer.Length -or $memory.Length+$count -gt $Limit){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$memory.Write($buffer,0,$count)}
    $other=Open-OwnerCutoverMutableFile $Path;Assert-OwnerCutoverPrivateClock;$after=Get-OwnerCutoverFileIdentity $other $Path;Assert-OwnerCutoverPrivateClock
    if($after.links -isnot [int] -or $after.links -ne 1 -or $after.finalPath -ine $Path -or $after.key -cne $first.key -or $other.Length -ne $length -or $memory.Length -ne $length){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $aclAfter=Get-OwnerCutoverMutableAclHash $Path;Assert-OwnerCutoverPrivateClock;if($aclBefore -isnot [string] -or $aclBefore -cnotmatch '^[a-f0-9]{64}$' -or $aclAfter -cne $aclBefore){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $bytes=$memory.ToArray();return @{bytes=$bytes;sha256=(Get-OwnerLauncherDigest $bytes);identityKey=$first.key;aclSha256=$aclBefore}
   }finally{if($other){$other.Dispose()};if($stream){$stream.Dispose()};$memory.Dispose()}
  }
  function ConvertFrom-OwnerCutoverProtectedConfiguration([byte[]]$Bytes){
   $memory=[IO.MemoryStream]::new($Bytes,$false);$reader=[IO.StreamReader]::new($memory,[Text.UTF8Encoding]::new($false,$true),$true);$secure=$null;$credential=$null;$plaintext=$null;$configuration=$null
   try{
    Assert-OwnerCutoverPrivateClock;$encrypted=$reader.ReadToEnd();Assert-OwnerCutoverPrivateClock
    $secure=Microsoft.PowerShell.Security\ConvertTo-SecureString $encrypted.Trim() -ErrorAction Stop;Assert-OwnerCutoverPrivateClock
    $credential=[Management.Automation.PSCredential]::new('config',$secure);Assert-OwnerCutoverPrivateClock;$plaintext=$credential.GetNetworkCredential().Password;Assert-OwnerCutoverPrivateClock
    if($plaintext -isnot [string] -or [Text.Encoding]::UTF8.GetByteCount($plaintext) -gt 131072){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $configuration=$plaintext|Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop;Assert-OwnerCutoverPrivateClock
    return @{configuration=$configuration;plaintext=$plaintext}
   }catch{throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}finally{$plaintext=$null;$configuration=$null;$credential=$null;if($secure){$secure.Dispose()};$reader.Dispose();$memory.Dispose();$encrypted=$null}
  }
  function New-OwnerCutoverConfigurationValidatorProcess($Info){$p=[Diagnostics.Process]::new();$p.StartInfo=$Info;return $p}
  function Get-OwnerCutoverWindowsDirectory {return [Environment]::GetFolderPath('Windows')}
  function Invoke-OwnerCutoverConfigurationValidator([string]$Json,[string]$ReleaseRoot,[string]$StateRoot){
   Initialize-OwnerCutoverNodeStartupPolicy;Assert-OwnerCutoverNodeStartupPolicy;Assert-OwnerCutoverPrivateClock;$windows=Get-OwnerCutoverWindowsDirectory;Assert-OwnerCutoverPrivateClock;Assert-OwnerCutoverKernelPath $windows
   $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$script:nodePath;$validatorPath=[IO.Path]::Combine($script:stagePath,'scripts','validate-jarvis-production-config.mjs');$info.Arguments='"'+$validatorPath+'" "'+$ReleaseRoot+'" "'+$StateRoot+'"';$info.WorkingDirectory=$script:stagePath;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
   # This owned validation child receives a minimal environment. This does not
   # assert anything about Scheduler's cached target environment.
   $info.EnvironmentVariables.Clear();$info.EnvironmentVariables['SystemRoot']=$windows;$info.EnvironmentVariables['USERPROFILE']=$script:kernelBaseline.profile;$info.EnvironmentVariables['LOCALAPPDATA']=$script:kernelBaseline.localAppData;$info.EnvironmentVariables['PATH']=(Get-OwnerCutoverParentPath $script:nodePath)+';'+(Get-OwnerCutoverParentPath $script:kernelBaseline.processPath)
   $process=$null;$started=$false;$inputClosed=$false;$outText=[Text.StringBuilder]::new();$errText=[Text.StringBuilder]::new()
   try{
    Assert-OwnerCutoverPrivateClock;$process=New-OwnerCutoverConfigurationValidatorProcess $info;Assert-OwnerCutoverPrivateClock;Assert-OwnerCutoverNodeStartupPolicy;$started=$process.Start();Assert-OwnerCutoverPrivateClock;Assert-OwnerCutoverNodeStartupPolicy;if(-not $started){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $outBuffer=New-Object char[] 512;$errBuffer=New-Object char[] 512;$outRead=$process.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length);Assert-OwnerCutoverPrivateClock;$errRead=$process.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length);Assert-OwnerCutoverPrivateClock;$inputWrite=$process.StandardInput.WriteAsync($Json);Assert-OwnerCutoverPrivateClock;$outDone=$false;$errDone=$false
    while($true){
     Assert-OwnerCutoverPrivateClock
     if(-not $inputClosed -and $inputWrite.IsCompleted){$null=$inputWrite.GetAwaiter().GetResult();$process.StandardInput.Close();$inputClosed=$true;Assert-OwnerCutoverPrivateClock}
     foreach($side in @('out','err')){
      $read=if($side -ceq 'out'){$outRead}else{$errRead};$done=if($side -ceq 'out'){$outDone}else{$errDone};if($done -or -not $read.IsCompleted){continue}
      $count=$read.GetAwaiter().GetResult();Assert-OwnerCutoverPrivateClock
      if($count -eq 0){if($side -ceq 'out'){$outDone=$true}else{$errDone=$true};continue}
      $builder=if($side -ceq 'out'){$outText}else{$errText};[char[]]$buffer=if($side -ceq 'out'){$outBuffer}else{$errBuffer};if($count -lt 0 -or $count -gt 512 -or $builder.Length+$count -gt 4096){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$null=$builder.Append($buffer,0,$count)
      if($side -ceq 'out'){$outRead=$process.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length)}else{$errRead=$process.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length)};Assert-OwnerCutoverPrivateClock
     }
     $exited=$process.HasExited;Assert-OwnerCutoverPrivateClock;if($exited -and $outDone -and $errDone){break};$null=$process.WaitForExit(25);Assert-OwnerCutoverPrivateClock
    }
    $exitCode=$process.ExitCode;Assert-OwnerCutoverPrivateClock
    if($exitCode -ne 0 -or $outText.ToString().Trim() -cne 'Production configuration structure: PASS' -or $errText.Length -ne 0){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   }catch{throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}finally{
    # Cancel only this owned validator child, like aborting an owned HTTP stream.
    # This never queries, stops or starts the production host/task.
    if($process){try{if($started -and -not $process.HasExited){$process.Kill();$null=$process.WaitForExit(1000)}}catch{};$process.Dispose()};$Json=$null
   }
  }
  function Initialize-OwnerCutoverPrivateConfiguration {
   Read-OwnerCutoverPrivateKernel
   if(-not $script:claimConsumed -or -not $script:stagePath -or -not $script:nodePath -or $script:stageTerminal -or $script:nodeTerminal -or $script:configurationTerminal -or $script:configurationBinding){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   Initialize-OwnerCutoverNodeStartupPolicy;Assert-OwnerCutoverNodeStartupPolicy
   $opened=$null;$decrypted=$null;$configuration=$null;$plaintext=$null
   try{
    $stateRoot=$script:kernelBaseline.profile+'\JARVIS\production';$path=$stateRoot+'\config.dpapi';Assert-OwnerCutoverPrivateProtectedPath $path;Assert-OwnerCutoverPrivateClock;$configPathObservation=Get-OwnerCutoverPathObservation $path;Assert-OwnerCutoverPrivateClock
    if($configPathObservation.directory -isnot [bool] -or $configPathObservation.directory -or $configPathObservation.ownerSid -cne $script:kernelBaseline.ownerSid){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $opened=Read-OwnerCutoverMutableSnapshot $path 1048576;$decrypted=ConvertFrom-OwnerCutoverProtectedConfiguration $opened.bytes;Assert-OwnerCutoverPrivateClock;$configuration=$decrypted.configuration;$plaintext=$decrypted.plaintext
    if($configuration -isnot [pscustomobject] -or $configuration.version -ne 1 -or $configuration.commit -isnot [string] -or $configuration.commit -cnotmatch '^[a-f0-9]{40}$' -or $configuration.releaseRoot -isnot [string] -or $configuration.environment -isnot [pscustomobject] -or $configuration.environment.JARVIS_DB_PATH -isnot [string]){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $release=$configuration.releaseRoot;$db=$configuration.environment.JARVIS_DB_PATH;Assert-OwnerCutoverKernelPath $release;Assert-OwnerCutoverKernelPath $db;Assert-OwnerCutoverPrivateProtectedPath $release
    Invoke-OwnerCutoverConfigurationValidator $plaintext $release $stateRoot;Assert-OwnerCutoverPrivateClock
    $manifest=Read-OwnerCutoverMutableSnapshot ($release+'\jarvis-release.json') 65536;$metadata=Get-OwnerLauncherJsonData $manifest.bytes
    if($metadata.commit -isnot [string] -or $metadata.commit -cne $configuration.commit){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $build=Read-OwnerCutoverMutableSnapshot ($release+'\.next\BUILD_ID') 65536;$host=Read-OwnerCutoverMutableSnapshot ($release+'\scripts\jarvis-remote-host.mjs') 1048576
    Hold-OwnerCutoverSourceFile ($release+'\jarvis-release.json') $manifest.sha256;Hold-OwnerCutoverSourceFile ($release+'\.next\BUILD_ID') $build.sha256;Hold-OwnerCutoverSourceFile ($release+'\scripts\jarvis-remote-host.mjs') $host.sha256
    Assert-OwnerCutoverPrivateProtectedPath $db;Assert-OwnerCutoverPrivateClock;$dbObservation=Get-OwnerCutoverPathObservation $db;Assert-OwnerCutoverPrivateClock;if($dbObservation.directory -isnot [bool] -or $dbObservation.directory){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $dbStream=$null;try{$dbStream=Open-OwnerCutoverMutableFile $db;Assert-OwnerCutoverPrivateClock;$dbIdentity=Get-OwnerCutoverFileIdentity $dbStream $db;Assert-OwnerCutoverPrivateClock;if($dbIdentity.links -isnot [int] -or $dbIdentity.links -ne 1 -or $dbIdentity.finalPath -ine $db -or $dbIdentity.key -isnot [string] -or -not $dbIdentity.key){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}}finally{if($dbStream){$dbStream.Dispose()}}
    $sidecars=@{}
    foreach($pair in @(@('.pc-tasks.json','expectedTaskFile'),@('.pc-observations.json','expectedObservationFile'))){$side=$db+$pair[0];Assert-OwnerCutoverPrivateClock;$observation=Get-OwnerCutoverPathObservation $side;Assert-OwnerCutoverPrivateClock;$expected=$script:originalState.grant.pcSidecars.($pair[1]) -ceq 'present';if($observation.exists -isnot [bool] -or $observation.exists -ne $expected){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};if($expected){$sidecars[$pair[0]]=Read-OwnerCutoverMutableSnapshot $side 8388608}else{$sidecars[$pair[0]]=$null}}
    $again=Read-OwnerCutoverMutableSnapshot $path 1048576
    if($again.sha256 -cne $opened.sha256 -or $again.identityKey -cne $opened.identityKey -or $again.aclSha256 -cne $opened.aclSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
    $script:configurationBinding=@{configuration=$configuration;configPath=$path;configSnapshot=$opened;stateRoot=$stateRoot;releaseRoot=$release;runtimeRevision=$configuration.commit;manifest=$manifest;build=$build;host=$host;dbPath=$db;dbIdentity=$dbIdentity;sidecars=$sidecars;targetEnvironmentVerified=$false}
    $script:configurationReleaseRoot=$release
    Assert-OwnerCutoverPrivateClock;return [pscustomobject]@{phase='CONFIGURATION_DATA_BOUND';effectCapability=$false;privateContextVerified=$false;targetEnvironmentVerified=$false}
   }catch{$script:configurationTerminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}finally{if($decrypted){$decrypted.plaintext=$null};$decrypted=$null;$plaintext=$null;$configuration=$null}
  }
  function Get-OwnerLauncherJsonData([byte[]]$Bytes){Assert-OwnerCutoverPrivateClock;$text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes).TrimStart([char]0xfeff);$value=$text|Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop;Assert-OwnerCutoverPrivateClock;return $value}
  $script:journalLifetime=@{consumed=$false;terminal=$false;token=$null;record=$null;identities=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}
  function Initialize-OwnerCutoverPrivateJournal {
   Read-OwnerCutoverPrivateKernel
   if($script:journalLifetime.consumed -or $script:journalLifetime.terminal -or -not $script:configurationBinding -or $script:configurationTerminal -or -not $script:claimConsumed -or -not $script:stagePath -or -not $script:nodePath -or $script:stageTerminal -or $script:nodeTerminal){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   $script:journalLifetime.consumed=$true
   try{
    $claim=Read-OwnerCutoverMutableSnapshot $script:claimPath 16384
    if($claim.sha256 -cne $script:claimSha256){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};Hold-OwnerCutoverSourceFile $script:claimPath $script:claimSha256
    $directory=$script:stagePath+'\.gai-results';New-OwnerCutoverPrivateDirectory $directory;$path=$directory+'\cutover-journal.json'
    $header=[ordered]@{schemaVersion=1;kind='GORIQ_ORIGINAL_CUTOVER_JOURNAL';approvalId=$script:originalState.grant.approvalId;originalGrantSha256=$script:originalState.grantHash;sourceRevision=$script:originalState.sourceRevision;sourceHashes=$script:originalState.grant.sourceHashes;workflowRunId=$script:originalState.workflowRunId;workflowRunAttempt=1;officialJobId=$script:originalState.jobId;officialJobStartedAt=$script:originalState.jobStartedAt;originalHardEndUtc=$script:originalState.hardEnd.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');originalMonotonicStamp=$script:originalState.originStamp.ToString([Globalization.CultureInfo]::InvariantCulture);originalMonotonicFrequency=$script:originalState.frequency.ToString([Globalization.CultureInfo]::InvariantCulture);ownerSidSha256=$script:originalState.grant.ownerSidSha256;originalProcessId=$script:kernelBaseline.pid;originalProcessCreationTicks=$script:kernelBaseline.creationTicks;originalClaimSha256=$script:claimSha256;originalConfigSha256=$script:configurationBinding.configSnapshot.sha256;configAclSha256=$script:configurationBinding.configSnapshot.aclSha256;runtimeRevision=$script:configurationBinding.runtimeRevision;manifestSha256=$script:configurationBinding.manifest.sha256;buildSha256=$script:configurationBinding.build.sha256;hostSha256=$script:configurationBinding.host.sha256;nodeSha256=$script:originalState.grant.protectedNodeBootstrap.nodeSha256}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($header|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 6 -Compress));if($bytes.Length -gt 16384){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'};$hash=Get-OwnerLauncherDigest $bytes
    New-OwnerCutoverPrivateFile $path $bytes;Hold-OwnerCutoverSourceFile $path $hash;Assert-OwnerCutoverPrivateClock
    $identity=[object]::new();$record=@{state=$script:originalState;path=$path;sha256=$hash;claimSha256=$script:claimSha256;configuration=$script:configurationBinding;kernel=$script:kernelBaseline};$script:journalLifetime.identities.Add($identity,$record);$script:journalLifetime.token=$identity;$script:journalLifetime.record=$record
    return [pscustomobject]@{phase='JOURNAL_DATA_BOUND';durableClaimBound=$true;effectCapability=$false;privateContextVerified=$false}
   }catch{$script:journalLifetime.terminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  }
  function Assert-OwnerCutoverPrivateJournal {
   Assert-OwnerCutoverPrivateClock
   $record=$null
   if($script:journalLifetime.terminal -or -not $script:journalLifetime.consumed -or $null -eq $script:journalLifetime.token -or -not $script:journalLifetime.identities.TryGetValue($script:journalLifetime.token,[ref]$record) -or -not [object]::ReferenceEquals($record,$script:journalLifetime.record) -or -not [object]::ReferenceEquals($record.state,$script:originalState) -or -not [object]::ReferenceEquals($record.configuration,$script:configurationBinding) -or -not [object]::ReferenceEquals($record.kernel,$script:kernelBaseline)){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
   Read-OwnerCutoverPrivateKernel;$observed=Read-OwnerCutoverMutableSnapshot $record.path 16384;Assert-OwnerCutoverPrivateClock
   if($observed.sha256 -cne $record.sha256 -or $observed.identityKey -cne $script:immutableFileBindings[$record.path].identityKey){$script:journalLifetime.terminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  }

  # Exact known loader package is required before applying its fallback rules.
  # This does not claim the complete installed release or environment verified.
  $script:knownFallbackSources=[ordered]@{'jarvis-remote-host.mjs'='adeff38e18b779d850acf0e5e84b721ff48c373690cabbbeabbe6ce4dde342ef';'jarvis-production-config.mjs'='4a8d55473cdbab4578d4c7ad84b339adce9e5423fea9cbfd9deb2d1d6a8f1fdb';'read-jarvis-production-config.ps1'='252f057b933ddd16c8eec85507fd43b084cf9f0cdba1ded93746ad5e199cccb5';'jarvis-managed-process.mjs'='4ac80f4f258460970bb7bfcf8442c2fa9f610dadf629ff8bba566111ed97c333';'jarvis-remote-access-lib.mjs'='f17d1d217563e4df89b395f9877c0690ba61023f77f6fb5b440f074014b0eab4'}
  $script:fallbackLifetime=@{token=$null;record=$null;terminal=$false;records=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}
  function Get-OwnerCutoverBoundFallbackRoot {
   Assert-OwnerCutoverPrivateClock
   if($script:fallbackLifetime.terminal -or $null -eq $script:configurationBinding -or $script:configurationReleaseRoot -isnot [string] -or -not $script:configurationReleaseRoot -or $script:configurationBinding.releaseRoot -cne $script:configurationReleaseRoot -or $script:configurationBinding.configuration.releaseRoot -cne $script:configurationReleaseRoot){$script:fallbackLifetime.terminal=$true;throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
   # File-ancestor deletion protection is insufficient for an absent fallback:
   # its exact directory must also exclude untrusted file/branch creation.
   Assert-OwnerCutoverPrivateProtectedPath $script:configurationReleaseRoot;Assert-OwnerCutoverPrivateClock
   return $script:configurationReleaseRoot
  }
  function Read-OwnerCutoverFallbackAttributes([string]$Path){
   $root=Get-OwnerCutoverBoundFallbackRoot;if($Path -cnotin @(($root+'\.env'),($root+'\.env.local'))){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
   Assert-OwnerCutoverPrivateClock;return [IO.File]::GetAttributes($Path)
  }
  function Get-OwnerCutoverFallbackFileState([string]$Name){
   if($Name -cnotin @('.env','.env.local') -or $null -eq $script:configurationBinding){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
   $root=Get-OwnerCutoverBoundFallbackRoot;$path=$root+'\'+$Name;Assert-OwnerCutoverPrivateClock
   try{$attributes=Read-OwnerCutoverFallbackAttributes $path;Assert-OwnerCutoverPrivateClock;if($attributes -isnot [IO.FileAttributes] -or ($attributes -band [IO.FileAttributes]::Directory) -or ($attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'};return [pscustomobject]@{exists=$true;path=$path}}
   catch{Assert-OwnerCutoverPrivateClock;$e=$_.Exception;while($e -is [Management.Automation.MethodInvocationException] -and $e.InnerException){$e=$e.InnerException};if($e.GetType() -eq [IO.FileNotFoundException] -and ($e.HResult -band 65535) -eq 2){return [pscustomobject]@{exists=$false;path=$path}};throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
  }
  function Assert-OwnerCutoverFallbackInputs {
   Assert-OwnerCutoverPrivateClock;$record=$null
   if($script:fallbackLifetime.terminal -or $null -eq $script:fallbackLifetime.token -or -not $script:fallbackLifetime.records.TryGetValue($script:fallbackLifetime.token,[ref]$record) -or -not [object]::ReferenceEquals($record,$script:fallbackLifetime.record) -or -not [object]::ReferenceEquals($record.state,$script:originalState) -or -not [object]::ReferenceEquals($record.configuration,$script:configurationBinding)){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
   try{
    if($record.releaseRoot -cne $script:configurationReleaseRoot -or $script:configurationBinding.releaseRoot -cne $record.releaseRoot){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
    Read-OwnerCutoverPrivateKernel;Assert-OwnerCutoverPrivateJournal;$null=Get-OwnerCutoverBoundFallbackRoot
    foreach($name in $script:knownFallbackSources.Keys){$null=Get-OwnerCutoverBoundFallbackRoot;$current=Read-OwnerCutoverMutableSnapshot ($record.releaseRoot+'\scripts\'+$name) 1048576;$before=$record.sources[$name];if($current.sha256 -cne $script:knownFallbackSources[$name] -or $current.sha256 -cne $before.sha256 -or $current.identityKey -cne $before.identityKey -or $current.aclSha256 -cne $before.aclSha256){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}}
    foreach($name in @('.env','.env.local')){$state=Get-OwnerCutoverFallbackFileState $name;$before=$record.inputs[$name];if($state.exists -ne $before.exists){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'};if($state.exists){$current=Read-OwnerCutoverMutableSnapshot $state.path 65536 'FIXED_FALLBACK';if($current.sha256 -cne $before.snapshot.sha256 -or $current.identityKey -cne $before.snapshot.identityKey -or $current.aclSha256 -cne $before.snapshot.aclSha256){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}}}
    Assert-OwnerCutoverPrivateClock
   }catch{$script:fallbackLifetime.terminal=$true;throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
  }
  function Initialize-OwnerCutoverFallbackInputs {
   Assert-OwnerCutoverPrivateClock
   if($script:fallbackLifetime.terminal -or $null -eq $script:configurationBinding -or $script:configurationTerminal){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
   if($script:fallbackLifetime.token){Assert-OwnerCutoverFallbackInputs;return [pscustomobject]@{phase='FALLBACK_INPUTS_BOUND';knownLoaderSourcesVerified=5;effectCapability=$false;targetEnvironmentVerified=$false}}
   try{
    Read-OwnerCutoverPrivateKernel;Assert-OwnerCutoverPrivateJournal;$sources=@{};$inputs=@{};$release=Get-OwnerCutoverBoundFallbackRoot
    foreach($name in $script:knownFallbackSources.Keys){$null=Get-OwnerCutoverBoundFallbackRoot;$path=$release+'\scripts\'+$name;$snapshot=Read-OwnerCutoverMutableSnapshot $path 1048576;if($snapshot.sha256 -cne $script:knownFallbackSources[$name]){throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'};Hold-OwnerCutoverSourceFile $path $snapshot.sha256;$sources[$name]=$snapshot}
    foreach($name in @('.env','.env.local')){$state=Get-OwnerCutoverFallbackFileState $name;$snapshot=$null;if($state.exists){$snapshot=Read-OwnerCutoverMutableSnapshot $state.path 65536 'FIXED_FALLBACK';Hold-OwnerCutoverSourceFile $state.path $snapshot.sha256};$inputs[$name]=@{exists=$state.exists;snapshot=$snapshot}}
    $identity=[object]::new();$record=@{state=$script:originalState;configuration=$script:configurationBinding;releaseRoot=$release;sources=$sources;inputs=$inputs};$script:fallbackLifetime.records.Add($identity,$record);$script:fallbackLifetime.token=$identity;$script:fallbackLifetime.record=$record
    Assert-OwnerCutoverFallbackInputs;return [pscustomobject]@{phase='FALLBACK_INPUTS_BOUND';knownLoaderSourcesVerified=5;effectCapability=$false;targetEnvironmentVerified=$false}
   }catch{$script:fallbackLifetime.terminal=$true;throw 'ROTATION_CUTOVER_ENVIRONMENT_REJECTED'}
  }
  # One parent-owned readonly peer. A reservation/writeahead is never reusable.
  $script:ownedPeerLifetime=@{consumed=$false;terminal=$false;process=$null;token=$null;record=$null;records=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();allocations=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();observerContainment='NOT_ATTEMPTED'}
  function New-OwnerCutoverOwnedPeerProcess($Info){
   Assert-OwnerCutoverPrivateClock;if($Info -isnot [Diagnostics.ProcessStartInfo]){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   $process=[Diagnostics.Process]::new();$process.StartInfo=$Info;$script:ownedPeerLifetime.allocations.Add($process,@{state=$script:originalState;info=$Info});return $process
  }
  function Close-OwnerCutoverOwnedPeerObserver {
   # Containment only, including terminal clock0. Never journal/write, query a
   # caller PID, or touch a runtime task. Only this constructor's exact object.
   $process=$script:ownedPeerLifetime.process;$allocation=$null
   if($process -isnot [Diagnostics.Process] -or -not $script:ownedPeerLifetime.allocations.TryGetValue($process,[ref]$allocation) -or -not [object]::ReferenceEquals($allocation.state,$script:originalState) -or -not [object]::ReferenceEquals($allocation.info,$process.StartInfo)){return}
   $script:ownedPeerLifetime.observerContainment='UNKNOWN'
   try{if(-not $process.HasExited){$process.Kill();if(-not $process.WaitForExit(1000)){return}};$script:ownedPeerLifetime.observerContainment='CLOSED'}catch{}finally{$process.Dispose()}
  }
  function Get-OwnerCutoverOwnedPeerProcessObservation($Process){
   Assert-OwnerCutoverPrivateClock;$null=$Process.Handle;Assert-OwnerCutoverPrivateClock;$id=$Process.Id;Assert-OwnerCutoverPrivateClock;$creation=$Process.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);Assert-OwnerCutoverPrivateClock;$session=$Process.SessionId;Assert-OwnerCutoverPrivateClock;$image=$Process.MainModule.FileName;Assert-OwnerCutoverPrivateClock;$exited=$Process.HasExited;Assert-OwnerCutoverPrivateClock
   if($exited){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};return @{pid=$id;creationTicks=$creation;sessionId=$session;imagePath=$image}
  }
  function Assert-OwnerCutoverPeerProcessObservation($Value){
   Assert-OwnerCutoverPrivateClock
   if($Value -isnot [Collections.IDictionary] -or $Value.Count -ne 4){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   foreach($key in @('pid','creationTicks','sessionId','imagePath')){if(-not $Value.Contains($key)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
   foreach($key in @('pid','sessionId')){if(($Value[$key] -isnot [int] -and $Value[$key] -isnot [long]) -or $Value[$key] -le 0 -or $Value[$key] -gt [int]::MaxValue){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
   if($Value.creationTicks -isnot [string] -or $Value.creationTicks -cnotmatch '^[1-9][0-9]{10,18}$' -or [long]$Value.creationTicks -gt [datetime]::MaxValue.Ticks){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Assert-OwnerCutoverKernelPath $Value.imagePath
  }
  function ConvertFrom-OwnerCutoverPeerWire([byte[]]$Bytes){
   Assert-OwnerCutoverPrivateClock;if($Bytes.Length -lt 2 -or $Bytes.Length -gt 32768 -or $Bytes[0] -eq 239){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   $text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes);$value=ConvertFrom-OwnerLauncherJson $text;Assert-OwnerCutoverPrivateClock
   # Decode equivalent escaped keys before checking duplicates. The normal JSON
   # parser validates grammar; the bounded token walk closes duplicate collapse.
   $frames=[Collections.Generic.List[object]]::new();$tokens=[regex]::Matches($text,'"(?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*"|[{}\[\],:]')
   foreach($match in $tokens){Assert-OwnerCutoverPrivateClock;$part=$match.Value
    if($part -ceq '{'){$frames.Add(@{object=$true;key=$true;seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)})}
    elseif($part -ceq '['){$frames.Add(@{object=$false})}
    elseif($part -cin @('}',']')){if($frames.Count -eq 0){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$frames.RemoveAt($frames.Count-1)}
    elseif($part -ceq ',' -and $frames.Count -gt 0 -and $frames[$frames.Count-1].object){$frames[$frames.Count-1].key=$true}
    elseif($part.StartsWith('"') -and $frames.Count -gt 0 -and $frames[$frames.Count-1].object -and $frames[$frames.Count-1].key){$key=ConvertFrom-OwnerLauncherJson $part;if(-not $frames[$frames.Count-1].seen.Add($key)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$frames[$frames.Count-1].key=$false}
    if($frames.Count -gt 12){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   }
   Assert-OwnerCutoverPrivateClock;return $value
  }
  function Wait-OwnerCutoverPeerTask($Task,$Process,$LocalWatch,$StderrTask){
   while(-not $Task.IsCompleted){
    Assert-OwnerCutoverPrivateClock;if($LocalWatch.ElapsedMilliseconds -gt 15000){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    $exited=$Process.HasExited;Assert-OwnerCutoverPrivateClock;if($exited -or ($StderrTask -and $StderrTask.IsCompleted)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    Assert-OwnerCutoverPrivateClock;Microsoft.PowerShell.Utility\Start-Sleep -Milliseconds 10;Assert-OwnerCutoverPrivateClock
   }
   Assert-OwnerCutoverPrivateClock;if($Task.IsFaulted -or $Task.IsCanceled){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
  }
  function Invoke-OwnerCutoverPeerInputFlush($Process,$LocalWatch,$StderrTask){
   Assert-OwnerCutoverPrivateClock;$allocation=$null
   if($Process -isnot [Diagnostics.Process] -or -not [object]::ReferenceEquals($Process,$script:ownedPeerLifetime.process) -or -not $script:ownedPeerLifetime.allocations.TryGetValue($Process,[ref]$allocation) -or -not [object]::ReferenceEquals($allocation.state,$script:originalState) -or -not [object]::ReferenceEquals($allocation.info,$Process.StartInfo)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   Assert-OwnerCutoverPrivateClock;$stream=$Process.StandardInput.BaseStream;Assert-OwnerCutoverPrivateClock
   $flushAction=[Delegate]::CreateDelegate([Action],$stream,'Flush')
   Assert-OwnerCutoverPrivateClock
   # Schedule only this exact owned stream leaf. Scheduling is not worker-side
   # deadline admission or preemption. Retain pending resources without a parent
   # Dispose/Flush; native/private capture remains refused until containment.
   $entry=@{state='ENTERED';task=$null;stream=$stream;action=$flushAction};$script:ownedPeerLifetime.inputFlush=$entry
   try{
    $entry.task=[Threading.Tasks.Task]::Run($flushAction)
    $entry.state='PENDING';Assert-OwnerCutoverPrivateClock
    Wait-OwnerCutoverPeerTask $entry.task $Process $LocalWatch $StderrTask
    $null=$entry.task.GetAwaiter().GetResult()
   }finally{
    # Task state is retained memory, not further protected I/O after expiry.
    if($entry.task -and $entry.task.IsCompleted){$entry.state=if($entry.task.IsFaulted -or $entry.task.IsCanceled){'THREW'}else{'RETURNED'}}
   }
   Assert-OwnerCutoverPrivateClock
  }
  function Assert-OwnerCutoverPeerNodeBinding {
   Assert-OwnerCutoverPrivateClock
   if($script:nodeTerminal -or $script:nodeStream -isnot [IO.Stream] -or -not $script:nodeStream.CanRead -or -not $script:sourceHandles.Contains($script:nodeStream) -or $null -eq $script:nodeIdentity){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   Assert-OwnerLauncherShape ([pscustomobject]$script:nodeIdentity) @('key','finalPath','links')
   if($script:nodeIdentity.key -isnot [string] -or -not $script:nodeIdentity.key -or $script:nodeIdentity.key.Length -gt 512 -or $script:nodeIdentity.finalPath -isnot [string] -or $script:nodeIdentity.finalPath -ine $script:nodePath -or $script:nodeIdentity.links -isnot [int] -or $script:nodeIdentity.links -ne 1){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   $again=Get-OwnerCutoverFileIdentity $script:nodeStream $script:nodePath;Assert-OwnerCutoverPrivateClock
   if($again.key -isnot [string] -or $again.key -cne $script:nodeIdentity.key -or $again.finalPath -isnot [string] -or $again.finalPath -ine $script:nodePath -or $again.links -isnot [int] -or $again.links -ne 1){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
  }
  function Assert-OwnerCutoverPeerAncestry($Proof,$Observation){
   Assert-OwnerLauncherShape $Proof @('profile','effectCapability','helper','node','bootstrap')
   if($Proof.profile -isnot [string] -or $Proof.profile -cne 'goriq-owned-node-peer-ancestry-data-v1' -or $Proof.effectCapability -isnot [bool] -or $Proof.effectCapability){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   $rows=@($Proof.helper,$Proof.node,$Proof.bootstrap);$seen=@{};$ownerHash=Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes($script:kernelBaseline.ownerSid))
   for($index=0;$index -lt 3;$index++){
    Assert-OwnerCutoverPrivateClock;$row=$rows[$index];Assert-OwnerLauncherShape $row @('pid','parentPid','creationTicks','sessionId','imagePath','imageSha256','imageIdentityKey','ownerSidSha256','signatureStatus','publisher')
    foreach($field in @('pid','parentPid','sessionId')){if(($row.$field -isnot [int] -and $row.$field -isnot [long]) -or $row.$field -le 0 -or $row.$field -gt [int]::MaxValue){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
    if($seen.ContainsKey([string]$row.pid) -or $row.sessionId -ne $script:kernelBaseline.sessionId -or $row.creationTicks -isnot [string] -or $row.creationTicks -cnotmatch '^[1-9][0-9]{10,18}$' -or [long]$row.creationTicks -gt [datetime]::MaxValue.Ticks){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$seen[[string]$row.pid]=$true
    Assert-OwnerCutoverKernelPath $row.imagePath
    foreach($field in @('imageSha256','ownerSidSha256')){if($row.$field -isnot [string] -or $row.$field -cnotmatch '^[a-f0-9]{64}$'){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
    if($row.ownerSidSha256 -cne $ownerHash -or $row.imageIdentityKey -isnot [string] -or -not $row.imageIdentityKey -or $row.imageIdentityKey.Length -gt 512 -or $row.imageIdentityKey -match '[\r\n\0]' -or $row.signatureStatus -isnot [string] -or $row.publisher -isnot [string]){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    if($index -eq 1){if($row.imagePath -ine $script:nodePath -or $row.imageSha256 -cne $script:originalState.grant.protectedNodeBootstrap.nodeSha256 -or $row.signatureStatus -cne 'NOT_REQUIRED' -or $row.publisher -cne ''){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
    elseif($row.imagePath -ine $script:kernelBaseline.processPath -or $row.signatureStatus -cne 'Valid' -or $row.publisher -cne 'Microsoft Corporation'){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    if($index -gt 0 -and [long]$row.creationTicks -gt [long]$rows[$index-1].creationTicks){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   }
   if($Proof.helper.parentPid -ne $Proof.node.pid -or $Proof.node.parentPid -ne $script:kernelBaseline.pid -or $Proof.bootstrap.pid -ne $script:kernelBaseline.pid -or $Proof.bootstrap.creationTicks -cne $script:kernelBaseline.creationTicks -or $Proof.node.pid -ne $Observation.pid -or $Proof.node.creationTicks -cne $Observation.creationTicks -or $Proof.node.imageIdentityKey -cne $script:nodeIdentity.key -or $Proof.helper.imageSha256 -cne $Proof.bootstrap.imageSha256){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   Assert-OwnerCutoverPrivateClock
  }
  function Assert-OwnerCutoverOwnedPeer {
   try{Assert-OwnerCutoverPrivateClock;$record=$null
   if($script:ownedPeerLifetime.terminal -or $null -eq $script:ownedPeerLifetime.token -or -not $script:ownedPeerLifetime.records.TryGetValue($script:ownedPeerLifetime.token,[ref]$record) -or -not [object]::ReferenceEquals($record,$script:ownedPeerLifetime.record) -or -not [object]::ReferenceEquals($record.state,$script:originalState) -or -not [object]::ReferenceEquals($record.journal,$script:journalLifetime.token) -or -not [object]::ReferenceEquals($record.process,$script:ownedPeerLifetime.process)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   Read-OwnerCutoverPrivateKernel;Assert-OwnerCutoverPrivateJournal;Assert-OwnerCutoverNodeStartupPolicy;Assert-OwnerCutoverPeerNodeBinding;$observed=Get-OwnerCutoverOwnedPeerProcessObservation $record.process;Assert-OwnerCutoverPeerProcessObservation $observed;if($observed.pid -ne $record.observation.pid -or $observed.creationTicks -cne $record.observation.creationTicks -or $observed.sessionId -ne $script:kernelBaseline.sessionId -or $observed.imagePath -ine $script:nodePath -or $record.stderrTask.IsCompleted -or $record.extraTask.IsCompleted){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Assert-OwnerCutoverPrivateClock}catch{$script:ownedPeerLifetime.terminal=$true;Close-OwnerCutoverOwnedPeerObserver;throw}
  }
  function Initialize-OwnerCutoverOwnedPeer {
   Assert-OwnerCutoverPrivateClock
   if($script:ownedPeerLifetime.consumed -or $script:ownedPeerLifetime.terminal){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
   Read-OwnerCutoverPrivateKernel;Assert-OwnerCutoverPrivateJournal;Assert-OwnerCutoverFallbackInputs;Assert-OwnerCutoverNodeStartupPolicy;Assert-OwnerCutoverPrivateClock
   $script:ownedPeerLifetime.consumed=$true;$process=$null;$watch=[Diagnostics.Stopwatch]::StartNew()
   try{
    Assert-OwnerCutoverPeerNodeBinding
    $entered=[ordered]@{schemaVersion=1;kind='GORIQ_ORIGINAL_OWNED_PEER_ENTERED';originalGrantSha256=$script:originalState.grantHash;attemptId=$script:originalState.grant.approvalId;originalJournalSha256=$script:journalLifetime.record.sha256;sourceRevision=$script:originalState.sourceRevision;nativeMjsSha256=$script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.mjs';nativePsSha256=$script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.ps1'}
    $enteredBytes=[Text.Encoding]::UTF8.GetBytes(($entered|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress));$enteredPath=$script:stagePath+'\.gai-results\owned-peer-entered.json';$enteredHash=Get-OwnerLauncherDigest $enteredBytes
    New-OwnerCutoverPrivateFile $enteredPath $enteredBytes;Hold-OwnerCutoverSourceFile $enteredPath $enteredHash;Assert-OwnerCutoverPrivateClock
    $native=$script:stagePath+'\scripts\owner-code-rotation-native-1218.mjs';$system=Get-OwnerCutoverWindowsDirectory;Assert-OwnerCutoverPrivateClock
    $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$script:nodePath;$info.Arguments='"'+$native+'" --owned-cutover-peer';$info.WorkingDirectory=$script:stagePath;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.EnvironmentVariables.Clear()
    $values=@{SystemRoot=$system;WINDIR=$system;ComSpec=($system+'\System32\cmd.exe');USERPROFILE=$script:kernelBaseline.profile;LOCALAPPDATA=$script:kernelBaseline.localAppData;TEMP=($script:stagePath+'\.gai-results');TMP=($script:stagePath+'\.gai-results');PATH=([IO.Path]::GetDirectoryName($script:nodePath)+';'+[IO.Path]::Combine($system,'System32')+';'+$system);PATHEXT='.COM;.EXE;.BAT;.CMD';PSModulePath=([IO.Path]::Combine($system,'System32','WindowsPowerShell','v1.0','Modules'))};foreach($key in $values.Keys){$info.EnvironmentVariables[$key]=$values[$key]}
    $process=New-OwnerCutoverOwnedPeerProcess $info;$allocation=$null;if($process -isnot [Diagnostics.Process] -or -not $script:ownedPeerLifetime.allocations.TryGetValue($process,[ref]$allocation) -or -not [object]::ReferenceEquals($allocation.state,$script:originalState) -or -not [object]::ReferenceEquals($allocation.info,$info) -or -not [object]::ReferenceEquals($allocation.info,$process.StartInfo)){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$script:ownedPeerLifetime.process=$process;Assert-OwnerCutoverPrivateClock;if(-not $process.Start()){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Assert-OwnerCutoverPrivateClock
    $observed=Get-OwnerCutoverOwnedPeerProcessObservation $process;Assert-OwnerCutoverPeerProcessObservation $observed;if($observed.imagePath -ine $script:nodePath -or $observed.sessionId -ne $script:kernelBaseline.sessionId){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    $hello=[ordered]@{schemaVersion=1;kind='GORIQ_OWNED_NODE_PEER_HELLO';sequence=1;sourceRevision=$script:originalState.sourceRevision;originalGrantSha256=$script:originalState.grantHash;attemptId=$script:originalState.grant.approvalId;workflowRunId=$script:originalState.workflowRunId;officialJobId=$script:originalState.jobId;nativeMjsSha256=$script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.mjs';nativePsSha256=$script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.ps1';bootstrapPid=$script:kernelBaseline.pid;bootstrapCreationTicks=$script:kernelBaseline.creationTicks;ownerSidSha256=$script:originalState.grant.ownerSidSha256;sessionId=$script:kernelBaseline.sessionId;nodePid=$observed.pid;nodeCreationTicks=$observed.creationTicks;nodePath=$script:nodePath;nodeImageIdentityKey=$script:nodeIdentity.key}
    $wire=[Text.Encoding]::UTF8.GetBytes(($hello|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)+[char]10);if($wire.Length -gt 32768){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    $errorBuffer=New-Object char[] 1;Assert-OwnerCutoverPrivateClock;$stderrTask=$process.StandardError.ReadAsync($errorBuffer,0,1);Assert-OwnerCutoverPrivateClock;$write=$process.StandardInput.BaseStream.WriteAsync($wire,0,$wire.Length);Assert-OwnerCutoverPrivateClock;Wait-OwnerCutoverPeerTask $write $process $watch $stderrTask;$null=$write.GetAwaiter().GetResult();Assert-OwnerCutoverPrivateClock
    Invoke-OwnerCutoverPeerInputFlush $process $watch $stderrTask
    $bytes=New-Object byte[] 32769;$total=0;$complete=$false
    while(-not $complete){Assert-OwnerCutoverPrivateClock;$read=$process.StandardOutput.BaseStream.ReadAsync($bytes,$total,$bytes.Length-$total);Assert-OwnerCutoverPrivateClock;Wait-OwnerCutoverPeerTask $read $process $watch $stderrTask;$count=$read.Result;Assert-OwnerCutoverPrivateClock;if($count -le 0){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$total+=$count;if($total -gt 32768){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};for($index=0;$index -lt $total;$index++){if($bytes[$index] -eq 10){if($index -ne $total-1){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};$complete=$true;break}}}
    $frame=New-Object byte[] ($total-1);[Array]::Copy($bytes,$frame,$total-1);$reply=ConvertFrom-OwnerCutoverPeerWire $frame;Assert-OwnerLauncherShape $reply @('schemaVersion','kind','sequence','sourceRevision','originalGrantSha256','nativeMjsSha256','nativePsSha256','ancestry')
    foreach($field in @('kind','sourceRevision','originalGrantSha256','nativeMjsSha256','nativePsSha256')){if($reply.$field -isnot [string]){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}
    if(($reply.schemaVersion -isnot [int] -and $reply.schemaVersion -isnot [long]) -or $reply.schemaVersion -ne 1 -or ($reply.sequence -isnot [int] -and $reply.sequence -isnot [long]) -or $reply.sequence -ne 1 -or $reply.kind -isnot [string] -or $reply.kind -cne 'GORIQ_OWNED_NODE_PEER_OS_DATA' -or $reply.sourceRevision -cne $script:originalState.sourceRevision -or $reply.originalGrantSha256 -cne $script:originalState.grantHash -or $reply.nativeMjsSha256 -cne $script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.mjs' -or $reply.nativePsSha256 -cne $script:originalState.grant.sourceHashes.'scripts/owner-code-rotation-native-1218.ps1'){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    Assert-OwnerCutoverPeerAncestry $reply.ancestry $observed;Assert-OwnerCutoverPrivateClock;$again=Get-OwnerCutoverOwnedPeerProcessObservation $process;Assert-OwnerCutoverPeerProcessObservation $again;if($again.pid -ne $observed.pid -or $again.creationTicks -cne $observed.creationTicks -or $again.sessionId -ne $observed.sessionId -or $again.imagePath -ine $observed.imagePath){throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}
    $extraBuffer=New-Object byte[] 1;Assert-OwnerCutoverPrivateClock;$extraTask=$process.StandardOutput.BaseStream.ReadAsync($extraBuffer,0,1);Assert-OwnerCutoverPrivateClock
    $identity=[object]::new();$record=@{state=$script:originalState;journal=$script:journalLifetime.token;process=$process;observation=$observed;stderrTask=$stderrTask;extraTask=$extraTask;enteredPath=$enteredPath;enteredSha256=$enteredHash;ancestry=$reply.ancestry};$script:ownedPeerLifetime.records.Add($identity,$record);$script:ownedPeerLifetime.token=$identity;$script:ownedPeerLifetime.record=$record
    Assert-OwnerCutoverOwnedPeer;return [pscustomobject]@{phase='OWNED_PEER_DATA_BOUND';effectCapability=$false;originalPreservationBound=$false;credentialProofBound=$false;knownRecoveryBound=$false}
   }catch{$script:ownedPeerLifetime.terminal=$true;Close-OwnerCutoverOwnedPeerObserver;throw 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}finally{$watch.Stop()}
  }

  Export-ModuleMember -Function Read-OwnerCutoverPrivateKernel
 }
 Assert-OwnerCutoverPublicBudget $State;return $module
}
function New-OwnerCutoverPrivateBackend {
 param([object]$PublicToken)
 $state=$null;$publicStore=Get-Variable -Name ownerCutoverPublicLifetimes -Scope Script -ErrorAction SilentlyContinue
 if(-not $publicStore -or $null -eq $PublicToken -or -not $script:ownerCutoverPublicLifetimes.tokens.TryGetValue($PublicToken,[ref]$state) -or $state.phase -cne 'PUBLIC_SOURCE_BOUND'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
 Assert-OwnerCutoverPublicBudget $state
 $store=Get-Variable -Name ownerCutoverPrivateLifetimes -Scope Script -ErrorAction SilentlyContinue
 if(-not $store){$script:ownerCutoverPrivateLifetimes=@{states=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new();tokens=[System.Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()}}
 $record=$null
 if($script:ownerCutoverPrivateLifetimes.states.TryGetValue($state,[ref]$record)){
  if($record.terminal){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  $null=Get-OwnerCutoverPrivateBackendStatus $record.token;return $record.token
 }
 $record=@{state=$state;module=$null;token=[object]::new();terminal=$false;phase='DISCOVERING_PRIVATE_KERNEL'};$script:ownerCutoverPrivateLifetimes.states.Add($state,$record)
 try{$record.module=New-OwnerCutoverPrivateModule $state;&$record.module {Read-OwnerCutoverPrivateKernel};Assert-OwnerCutoverPublicBudget $state;$record.phase='KERNEL_DATA_BOUND';$script:ownerCutoverPrivateLifetimes.tokens.Add($record.token,$record);return $record.token}catch{$record.terminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
}
function Get-OwnerCutoverPrivateBackendStatus {
 param([object]$Token)
 $record=$null;$store=Get-Variable -Name ownerCutoverPrivateLifetimes -Scope Script -ErrorAction SilentlyContinue
 if(-not $store -or $null -eq $Token -or -not $script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($Token,[ref]$record) -or $record.terminal -or $record.phase -cne 'KERNEL_DATA_BOUND'){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
 try{Assert-OwnerCutoverPublicBudget $record.state;&$record.module {Read-OwnerCutoverPrivateKernel};Assert-OwnerCutoverPublicBudget $record.state}catch{$record.terminal=$true;throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
 return [pscustomobject][ordered]@{schemaVersion=1;phase='KERNEL_DATA_BOUND';effectCapability=$false;privateContextVerified=$false}
}

# Retained-scriptblock execution has no trustworthy PSScriptRoot. This private
# DATA context derives only the fixed allocated workflow checkout and current
# working directory. Actual protected-source/Owner admission remains mandatory.
function Get-OwnerCutoverEntryWorkspace {
 if(-not $env:GITHUB_WORKSPACE -or -not [IO.Path]::IsPathRooted($env:GITHUB_WORKSPACE) -or $env:GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]{0,19}$' -or $env:GITHUB_RUN_ATTEMPT -cne '1' -or $env:GITHUB_SHA -cnotmatch '^[a-f0-9]{40}$'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 $workspace=[IO.Path]::GetFullPath($env:GITHUB_WORKSPACE);$root=[IO.Path]::Combine($workspace,('owner-native-'+$env:GITHUB_RUN_ID+'-'+$env:GITHUB_RUN_ATTEMPT));$location=Get-Location
 if($location.Provider.Name -cne 'FileSystem' -or -not [string]::Equals([IO.Path]::GetFullPath($location.ProviderPath),$root,[StringComparison]::OrdinalIgnoreCase)){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
 return $root
}
function Invoke-OwnerCutoverBootstrap {
 $result=[pscustomobject][ordered]@{schemaVersion=3;issue=1218;operation='production-cutover-bootstrap';complete=$false;failureCode='ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE';effectCapability=$false}
 try{
  $root=Get-OwnerCutoverEntryWorkspace
  $context=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT;GITHUB_WORKFLOW_REF=$env:GITHUB_WORKFLOW_REF;JARVIS_PRODUCTION_CONFIG=$env:JARVIS_PRODUCTION_CONFIG}
  $selection=Get-OwnerRotationProfileSelection -Encoded $env:GORIQ_OWNER_ROTATION_SCOPE_BASE64 -Environment $context -Now (Get-OwnerCutoverUtcNow)
  if($selection.profile -cne 'CUTOVER_V1'){throw 'ROTATION_ENTRY_CONTEXT_REQUIRED'}
  $publicReadiness=Get-OwnerCutoverPublicReadiness
  $script:ownerCutoverEntryWorkspaceContext=@{checkoutRoot=$root;sourceRevision=$selection.sourceRevision;originalGrantSha256=$selection.originalGrantSha256;workflowRunId=$env:GITHUB_RUN_ID;workflowRunAttempt=1;publicReadinessIdentity=$publicReadiness}
  $private=New-OwnerCutoverPrivateBackend -PublicToken $publicReadiness
  $script:ownerCutoverEntryWorkspaceContext.privateReadinessIdentity=$private;$record=$null
  if(-not $script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record)){throw 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED'}
  $sourceStatus=&$record.module {Initialize-OwnerCutoverPrivateSource};$nodeStatus=&$record.module {Initialize-OwnerCutoverProtectedNode};&$record.module {Initialize-OwnerCutoverNodeStartupPolicy};$configurationStatus=&$record.module {Initialize-OwnerCutoverPrivateConfiguration};$journalStatus=&$record.module {Initialize-OwnerCutoverPrivateJournal};$fallbackStatus=&$record.module {Initialize-OwnerCutoverFallbackInputs}
  $script:ownerCutoverEntryWorkspaceContext.readonlyPhase=$fallbackStatus.phase

 }catch{$code=$_.Exception.Message;if($code -cin @('ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE','ROTATION_CUTOVER_PUBLIC_SOURCE_REJECTED','ROTATION_CUTOVER_CLOCK_INVALID','ROTATION_CUTOVER_FORWARD_RESERVE','ROTATION_CUTOVER_NODE_STARTUP_POLICY_REQUIRED','ROTATION_ENTRY_ATTEMPT_CONSUMED')){$result.failureCode=$code}else{$result.failureCode='ROTATION_ENTRY_CONTEXT_REQUIRED'}}
 # The genuine readonly kernel/source/Node/config/journal/known-fallback path
 # is connected. Target environment/activeDB, held peer/original38, proof and actual recovery
 # are not connected; no data context enters the native admission registry.
 return $result
}

if ($MyInvocation.InvocationName -ne '.') {
 # The closed retained entry is intentionally unavailable until authentic
 # activation/current normal-start witnesses are connected; DATA cannot start.
 if($StartOnly){[Console]::Error.WriteLine('GORIQ_NORMAL_START_REFUSED');exit 1}
 if($BootstrapPublicCutover){[Console]::Out.WriteLine('{"schemaVersion":3,"issue":1218,"operation":"production-cutover-bootstrap","complete":false,"failureCode":"ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE","effectCapability":false}');exit 1}
 if (-not $Prepare -and -not $PreparePublic) { [Console]::Out.WriteLine('PLAN ONLY: native rotation preparation requires fresh exact-source authority; no Owner state is accessed.');exit 0 }
 if ([IO.Path]::DirectorySeparatorChar -eq [char]92) { $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules') }
 $result=if($PreparePublic){try{$public=Get-OwnerRotationPublicAdmission;Initialize-OwnerRotationEntryStage -PublicAdmission $public}catch{$code=[string]$_.Exception.Message;if($code -cnotin @('ROTATION_ENTRY_SCOPE_REQUIRED','ROTATION_ENTRY_CONTEXT_REQUIRED','ROTATION_ENTRY_OWNER_CONTEXT_REQUIRED','ROTATION_ENTRY_SOURCE_REJECTED','ROTATION_ENTRY_ATTEMPT_CONSUMED','ROTATION_ENTRY_NODE_REJECTED')){$code='ROTATION_ENTRY_PREPARATION_FAILED'};@{schemaVersion=1;complete=$false;failureCode=$code;profileMatchesEnvironment=$false}}}else{Initialize-OwnerRotationEntryStage}
 # Fixed protocol emission must also work if the trusted scope codec is unavailable.
 $failureJson=if ($null -eq $result.failureCode) { 'null' } else { '"'+$result.failureCode+'"' }
 [Console]::Out.WriteLine('{"schemaVersion":1,"complete":'+([bool]$result.complete).ToString().ToLowerInvariant()+',"failureCode":'+$failureJson+',"profileMatchesEnvironment":'+([bool]$result.profileMatchesEnvironment).ToString().ToLowerInvariant()+'}')
 if (-not $result.complete) { exit 1 }
}

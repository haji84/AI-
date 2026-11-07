param([string]$Root,[switch]$OwnedTransport,[switch]$ClosedChannel,[switch]$PlatformEnvironment,[ValidateSet(0,1,2)][int]$TransportGroup=0,[ValidateSet('positive','wrong-parent')][string]$HostedAncestry,[string]$NodeExecutable)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. (Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('PEER_FIXTURE_'+$Code)}}
# Hosted-only component evidence: real source-linked processes and readonly OS
# observations. This test never creates a native admission or an actual grant.
if($HostedAncestry){
 Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and $PSVersionTable.PSVersion.Major -eq 5 -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted') 'HOSTED_WINDOWS_REQUIRED'
 $system=[Environment]::GetFolderPath('System');$shell=$system+'\WindowsPowerShell\v1.0\powershell.exe';$windows=[IO.Directory]::GetParent($system).FullName
 $bootstrap=[Diagnostics.Process]::GetCurrentProcess();$nodeStream=$null;$node=$null;$ownedId=$null;$output=@();$watch=$null
 try{
  $null=$bootstrap.Handle;Require ($bootstrap.MainModule.FileName.Equals($shell,[StringComparison]::OrdinalIgnoreCase)) 'ACTUAL_FIXED_BOOTSTRAP_IMAGE'
  Require ($NodeExecutable -and [IO.Path]::GetFullPath($NodeExecutable) -ceq $NodeExecutable) 'ACTUAL_NODE_PATH'
  $nodeStream=[IO.File]::Open($NodeExecutable,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  . (Join-Path $Root 'scripts/owner-code-launcher-binding-inspection-1218.ps1')
  $identity=Get-OwnerLauncherHandleIdentity $nodeStream $NodeExecutable;Require ($identity.finalPath.Equals($NodeExecutable,[StringComparison]::OrdinalIgnoreCase) -and $identity.links -eq 1) 'ACTUAL_HELD_NODE_IDENTITY'
  $sha=[Security.Cryptography.SHA256]::Create();try{$nodeHash=([BitConverter]::ToString($sha.ComputeHash($nodeStream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  Require ($nodeHash -ceq '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') 'ACTUAL_PINNED_NODE'
  $who=[Security.Principal.WindowsIdentity]::GetCurrent();try{$ownerHash=Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes($who.User.Value))}finally{$who.Dispose()}
  $entry=Join-Path $Root 'scripts/owner-code-rotation-native-1218.mjs';$psEntry=Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1'
  $mjsHash=Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($entry));$psHash=Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($psEntry))
  Require ($env:GITHUB_SHA -cmatch '^[a-f0-9]{40}$') 'ACTUAL_SOURCE_REVISION'
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='"'+$entry+'" --owned-cutover-peer';$info.WorkingDirectory=$Root;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.EnvironmentVariables.Clear()
  $envValues=@{SystemRoot=$windows;WINDIR=$windows;ComSpec=($system+'\cmd.exe');USERPROFILE=[Environment]::GetFolderPath('UserProfile');LOCALAPPDATA=[Environment]::GetFolderPath('LocalApplicationData');TEMP=[IO.Path]::GetTempPath().TrimEnd([char]92);TMP=[IO.Path]::GetTempPath().TrimEnd([char]92);PATH=([IO.Path]::GetDirectoryName($NodeExecutable)+';'+$system+';'+$windows);PATHEXT='.COM;.EXE;.BAT;.CMD';PSModulePath=($system+'\WindowsPowerShell\v1.0\Modules')}
  foreach($name in $envValues.Keys){Require ([bool]$envValues[$name]) 'ACTUAL_PLATFORM_VALUE';$info.EnvironmentVariables[$name]=$envValues[$name]}
  $node=[Diagnostics.Process]::new();$node.StartInfo=$info;$watch=[Diagnostics.Stopwatch]::StartNew();Require $node.Start() 'ACTUAL_OWNED_NODE_STARTED';$ownedId=$node.Id;$null=$node.Handle
  $nodeTicks=$node.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);$bootstrapTicks=$bootstrap.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
  Require ($node.SessionId -eq $bootstrap.SessionId -and $node.MainModule.FileName.Equals($NodeExecutable,[StringComparison]::OrdinalIgnoreCase)) 'ACTUAL_NODE_OBSERVATION'
  $hello=[ordered]@{schemaVersion=1;kind='GORIQ_OWNED_NODE_PEER_HELLO';sequence=1;sourceRevision=$env:GITHUB_SHA;originalGrantSha256=(Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes('PUBLIC_COMPONENT_NOT_AUTHORITY')));attemptId='11111111-1111-4111-8111-111111111111';workflowRunId='12345';officialJobId='67890';nativeMjsSha256=$mjsHash;nativePsSha256=$psHash;bootstrapPid=$bootstrap.Id;bootstrapCreationTicks=$bootstrapTicks;ownerSidSha256=$ownerHash;sessionId=$node.SessionId;nodePid=$node.Id;nodeCreationTicks=$nodeTicks;nodePath=$NodeExecutable;nodeImageIdentityKey=$identity.key}
  if($HostedAncestry -ceq 'wrong-parent'){$hello.bootstrapPid=$bootstrap.Id+1}
  $stderrBuffer=New-Object char[] 4097;$stderrTask=$node.StandardError.ReadAsync($stderrBuffer,0,$stderrBuffer.Length)
  $stdoutBuffer=New-Object char[] 32769;$stdoutTask=$node.StandardOutput.ReadAsync($stdoutBuffer,0,$stdoutBuffer.Length)
  $wire=[Text.Encoding]::UTF8.GetBytes(($hello|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 4 -Compress)+[char]10)
  $write=$node.StandardInput.BaseStream.WriteAsync($wire,0,$wire.Length)
  while(-not $write.IsCompleted){Require ($watch.ElapsedMilliseconds -lt 13000) 'FINITE_CHILD_WRITE';[Threading.Thread]::Sleep(5)};$write.GetAwaiter().GetResult()
  if($HostedAncestry -ceq 'wrong-parent'){
   $node.StandardInput.Close();while(-not $node.HasExited){Require ($watch.ElapsedMilliseconds -lt 13000) 'FINITE_REFUSAL';[Threading.Thread]::Sleep(5)}
   Require ($stdoutTask.Wait(1000) -and $stderrTask.Wait(1000)) 'REFUSAL_PIPE_CLOSED';$outCount=$stdoutTask.GetAwaiter().GetResult();$errCount=$stderrTask.GetAwaiter().GetResult()
   Require ($node.ExitCode -eq 1 -and $outCount -eq 0 -and $errCount -gt 0 -and $errCount -le 4096 -and ([string]::new($stderrBuffer,0,$errCount)).Trim() -ceq 'GORIQ_OWNED_PEER_REFUSED') 'CLOSED_WRONG_PARENT_REFUSAL'
  }else{
   $text=[Text.StringBuilder]::new();$line=$null
   while($null -eq $line){
    while(-not $stdoutTask.IsCompleted){Require (-not $stderrTask.IsCompleted -and -not $node.HasExited -and $watch.ElapsedMilliseconds -lt 13000) 'FINITE_REPLY';[Threading.Thread]::Sleep(5)}
    $n=$stdoutTask.GetAwaiter().GetResult();Require ($n -gt 0 -and $text.Length+$n -le 32768) 'BOUNDED_SINGLE_REPLY';$null=$text.Append($stdoutBuffer,0,$n);$value=$text.ToString();$end=$value.IndexOf([char]10)
    if($end -ge 0){Require ($end -eq $value.Length-1) 'NO_EXTRA_REPLY';$line=$value.Substring(0,$end).TrimEnd([char]13)}else{$stdoutTask=$node.StandardOutput.ReadAsync($stdoutBuffer,0,$stdoutBuffer.Length)}
   }
   Require (-not $stderrTask.IsCompleted -and -not $node.HasExited) 'HELD_CLEAN_CHANNEL';$reply=ConvertFrom-OwnerLauncherJson $line
   Assert-OwnerRotationEntryShape $reply @('schemaVersion','kind','sequence','sourceRevision','originalGrantSha256','nativeMjsSha256','nativePsSha256','ancestry')
   Require ($reply.schemaVersion -eq 1 -and $reply.kind -ceq 'GORIQ_OWNED_NODE_PEER_OS_DATA' -and $reply.sequence -eq 1 -and $reply.sourceRevision -ceq $hello.sourceRevision -and $reply.originalGrantSha256 -ceq $hello.originalGrantSha256 -and $reply.nativeMjsSha256 -ceq $mjsHash -and $reply.nativePsSha256 -ceq $psHash) 'EXACT_SOURCE_CHANNEL'
   $proof=$reply.ancestry;Require ($proof.profile -ceq 'goriq-owned-node-peer-ancestry-data-v1' -and $proof.effectCapability -ceq $false) 'DATA_ONLY'
   Require ($proof.helper.parentPid -eq $node.Id -and $proof.node.pid -eq $node.Id -and $proof.node.parentPid -eq $bootstrap.Id -and $proof.bootstrap.pid -eq $bootstrap.Id -and $proof.node.creationTicks -ceq $nodeTicks -and $proof.bootstrap.creationTicks -ceq $bootstrapTicks) 'ACTUAL_ANCESTRY_AND_CREATION'
   foreach($r in @($proof.helper,$proof.node,$proof.bootstrap)){Require ($r.ownerSidSha256 -ceq $ownerHash -and $r.sessionId -eq $bootstrap.SessionId) 'ACTUAL_OWNER_AND_SESSION'}
   Require ($proof.node.imagePath.Equals($NodeExecutable,[StringComparison]::OrdinalIgnoreCase) -and $proof.node.imageSha256 -ceq $nodeHash -and $proof.node.imageIdentityKey -ceq $identity.key -and $proof.helper.imagePath.Equals($shell,[StringComparison]::OrdinalIgnoreCase) -and $proof.bootstrap.imagePath.Equals($shell,[StringComparison]::OrdinalIgnoreCase) -and $proof.helper.signatureStatus -ceq 'Valid' -and $proof.bootstrap.signatureStatus -ceq 'Valid') 'ACTUAL_IMAGE_IDENTITY'
   # Product emits only after its exact helper has exited. Reused PIDs are not
   # owned and are never killed; a same-creation live helper is a test failure.
   $helper=$null;try{$helper=[Diagnostics.Process]::GetProcessById($proof.helper.pid);Require ($helper.HasExited -or $helper.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture) -cne $proof.helper.creationTicks) 'OWN_HELPER_EXITED'}catch [ArgumentException]{}finally{if($helper){$helper.Dispose()}}
   $extra=New-Object char[] 1;$extraTask=$node.StandardOutput.ReadAsync($extra,0,1);$node.StandardInput.Close()
   while(-not $node.HasExited){Require ($watch.ElapsedMilliseconds -lt 13000) 'FINITE_OWN_NODE_EOF';[Threading.Thread]::Sleep(5)}
   Require ($extraTask.Wait(1000) -and $stderrTask.Wait(1000)) 'EOF_PIPES_CLOSED';$errCount=$stderrTask.GetAwaiter().GetResult()
   Require ($extraTask.GetAwaiter().GetResult() -eq 0 -and $node.ExitCode -eq 1 -and $errCount -gt 0 -and $errCount -le 4096 -and ([string]::new($stderrBuffer,0,$errCount)).Trim() -ceq 'GORIQ_OWNED_PEER_REFUSED') 'NORMAL_CHANNEL_EOF_CLOSED'
  }
  $after=Get-OwnerLauncherHandleIdentity $nodeStream $NodeExecutable;Require ($after.key -ceq $identity.key -and $after.finalPath -ceq $identity.finalPath -and $after.links -eq 1) 'HELD_NODE_UNCHANGED'
  $children=@(CimCmdlets\Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = '+$ownedId) -OperationTimeoutSec 1 -ErrorAction Stop);Require ($children.Count -eq 0) 'NO_REMAINING_OWN_NODE_CHILDREN'
  [ordered]@{pass=$true;case=$HostedAncestry;actualWindowsReadonly=$true;sourceLinked=$true;actualParentFactory=$false;ownedNodeClosed=$true;ownHelperClosed=$true;privateEntry=$false;nativeAuthority=$false;taskAccountDpapiCalls=0;perOwnedChildLimitMs=13000}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress;return
 }finally{if($node){try{if(-not $node.HasExited){$node.Kill();$null=$node.WaitForExit(1000)}}catch{};$node.Dispose()};if($nodeStream){$nodeStream.Dispose()};$bootstrap.Dispose()}
}
if($OwnedTransport){
 $publicInput=[Console]::In.ReadToEnd();$null=. (Join-Path $Root 'tests/owner-code-cutover-private-bootstrap.fixture.ps1') -Scenario kernel -FixtureInput $publicInput
 $owned=[IO.Path]::Combine([IO.Path]::GetTempPath(),('public-owned-peer-'+[IO.Path]::GetRandomFileName()));$null=[IO.Directory]::CreateDirectory($owned);$childPath=[IO.Path]::Combine($owned,'public-peer.mjs')
 $js=@'
import{closeSync}from'node:fs';let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{pending+=x;const end=pending.indexOf('\n');if(end<0)return;const first=pending.slice(0,end);pending='';if(first==='PUBLIC_TRIGGER_LATE_STDERR'){process.stderr.write('PUBLIC_LATE_STDERR');return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDOUT'){closeSync(1);return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDERR'){closeSync(2);return;}const h=JSON.parse(first);const row=(pid,parentPid,ticks,node)=>({pid,parentPid,creationTicks:ticks,sessionId:h.sessionId,imagePath:node?h.nodePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',imageSha256:node?'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237':'a'.repeat(64),imageIdentityKey:node?h.nodeImageIdentityKey:'PUBLIC-SYSTEM-IMAGE',ownerSidSha256:h.ownerSidSha256,signatureStatus:node?'NOT_REQUIRED':'Valid',publisher:node?'':'Microsoft Corporation'});const ancestry={profile:'goriq-owned-node-peer-ancestry-data-v1',effectCapability:false,helper:row(h.nodePid+1000,h.nodePid,String(BigInt(h.nodeCreationTicks)+1n),false),node:row(h.nodePid,h.bootstrapPid,h.nodeCreationTicks,true),bootstrap:row(h.bootstrapPid,3000,h.bootstrapCreationTicks,false)};const reply={schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_OS_DATA',sequence:1,sourceRevision:h.sourceRevision,originalGrantSha256:h.originalGrantSha256,nativeMjsSha256:h.nativeMjsSha256,nativePsSha256:h.nativePsSha256,ancestry};const mode=process.env.GORIQ_PUBLIC_PEER_CASE;if(mode==='pid')reply.ancestry.node.pid++;if(mode==='source')reply.nativePsSha256='e'.repeat(64);if(mode==='source-array')reply.nativePsSha256=[reply.nativePsSha256];if(mode==='stderr')process.stderr.write('PUBLIC_ONLY_UNEXPECTED_STDERR');let wire=JSON.stringify(reply);if(mode==='duplicate')wire=wire.replace('"sequence":1','"sequence":2,"sequence":1');process.stdout.write(wire+'\n'+(mode==='extra'?'PUBLIC_EXTRA_FRAME\n':''));});
'@
 [IO.File]::WriteAllText($childPath,$js,[Text.UTF8Encoding]::new($false));$rows=@();$index=3000;$startedCount=0
 try{$groups=@(@('success','pid','source','source-array'),@('duplicate','stderr','extra','foreign-factory'),@('journal-throw','start-expiry','node-binding-missing','late-stderr'));if($ClosedChannel){$groups=@(@('late-stdout-eof'),@('late-stderr-eof'),@('success'))};if($PlatformEnvironment){$groups=@(@('success'),@('success'),@('success'))};foreach($which in $groups[$TransportGroup]){$index++;$dir=PrivateSetup $index;$module=$null;try{
  $public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$privateRecord=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$privateRecord);$module=$privateRecord.module
  InstallFixtureSource $module;InstallFixtureNode $module;InstallFixtureConfiguration $module
  $package=(Get-CutoverPublicLoaderPackage).model
  &$module {param($sources);foreach($name in $sources.Keys){$path='D:\Installed\release-current\scripts\'+$name;$script:memoryFiles[$path]=[byte[]]$sources[$name].Clone();$script:identities[$path]='public-peer-loader-'+$name};function script:Read-OwnerCutoverFallbackAttributes([string]$Path){throw [IO.FileNotFoundException]::new('PUBLIC_PEER_ABSENCE')}} $package
  &$module {param($mode);$script:transportFixtureMode=$mode;$script:transportFakeNodeFacts=(Get-Command Get-OwnerCutoverNodeImageFacts).ScriptBlock;function script:Get-OwnerCutoverNodeImageFacts([string]$Path){$value=&$script:transportFakeNodeFacts $Path;if($script:transportFixtureMode -cne 'node-binding-missing'){$script:nodeStream=[IO.MemoryStream]::new([byte[]]$script:memoryFiles[$Path],$false);$script:sourceHandles.Add($script:nodeStream);$script:nodeIdentity=Get-OwnerCutoverFileIdentity $script:nodeStream $Path};return $value}} $which
  $null=&$module {Initialize-OwnerCutoverPrivateSource};$null=&$module {Initialize-OwnerCutoverProtectedNode};&$module {Initialize-OwnerCutoverNodeStartupPolicy};$null=&$module {Initialize-OwnerCutoverPrivateConfiguration};$null=&$module {Initialize-OwnerCutoverPrivateJournal};$null=&$module {Initialize-OwnerCutoverFallbackInputs}
  function ExpireOwnedTransportClock {$script:stamp+=880001}
  &$module {param($mode,$node,$child,$working,$expire,$checkEnvironment)
   $script:transportCheckEnvironment=$checkEnvironment;$script:transportCase=$mode;$script:transportNode=$node;$script:transportChild=$child;$script:transportWorking=$working;$script:transportExpire=$expire;$script:transportCreated=0;$script:transportActualFactory=(Get-Command New-OwnerCutoverOwnedPeerProcess -ErrorAction Stop).ScriptBlock;$script:transportActualObservation=(Get-Command Get-OwnerCutoverOwnedPeerProcessObservation -ErrorAction Stop).ScriptBlock;$script:transportActualWrite=(Get-Command New-OwnerCutoverPrivateFile).ScriptBlock
   function script:Get-OwnerCutoverWindowsDirectory {'C:\Windows'}
   function script:New-OwnerCutoverOwnedPeerProcess($Info){
    if($script:transportCheckEnvironment){$required=@('SystemRoot','WINDIR','ComSpec','USERPROFILE','LOCALAPPDATA','TEMP','TMP','PATH','PATHEXT','PSModulePath');Require ($Info.EnvironmentVariables.Count -eq $required.Count) 'EXACT_PARENT_PLATFORM_ENVIRONMENT';foreach($key in $required){Require ($Info.EnvironmentVariables.ContainsKey($key) -and [bool]$Info.EnvironmentVariables[$key]) ('PARENT_PLATFORM_'+$key)};Require ($Info.EnvironmentVariables['ComSpec'] -ceq ($Info.EnvironmentVariables['SystemRoot']+'\System32\cmd.exe') -and $Info.EnvironmentVariables['ComSpec'] -cne $env:ComSpec) 'VERIFIED_PLATFORM_COMSPEC_NOT_AMBIENT'}
    $script:transportCreated++;$Info.FileName=$script:transportNode;$Info.Arguments='"'+$script:transportChild+'"';$Info.WorkingDirectory=$script:transportWorking;$Info.EnvironmentVariables['GORIQ_PUBLIC_PEER_CASE']=$script:transportCase;if($script:transportCase -ceq 'foreign-factory'){$outside=[Diagnostics.Process]::new();$outside.StartInfo=$Info;$script:foreignFixtureProcess=$outside;return $outside};return (&$script:transportActualFactory $Info)}
   function script:Get-OwnerCutoverOwnedPeerProcessObservation($Process){$value=&$script:transportActualObservation $Process;$value.imagePath=$script:nodePath;$value.sessionId=$script:kernelBaseline.sessionId;if($script:transportCase -ceq 'start-expiry'){&$script:transportExpire};return $value}
   function script:New-OwnerCutoverPrivateFile([string]$Path,[byte[]]$Bytes){&$script:transportActualWrite $Path $Bytes;if($script:transportCase -ceq 'journal-throw' -and $Path.EndsWith('owned-peer-entered.json')){throw 'PUBLIC_AMBIGUOUS_PEER_CREATE'}}
  } $which ([string]$inputData.nodeExecutable) $childPath $owned (Get-Command ExpireOwnedTransportClock).ScriptBlock ([bool]$PlatformEnvironment)
  if($which -ceq 'success'){if($PlatformEnvironment){$savedComSpec=$env:ComSpec;try{$env:ComSpec='C:\PUBLIC_UNTRUSTED\cmd.exe';$result=&$module {Initialize-OwnerCutoverOwnedPeer}}finally{$env:ComSpec=$savedComSpec}}else{$result=&$module {Initialize-OwnerCutoverOwnedPeer}};Require ($result.phase -ceq 'OWNED_PEER_DATA_BOUND' -and -not $result.effectCapability -and -not $result.originalPreservationBound -and -not $result.credentialProofBound -and -not $result.knownRecoveryBound) 'HELD_PEER_DATA_ONLY';$null=&$module {Assert-OwnerCutoverOwnedPeer}}
  elseif($which -cin @('late-stdout-eof','late-stderr-eof')){
   $null=&$module {Initialize-OwnerCutoverOwnedPeer};$ownedId=&$module {$script:ownedPeerLifetime.process.Id}
   $observation=&$module {param($name)
    $key=if($name -ceq 'late-stdout-eof'){'extraTask'}else{'stderrTask'};$command=if($name -ceq 'late-stdout-eof'){'PUBLIC_TRIGGER_CLOSE_STDOUT'}else{'PUBLIC_TRIGGER_CLOSE_STDERR'}
    $bytes=[Text.Encoding]::UTF8.GetBytes($command+[char]10);$script:ownedPeerLifetime.process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length)
    $watch=[Diagnostics.Stopwatch]::StartNew();$task=$script:ownedPeerLifetime.record[$key];while(-not $task.IsCompleted -and $watch.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(5)}
    return @{eofTaskCompleted=$task.IsCompleted;eofResult=$(if($task.IsCompleted){$task.GetAwaiter().GetResult()}else{-1});aliveBefore=(-not $script:ownedPeerLifetime.process.HasExited)}
   } $which
   Require ($observation.eofTaskCompleted -and $observation.eofResult -eq 0 -and $observation.aliveBefore) 'ACTUAL_EOF_WHILE_OWN_CHILD_ALIVE'
   Refused {&$module {Assert-OwnerCutoverOwnedPeer}}
   $stillAlive=$false;$probe=$null;try{$probe=[Diagnostics.Process]::GetProcessById($ownedId);$stillAlive=-not $probe.HasExited}catch{}finally{if($probe){$probe.Dispose()}}
   Require (-not $stillAlive) 'CLOSED_STDIO_OWNED_OBSERVER_TERMINATED'
  }
  elseif($which -ceq 'late-stderr'){$null=&$module {Initialize-OwnerCutoverOwnedPeer};$ownedId=&$module {$script:ownedPeerLifetime.process.Id};&$module {$bytes=[Text.Encoding]::UTF8.GetBytes('PUBLIC_TRIGGER_LATE_STDERR'+[char]10);$script:ownedPeerLifetime.process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$watch=[Diagnostics.Stopwatch]::StartNew();while(-not $script:ownedPeerLifetime.record.stderrTask.IsCompleted -and $watch.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(10)}};Refused {&$module {Assert-OwnerCutoverOwnedPeer}};$stillAlive=$false;$probe=$null;try{$probe=[Diagnostics.Process]::GetProcessById($ownedId);$stillAlive=-not $probe.HasExited}catch{}finally{if($probe){$probe.Dispose()}};Require (-not $stillAlive) 'FAILED_OWNED_OBSERVER_TERMINATED'}
  else{Refused {&$module {Initialize-OwnerCutoverOwnedPeer}}}
  $count=&$module {$script:transportCreated};$writes=&$module {$script:writes.Count};Refused {&$module {Initialize-OwnerCutoverOwnedPeer}};Require ((&$module {$script:transportCreated}) -eq $count -and (&$module {$script:writes.Count}) -eq $writes) 'NO_PROCESS_OR_WRITEAHEAD_REISSUE';Require ($count -eq $(if($which -cin @('journal-throw','node-binding-missing')){0}else{1})) 'OWNED_PROCESS_COUNT';if($which -cne 'foreign-factory'){$startedCount+=$count;}$rows+=@{case=$which;expected=$(if($which -ceq 'success'){'DATA_ONLY'}else{'REFUSE'})}
 }finally{if($module){&$module {if(Get-Variable foreignFixtureProcess -Scope Script -ErrorAction SilentlyContinue){try{$script:foreignFixtureProcess.Dispose()}catch{}};if($script:ownedPeerLifetime.process){try{if(-not $script:ownedPeerLifetime.process.HasExited){$script:ownedPeerLifetime.process.Kill();$null=$script:ownedPeerLifetime.process.WaitForExit(1000)}}catch{};try{$script:ownedPeerLifetime.process.Dispose()}catch{}}}};Close $dir}}}finally{[IO.Directory]::Delete($owned,$true)}
 @{pass=$true;transportCases=$rows;ownedPublicChildren=$startedCount;actualNativeWindowsCalls=0;authority=$false}|ConvertTo-Json -Depth 5 -Compress;return
}

$script:peerCase='';$script:peerTrace=[Collections.Generic.List[int]]::new();$script:peerElapsed=[long]0
function Get-OwnerCutoverPeerProbePlatform {return @{windows=$true;major=5;nativeSystem='C:\Windows\System32'}}
function Get-OwnerCutoverPeerProbeSelfId {return 3101}
function Get-OwnerCutoverPeerProbeElapsedMs {return $script:peerElapsed}
function Read-OwnerCutoverPeerProcessData {
 $Id=$script:ownerCutoverPeerProbeState.cursor
 [void]$script:peerTrace.Add($Id);if($script:peerCase -ceq 'expiry' -and $script:peerTrace.Count -eq 1){$script:peerElapsed=10001}
 $isNode=$Id -eq 3102;$row=[pscustomobject][ordered]@{pid=$Id;parentPid=$(if($Id -eq 3101){3102}elseif($Id -eq 3102){3103}else{3000});creationTicks=$(if($Id -eq 3101){'639000000000000003'}elseif($Id -eq 3102){'639000000000000002'}else{'639000000000000001'});sessionId=2;imagePath=$(if($isNode){'C:\Users\Owner\JARVIS\tools\node-v24.19.0-win-x64\node.exe'}else{'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'});imageSha256=$(if($isNode){'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'}else{'a'*64});imageIdentityKey=('public-file-'+$Id);ownerSidSha256=('b'*64);signatureStatus=$(if($isNode){'NOT_REQUIRED'}else{'Valid'});publisher=$(if($isNode){''}else{'Microsoft Corporation'})}
 if($script:peerCase -ceq 'cycle' -and $Id -eq 3102){$row.parentPid=3101};if($script:peerCase -ceq 'owner' -and $Id -eq 3103){$row.ownerSidSha256='c'*64};if($script:peerCase -ceq 'session' -and $Id -eq 3102){$row.sessionId=3};if($script:peerCase -ceq 'node-hash' -and $isNode){$row.imageSha256='d'*64};if($script:peerCase -ceq 'signature' -and -not $isNode){$row.signatureStatus='UnknownError'};if($script:peerCase -ceq 'image' -and -not $isNode){$row.imagePath='C:\Other\powershell.exe'};if($script:peerCase -ceq 'numeric'){$row.pid=[string]$row.pid};if($script:peerCase -ceq 'creation'){$row.creationTicks=[double]639000000000000003};if($script:peerCase -ceq 'newer-parent' -and $Id -eq 3103){$row.creationTicks='639000000000000009'};if($script:peerCase -ceq 'extra'){$row|Add-Member -NotePropertyName trusted -NotePropertyValue $true};return $row
}
$cases=@('success','cycle','owner','session','node-hash','signature','image','numeric','creation','newer-parent','extra','expiry');$rows=@()
foreach($which in $cases){$script:peerCase=$which;$script:peerTrace.Clear();$script:peerElapsed=0
 if($which -ceq 'success'){$proof=Get-OwnerCutoverPeerAncestryData;Require ($proof.profile -ceq 'goriq-owned-node-peer-ancestry-data-v1' -and -not $proof.effectCapability -and $proof.helper.pid -eq 3101 -and $proof.node.pid -eq 3102 -and $proof.bootstrap.pid -eq 3103) 'DERIVED_CHAIN_DATA';Require (($script:peerTrace -join ',') -ceq '3101,3102,3103') 'ONLY_DERIVED_THREE_IDS'}else{$refused=$false;try{Get-OwnerCutoverPeerAncestryData|Out-Null}catch{$refused=$_.Exception.Message -ceq 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Require $refused ('CLOSED_'+$which);if($which -ceq 'expiry'){Require ($script:peerTrace.Count -eq 1) 'NO_SECOND_OS_READ_AFTER_READONLY_EXPIRY'}}
 $rows+=@{case=$which;expected=$(if($which -ceq 'success'){'DATA_ONLY'}else{'REFUSE'})}
}
[ordered]@{pass=$true;cases=$rows;actualNativeCalls=0;authority=$false}|ConvertTo-Json -Depth 4 -Compress

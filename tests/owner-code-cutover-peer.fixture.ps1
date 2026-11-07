param([string]$Root,[switch]$OwnedTransport,[switch]$ClosedChannel,[switch]$PlatformEnvironment,[switch]$AwaitResultTransport,[switch]$PipeDiagnostic,[switch]$WriteDiagnostic,[switch]$ManagedFlushTransport,[ValidateSet(0,1,2)][int]$TransportGroup=0,[ValidateSet('positive','wrong-parent')][string]$HostedAncestry,[string]$NodeExecutable)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. (Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('PEER_FIXTURE_'+$Code)}}
# Bounded public-only progress. Each owned fixture process has a separate
# CreateNew file. Values contain closed phases and local elapsed time only.
function Write-PublicPeerProgress([string]$Phase){
 if(-not $script:peerProgressPath){return}
 $cases=@('SUCCESS','PID','SOURCE','SOURCE_ARRAY','DUPLICATE','STDERR','EXTRA','FOREIGN_FACTORY','JOURNAL_THROW','START_EXPIRY','NODE_BINDING_MISSING','LATE_STDERR','LATE_STDOUT_EOF','LATE_STDERR_EOF')
 $allowed=@('GROUP_BEGIN','GROUP_DONE','SOURCE_BASE_BEGIN','SOURCE_BASE_DONE')+@(foreach($name in $cases){foreach($edge in @('BEGIN','KERNEL_DONE','SOURCE_DONE','NODE_DONE','CONFIGURATION_DONE','JOURNAL_DONE','FALLBACK_DONE','PEER_DONE','END')){'CASE_'+$name+'_'+$edge}})
 if($allowed -cnotcontains $Phase){throw 'PUBLIC_PEER_PROGRESS_REJECTED'}
 $elapsed=$script:peerProgressWatch.ElapsedMilliseconds;if($elapsed -lt 0 -or $elapsed -gt 15000 -or $script:peerProgressRows -ge 64){throw 'PUBLIC_PEER_PROGRESS_REJECTED'}
 $bytes=[Text.Encoding]::UTF8.GetBytes($Phase+':'+$elapsed.ToString([Globalization.CultureInfo]::InvariantCulture)+[char]10);$stream=$null
 try{$stream=[IO.File]::Open($script:peerProgressPath,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::Read);if($stream.Length+$bytes.Length -gt 8192){throw 'PUBLIC_PEER_PROGRESS_REJECTED'};$null=$stream.Seek(0,[IO.SeekOrigin]::End);$stream.Write($bytes,0,$bytes.Length);$stream.Flush();$script:peerProgressRows++}catch{throw 'PUBLIC_PEER_PROGRESS_REJECTED'}finally{if($stream){$stream.Dispose()}}
}
# Public managed-leaf controls use the actual private production function and
# actual Action/Task.Run assignment ASTs. Test-only fake clocks do not grant an
# original-clock/native capability. All files/processes belong to this fixture.
if($ManagedFlushTransport){
 $nativePath=Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1';$parseErrors=$null;$tokens=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($nativePath,[ref]$tokens,[ref]$parseErrors)
 Require ($parseErrors.Count -eq 0) 'MANAGED_PARSE'
 $definitions=@($ast.FindAll({param($x)$x -is [Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -ceq 'Invoke-OwnerCutoverPeerInputFlush'},$true));Require ($definitions.Count -eq 1) 'ONE_ACTUAL_MANAGED_FLUSH_FUNCTION'
 $definition=$definitions[0]
 $actionStatements=@($definition.FindAll({param($x)$x -is [Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -ceq '$flushAction'},$true))
 $taskStatements=@($definition.FindAll({param($x)$x -is [Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -ceq '$entry.task'},$true))
 Require ($actionStatements.Count -eq 1 -and $taskStatements.Count -eq 1) 'ONE_ACTUAL_ACTION_TASK_VECTOR'
 $makeAction=[scriptblock]::Create($actionStatements[0].Extent.Text);$makeTask=[scriptblock]::Create($taskStatements[0].Extent.Text)
 Add-Type -TypeDefinition @'
using System;using System.IO;using System.Threading;
public sealed class GoriqPublicFlushStream:Stream {
 public readonly ManualResetEventSlim Entered=new ManualResetEventSlim(false),Release=new ManualResetEventSlim(false);
 public bool Fail;public int Calls,ThreadId;
 public override void Flush(){Interlocked.Increment(ref Calls);ThreadId=Thread.CurrentThread.ManagedThreadId;Entered.Set();if(!Release.Wait(2000))throw new IOException("PUBLIC_FLUSH_LIMIT");if(Fail)throw new IOException("PUBLIC_FLUSH_REJECTED");}
 public override bool CanRead{get{return false;}}public override bool CanWrite{get{return true;}}public override bool CanSeek{get{return false;}}
 public override long Length{get{throw new NotSupportedException();}}public override long Position{get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
 public override int Read(byte[] b,int o,int c){throw new NotSupportedException();}public override void Write(byte[] b,int o,int c){throw new NotSupportedException();}public override long Seek(long o,SeekOrigin s){throw new NotSupportedException();}public override void SetLength(long n){throw new NotSupportedException();}
}
'@|Out-Null
 $path=Join-Path ([IO.Path]::GetTempPath()) ('goriq-public-flush-'+[IO.Path]::GetRandomFileName());$stream=$null;$writer=$null;$reader=$null;$process=$null;$pending=$null
 try{
  $payload=[Text.Encoding]::UTF8.GetBytes('PUBLIC_UTF8_'+[char]0x65E5+[char]0x672C+[char]10)
  $stream=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read,4096,[IO.FileOptions]::None)
  $write=$stream.WriteAsync($payload,0,$payload.Length);Require ($write.Wait(1000)) 'FILE_WRITE_COMPLETE';$null=$write.GetAwaiter().GetResult()
  $reader=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);Require ($reader.Length -eq 0) 'REAL_FILESTREAM_BUFFERED_RED_CONTROL'
  $entry=@{task=$null};$null=. $makeAction;$null=. $makeTask;Require ($entry.task.Wait(1000)) 'REAL_FILESTREAM_MANAGED_FLUSH';$leaked=@($entry.task.GetAwaiter().GetResult());Require ($leaked.Count -eq 0) 'MANAGED_TASK_VOID_JSON_ONLY'
  Require ($reader.Length -eq $payload.Length) 'EXACT_BYTES_VISIBLE_AFTER_FLUSH';$bytes=New-Object byte[] $payload.Length;Require ($reader.Read($bytes,0,$bytes.Length) -eq $payload.Length -and [Convert]::ToBase64String($bytes) -ceq [Convert]::ToBase64String($payload)) 'UTF8_BYTES_UNCHANGED'
  $reader.Dispose();$reader=$null;$stream.Dispose();$stream=$null
  $stream=[GoriqPublicFlushStream]::new();$entry=@{task=$null};$parentThread=[Threading.Thread]::CurrentThread.ManagedThreadId;$null=. $makeAction;$null=. $makeTask;$pending=$entry.task
  Require ($stream.Entered.Wait(1000) -and -not $pending.IsCompleted -and $stream.ThreadId -ne $parentThread -and $stream.Calls -eq 1) 'BLOCKED_FLUSH_RUNS_OFF_PARENT'
  $stream.Release.Set();Require ($pending.Wait(1000)) 'RELEASED_FLUSH_FINITE';$null=$pending.GetAwaiter().GetResult();$stream.Dispose();$stream=$null;$pending=$null
  $stream=[GoriqPublicFlushStream]::new();$stream.Fail=$true;$stream.Release.Set();$entry=@{task=$null};$null=. $makeAction;$null=. $makeTask;$refused=$false;try{$entry.task.GetAwaiter().GetResult()}catch{$refused=$true};Require ($refused -and $entry.task.IsFaulted -and $stream.Calls -eq 1) 'FLUSH_ERROR_NOT_SUCCESS'
  $stream.Dispose();$stream=$null;$bad=$false;try{$null=[Delegate]::CreateDelegate([Action],[object]::new(),'Flush')}catch{$bad=$true};Require $bad 'MISSING_METHOD_NO_FALLBACK'
  # Actual function guards on a real owned child. Only the private module's
  # original-clock observation is replaced; no production TestMode/provider.
  Require ([bool]$NodeExecutable -and -not $NodeExecutable.Contains('"')) 'MANAGED_NODE_PATH'
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='-e "process.stdin.resume();process.stdin.on(''end'',()=>process.exit(0));"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $process=[Diagnostics.Process]::new();$process.StartInfo=$info;Require ($process.Start()) 'MANAGED_OWNED_CHILD_STARTED'
  $module=New-Module -ScriptBlock {param($definition,$owned,$info)
   . ([scriptblock]::Create($definition));$script:originalState=[object]::new();$script:ownedPeerLifetime=@{process=$owned;inputFlush=$null;allocations=[Runtime.CompilerServices.ConditionalWeakTable[object,object]]::new()};$script:ownedPeerLifetime.allocations.Add($owned,@{state=$script:originalState;info=$info});$script:checks=0;$script:expireAt=0;$script:waits=0
   function Assert-OwnerCutoverPrivateClock {$script:checks++;if($script:expireAt -gt 0 -and $script:checks -ge $script:expireAt){throw 'PUBLIC_ORIGINAL_CLOCK_EXPIRED'}}
   function Wait-OwnerCutoverPeerTask($Task,$Process,$LocalWatch,$StderrTask){$script:waits++;Require ($Task.Wait(1000)) 'OWNED_TASK_FINITE'}
  } -ArgumentList $definition.Extent.Text,$process,$info
  $watch=[Diagnostics.Stopwatch]::StartNew();$foreign=[Diagnostics.Process]::new();$foreign.StartInfo=$info
  try{$refused=$false;try{&$module {param($p,$w)Invoke-OwnerCutoverPeerInputFlush $p $w $null} $foreign $watch}catch{$refused=$true};Require ($refused -and (&$module {$null -eq $script:ownedPeerLifetime.inputFlush -and $script:waits -eq 0})) 'FOREIGN_PROCESS_NO_FLUSH'}finally{$foreign.Dispose()}
  foreach($expire in @(1,3)){&$module {param($at)$script:checks=0;$script:expireAt=$at} $expire;$refused=$false;try{&$module {param($p,$w)Invoke-OwnerCutoverPeerInputFlush $p $w $null} $process $watch}catch{$refused=$true};Require ($refused -and (&$module {$null -eq $script:ownedPeerLifetime.inputFlush -and $script:waits -eq 0})) 'ORIGINAL_HARD_ZERO_NO_SCHEDULE'}
  &$module {$script:checks=0;$script:expireAt=0};$leaked=@(&$module {param($p,$w)Invoke-OwnerCutoverPeerInputFlush $p $w $null} $process $watch);Require ($leaked.Count -eq 0 -and (&$module {$script:ownedPeerLifetime.inputFlush.state -ceq 'RETURNED' -and $script:waits -eq 1})) 'SUCCESS_VOID_AND_COMPLETION_MEMORY'
  &$module {$script:checks=0;$script:expireAt=0;function script:Wait-OwnerCutoverPeerTask($Task,$Process,$LocalWatch,$StderrTask){$script:waits++;Require ($Task.Wait(1000)) 'OWNED_POST_TASK_FINITE';throw 'PUBLIC_ORIGINAL_CLOCK_EXPIRED'}}
  $refused=$false;try{&$module {param($p,$w)Invoke-OwnerCutoverPeerInputFlush $p $w $null} $process $watch}catch{$refused=$true};Require ($refused -and (&$module {$script:ownedPeerLifetime.inputFlush.state -ceq 'RETURNED'})) 'POST_GUARD_FAILURE_RETAINS_ACTUAL_RETURNED'
  $process.StandardInput.Close();Require ($process.WaitForExit(1000)) 'OWNED_MANAGED_CHILD_EOF';$process.Dispose();$process=$null
  @{pass=$true;realBufferedFileStream=$true;actualProductionActionVector=$true;utf8Unchanged=$true;voidSuccessStream=$true;offParentThread=$true;throwRefused=$true;foreignProcessRefused=$true;expiredClockNoSchedule=$true;postguardRetainsCompletion=$true;nativeAuthority=$false;actualOwnerTaskAccountDpapiCalls=0}|ConvertTo-Json -Compress;return
 }finally{if($stream -is [GoriqPublicFlushStream]){$stream.Release.Set()};if($pending){try{$null=$pending.Wait(2500)}catch{}};if($reader){$reader.Dispose()};if($stream){$stream.Dispose()};if($process){try{if(-not $process.HasExited){$process.Kill();$null=$process.WaitForExit(1000)}}catch{};$process.Dispose()};if([IO.File]::Exists($path)){[IO.File]::Delete($path)}}
}

if($AwaitResultTransport){
 # Replay the exact actual hosted call-site statement with a benign generic
 # struct-valued Task. WinPS5 exposes VoidTaskResult on the real WriteAsync;
 # this portable control proves the success-stream consequence without I/O.
 Add-Type -TypeDefinition @'
using System;using System.Threading.Tasks;
public struct GoriqPublicAwaitResult { public override string ToString(){return "PUBLIC_AWAIT_RESULT_CANARY";} }
public static class GoriqPublicAwaitTask { public static Task<GoriqPublicAwaitResult> Make(){return Task.FromResult(new GoriqPublicAwaitResult());} }
'@|Out-Null
 $source=[IO.File]::ReadAllText($PSCommandPath)
 $matches=[regex]::Matches($source,'(?m)^ +while\(-not \$write\.IsCompleted\)[^\r\n]+;\s*((?:\$null=)?\$write\.GetAwaiter\(\)\.GetResult\(\))\s*$')
 Require ($matches.Count -eq 1) 'ONE_REAL_HOSTED_WRITE_AWAIT'
 $write=[GoriqPublicAwaitTask]::Make();$leaked=@(&([scriptblock]::Create($matches[0].Groups[1].Value)))
 Require ($leaked.Count -eq 0) 'WRITE_AWAIT_MUST_NOT_POLLUTE_JSON'
 @{pass=$true;actualHostedStatement=$true;jsonOnly=$true;actualNativeCalls=0;nativeAuthority=$false}|ConvertTo-Json -Compress;return
}
# Frozen PUBLIC same-child write counterfactual. ACK is measured while stdin
# remains open, first after WriteAsync alone, then after BaseStream.FlushAsync.
if($WriteDiagnostic){
 Require ([bool]$NodeExecutable -and -not $NodeExecutable.Contains('"')) 'PUBLIC_STDIN_NODE_PATH'
 $directory=Join-Path ([IO.Path]::GetTempPath()) ('goriq-public-stdin-'+[IO.Path]::GetRandomFileName());$null=[IO.Directory]::CreateDirectory($directory);$ready=Join-Path $directory 'ready';Require (-not $ready.Contains('"')) 'PUBLIC_STDIN_READY_PATH'
 $program="const fs=require('node:fs');const parse=s=>{const h=JSON.parse(s.replace(/^\uFEFF/,''));if(Object.keys(h).length!==3||h.schemaVersion!==1||h.kind!=='PUBLIC_HELLO'||h.sequence!==1)throw 0;return h;};const plain=JSON.stringify({schemaVersion:1,kind:'PUBLIC_HELLO',sequence:1});try{for(const frame of[plain,'\uFEFF'+plain])parse(frame);for(const frame of['\uFEFF\uFEFF'+plain,plain+'X']){let refused=false;try{parse(frame);}catch{refused=true;}if(!refused)throw 0;}}catch{process.stderr.write('PUBLIC_STDIN_PARSER_CONTROL_REJECTED');process.exit(7);}setTimeout(()=>{process.stderr.write('PUBLIC_STDIN_CONTAINMENT_LIMIT');process.exit(9);},3500);let pending='',acked=false;process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{pending+=chunk;const end=pending.indexOf('\n');if(end<0||acked)return;try{parse(pending.slice(0,end));acked=true;process.stdout.write('A');}catch{process.stderr.write('PUBLIC_STDIN_HELLO_REJECTED');process.exit(7);}});process.stdin.on('end',()=>process.exit(0));fs.writeFileSync(process.argv[1],'READY',{flag:'wx'});"
 $process=[Diagnostics.Process]::new();$watch=[Diagnostics.Stopwatch]::StartNew()
 try{
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='-e "'+$program+'" "'+$ready+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$process.StartInfo=$info;Require ($process.Start()) 'PUBLIC_STDIN_STARTED'
  while(-not [IO.File]::Exists($ready)){Require (-not $process.HasExited -and $watch.ElapsedMilliseconds -lt 2000) 'PUBLIC_STDIN_READY';[Threading.Thread]::Sleep(5)}
  $stream=$process.StandardInput.BaseStream;$kind=switch($stream.GetType().FullName){'System.IO.FileStream'{'FILE_STREAM'};'System.IO.Pipes.AnonymousPipeClientStream'{'ANONYMOUS_PIPE'};default{'OTHER'}}
  $ackBuffer=New-Object byte[] 1;$ack=$process.StandardOutput.BaseStream.ReadAsync($ackBuffer,0,1);$errorBuffer=New-Object char[] 1;$stderr=$process.StandardError.ReadAsync($errorBuffer,0,1)
  $payload=[Text.Encoding]::UTF8.GetBytes('{"schemaVersion":1,"kind":"PUBLIC_HELLO","sequence":1}'+[char]10);Require ($payload.Length -lt 4096) 'PUBLIC_STDIN_SMALL_FRAME'
  $writeTask=$stream.WriteAsync($payload,0,$payload.Length);while(-not $writeTask.IsCompleted){Require (-not $process.HasExited -and -not $stderr.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_STDIN_WRITE_BOUND';[Threading.Thread]::Sleep(5)};$null=$writeTask.GetAwaiter().GetResult()
  $beforeWatch=[Diagnostics.Stopwatch]::StartNew();while(-not $ack.IsCompleted -and $beforeWatch.ElapsedMilliseconds -lt 300){Require (-not $process.HasExited -and -not $stderr.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_STDIN_OPEN_BOUND';[Threading.Thread]::Sleep(5)}
  $before=$ack.IsCompleted;Require (-not $process.HasExited -and -not $stderr.IsCompleted) 'PUBLIC_STDIN_HELD_BEFORE_FLUSH';if($before){Require ($ack.GetAwaiter().GetResult() -eq 1 -and $ackBuffer[0] -eq 65) 'PUBLIC_STDIN_INITIAL_ACK'}
  $flushTask=$stream.FlushAsync();while(-not $flushTask.IsCompleted){Require (-not $process.HasExited -and -not $stderr.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_STDIN_FLUSH_BOUND';[Threading.Thread]::Sleep(5)};$null=$flushTask.GetAwaiter().GetResult()
  while(-not $ack.IsCompleted){Require (-not $process.HasExited -and -not $stderr.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_STDIN_FLUSH_ACK_BOUND';[Threading.Thread]::Sleep(5)}
  Require ($ack.GetAwaiter().GetResult() -eq 1 -and $ackBuffer[0] -eq 65 -and -not $process.HasExited -and -not $stderr.IsCompleted) 'PUBLIC_STDIN_ACK_WITHOUT_EOF'
  $process.StandardInput.Close();while(-not $process.HasExited){Require ($watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_STDIN_OWN_EOF';[Threading.Thread]::Sleep(5)};Require ($stderr.Wait(1000) -and $stderr.GetAwaiter().GetResult() -eq 0 -and $process.ExitCode -eq 0) 'PUBLIC_STDIN_CHILD_CLOSED'
  @{pass=$true;diagnosticOnly=$true;windows=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);psMajor=[int]$PSVersionTable.PSVersion.Major;stdinBaseStream=$kind;frameBytes=$payload.Length;writeCompleted=$true;ackBeforeFlush=$before;ackAfterFlush=$true;sameOwnedChild=$true;ackWithoutEof=$true;ownedChildClosed=$true;parserControlsPassed=$true;parserControlsCount=4;timerIsContainmentOnly=$true;localChildTimerMs=3500;actualOwnerTaskAccountDpapiCalls=0;nativeAuthority=$false}|ConvertTo-Json -Compress;return
 }finally{try{if(-not $process.HasExited){$process.Kill();$null=$process.WaitForExit(1000)}}catch{};$process.Dispose();[IO.Directory]::Delete($directory,$true)}
}

# Fixed PUBLIC partial-pipe mechanism diagnosis. No Owner/private source or
# task/account/DPAPI operation. Each process is allocated/contained by this test.
if($PipeDiagnostic){
 Require ([bool]$NodeExecutable -and -not $NodeExecutable.Contains('"')) 'PUBLIC_PIPE_NODE_PATH'
 $directory=Join-Path ([IO.Path]::GetTempPath()) ('goriq-public-pipe-'+[IO.Path]::GetRandomFileName());$null=[IO.Directory]::CreateDirectory($directory);$rows=@();$index=0
 $program="const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));process.stdout.write('PUBLIC_PARTIAL\n',()=>fs.writeFileSync(process.argv[1],'READY',{flag:'wx'}));"
 try{foreach($method in @('CHAR_BUFFER','BYTE_BUFFER','BYTE_ONE')){
  $index++;$ready=Join-Path $directory ('ready-'+$index);Require (-not $ready.Contains('"')) 'PUBLIC_PIPE_READY_PATH';$process=[Diagnostics.Process]::new();$watch=[Diagnostics.Stopwatch]::StartNew()
  try{
   $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='-e "'+$program+'" "'+$ready+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$process.StartInfo=$info;Require ($process.Start()) 'PUBLIC_PIPE_STARTED'
   while(-not [IO.File]::Exists($ready)){Require (-not $process.HasExited -and $watch.ElapsedMilliseconds -lt 2000) 'PUBLIC_PIPE_READY';[Threading.Thread]::Sleep(5)}
   if($method -ceq 'CHAR_BUFFER'){$buffer=New-Object char[] 32769;$read=$process.StandardOutput.ReadAsync($buffer,0,$buffer.Length)}else{$buffer=New-Object byte[] $(if($method -ceq 'BYTE_ONE'){1}else{32769});$read=$process.StandardOutput.BaseStream.ReadAsync($buffer,0,$buffer.Length)}
   $readWatch=[Diagnostics.Stopwatch]::StartNew();while(-not $read.IsCompleted -and $readWatch.ElapsedMilliseconds -lt 300){[Threading.Thread]::Sleep(5)}
   $completed=$read.IsCompleted;Require (-not $read.IsFaulted -and -not $read.IsCanceled -and -not $process.HasExited) 'PUBLIC_PIPE_HELD_READER'
   $before=if($completed){$read.GetAwaiter().GetResult()}else{$null}
   $process.StandardInput.Close();while(-not $process.HasExited){Require ($watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_PIPE_FINITE_EOF';[Threading.Thread]::Sleep(5)}
   Require ($read.Wait(1000) -and $process.ExitCode -eq 0) 'PUBLIC_PIPE_EOF_READ';$after=$read.GetAwaiter().GetResult();$ownedStderr=$process.StandardError.ReadToEnd();Require ($ownedStderr -ceq '' -and $after -eq $(if($method -ceq 'BYTE_ONE'){1}else{15})) 'PUBLIC_PIPE_EXACT_PUBLIC_COUNTS'
   $rows+=@{method=$method;completedBeforeEof=$completed;countBeforeEof=$before;countAfterEof=$after;heldBeforeEof=$true;ownedChildClosed=$true}
  }finally{try{if(-not $process.HasExited){$process.Kill();$null=$process.WaitForExit(1000)}}catch{};$process.Dispose()}
 }}finally{[IO.Directory]::Delete($directory,$true)}
 Require ($rows.Count -eq 3 -and $rows[2].completedBeforeEof -and $rows[2].countBeforeEof -eq 1) 'PUBLIC_PIPE_SINGLE_BYTE_CONTROL'
 @{pass=$true;diagnosticOnly=$true;windows=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);psMajor=[int]$PSVersionTable.PSVersion.Major;rows=$rows;actualOwnerTaskAccountDpapiCalls=0;nativeAuthority=$false}|ConvertTo-Json -Depth 4 -Compress;return
}

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
  while(-not $write.IsCompleted){Require ($watch.ElapsedMilliseconds -lt 13000) 'FINITE_CHILD_WRITE';[Threading.Thread]::Sleep(5)};$null=$write.GetAwaiter().GetResult()
  $flushAction=[Delegate]::CreateDelegate([Action],$node.StandardInput.BaseStream,'Flush');$flushTask=[Threading.Tasks.Task]::Run($flushAction)
  while(-not $flushTask.IsCompleted){Require (-not $node.HasExited -and $watch.ElapsedMilliseconds -lt 13000) 'FINITE_CHILD_FLUSH';[Threading.Thread]::Sleep(5)};$null=$flushTask.GetAwaiter().GetResult()
  if($HostedAncestry -ceq 'wrong-parent'){
   $node.StandardInput.Close();while(-not $node.HasExited){Require ($watch.ElapsedMilliseconds -lt 13000) 'FINITE_REFUSAL';[Threading.Thread]::Sleep(5)}
   Require ($stdoutTask.Wait(1000) -and $stderrTask.Wait(1000)) 'REFUSAL_PIPE_CLOSED';$outCount=$stdoutTask.GetAwaiter().GetResult();$errCount=$stderrTask.GetAwaiter().GetResult()
   Require ($node.ExitCode -eq 1 -and $outCount -eq 0 -and $errCount -gt 0 -and $errCount -le 4096 -and ([string]::new($stderrBuffer,0,$errCount)).Trim() -ceq 'GORIQ_OWNED_PEER_REFUSED') 'CLOSED_WRONG_PARENT_REFUSAL'
  }else{
   $text=[Text.StringBuilder]::new();$line=$null
   while($null -eq $line){
    while(-not $stdoutTask.IsCompleted){
     $stderrDone=$stderrTask.IsCompleted;$childExited=$node.HasExited;$localBound=$watch.ElapsedMilliseconds -ge 13000
     if($stderrDone -or $childExited -or $localBound){[Console]::Error.WriteLine('GORIQ_PUBLIC_PEER_REPLY_STATE '+(@{phase='REPLY_WAIT';stdoutCompleted=$stdoutTask.IsCompleted;stderrCompleted=$stderrDone;childExited=$childExited;localBound=$localBound;sessionPositive=($hello.sessionId -gt 0)}|ConvertTo-Json -Compress));if($stderrDone){Require $false 'REPLY_STDERR_COMPLETED'};if($childExited){Require $false 'REPLY_CHILD_EXITED'};Require $false 'REPLY_LOCAL_BOUND'}
     [Threading.Thread]::Sleep(5)
    }
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
 $script:peerProgressPath=$null;$script:peerProgressRows=0;$script:peerProgressWatch=[Diagnostics.Stopwatch]::StartNew()
 if($env:GORIQ_PUBLIC_PEER_PROGRESS_DIRECTORY){$mode=if($ClosedChannel){'CLOSED'}elseif($PlatformEnvironment){'PLATFORM'}else{'OWNED'};$script:peerProgressPath=Join-Path $env:GORIQ_PUBLIC_PEER_PROGRESS_DIRECTORY ($mode+'_'+$TransportGroup+'.txt');$progressFile=[IO.File]::Open($script:peerProgressPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);$progressFile.Dispose()}
 Write-PublicPeerProgress 'GROUP_BEGIN';Write-PublicPeerProgress 'SOURCE_BASE_BEGIN'
 $publicInput=[Console]::In.ReadToEnd();$null=. (Join-Path $Root 'tests/owner-code-cutover-private-bootstrap.fixture.ps1') -Scenario kernel -FixtureInput $publicInput
 Write-PublicPeerProgress 'SOURCE_BASE_DONE'
 $owned=[IO.Path]::Combine([IO.Path]::GetTempPath(),('public-owned-peer-'+[IO.Path]::GetRandomFileName()));$null=[IO.Directory]::CreateDirectory($owned);$childPath=[IO.Path]::Combine($owned,'public-peer.mjs')
 $js=@'
import{closeSync}from'node:fs';let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{pending+=x;const end=pending.indexOf('\n');if(end<0)return;const first=pending.slice(0,end);pending='';if(first==='PUBLIC_TRIGGER_LATE_STDERR'){process.stderr.write('PUBLIC_LATE_STDERR');return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDOUT'){closeSync(1);return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDERR'){closeSync(2);return;}const h=JSON.parse(first);const row=(pid,parentPid,ticks,node)=>({pid,parentPid,creationTicks:ticks,sessionId:h.sessionId,imagePath:node?h.nodePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',imageSha256:node?'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237':'a'.repeat(64),imageIdentityKey:node?h.nodeImageIdentityKey:'PUBLIC-SYSTEM-IMAGE',ownerSidSha256:h.ownerSidSha256,signatureStatus:node?'NOT_REQUIRED':'Valid',publisher:node?'':'Microsoft Corporation'});const ancestry={profile:'goriq-owned-node-peer-ancestry-data-v1',effectCapability:false,helper:row(h.nodePid+1000,h.nodePid,String(BigInt(h.nodeCreationTicks)+1n),false),node:row(h.nodePid,h.bootstrapPid,h.nodeCreationTicks,true),bootstrap:row(h.bootstrapPid,3000,h.bootstrapCreationTicks,false)};const reply={schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_OS_DATA',sequence:1,sourceRevision:h.sourceRevision,originalGrantSha256:h.originalGrantSha256,nativeMjsSha256:h.nativeMjsSha256,nativePsSha256:h.nativePsSha256,ancestry};const mode=process.env.GORIQ_PUBLIC_PEER_CASE;if(mode==='pid')reply.ancestry.node.pid++;if(mode==='source')reply.nativePsSha256='e'.repeat(64);if(mode==='source-array')reply.nativePsSha256=[reply.nativePsSha256];if(mode==='stderr')process.stderr.write('PUBLIC_ONLY_UNEXPECTED_STDERR');let wire=JSON.stringify(reply);if(mode==='duplicate')wire=wire.replace('"sequence":1','"sequence":2,"sequence":1');process.stdout.write(wire+'\n'+(mode==='extra'?'PUBLIC_EXTRA_FRAME\n':''));});
'@
 [IO.File]::WriteAllText($childPath,$js,[Text.UTF8Encoding]::new($false));$rows=@();$index=3000;$startedCount=0
 try{$groups=@(@('success','pid','source','source-array'),@('duplicate','stderr','extra','foreign-factory'),@('journal-throw','start-expiry','node-binding-missing','late-stderr'));if($ClosedChannel){$groups=@(@('late-stdout-eof'),@('late-stderr-eof'),@('success'))};if($PlatformEnvironment){$groups=@(@('success'),@('success'),@('success'))};foreach($which in $groups[$TransportGroup]){$phaseCase='CASE_'+$which.ToUpperInvariant().Replace('-','_');Write-PublicPeerProgress ($phaseCase+'_BEGIN');$index++;$dir=PrivateSetup $index;$module=$null;try{
  $public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$privateRecord=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$privateRecord);$module=$privateRecord.module
  Write-PublicPeerProgress ($phaseCase+'_KERNEL_DONE')
  InstallFixtureSource $module;InstallFixtureNode $module;InstallFixtureConfiguration $module
  $package=(Get-CutoverPublicLoaderPackage).model
  &$module {param($sources);foreach($name in $sources.Keys){$path='D:\Installed\release-current\scripts\'+$name;$script:memoryFiles[$path]=[byte[]]$sources[$name].Clone();$script:identities[$path]='public-peer-loader-'+$name};function script:Read-OwnerCutoverFallbackAttributes([string]$Path){throw [IO.FileNotFoundException]::new('PUBLIC_PEER_ABSENCE')}} $package
  &$module {param($mode);$script:transportFixtureMode=$mode;$script:transportFakeNodeFacts=(Get-Command Get-OwnerCutoverNodeImageFacts).ScriptBlock;function script:Get-OwnerCutoverNodeImageFacts([string]$Path){$value=&$script:transportFakeNodeFacts $Path;if($script:transportFixtureMode -cne 'node-binding-missing'){$script:nodeStream=[IO.MemoryStream]::new([byte[]]$script:memoryFiles[$Path],$false);$script:sourceHandles.Add($script:nodeStream);$script:nodeIdentity=Get-OwnerCutoverFileIdentity $script:nodeStream $Path};return $value}} $which
  $null=&$module {Initialize-OwnerCutoverPrivateSource};Write-PublicPeerProgress ($phaseCase+'_SOURCE_DONE')
  $null=&$module {Initialize-OwnerCutoverProtectedNode};&$module {Initialize-OwnerCutoverNodeStartupPolicy};Write-PublicPeerProgress ($phaseCase+'_NODE_DONE')
  $null=&$module {Initialize-OwnerCutoverPrivateConfiguration};Write-PublicPeerProgress ($phaseCase+'_CONFIGURATION_DONE')
  $null=&$module {Initialize-OwnerCutoverPrivateJournal};Write-PublicPeerProgress ($phaseCase+'_JOURNAL_DONE')
  $null=&$module {Initialize-OwnerCutoverFallbackInputs};Write-PublicPeerProgress ($phaseCase+'_FALLBACK_DONE')
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
    $bytes=[Text.Encoding]::UTF8.GetBytes($command+[char]10);$script:ownedPeerLifetime.process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$flushAction=[Delegate]::CreateDelegate([Action],$script:ownedPeerLifetime.process.StandardInput.BaseStream,'Flush');$flushTask=[Threading.Tasks.Task]::Run($flushAction);Require ($flushTask.Wait(1000)) 'PUBLIC_TRIGGER_FLUSH_FINITE';$null=$flushTask.GetAwaiter().GetResult()
    $watch=[Diagnostics.Stopwatch]::StartNew();$task=$script:ownedPeerLifetime.record[$key];while(-not $task.IsCompleted -and $watch.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(5)}
    return @{eofTaskCompleted=$task.IsCompleted;eofResult=$(if($task.IsCompleted){$task.GetAwaiter().GetResult()}else{-1});aliveBefore=(-not $script:ownedPeerLifetime.process.HasExited)}
   } $which
   Require ($observation.eofTaskCompleted -and $observation.eofResult -eq 0 -and $observation.aliveBefore) 'ACTUAL_EOF_WHILE_OWN_CHILD_ALIVE'
   Refused {&$module {Assert-OwnerCutoverOwnedPeer}}
   $stillAlive=$false;$probe=$null;try{$probe=[Diagnostics.Process]::GetProcessById($ownedId);$stillAlive=-not $probe.HasExited}catch{}finally{if($probe){$probe.Dispose()}}
   Require (-not $stillAlive) 'CLOSED_STDIO_OWNED_OBSERVER_TERMINATED'
  }
  elseif($which -ceq 'late-stderr'){$null=&$module {Initialize-OwnerCutoverOwnedPeer};$ownedId=&$module {$script:ownedPeerLifetime.process.Id};&$module {$bytes=[Text.Encoding]::UTF8.GetBytes('PUBLIC_TRIGGER_LATE_STDERR'+[char]10);$script:ownedPeerLifetime.process.StandardInput.BaseStream.Write($bytes,0,$bytes.Length);$flushAction=[Delegate]::CreateDelegate([Action],$script:ownedPeerLifetime.process.StandardInput.BaseStream,'Flush');$flushTask=[Threading.Tasks.Task]::Run($flushAction);Require ($flushTask.Wait(1000)) 'PUBLIC_TRIGGER_FLUSH_FINITE';$null=$flushTask.GetAwaiter().GetResult();$watch=[Diagnostics.Stopwatch]::StartNew();while(-not $script:ownedPeerLifetime.record.stderrTask.IsCompleted -and $watch.ElapsedMilliseconds -lt 2000){[Threading.Thread]::Sleep(10)}};Refused {&$module {Assert-OwnerCutoverOwnedPeer}};$stillAlive=$false;$probe=$null;try{$probe=[Diagnostics.Process]::GetProcessById($ownedId);$stillAlive=-not $probe.HasExited}catch{}finally{if($probe){$probe.Dispose()}};Require (-not $stillAlive) 'FAILED_OWNED_OBSERVER_TERMINATED'}
  else{Refused {&$module {Initialize-OwnerCutoverOwnedPeer}}}
  Write-PublicPeerProgress ($phaseCase+'_PEER_DONE')
  $count=&$module {$script:transportCreated};$writes=&$module {$script:writes.Count};Refused {&$module {Initialize-OwnerCutoverOwnedPeer}};Require ((&$module {$script:transportCreated}) -eq $count -and (&$module {$script:writes.Count}) -eq $writes) 'NO_PROCESS_OR_WRITEAHEAD_REISSUE';Require ($count -eq $(if($which -cin @('journal-throw','node-binding-missing')){0}else{1})) 'OWNED_PROCESS_COUNT';if($which -cne 'foreign-factory'){$startedCount+=$count;}$rows+=@{case=$which;expected=$(if($which -ceq 'success'){'DATA_ONLY'}else{'REFUSE'})}
  Write-PublicPeerProgress ($phaseCase+'_END')
 }finally{if($module){&$module {if(Get-Variable foreignFixtureProcess -Scope Script -ErrorAction SilentlyContinue){try{$script:foreignFixtureProcess.Dispose()}catch{}};if($script:ownedPeerLifetime.process){try{if(-not $script:ownedPeerLifetime.process.HasExited){$script:ownedPeerLifetime.process.Kill();$null=$script:ownedPeerLifetime.process.WaitForExit(1000)}}catch{};try{$script:ownedPeerLifetime.process.Dispose()}catch{}}}};Close $dir}}}finally{[IO.Directory]::Delete($owned,$true)}
 Write-PublicPeerProgress 'GROUP_DONE'
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

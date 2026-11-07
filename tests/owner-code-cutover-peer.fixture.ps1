param([string]$Root,[switch]$ClockEndpointData,[switch]$OwnedTransport,[switch]$ClosedChannel,[switch]$PlatformEnvironment,[switch]$AwaitResultTransport,[switch]$PipeDiagnostic,[switch]$WriteDiagnostic,[switch]$ManagedFlushTransport,[switch]$SourceBufferTransport,[switch]$HelloPreambleDiagnostic,[switch]$PreambleCleanupDiagnostic,[switch]$ProbeDiagnosticTransport,[switch]$HostedProbeDiagnostic,[ValidateSet(0,1,2)][int]$TransportGroup=0,[ValidateSet('positive','wrong-parent')][string]$HostedAncestry,[string]$NodeExecutable)
$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. (Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('PEER_FIXTURE_'+$Code)}}
# Exact source-extracted PUBLIC allocation/read/hash controls. The command
# trap proves a semantic dependency only, never the actual Windows stall cause.
if($SourceBufferTransport){
 $product=[IO.File]::ReadAllText((Join-Path $Root 'scripts/owner-code-rotation-native-1218.mjs'));$mirror=[IO.File]::ReadAllText($PSCommandPath)
 $productRows=[regex]::Matches($product,'(?m)^     const capsule=[^\r\n]+');$mirrorRows=[regex]::Matches($mirror,'(?m)^  \$capsule=[^\r\n]+');Require ($productRows.Count -eq 1 -and $mirrorRows.Count -eq 1) 'SOURCE_BUFFER_EXACT_CAPSULES'
 $vectors=@();foreach($rawLine in @($productRows[0].Value,$mirrorRows[0].Value)){$line=if($rawLine.StartsWith('  $capsule=')){$rawLine.Replace("''","'")}else{$rawLine}
  $assignments=[regex]::Matches($line,'\$b=[^;]+');Require ($assignments.Count -eq 1) 'SOURCE_BUFFER_ONE_ALLOCATION'
  $guardStart=$line.IndexOf('if($s.Length -lt 1 -or $s.Length -gt 262144){throw ');Require ($guardStart -ge 0) 'SOURCE_BUFFER_LENGTH_GUARD';$guardEnd=$line.IndexOf('}',$guardStart)
  $readStart=$line.IndexOf('while($n -lt $b.Length){$c=$s.Read($b,$n,$b.Length-$n);');Require ($readStart -ge 0) 'SOURCE_BUFFER_READ_LOOP';$readEnd=$line.IndexOf(';$n+=$c}',$readStart)
  $hashStart=$line.IndexOf('$sha=[Security.Cryptography.SHA256]::Create();');$hashGuard=$line.IndexOf('if($d -cne $h){throw ',$hashStart);Require ($hashStart -ge 0 -and $hashGuard -ge 0) 'SOURCE_BUFFER_HASH_GUARD';$hashEnd=$line.IndexOf('}',$hashGuard)
  $vectors+=@{allocate=[scriptblock]::Create($assignments[0].Value);guard=[scriptblock]::Create($line.Substring($guardStart,$guardEnd-$guardStart+1));read=[scriptblock]::Create('$n=0;'+$line.Substring($readStart,$readEnd-$readStart+8));hash=[scriptblock]::Create($line.Substring($hashStart,$hashEnd-$hashStart+1))}
 }
 $lengths=@(1,2,8192,65536,176618,262144);$cases=0;$guardRefusals=0;$directory=Join-Path ([IO.Path]::GetTempPath()) ('public-source-buffer-'+[IO.Path]::GetRandomFileName());$null=[IO.Directory]::CreateDirectory($directory);$file=Join-Path $directory 'public.bin';$s=$null
 try{
  foreach($length in $lengths){$payload=[Text.Encoding]::UTF8.GetBytes(('P'*$length));[IO.File]::WriteAllBytes($file,$payload);$h=Get-OwnerRotationEntryDigest $payload
   foreach($vector in $vectors){$s=[IO.File]::OpenRead($file);try{. $vector.guard;. $vector.allocate;Require ($b.GetType() -eq [byte[]] -and $b.Length -eq $length) 'SOURCE_BUFFER_EXACT_TYPE_LENGTH';Require ([Convert]::ToBase64String($b) -ceq [Convert]::ToBase64String([byte[]]::new($length))) 'SOURCE_BUFFER_ZERO_INITIALIZED';. $vector.read;Require ($n -eq $length -and [Convert]::ToBase64String($b) -ceq [Convert]::ToBase64String($payload)) 'SOURCE_BUFFER_PAYLOAD_EXACT';. $vector.hash;$cases++}finally{$s.Dispose();$s=$null}}
  }
  $script:sourceBufferCmdletCalls=0;function New-Object {$script:sourceBufferCmdletCalls++;throw 'PUBLIC_SOURCE_BUFFER_CMDLET_REFUSED'}
  foreach($length in @(0,262145)){$s=[IO.MemoryStream]::new([byte[]]::new($length));try{foreach($vector in $vectors){$refused=$false;try{. $vector.guard;. $vector.allocate}catch{$refused=$_.Exception.Message -ceq 'PEER_SOURCE'};Require ($refused -and $script:sourceBufferCmdletCalls -eq 0) 'SOURCE_BUFFER_GUARD_PRECEDES_ALLOCATION';$guardRefusals++}}finally{$s.Dispose();$s=$null}}
  $s=[IO.MemoryStream]::new([byte[]]::new(2));$oldAllocation=[scriptblock]::Create('$b=New-Object byte[] ([int]$s.Length)');$oldRefused=$false;try{. $oldAllocation}catch{$oldRefused=$_.Exception.Message -ceq 'PUBLIC_SOURCE_BUFFER_CMDLET_REFUSED'};Require ($oldRefused -and $script:sourceBufferCmdletCalls -eq 1) 'SOURCE_BUFFER_FROZEN_OLD_CMDLET_CONTROL'
  foreach($vector in $vectors){$script:sourceBufferCmdletCalls=0;$refused=$false;try{. $vector.guard;. $vector.allocate}catch{$refused=$true};Require (-not $refused -and $script:sourceBufferCmdletCalls -eq 0 -and $b.GetType() -eq [byte[]] -and $b.Length -eq 2) 'SOURCE_BUFFER_DIRECT_EXPRESSION_AVOIDS_CMDLET'}
  @{pass=$true;lengthCases=$lengths;sourceForms=$vectors.Count;readHashCases=$cases;guardRefusals=$guardRefusals;actualProductExpression=$true;actualPublicMirror=$true;byteArrayType=$true;exactLength=$true;zeroInitialized=$true;payloadReadHashEquivalent=$true;oldCmdletControlRefused=$true;actualSourceAvoidsCmdletResolution=$true;actualWindowsExecuted=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);actualStallCauseVerified=$false;nativeAuthority=$false;actualOwnerTaskAccountDpapiCalls=0}|ConvertTo-Json -Compress;return
 }finally{if($s){$s.Dispose()};if([IO.Directory]::Exists($directory)){[IO.Directory]::Delete($directory,$true)}}
}
function Get-PublicPeerReadState($Task){
 if(-not $Task.IsCompleted){return 'PENDING'};if($Task.IsCanceled){return 'CANCELED'};if($Task.IsFaulted){return 'FAULT'}
 try{$count=$Task.GetAwaiter().GetResult();if($count -isnot [int] -or $count -lt 0){return 'INVALID'};if($count -eq 0){return 'EOF'};return 'DATA'}catch{return 'FAULT'}
}

# PUBLIC exact endpoint corpus. Original registration is always issued by the
# actual unchanged readiness constructor through these fixed metadata fakes.
if($ClockEndpointData){
 Require ($null -ne (Get-Command Get-OwnerCutoverOriginalClockEndpointData -ErrorAction SilentlyContinue)) 'RAW_ENDPOINT_API_REQUIRED'
 $inputData=[Console]::In.ReadToEnd()|ConvertFrom-Json;$root=$Root;$script:epIndex=7000;$script:baseNow=[datetimeoffset]::Parse($inputData.now);$script:case='';$script:calls=[Collections.Generic.List[string]]::new();$script:epQueues=$null;$script:epProviderCalls=@{utc=0;stamp=0;frequency=0}
 function Get-OwnerCutoverUtcNow {$script:epProviderCalls.utc++;if($script:epTerminalDuringRead -and $script:epProviderCalls.utc -eq 2){$script:epMutationState.terminal='ROTATION_CUTOVER_CLOCK_INVALID'};if($script:epQueues -and $script:epQueues.utc.Count){return $script:epQueues.utc.Dequeue()};return $script:utc}
 function Get-OwnerCutoverMonotonicStamp {$script:epProviderCalls.stamp++;if($script:epQueues -and $script:epQueues.stamp.Count){return $script:epQueues.stamp.Dequeue()};return $script:stamp}
 function Get-OwnerCutoverMonotonicFrequency {$script:epProviderCalls.frequency++;if($script:epQueues -and $script:epQueues.frequency.Count){return $script:epQueues.frequency.Dequeue()};return $script:frequency}
 function Ep-Date([string]$Ticks){return [datetimeoffset]::new([datetime]::new([long]$Ticks,[DateTimeKind]::Utc))}
 function Ep-Counts {return ($script:epProviderCalls|ConvertTo-Json -Compress)}
 function Ep-ResetCounts {$script:epProviderCalls=@{utc=0;stamp=0;frequency=0}}
 function Ep-Setup($Vector){
  $script:epIndex++;$script:run=[long](12345000+$script:epIndex);$script:epQueues=$null;$script:epTerminalDuringRead=$false;$script:epMutationState=$null;$script:utc=Ep-Date $Vector.originUtc;$script:stamp=[long]::Parse($Vector.origin);$script:frequency=[long]::Parse($Vector.frequency);$script:baseNow=$script:utc;$script:case='';$script:calls.Clear();$script:epJobStart=[datetimeoffset]::Parse($script:utc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'));if($Vector.id -cin @('official-older-start-880','one-utc-tick-fraction')){$script:epJobStart=$script:epJobStart.AddSeconds(-20)}
  $script:grant=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($inputData.encoded)))
  $dir=[IO.Path]::Combine([IO.Path]::GetTempPath(),('public-endpoint-'+[IO.Path]::GetRandomFileName()));$script:stage=[IO.Path]::Combine($dir,('owner-native-'+$script:run+'-1'));$null=[IO.Directory]::CreateDirectory($script:stage)
  foreach($path in @($script:grant.sourceHashes.PSObject.Properties.Name)+@('.github/workflows/gai-zbook-diagnostic-1218.yml')){$target=Join-Path $script:stage $path;$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target));[IO.File]::Copy((Join-Path $root $path),$target)}
  foreach($property in $inputData.environment.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value)};$env:GITHUB_RUN_ID=[string]$script:run;$env:GITHUB_WORKSPACE=$dir;$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64=$inputData.encoded;$env:JARVIS_PRODUCTION_CONFIG='';Push-Location $script:stage
  try{$token=Get-OwnerCutoverPublicReadiness;$state=$null;Require ($script:ownerCutoverPublicLifetimes.tokens.TryGetValue($token,[ref]$state)) 'ACTUAL_READINESS_TOKEN';$registered=$null;Require ($script:ownerCutoverPublicLifetimes.states.TryGetValue($state,[ref]$registered) -and [object]::ReferenceEquals($registered,$state)) 'ACTUAL_READINESS_STATE';return @{dir=$dir;token=$token;state=$state}}catch{Pop-Location;[IO.Directory]::Delete($dir,$true);throw}
 }
 function Ep-Close($Owned){Pop-Location;[IO.Directory]::Delete($Owned.dir,$true)}
 function Ep-Pair($State,$Vector){
  $script:epQueues=@{utc=[Collections.Generic.Queue[object]]::new();stamp=[Collections.Generic.Queue[object]]::new();frequency=[Collections.Generic.Queue[object]]::new()}
  $firstUtc=$State.lastUtc;$firstStamp=[long]$State.lastStamp;if($Vector.PSObject.Properties['id'] -and $Vector.id -cin @('sampling-delay-conservative-before-utc','sampling-delay-new-only-cut')){$firstUtc=(Ep-Date $Vector.originUtc).AddSeconds(1);$firstStamp=[long]1000};$script:epQueues.utc.Enqueue($firstUtc);$script:epQueues.utc.Enqueue((Ep-Date $Vector.sampleUtc));$script:epQueues.stamp.Enqueue($firstStamp);$script:epQueues.stamp.Enqueue([long]::Parse($Vector.pre));$script:epQueues.stamp.Enqueue([long]::Parse($Vector.sample));$script:epQueues.frequency.Enqueue($script:frequency);$script:epQueues.frequency.Enqueue($script:frequency);$script:utc=Ep-Date $Vector.sampleUtc;$script:stamp=[long]::Parse($Vector.sample)
 }
 function Ep-Refused([scriptblock]$Call){$message=$null;try{&$Call|Out-Null}catch{$message=$_.Exception.Message};Require ($message -ceq 'ROTATION_CUTOVER_CLOCK_ENDPOINT_DATA_REJECTED') 'FIXED_ENDPOINT_REFUSAL'}
 function Get-OwnerCutoverBootstrapPublicResource([string]$Uri){
 [void]$script:calls.Add($Uri);if($script:case -eq 'transport'){throw 'PUBLIC_FAKE_PRIVATE_TRANSPORT_CANARY'};if($script:case -eq 'slow'){$script:stamp+=880000};if($script:case -eq 'provisional' -and $script:calls.Count -le 2){$script:stamp+=2000;$script:utc=$script:utc.AddSeconds(2)}
 $prefix='https://api.github.com/repos/haji84/AI-/'
 if($Uri -ceq ($prefix+'actions/runs/'+$script:run)){$value=@{id=$script:run;run_attempt=1;name='GORIQ Owner Code 1218 Bounded Native Acceptance';path='.github/workflows/gai-zbook-diagnostic-1218.yml';event='workflow_dispatch';head_sha=('a'*40);head_branch='main';status='in_progress';conclusion=$null;repository=@{full_name='haji84/AI-'};actor=@{login='haji84'}};if($script:case -eq 'native-event'){$value.event='push'};if($script:case -eq 'attempt'){$value.run_attempt=2}}
 elseif($Uri -ceq ($prefix+'actions/runs/'+$script:run+'/attempts/1/jobs?per_page=100')){$job=@{id=(50000+$script:run);run_id=$script:run;run_attempt=1;name='inspect';head_sha=('a'*40);status='in_progress';conclusion=$null;labels=@('self-hosted','Windows','X64');started_at=$script:epJobStart.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');completed_at=$null};if($script:case -eq 'provisional'){$job.started_at=$script:baseNow.AddSeconds(1).ToString('yyyy-MM-ddTHH:mm:ssZ')};if($script:case -eq 'future-start'){$job.started_at=$script:baseNow.AddSeconds(20).ToString('yyyy-MM-ddTHH:mm:ssZ')};if($script:case -eq 'labels'){$job.labels=@('ubuntu-latest')};$value=@{total_count=$(if($script:case -eq 'job-count'){2}else{1});jobs=@($job)}}
 elseif($Uri -ceq ($prefix+'git/ref/heads/main')){$value=@{object=@{sha=$(if($script:case -eq 'main'){'f'*40}else{'a'*40})}}}
 elseif($Uri -ceq ($prefix+'actions/runs/1001')){$value=@{id=1001;run_attempt=1;name='CI';path='.github/workflows/ci.yml';event=$(if($script:case -eq 'ci-event'){'workflow_dispatch'}else{'push'});head_sha=('a'*40);head_branch='main';status='completed';conclusion='success'}}
 elseif($Uri -ceq ($prefix+'actions/runs/1001/attempts/1/jobs?per_page=100')){$jobs=@(foreach($n in @('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures')){@{name=$n;status='completed';conclusion='success'}});if($script:case -eq 'ci-job'){$jobs[0].conclusion='failure'};$value=@{total_count=$(if($script:case -eq 'ci-count'){5}else{4});jobs=$jobs}}
 elseif($Uri.StartsWith(('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/'))){$path=$Uri.Substring(('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/').Length);Require ($path -cin @($script:grant.sourceHashes.PSObject.Properties.Name)+@('.github/workflows/gai-zbook-diagnostic-1218.yml')) 'FIXED_SOURCE_URL';if($script:case -eq 'source-oversize'){return ,(New-Object byte[] 1048577)};$b=[IO.File]::ReadAllBytes((Join-Path $root $path));if($script:case -eq 'remote-source'){$b=[Text.Encoding]::UTF8.GetBytes('PUBLIC_SOURCE_MISMATCH')};return ,$b}
 else{throw 'UNEXPECTED_PUBLIC_URL'}
 return ,[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 8 -Compress))
}

 $rows=@();foreach($v in $inputData.vectors){$owned=Ep-Setup $v;try{
  if($v.id -ceq 'previous-utc-cap-cannot-increase-after-stall'){$prime=[pscustomobject]@{sampleUtc=$v.sampleUtc;pre='1000';sample='5000'};Ep-Pair $owned.state $prime;$null=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token}
  $owned.state.hardEnd=Ep-Date $v.hardEnd;Ep-Pair $owned.state $v;Ep-ResetCounts
  if($v.expected.kind -ceq 'DATA'){$value=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token;Require ($null -eq (Get-Command Resolve-OwnerCutoverClockEndpointState -ErrorAction SilentlyContinue) -and $null -eq (Get-Command Get-OwnerCutoverClockEndpointPins -ErrorAction SilentlyContinue) -and $null -eq (Get-Command Test-OwnerCutoverClockEndpointPins -ErrorAction SilentlyContinue)) 'NO_ADDITIONAL_STATE_OR_PIN_API';Require ($script:epProviderCalls.utc -eq 2 -and $script:epProviderCalls.stamp -eq 3 -and $script:epProviderCalls.frequency -eq 2) 'EXACT_TWO_READER_ONE_PRESTAMP_CALLS';$rows+=@{id=$v.id;value=$value}}
  else{Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token};$naturalEquality=$v.id -ceq 'fractional-floor-deadline-equality-refuses';Require ([bool]$owned.state.terminal -eq $naturalEquality) ('ORIGINAL_VS_NEW_ONLY_TAXONOMY_'+$v.id);$before=Ep-Counts;Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token};Require ((Ep-Counts) -ceq $before) 'NEW_ONLY_STICKY_NO_MORE_SAMPLES';$failedRow=@{id=$v.id;refused=$true;originalTerminal=$naturalEquality};if($v.id -ceq 'sampling-delay-new-only-cut'){$oldClock=Read-OwnerCutoverClock $owned.state;Require ($oldClock.remainingHardMs -eq 50000 -and -not $owned.state.terminal) 'UNCHANGED_ORIGINAL_STILL_POSITIVE_AFTER_NEW_CUT';$failedRow.originalHardMsAfterConservativeRefusal=$oldClock.remainingHardMs};$rows+=$failedRow}
 }finally{Ep-Close $owned}}
 $base=$inputData.vectors[0];$negative=@();foreach($kind in @('null-token','copied-token','output-token','foreign-state-token','missing-token-store','missing-state-store','mismatched-state-registration','wrong-allocation','state-token-mismatch','source-drift','grant-drift','job-drift','origin-drift','frequency-drift','utc-backward','stamp-backward','provider-frequency-change','pre-stamp-backward','pre-stamp-malformed','second-before-pre','hard-expiry','hardend-extension','endpoint-bookkeeping','bookkeeping-hardend','bookkeeping-sample','bookkeeping-pin-write','bookkeeping-forged-pins','extra-positional','extra-named','extra-common','output-mutation','terminal-during-second-read','ambient-id-change')){
  $owned=Ep-Setup $base;try{
   $state=$owned.state;$token=$owned.token;$proof=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token;Require ($proof.remainingHardTicks -ne '0') 'PRIMED_ORIGINAL'
   Ep-ResetCounts;$originalExpected=$false;$noSamples=$false;$registry=$false
   switch($kind){
    'null-token'{$token=$null;$noSamples=$true;$registry=$true}
    'copied-token'{$token=[pscustomobject]@{};$noSamples=$true;$registry=$true}
    'output-token'{$token=$proof;$noSamples=$true;$registry=$true}
    'foreign-state-token'{$token=$state;$noSamples=$true;$registry=$true}
    'missing-token-store'{$script:ownerCutoverPublicLifetimes.tokens.Remove($token)|Out-Null;$noSamples=$true;$registry=$true}
    'missing-state-store'{$script:ownerCutoverPublicLifetimes.states.Remove($state)|Out-Null;$noSamples=$true;$registry=$true}
    'mismatched-state-registration'{$script:ownerCutoverPublicLifetimes.states.Remove($state)|Out-Null;$script:ownerCutoverPublicLifetimes.states.Add($state,[object]::new());$noSamples=$true;$registry=$true}
    'wrong-allocation'{$key='haji84/AI-|haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main|'+$state.workflowRunId+'|1|inspect';$script:ownerCutoverPublicLifetimes.allocations[$key]=[object]::new();$noSamples=$true;$registry=$true}
    'state-token-mismatch'{$state.token=[object]::new();$noSamples=$true;$registry=$true}
    'source-drift'{$state.sourceRevision='b'*40;$originalExpected=$true;$noSamples=$true}
    'grant-drift'{$state.grant.maxDurationSeconds=899;$originalExpected=$true;$noSamples=$true}
    'job-drift'{$state.jobId='999';$originalExpected=$true;$noSamples=$true}
    'origin-drift'{$state.originStamp++;$originalExpected=$true;$noSamples=$true}
    'frequency-drift'{$state.frequency++;$originalExpected=$true;$noSamples=$true}
    'utc-backward'{$script:utc=$state.lastUtc.AddTicks(-1);$originalExpected=$true}
    'stamp-backward'{$script:stamp=$state.lastStamp-1;$originalExpected=$true}
    'provider-frequency-change'{$script:frequency++;$originalExpected=$true}
    'pre-stamp-backward'{$v=[pscustomobject]@{sampleUtc=[string]$state.lastUtc.UtcDateTime.Ticks;pre=[string]($state.lastStamp-1);sample=[string]$state.lastStamp};Ep-Pair $state $v;$originalExpected=$true}
    'pre-stamp-malformed'{$v=[pscustomobject]@{sampleUtc=[string]$state.lastUtc.UtcDateTime.Ticks;pre=[string]$state.lastStamp;sample=[string]$state.lastStamp};Ep-Pair $state $v;$script:epQueues.stamp.Clear();$script:epQueues.stamp.Enqueue($state.lastStamp);$script:epQueues.stamp.Enqueue('PRIVATE_BAD_STAMP');$originalExpected=$true}
    'second-before-pre'{$v=[pscustomobject]@{sampleUtc=[string]$state.lastUtc.UtcDateTime.Ticks;pre=[string]($state.lastStamp+2);sample=[string]($state.lastStamp+1)};Ep-Pair $state $v;$originalExpected=$true}
    'hard-expiry'{$script:utc=$state.hardEnd;$originalExpected=$true}
    'hardend-extension'{$state.hardEnd=$state.hardEnd.AddTicks(1);$originalExpected=$true;$noSamples=$true}
    'endpoint-bookkeeping'{$record=$null;Require ($script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$record)) 'PRIVATE_ENDPOINT_RECORD_EXISTS';$record.Item2.previousForward=[long]0;$noSamples=$true}
    'bookkeeping-hardend'{$r=$null;$null=$script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$r);$r.Item2.previousHardEnd=[long]($state.hardEnd.UtcDateTime.Ticks-1);$noSamples=$true}
    'bookkeeping-sample'{$r=$null;$null=$script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$r);$r.Item2.lastStamp=[long]($state.lastStamp+1);$noSamples=$true}
    'bookkeeping-pin-write'{$r=$null;$null=$script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$r);$refused=$false;try{$r.Item1.Item2[0]='PUBLIC_FORGED_PIN'}catch{$refused=$true};Require $refused 'PIN_COLLECTION_READONLY';$refused=$false;try{$r.Item1=[object]::new()}catch{$refused=$true};Require $refused 'PIN_TUPLE_READONLY';$value=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token;Require (-not $state.terminal -and $value.remainingHardTicks -ne '0') 'PIN_WRITE_REFUSED_WITHOUT_STATE_POISON';$negative+=@{id=$kind;immutablePins=$true};continue}
    'bookkeeping-forged-pins'{$r=$null;$null=$script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$r);$wrong=[object[]]@($r.Item1.Item2);$wrong[5]='PUBLIC_FALSE_JOB_PIN';$fakePins=[Tuple[object,object,object]]::new($r.Item1.Item1,[Array]::AsReadOnly($wrong),$r.Item1.Item3);$script:ownerCutoverClockEndpointRecords.Remove($state)|Out-Null;$script:ownerCutoverClockEndpointRecords.Add($state,[Tuple[object,object]]::new($fakePins,$r.Item2));$noSamples=$true}
    'extra-positional'{$noSamples=$true;$registry=$true}
    'extra-named'{$noSamples=$true;$registry=$true}
    'extra-common'{$noSamples=$true;$registry=$true}
    'output-mutation'{$proof.hardStampEndpoint='0';$proof.sourceRevision='PUBLIC_CHANGED_OUTPUT';$again=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token;Require ($again.hardStampEndpoint -ne '0' -and $again.sourceRevision -ceq $state.sourceRevision -and -not [object]::ReferenceEquals($proof,$again)) 'OUTPUT_IS_FRESH_DATA_NO_STATE_ALIAS';$negative+=@{id=$kind;freshOutput=$true};continue}
    'terminal-during-second-read'{$script:epTerminalDuringRead=$true;$script:epMutationState=$state;$originalExpected=$true}
    'ambient-id-change'{$env:GITHUB_RUN_ID='999999';$env:GITHUB_REPOSITORY='PUBLIC_FOREIGN_AMBIENT';$value=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token;Require ($value.workflowRunId -ceq $state.workflowRunId) 'ORIGINAL_ALLOCATION_NOT_AMBIENT';$negative+=@{id=$kind;acceptedOriginal=$true};continue}
   }
   if($kind -cin @('ambient-id-change','bookkeeping-pin-write','output-mutation')){continue}
   if($kind -like 'extra-*'){switch($kind){'extra-positional'{Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token 'PUBLIC_EXTRA'}}'extra-named'{Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token -Foreign 'PUBLIC_EXTRA'}}'extra-common'{Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token -Verbose}}};Require ((Ep-Counts) -ceq '{"utc":0,"stamp":0,"frequency":0}' -or ($script:epProviderCalls.utc -eq 0 -and $script:epProviderCalls.stamp -eq 0 -and $script:epProviderCalls.frequency -eq 0)) 'EXTRA_ARGUMENT_NO_PROVIDER';Require (-not $state.terminal) 'EXTRA_ARGUMENT_NO_ORIGINAL_POISON';$again=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token;Require ($again.nativeAuthority -eq $false) 'EXTRA_ARGUMENT_DOES_NOT_CONSUME_GENUINE_PRODUCER';$negative+=@{id=$kind;refusedBeforeSampling=$true};continue}
   Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $token};Require ([bool]$state.terminal -eq $originalExpected) ('ORIGINAL_TERMINAL_TAXONOMY_'+$kind)
   if($noSamples){Require ($script:epProviderCalls.utc -eq 0 -and $script:epProviderCalls.stamp -eq 0 -and $script:epProviderCalls.frequency -eq 0) ('NO_PROVIDER_'+$kind)}
   if(-not $registry){$before=Ep-Counts;$script:utc=$state.lastUtc;$script:stamp=$state.lastStamp;$script:frequency=$state.frequency;Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token};Require ((Ep-Counts) -ceq $before) ('STICKY_'+$kind)}
   $negative+=@{id=$kind;refused=$true;originalTerminal=$originalExpected;noSampleExpected=$noSamples}
  }finally{Ep-Close $owned}
 }
 # Same original accepted state: UTC-forward tightening then a monotonic stall
 # and a later legitimate hardEnd tightening cannot increase either endpoint.
 $owned=Ep-Setup $base;try{
  $v=[pscustomobject]@{sampleUtc=[string]([long]$base.originUtc+1000000000L);pre=[string]([long]$base.origin+10000000L);sample=[string]([long]$base.origin+50000000L)};Ep-Pair $owned.state $v;$first=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token
  $v.pre=[string]([long]$base.origin+200000000L);$v.sample=$v.pre;Ep-Pair $owned.state $v;$stall=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token;Require ($stall.hardStampEndpoint -ceq $first.hardStampEndpoint -and $stall.forwardStampEndpoint -ceq $first.forwardStampEndpoint) 'UTC_STALL_RETAINED_MINIMA'
  $owned.state.hardEnd=$owned.state.hardEnd.AddSeconds(-10);Ep-Pair $owned.state $v;$tight=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token;Require ([long]$tight.hardStampEndpoint -le [long]$stall.hardStampEndpoint) 'AUTHENTICATED_HARDEND_ONLY_TIGHTENS'
 }finally{Ep-Close $owned}
 # Independent review regressions: each starts from genuine unchanged readiness,
 # UTC+800s and F1000, whose accepted hard101000/forward0 must never renew.
 $reviewRegressions=@();foreach($kind in @('null-previous-hard','null-all-minima','coherent-larger-hard-forward-zero','fresh-lifetime-same-genuine-pins','clear-terminal-after-bookkeeping-refusal','first-reader-terminal')){
  $reviewVector=[pscustomobject]@{id='review-bookkeeping';originUtc=$base.originUtc;origin='0';frequency='1000'};$owned=Ep-Setup $reviewVector;try{
   $state=$owned.state;$pair=[pscustomobject]@{sampleUtc=[string]([long]$base.originUtc+8000000000L);pre='1000';sample='1000'};Ep-Pair $state $pair;$prime=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token
   Require ($prime.hardStampEndpoint -ceq '101000' -and $prime.forwardStampEndpoint -ceq '0') 'REVIEW_PRIME_FORWARD_ZERO'
   $issuedLifetime=$null;Require ($script:ownerCutoverClockEndpointRecords.TryGetValue($state,[ref]$issuedLifetime)) 'REVIEW_ISSUED_LIFETIME'
   $accepted=@{};foreach($name in @('previousHard','previousForward','previousHardEnd','lastUtc','lastStamp')){$accepted[$name]=$issuedLifetime.Item2[$name]}
   switch($kind){
    'null-previous-hard'{$issuedLifetime.Item2.previousHard=$null}
    'null-all-minima'{foreach($name in $accepted.Keys){$issuedLifetime.Item2[$name]=$null}}
    'coherent-larger-hard-forward-zero'{$issuedLifetime.Item2.previousHard=[long]102000}
    'fresh-lifetime-same-genuine-pins'{$replacement=@{terminal=$false;previousHard=$null;previousForward=$null;previousHardEnd=$null;lastUtc=$null;lastStamp=$null};$script:ownerCutoverClockEndpointRecords.Remove($state)|Out-Null;$script:ownerCutoverClockEndpointRecords.Add($state,[Tuple[object,object]]::new($issuedLifetime.Item1,$replacement))}
    'clear-terminal-after-bookkeeping-refusal'{$issuedLifetime.Item2.previousHard='PUBLIC_BAD';Ep-Refused {Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token};$issuedLifetime.Item2.previousHard=[long]101000;$issuedLifetime.Item2.terminal=$false}
   }
   $pair.pre='2000';$pair.sample='2000';Ep-Pair $state $pair;Ep-ResetCounts;$utcSeed=0
   if($kind -ceq 'first-reader-terminal'){$script:epTerminalDuringRead=$true;$script:epMutationState=$state;$script:epProviderCalls.utc=1;$utcSeed=1}
   $message=$null;$second=$null;try{$second=Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token}catch{$message=$_.Exception.Message}
   $observed=@{id=$kind;firstHard=$prime.hardStampEndpoint;firstForward=$prime.forwardStampEndpoint;refused=($message -ceq 'ROTATION_CUTOVER_CLOCK_ENDPOINT_DATA_REJECTED');utcSamples=($script:epProviderCalls.utc-$utcSeed);stampSamples=$script:epProviderCalls.stamp;frequencySamples=$script:epProviderCalls.frequency;originalTerminal=[bool]$state.terminal}
   if($second){$observed.secondHard=$second.hardStampEndpoint;$observed.secondForward=$second.forwardStampEndpoint}
   # Repair only the mutable mirror/current-record slot. An issued refusal must
   # remain sticky even when every visible bookkeeping field looks valid again.
   foreach($name in $accepted.Keys){$issuedLifetime.Item2[$name]=$accepted[$name]};$issuedLifetime.Item2.terminal=$false
   if($kind -ceq 'fresh-lifetime-same-genuine-pins'){$script:ownerCutoverClockEndpointRecords.Remove($state)|Out-Null;$script:ownerCutoverClockEndpointRecords.Add($state,$issuedLifetime)}
   $before=Ep-Counts;$repairMessage=$null;try{Get-OwnerCutoverOriginalClockEndpointData -PublicToken $owned.token|Out-Null}catch{$repairMessage=$_.Exception.Message};$observed.stickyAfterRepair=($repairMessage -ceq 'ROTATION_CUTOVER_CLOCK_ENDPOINT_DATA_REJECTED' -and (Ep-Counts) -ceq $before)
   $registered=$null;$allocation='haji84/AI-|haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main|'+$state.workflowRunId+'|1|inspect';Require ($script:ownerCutoverPublicLifetimes.tokens.TryGetValue($owned.token,[ref]$registered) -and [object]::ReferenceEquals($registered,$state) -and [object]::ReferenceEquals($script:ownerCutoverPublicLifetimes.allocations[$allocation],$state)) 'REVIEW_ORIGINAL_REGISTRATION_UNCHANGED'
   $reviewRegressions+=$observed
  }finally{Ep-Close $owned}
 }
 @{pass=$true;vectors=$rows;negative=$negative;reviewRegressions=$reviewRegressions;minimaPreserved=$true;actualOriginalRegistration=$true;originalReadClockUnchanged=$true;actualNativeCalls=0;nativeAuthority=$false;qpcAssociationVerified=$false}|ConvertTo-Json -Depth 10 -Compress;return
}


# Test-only insertion plan. The original PUBLIC source and every original
# statement remain present; the helper verifies exact removal before execution.
function New-PublicPeerEntryCounterfactual([string]$Source){
 Require ($Source -and [Text.Encoding]::UTF8.GetByteCount($Source) -le 262144) 'ENTRY_CF_SOURCE_BOUND'
 $steps=[Collections.Generic.List[object]]::new()
 function Add-EntryInsertion([string]$Anchor,[int]$Offset,[string]$Text){$at=$Source.IndexOf($Anchor,[StringComparison]::Ordinal);Require ($at -ge 0 -and $at -eq $Source.LastIndexOf($Anchor,[StringComparison]::Ordinal) -and $Offset -ge 0 -and $Offset -le $Anchor.Length) 'ENTRY_CF_UNIQUE_ORIGINAL_ANCHOR';$steps.Add(@{offset=($at+$Offset);text=$Text})}
 function Get-EntryMarker([string]$Phase){return ('[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE '+$Phase+' 0'');[Console]::Out.Flush();')}
 $wrapper='function Get-OwnerCutoverPeerAncestryDiagnosticData {';Add-EntryInsertion $wrapper $wrapper.Length ((Get-EntryMarker 'DIAGNOSTIC_WRAPPER_ENTER'))
 $initial='$script:ownerCutoverPeerProbeState=@{stopwatch=';Add-EntryInsertion $initial 0 ((Get-EntryMarker 'PRODUCER_STATE_INIT_ENTER'))
 $stopwatch=$initial+'[Diagnostics.Stopwatch]::StartNew()';Add-EntryInsertion $stopwatch $initial.Length '$(<#PUBLIC_ENTRY_CF_STOPWATCH#>';Add-EntryInsertion $stopwatch $stopwatch.Length (';'+(Get-EntryMarker 'PRODUCER_STOPWATCH_RETURN')+')')
 $v1Flag='([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))';$v2Flag='([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))'
 $v1Cleanup='Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue';$v2Cleanup='Microsoft.PowerShell.Utility\'+$v1Cleanup
 $v1Read=$Source.Contains($v1Flag);$v2Read=$Source.Contains($v2Flag);$v1Clear=$Source.Contains('}catch{}finally{'+$v1Cleanup+'}');$v2Clear=$Source.Contains('}catch{}finally{'+$v2Cleanup+'}')
 if($v1Read -and $v1Clear -and -not $v2Read -and -not $v2Clear){$flagAccessVersion=1;$flag=$v1Flag;$cleanup=$v1Cleanup;$getCommand='Get-Variable';$removeCommand='Remove-Variable'}elseif($v2Read -and $v2Clear -and -not $v1Read -and -not $v1Clear){$flagAccessVersion=2;$flag=$v2Flag;$cleanup=$v2Cleanup;$getCommand='Microsoft.PowerShell.Utility\Get-Variable';$removeCommand='Microsoft.PowerShell.Utility\Remove-Variable'}else{throw 'PEER_FIXTURE_ENTRY_CF_EXACT_PAIRED_ACCESS_VERSION_REQUIRED'}
 $logicalSource=$Source.Replace($v2Flag,$v1Flag).Replace($v2Cleanup,$v1Cleanup);Require (($logicalSource.Split([string[]]@($v1Flag),[StringSplitOptions]::None).Length-1) -eq 1 -and ($logicalSource.Split([string[]]@($v1Cleanup),[StringSplitOptions]::None).Length-1) -eq 1) 'ENTRY_CF_ONE_EXACT_LOGICAL_FLAG_PAIR'
 Add-EntryInsertion $flag 0 ('$(<#PUBLIC_ENTRY_CF_FLAG#>'+(Get-EntryMarker 'DIAGNOSTIC_FLAG_READ_ENTER'));Add-EntryInsertion $flag $flag.Length (';'+(Get-EntryMarker 'DIAGNOSTIC_FLAG_READ_RETURN')+')')
 $ready="lastProgress='';progressRows=0;progressBytes=0}";Add-EntryInsertion $ready $ready.Length (';'+(Get-EntryMarker 'PRODUCER_STATE_READY'))
 $returned='$null=Get-OwnerCutoverPeerAncestryData;$completed=$true';Add-EntryInsertion $returned ('$null=Get-OwnerCutoverPeerAncestryData;'.Length) ((Get-EntryMarker 'DIAGNOSTIC_PRODUCER_RETURN'))
 $caught='}catch{}finally{'+$cleanup;Add-EntryInsertion $caught ('}catch{'.Length) ((Get-EntryMarker 'DIAGNOSTIC_PRODUCER_THROW'))
 Add-EntryInsertion $cleanup 0 ((Get-EntryMarker 'DIAGNOSTIC_CLEANUP_ENTER'));Add-EntryInsertion $cleanup $cleanup.Length (';'+(Get-EntryMarker 'DIAGNOSTIC_CLEANUP_RETURN'))
 # The fixed plan has no provider, cmdlet, callback or warmup before the cold
 # original calls. Insert descending, then remove ascending at original offsets.
 $ordered=$steps.ToArray();for($i=0;$i -lt $ordered.Length;$i++){for($j=$i+1;$j -lt $ordered.Length;$j++){if($ordered[$j].offset -lt $ordered[$i].offset){$swap=$ordered[$i];$ordered[$i]=$ordered[$j];$ordered[$j]=$swap}}}
 $instrumented=$Source;$fragment='$counterfactualSource=([Text.UTF8Encoding]::new($false,$true)).GetString($b);$originalCounterfactualSource=$counterfactualSource;'
 for($i=$ordered.Length-1;$i -ge 0;$i--){$step=$ordered[$i];$instrumented=$instrumented.Insert($step.offset,$step.text);$fragment+='$counterfactualSource=$counterfactualSource.Insert('+[string]$step.offset+','''+$step.text.Replace("'","''")+''');'}
 $restored=$instrumented;$fragment+='$restoredCounterfactualSource=$counterfactualSource;'
 foreach($step in $ordered){$restored=$restored.Remove($step.offset,$step.text.Length);$fragment+='$restoredCounterfactualSource=$restoredCounterfactualSource.Remove('+[string]$step.offset+','+[string]$step.text.Length+');'}
 Require ([string]::Equals($restored,$Source,[StringComparison]::Ordinal)) 'ENTRY_CF_EXACT_INSERTION_REMOVAL_IDENTITY'
 $fragment+='if(-not [string]::Equals($restoredCounterfactualSource,$originalCounterfactualSource,[StringComparison]::Ordinal)){throw ''PUBLIC_ENTRY_COUNTERFACTUAL_IDENTITY''};'
 return @{source=$instrumented;fragment=$fragment;insertions=$ordered.Length;markerCount=10;restored=$restored;flagAccessVersion=$flagAccessVersion;flagExpression=$flag;getCommand=$getCommand;removeCommand=$removeCommand}
}
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
# Cleanup cannot replace a primary preamble error. An entered but ambiguous
# Start or an unconfirmed started-child exit is never reported as success.
function Close-PublicPreambleChild([Diagnostics.Process]$Process,[bool]$Started,[bool]$StartEntered=$false){
 $state='UNCONFIRMED'
 if(-not $StartEntered -and -not $Started){$state='NOT_STARTED'}elseif($Started){try{if(-not $Process.HasExited){$Process.Kill();$null=$Process.WaitForExit(1000)};if($Process.HasExited){$state='CLOSED'}}catch{}}
 try{$Process.Dispose()}catch{$state='UNCONFIRMED'};return $state
}
# Exercise the actual preamble finally on a never-started owned allocation.
# This tests exception preservation, not native process authority.
if($PreambleCleanupDiagnostic){
 $text=[IO.File]::ReadAllText($PSCommandPath);$begin=[regex]::Match($text,'(?m)^if\(\$HelloPreambleDiagnostic\)\{').Index;$end=$text.IndexOf('# Frozen PUBLIC same-child write counterfactual.',$begin);$part=$text.Substring($begin,$end-$begin);$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($part,[ref]$tokens,[ref]$errors)
 Require ($errors.Count -eq 0) 'PREAMBLE_FINALLY_PARSE'
 $tries=@($ast.FindAll({param($x)$x -is [Management.Automation.Language.TryStatementAst] -and $x.Finally -and ($x.Finally.Extent.Text.Contains('$process.Dispose()') -or $x.Finally.Extent.Text.Contains('$preambleCleanup'))},$true));Require ($tries.Count -eq 1) 'PREAMBLE_ONE_ACTUAL_FINALLY'
 $body=$tries[0].Finally.Extent.Text;$cleanup=[scriptblock]::Create($body.Substring(1,$body.Length-2));$process=[Diagnostics.Process]::new();$started=$false;$startEntered=$false;$preambleCleanup='UNCONFIRMED';$preserved=$false
 try{try{throw 'PUBLIC_PRIMARY_REFUSAL'}finally{. $cleanup}}catch{$preserved=$_.Exception.Message -ceq 'PUBLIC_PRIMARY_REFUSAL'}
 Require $preserved 'PREAMBLE_PRIMARY_ERROR_PRESERVED'
 Require ($preambleCleanup -ceq 'NOT_STARTED') 'PREAMBLE_UNSTARTED_CLEANUP_CLOSED'
 $disposed=[Diagnostics.Process]::new();$disposed.Dispose();$state=Close-PublicPreambleChild $disposed $true;Require ($state -ceq 'UNCONFIRMED') 'PREAMBLE_UNCONFIRMED_NOT_SUCCESS'
 @{pass=$true;primaryPreserved=$true;beforeStartClosed=$true;unconfirmedRefused=$true;actualNativeCalls=0;nativeAuthority=$false}|ConvertTo-Json -Compress;return
}
# Public managed StreamWriter preamble mechanism. Classification contains no
# input bytes. Explicit encodings are controls; DEFAULT measures this runtime.
if($HelloPreambleDiagnostic){
 Require ([bool]$NodeExecutable -and -not $NodeExecutable.Contains('"')) 'PUBLIC_PREAMBLE_NODE'
 $program=@'
let input=Buffer.alloc(0),sent=false;const bom=Buffer.from([239,187,191]);setTimeout(()=>process.exit(9),3500);process.stdin.on('data',part=>{input=Buffer.concat([input,part]);if(input.length>128)process.exit(7);const at=input.indexOf(10);if(at<0||sent)return;let body=input.subarray(0,at),count=0;while(body.subarray(0,3).equals(bom)){count++;body=body.subarray(3);}const kind=at!==input.length-1||body.toString('utf8')!=='PUBLIC_HELLO'||count>2?3:count;sent=true;process.stdout.write(String(kind));});process.stdin.on('end',()=>process.exit(sent?0:7));
'@
 $rows=@();$encodingProperty=[Diagnostics.ProcessStartInfo].GetProperty('StandardInputEncoding');$encodingAvailable=($null -ne $encodingProperty -and $encodingProperty.CanWrite)
 foreach($mode in @('DEFAULT','UTF8_BOM','UTF8_NO_BOM')){
  if($mode -cne 'DEFAULT' -and -not $encodingAvailable){$rows+=@{mode=$mode;status='NOT_RUN';reason='STANDARD_INPUT_ENCODING_UNAVAILABLE';actualExecuted=$false};continue}
  $process=[Diagnostics.Process]::new();$watch=[Diagnostics.Stopwatch]::StartNew();$started=$false;$startEntered=$false;$failed=$false;$phase='CONFIGURE';$row=@{mode=$mode;actualExecuted=$false;failurePhase='NONE';exceptionClass='NONE';actualExceptionHResult=$null}
  try{
   $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='-e "'+$program+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
   if($mode -ceq 'UTF8_BOM'){$info.StandardInputEncoding=[Text.UTF8Encoding]::new($true)}elseif($mode -ceq 'UTF8_NO_BOM'){$info.StandardInputEncoding=[Text.UTF8Encoding]::new($false)}
   $process.StartInfo=$info;$phase='START_ENTER';$startEntered=$true;$started=$process.Start();Require $started 'PUBLIC_PREAMBLE_START';$row.actualExecuted=$true;$phase='STDIN_ACQUIRE';$stream=$process.StandardInput.BaseStream;$preambleLength=$process.StandardInput.Encoding.GetPreamble().Length
   $ackBytes=New-Object byte[] 1;$ack=$process.StandardOutput.BaseStream.ReadAsync($ackBytes,0,1);$errBytes=New-Object char[] 1;$err=$process.StandardError.ReadAsync($errBytes,0,1)
   $phase='WRITE_ENTER';$bytes=[Text.Encoding]::UTF8.GetBytes('PUBLIC_HELLO'+[char]10);$preambleWrite=$stream.WriteAsync($bytes,0,$bytes.Length)
   while(-not $preambleWrite.IsCompleted){Require (-not $process.HasExited -and -not $err.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_PREAMBLE_WRITE_BOUND';[Threading.Thread]::Sleep(5)};$null=$preambleWrite.GetAwaiter().GetResult()
   $phase='FLUSH_ACK_ENTER';$action=[Delegate]::CreateDelegate([Action],$stream,'Flush');$flush=[Threading.Tasks.Task]::Run($action)
   while(-not $flush.IsCompleted -or -not $ack.IsCompleted){Require (-not $process.HasExited -and -not $err.IsCompleted -and $watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_PREAMBLE_ACK_BOUND';[Threading.Thread]::Sleep(5)};$null=$flush.GetAwaiter().GetResult()
   Require ($ack.GetAwaiter().GetResult() -eq 1 -and $ackBytes[0] -in @(48,49,50,51) -and -not $process.HasExited -and -not $err.IsCompleted) 'PUBLIC_PREAMBLE_CLOSED_CLASS'
   $phase='EOF_CLOSE_ENTER';$kind=@('PLAIN','ONE_BOM','DOUBLE_BOM','INVALID')[$ackBytes[0]-48];$process.StandardInput.Close()
   while(-not $process.HasExited){Require ($watch.ElapsedMilliseconds -lt 4000) 'PUBLIC_PREAMBLE_EXIT_BOUND';[Threading.Thread]::Sleep(5)};Require ($process.ExitCode -eq 0 -and $err.Wait(1000) -and $err.GetAwaiter().GetResult() -eq 0) 'PUBLIC_PREAMBLE_EXIT'
   $row.firstFrameClass=$kind;$row.managedEncodingPreambleLength=$preambleLength;$row.beforeEof=$true;$row.childClosed=$true
  }catch{$failed=$true;$row.failurePhase=$phase;$exception=$_.Exception;$row.actualExceptionHResult=[int]$exception.HResult;$row.exceptionClass=switch($exception.GetType().FullName){'System.Management.Automation.RuntimeException'{'RUNTIME'};'System.Management.Automation.SetValueInvocationException'{'SET_VALUE'};'System.Management.Automation.MethodInvocationException'{'METHOD_INVOCATION'};default{'OTHER'}}}
  finally{$preambleCleanup=Close-PublicPreambleChild $process $started $startEntered}
  $row.cleanupState=$preambleCleanup;$row.status=if($failed -or $preambleCleanup -cne 'CLOSED'){'FAIL'}else{'PASS'};$rows+=,$row;if($row.status -ceq 'FAIL'){break}
 }
 @{profile='goriq-public-stdin-preamble-diagnostic-v1';rows=$rows;standardInputEncodingAvailable=$encodingAvailable;windows=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);psMajor=[int]$PSVersionTable.PSVersion.Major;nativeAuthority=$false;actualOwnerTaskAccountDpapiCalls=0}|ConvertTo-Json -Depth 4 -Compress;return
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

# Separate public diagnostic capsule, authenticating the exact NativePS source.
# Original helper12s / ownedNode13s / outer15s limits are unchanged.
if($HostedProbeDiagnostic){
 Require ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and $PSVersionTable.PSVersion.Major -eq 5 -and $env:GITHUB_ACTIONS -ceq 'true' -and $env:RUNNER_ENVIRONMENT -ceq 'github-hosted') 'DIAGNOSTIC_HOSTED_WINDOWS_REQUIRED'
 $system=[Environment]::GetFolderPath('System');$shell=$system+'\WindowsPowerShell\v1.0\powershell.exe';$windows=[IO.Directory]::GetParent($system).FullName
 $bootstrap=[Diagnostics.Process]::GetCurrentProcess();$node=[Diagnostics.Process]::new();$directory=$null;$watch=[Diagnostics.Stopwatch]::StartNew()
 try{
  Require ($bootstrap.MainModule.FileName.Equals($shell,[StringComparison]::OrdinalIgnoreCase) -and $NodeExecutable -and -not $NodeExecutable.Contains('"')) 'DIAGNOSTIC_FIXED_BOOTSTRAP'
  Require ((Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($NodeExecutable))) -ceq '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') 'DIAGNOSTIC_PINNED_NODE'
  $native=Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1';$nativeHash=Get-OwnerRotationEntryDigest ([IO.File]::ReadAllBytes($native))
  $capsule='$ProgressPreference=''SilentlyContinue'';[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE CAPSULE_ENTER 0'');[Console]::Out.Flush();$ErrorActionPreference=''Stop'';Set-StrictMode -Version Latest;$p='''+$native.Replace("'","''")+''';$h='''+$nativeHash+''';$s=$null;try{[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_OPEN_ENTER 0'');[Console]::Out.Flush();$s=[IO.File]::OpenRead($p);if($s.Length -lt 1 -or $s.Length -gt 262144){throw ''PEER_SOURCE''};[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_READ_ENTER 0'');[Console]::Out.Flush();$b=[byte[]]::new([int]$s.Length);[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_ALLOC_RETURN 0'');[Console]::Out.Flush();$n=0;[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_READ_LOOP_ENTER 0'');[Console]::Out.Flush();while($n -lt $b.Length){$c=$s.Read($b,$n,$b.Length-$n);if($c -le 0){throw ''PEER_SOURCE''};$n+=$c};[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_HASH_ENTER 0'');[Console]::Out.Flush();$sha=[Security.Cryptography.SHA256]::Create();try{$d=([BitConverter]::ToString($sha.ComputeHash($b))).Replace(''-'','''').ToLowerInvariant()}finally{$sha.Dispose()};if($d -cne $h){throw ''PEER_SOURCE''};[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE SOURCE_DOTSOURCE_ENTER 0'');[Console]::Out.Flush();.([scriptblock]::Create(([Text.UTF8Encoding]::new($false,$true)).GetString($b)));[Console]::Out.WriteLine(''GORIQ_PUBLIC_PEER_CAPSULE_PHASE DIAGNOSTIC_ENTRY_ENTER 0'');[Console]::Out.Flush();$r=Get-OwnerCutoverPeerAncestryDiagnosticData;[Console]::Out.WriteLine(($r|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 4 -Compress))}catch{exit 1}finally{if($s){$s.Dispose()}}'
  $entryPlan=New-PublicPeerEntryCounterfactual (([Text.UTF8Encoding]::new($false,$true)).GetString([IO.File]::ReadAllBytes($native)))
  $originalDotSource='.([scriptblock]::Create(([Text.UTF8Encoding]::new($false,$true)).GetString($b)))';Require ($capsule.IndexOf($originalDotSource,[StringComparison]::Ordinal) -eq $capsule.LastIndexOf($originalDotSource,[StringComparison]::Ordinal) -and $capsule.Contains($originalDotSource)) 'ENTRY_CF_SINGLE_DOTSOURCE'
  $entryCounterfactualCapsule=$capsule.Replace($originalDotSource,($entryPlan.fragment+'.([scriptblock]::Create($counterfactualSource))'))
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($entryCounterfactualCapsule));$shellLiteral=ConvertTo-Json -InputObject $shell -Compress;$rootLiteral=ConvertTo-Json -InputObject $Root -Compress
 $diagnosticDriver=@'
'use strict';
const phases=new Set(['PLATFORM','ROW_READ','PROCESS_QUERY','PROCESS_OPEN','OWNER_QUERY','NATIVE_COMPILE','IMAGE_OPEN','IMAGE_IDENTITY','IMAGE_READ','IMAGE_RECHECK','SIGNATURE','ROW_SHAPE','ROW_BINDING','CHAIN_BINDING','COMPLETE']);
const capsulePhases=new Set(['CAPSULE_ENTER','SOURCE_OPEN_ENTER','SOURCE_READ_ENTER','SOURCE_ALLOC_RETURN','SOURCE_READ_LOOP_ENTER','SOURCE_HASH_ENTER','SOURCE_DOTSOURCE_ENTER','DIAGNOSTIC_ENTRY_ENTER']);
const entryCounterfactualPhases=new Set(['DIAGNOSTIC_WRAPPER_ENTER','PRODUCER_STATE_INIT_ENTER','PRODUCER_STOPWATCH_RETURN','DIAGNOSTIC_FLAG_READ_ENTER','DIAGNOSTIC_FLAG_READ_RETURN','PRODUCER_STATE_READY','DIAGNOSTIC_PRODUCER_RETURN','DIAGNOSTIC_PRODUCER_THROW','DIAGNOSTIC_CLEANUP_ENTER','DIAGNOSTIC_CLEANUP_RETURN']);
function parseDiagnosticWire(bytes){
 let last=null,lastCapsule=null,rows=0,diagnostic=null;const rejected=()=>({wireState:'REJECTED',lastObservedEntered:last,lastObservedCapsuleEntered:lastCapsule,progressRows:rows,diagnostic:null});if(bytes.length>8192)return rejected();let wire=bytes.toString('utf8').replace(/^\uFEFF/,'');const lines=wire.split('\n');const partial=lines.pop();
 for(const lineWithCr of lines){const line=lineWithCr.replace(/\r$/,'');const capsule=/^GORIQ_PUBLIC_PEER_CAPSULE_PHASE ([A-Z_]+) 0$/.exec(line);if(capsule){if(diagnostic||(!capsulePhases.has(capsule[1])&&!entryCounterfactualPhases.has(capsule[1]))||++rows>96)return rejected();lastCapsule={phase:capsule[1],rowIndex:0,meaning:entryCounterfactualPhases.has(capsule[1])?'SOURCE_AUTHENTICATED_COUNTERFACTUAL_ENTERED_NOT_CAUSE':capsule[1]==='SOURCE_ALLOC_RETURN'?'ALLOCATION_RETURN_OBSERVED_NOT_FAILURE_CAUSE':'LAST_OBSERVED_ENTERED_NOT_RETURNED_OR_CAUSE'};continue;}const match=/^GORIQ_PUBLIC_PEER_PROBE_PHASE ([A-Z_]+) ([0-2])$/.exec(line);if(match){if(diagnostic||!phases.has(match[1])||++rows>96)return rejected();last={phase:match[1],rowIndex:Number(match[2]),meaning:'LAST_OBSERVED_ENTERED_NOT_RETURNED_OR_CAUSE'};continue;}
  try{const d=JSON.parse(line),fields=['profile','ancestryCompleted','lastEnteredPhase','rowIndex','exceptionClass','actualExceptionHResult','hresultMeaning','nativeAuthority','effectCapability'];if(diagnostic||!d||Object.keys(d).length!==fields.length||fields.some(k=>!Object.hasOwn(d,k))||d.profile!=='goriq-readonly-peer-probe-diagnostic-v1'||typeof d.ancestryCompleted!=='boolean'||!phases.has(d.lastEnteredPhase)||!Number.isInteger(d.rowIndex)||d.rowIndex<0||d.rowIndex>2||!['NONE','RUNTIME','METHOD_INVOCATION','CIM','IO','ACCESS','OTHER'].includes(d.exceptionClass)||(d.actualExceptionHResult!==null&&(!Number.isInteger(d.actualExceptionHResult)||d.actualExceptionHResult<-2147483648||d.actualExceptionHResult>2147483647))||d.hresultMeaning!=='ACTUAL_DOTNET_EXCEPTION_NOT_UNDERLYING_NATIVE_CAUSE'||d.nativeAuthority!==false||d.effectCapability!==false||(d.ancestryCompleted&&(d.lastEnteredPhase!=='COMPLETE'||d.exceptionClass!=='NONE'||d.actualExceptionHResult!==null)))throw 0;diagnostic=d;}catch{return rejected();}
 }
 return {wireState:diagnostic&&!partial?'COMPLETE':rows?'PARTIAL':'EMPTY',lastObservedEntered:last,lastObservedCapsuleEntered:lastCapsule,progressRows:rows,diagnostic};
}
if(process.argv[1]==='PUBLIC_PARSER_CONTROLS'){
 const check=(value)=>{if(!value)throw new Error('PUBLIC_DIAGNOSTIC_PARSER_CONTROL_REFUSED');};const phase='GORIQ_PUBLIC_PEER_PROBE_PHASE OWNER_QUERY 1\n';let r=parseDiagnosticWire(Buffer.from(phase));check(r.wireState==='PARTIAL'&&r.lastObservedEntered.phase==='OWNER_QUERY');r=parseDiagnosticWire(Buffer.from(phase+'GORIQ_PUBLIC_PEER_PROBE_PHASE SIGN'));check(r.progressRows===1&&r.lastObservedEntered.phase==='OWNER_QUERY');check(parseDiagnosticWire(Buffer.from('PRIVATE_CANARY C:\\PRIVATE S-1-5\n')).wireState==='REJECTED');check(parseDiagnosticWire(Buffer.from('GORIQ_PUBLIC_PEER_PROBE_PHASE PRIVATE_CANARY 1\n')).wireState==='REJECTED');check(parseDiagnosticWire(Buffer.from(phase.repeat(97))).wireState==='REJECTED');check(parseDiagnosticWire(Buffer.alloc(8193)).wireState==='REJECTED');check(parseDiagnosticWire(Buffer.from('{}\n')).wireState==='REJECTED');process.stdout.write(JSON.stringify({pass:true,controls:7,nativeAuthority:false})+'\n');
}else{
 const {spawn}=require('node:child_process'),shell=__SHELL__,root=__ROOT__,encoded='__CAPSULE__';let child,output=Buffer.alloc(0),stderr=false,oversize=false,timedOut=false,spawnError=false,done=false,spawnAttempted=false,startObserved=false,closeObserved=false;
 const finish=(code,signal)=>{if(done)return;done=true;clearTimeout(timer);const parsed=parseDiagnosticWire(output);const state=timedOut?'HELPER_TIMEOUT':spawnError?'SPAWN_ERROR':oversize?'OUTPUT_LIMIT':stderr?'STDERR_DATA':code===0&&parsed.wireState==='COMPLETE'?'CLOSED_DIAGNOSTIC':'HELPER_REFUSED';process.stdout.write(JSON.stringify({profile:'goriq-public-owned-probe-diagnostic-v1',capsuleKind:'EXPLICIT_DIAGNOSTIC_SOURCE_AUTHENTICATED',executionMeaning:'PUBLIC_SOURCE_AUTHENTICATED_COUNTERFACTUAL',capsuleState:state,helperExitClass:signal?'SIGNAL':code===0?'ZERO':Number.isInteger(code)?'NONZERO':'UNKNOWN',helperStderrData:stderr,helperSpawnAttempted:spawnAttempted,helperStartObserved:startObserved,helperCloseObserved:closeObserved,...parsed,nativeAuthority:false,actualOwnerTaskAccountDpapiCalls:0,localHelperLimitMs:12000})+'\n');};
 const timer=setTimeout(()=>{timedOut=true;try{child.kill();}catch{finish(null,null);}},12000);try{spawnAttempted=true;child=spawn(shell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env}});child.stdout.on('data',part=>{if(output.length+part.length>8192){oversize=true;try{child.kill();}catch{}}else output=Buffer.concat([output,part]);});child.stderr.on('data',()=>{stderr=true;try{child.kill();}catch{}});child.on('error',()=>{spawnError=true;finish(null,null);});child.on('spawn',()=>{startObserved=true;});child.on('close',(code,signal)=>{closeObserved=true;finish(code,signal);});}catch{spawnError=true;finish(null,null);}
}
'@
  $program=$diagnosticDriver.Replace('__SHELL__',$shellLiteral).Replace('__ROOT__',$rootLiteral).Replace('__CAPSULE__',$encoded)
  $directory=Join-Path ([IO.Path]::GetTempPath()) ('public-peer-diagnostic-'+[IO.Path]::GetRandomFileName());$null=[IO.Directory]::CreateDirectory($directory);$programPath=Join-Path $directory 'public-diagnostic.cjs';Require (-not $programPath.Contains('"')) 'DIAGNOSTIC_PUBLIC_PATH';[IO.File]::WriteAllText($programPath,$program,[Text.UTF8Encoding]::new($false))
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$NodeExecutable;$info.Arguments='"'+$programPath+'"';$info.WorkingDirectory=$Root;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.EnvironmentVariables.Clear()
  $envValues=@{SystemRoot=$windows;WINDIR=$windows;ComSpec=($system+'\cmd.exe');USERPROFILE=[Environment]::GetFolderPath('UserProfile');LOCALAPPDATA=[Environment]::GetFolderPath('LocalApplicationData');TEMP=[IO.Path]::GetTempPath().TrimEnd([char]92);TMP=[IO.Path]::GetTempPath().TrimEnd([char]92);PATH=([IO.Path]::GetDirectoryName($NodeExecutable)+';'+$system+';'+$windows);PATHEXT='.COM;.EXE;.BAT;.CMD';PSModulePath=($system+'\WindowsPowerShell\v1.0\Modules')};foreach($name in $envValues.Keys){Require ([bool]$envValues[$name]) 'DIAGNOSTIC_PLATFORM_VALUE';$info.EnvironmentVariables[$name]=$envValues[$name]}
  $node.StartInfo=$info;Require ($node.Start()) 'DIAGNOSTIC_OWNED_NODE_START';$null=$node.Handle;$out=$node.StandardOutput.ReadToEndAsync();$err=$node.StandardError.ReadToEndAsync();$node.StandardInput.Close()
  while(-not $node.HasExited){Require ($watch.ElapsedMilliseconds -lt 13000) 'DIAGNOSTIC_OWNED_NODE_BOUND';[Threading.Thread]::Sleep(5)};Require ($out.Wait(500) -and $err.Wait(500) -and $node.ExitCode -eq 0 -and $err.Result.Length -eq 0 -and $out.Result.Length -le 8192) 'DIAGNOSTIC_CLOSED_NODE_CHANNEL'
  [Console]::Out.Write($out.Result);return
 }finally{if($node){try{if(-not $node.HasExited){$node.Kill();$null=$node.WaitForExit(1000)}}catch{};$node.Dispose()};$bootstrap.Dispose();if($directory -and [IO.Directory]::Exists($directory)){[IO.Directory]::Delete($directory,$true)}}
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
     if($stderrDone -or $childExited -or $localBound){[Console]::Error.WriteLine('GORIQ_PUBLIC_PEER_REPLY_STATE '+(@{phase='REPLY_WAIT';stdoutCompleted=$stdoutTask.IsCompleted;stderrCompleted=$stderrDone;stderrState=(Get-PublicPeerReadState $stderrTask);childExited=$childExited;localBound=$localBound;sessionPositive=($hello.sessionId -gt 0)}|ConvertTo-Json -Compress));if($stderrDone){Require $false 'REPLY_STDERR_COMPLETED'};if($childExited){Require $false 'REPLY_CHILD_EXITED'};Require $false 'REPLY_LOCAL_BOUND'}
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
import{closeSync}from'node:fs';let pending='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{pending+=x;const end=pending.indexOf('\n');if(end<0)return;const first=pending.slice(0,end);pending='';if(first==='PUBLIC_TRIGGER_LATE_STDERR'){process.stderr.write('PUBLIC_LATE_STDERR');return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDOUT'){closeSync(1);return;}if(first==='PUBLIC_TRIGGER_CLOSE_STDERR'){closeSync(2);return;}const h=JSON.parse(first.replace(/^\uFEFF/,''));const row=(pid,parentPid,ticks,node)=>({pid,parentPid,creationTicks:ticks,sessionId:h.sessionId,imagePath:node?h.nodePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',imageSha256:node?'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237':'a'.repeat(64),imageIdentityKey:node?h.nodeImageIdentityKey:'PUBLIC-SYSTEM-IMAGE',ownerSidSha256:h.ownerSidSha256,signatureStatus:node?'NOT_REQUIRED':'Valid',publisher:node?'':'Microsoft Corporation'});const ancestry={profile:'goriq-owned-node-peer-ancestry-data-v1',effectCapability:false,helper:row(h.nodePid+1000,h.nodePid,String(BigInt(h.nodeCreationTicks)+1n),false),node:row(h.nodePid,h.bootstrapPid,h.nodeCreationTicks,true),bootstrap:row(h.bootstrapPid,3000,h.bootstrapCreationTicks,false)};const reply={schemaVersion:1,kind:'GORIQ_OWNED_NODE_PEER_OS_DATA',sequence:1,sourceRevision:h.sourceRevision,originalGrantSha256:h.originalGrantSha256,nativeMjsSha256:h.nativeMjsSha256,nativePsSha256:h.nativePsSha256,ancestry};const mode=process.env.GORIQ_PUBLIC_PEER_CASE;if(mode==='pid')reply.ancestry.node.pid++;if(mode==='source')reply.nativePsSha256='e'.repeat(64);if(mode==='source-array')reply.nativePsSha256=[reply.nativePsSha256];if(mode==='stderr')process.stderr.write('PUBLIC_ONLY_UNEXPECTED_STDERR');let wire=JSON.stringify(reply);if(mode==='duplicate')wire=wire.replace('"sequence":1','"sequence":2,"sequence":1');process.stdout.write(wire+'\n'+(mode==='extra'?'PUBLIC_EXTRA_FRAME\n':''));});
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
if($ProbeDiagnosticTransport){
 $entryAdapters=@{};foreach($name in @('Get-OwnerCutoverPeerProbePlatform','Get-OwnerCutoverPeerProbeSelfId','Get-OwnerCutoverPeerProbeElapsedMs','Read-OwnerCutoverPeerProcessData')){$entryAdapters[$name]=(Get-Command $name -CommandType Function).ScriptBlock}
 $diagnosticRows=@();$originalConsoleOut=[Console]::Out;$capture=[IO.StringWriter]::new()
 try{[Console]::SetOut($capture);$script:peerCase='success';$null=Get-OwnerCutoverPeerAncestryData}finally{[Console]::SetOut($originalConsoleOut)};Require ($capture.ToString().Length -eq 0) 'DIAGNOSTIC_DEFAULT_NO_PROGRESS';$capture.Dispose()
 foreach($which in @('success','numeric','expiry','raw-error','extra-argument')){
  $script:peerCase=$which;$script:peerTrace.Clear();$script:peerElapsed=0
  if($which -ceq 'raw-error'){
   function Read-OwnerCutoverPeerProcessData {throw [IO.IOException]::new('PRIVATE_CANARY C:\PRIVATE S-1-5-21-111 pid=777')}
  }
  if($which -ceq 'extra-argument'){$refused=$false;try{$null=Get-OwnerCutoverPeerAncestryDiagnosticData 'PRIVATE_CANARY'}catch{$refused=$true};Require $refused 'DIAGNOSTIC_EXTRA_ARGUMENT_REFUSED';continue}
  $capture=[IO.StringWriter]::new();try{[Console]::SetOut($capture);$value=Get-OwnerCutoverPeerAncestryDiagnosticData}finally{[Console]::SetOut($originalConsoleOut)}
  $progress=@($capture.ToString().Split([char]10)|Where-Object {$_});$capture.Dispose();Require ($progress.Count -gt 0 -and $progress.Count -le 96) 'DIAGNOSTIC_BOUNDED_PROGRESS'
  foreach($line in $progress){Require ($line.TrimEnd([char]13) -cmatch '^GORIQ_PUBLIC_PEER_PROBE_PHASE (?:PLATFORM|ROW_READ|PROCESS_QUERY|PROCESS_OPEN|OWNER_QUERY|NATIVE_COMPILE|IMAGE_OPEN|IMAGE_IDENTITY|IMAGE_READ|IMAGE_RECHECK|SIGNATURE|ROW_SHAPE|ROW_BINDING|CHAIN_BINDING|COMPLETE) [0-2]$') 'DIAGNOSTIC_CLOSED_PROGRESS'}
  Require ($value.profile -ceq 'goriq-readonly-peer-probe-diagnostic-v1' -and -not $value.nativeAuthority -and -not $value.effectCapability -and $value.rowIndex -ge 0 -and $value.rowIndex -le 2) 'DIAGNOSTIC_CLOSED_SHAPE'
  if($which -ceq 'success'){Require ($value.ancestryCompleted -and $value.lastEnteredPhase -ceq 'COMPLETE' -and $value.exceptionClass -ceq 'NONE' -and $null -eq $value.actualExceptionHResult) 'DIAGNOSTIC_SUCCESS'}
  elseif($which -ceq 'raw-error'){Require (-not $value.ancestryCompleted -and $value.lastEnteredPhase -ceq 'ROW_READ' -and $value.exceptionClass -ceq 'IO' -and $value.actualExceptionHResult -eq [IO.IOException]::new().HResult) 'DIAGNOSTIC_ACTUAL_IO_HRESULT'}
  else{Require (-not $value.ancestryCompleted -and $value.exceptionClass -ceq 'RUNTIME' -and $value.actualExceptionHResult -is [int]) 'DIAGNOSTIC_REFUSAL';if($which -ceq 'expiry'){Require ($script:peerTrace.Count -eq 1) 'DIAGNOSTIC_NO_IO_AFTER_EXPIRY'}}
  $diagnosticRows+=,$value
 }
 foreach($cut in @('malformed','overflow','expiry','repeat')){
  $script:peerElapsed=0;$state=$script:ownerCutoverPeerProbeState;$state.diagnosticProgress=$true;$state.phase='ROW_READ';$state.index=0;$state.lastProgress='';$state.progressRows=0;$state.progressBytes=0
  if($cut -ceq 'malformed'){$state.phase='PRIVATE_CANARY'}elseif($cut -ceq 'overflow'){$state.progressRows=96}elseif($cut -ceq 'expiry'){$script:peerElapsed=10001}else{$state.lastProgress='ROW_READ 0'}
  $capture=[IO.StringWriter]::new();$refused=$false;try{[Console]::SetOut($capture);try{Write-OwnerCutoverPeerProbeDiagnosticProgress}catch{$refused=$_.Exception.Message -ceq 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'}}finally{[Console]::SetOut($originalConsoleOut)}
  Require ($capture.ToString().Length -eq 0 -and $refused -eq ($cut -cne 'repeat')) 'DIAGNOSTIC_PROGRESS_CUT_NO_OUTPUT';$capture.Dispose()
 }
 Require (($diagnosticRows|ConvertTo-Json -Depth 4 -Compress) -cnotmatch 'PRIVATE_CANARY|S-1-|C:\\PRIVATE') 'DIAGNOSTIC_NO_RAW_ERROR'
 # Portable controls execute the real original functions and their insertion-
 # only counterpart with the same existing TEST-only OS observation adapters.
 # Get-Variable, Remove-Variable and Stopwatch remain original calls in both.
 $entryOriginal=([Text.UTF8Encoding]::new($false,$true)).GetString([IO.File]::ReadAllBytes((Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')));$entryPlan=New-PublicPeerEntryCounterfactual $entryOriginal
 Require ($entryPlan.markerCount -eq 10 -and $entryPlan.insertions -eq 11 -and $entryPlan.restored -ceq $entryOriginal) 'ENTRY_CF_EXACT_INSERTION_REMOVAL_IDENTITY'
 $v1Source=$entryOriginal.Replace('([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))','([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))').Replace('Microsoft.PowerShell.Utility\Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue','Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue')
 $v2Source=$v1Source.Replace('([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))','([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))').Replace('Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue','Microsoft.PowerShell.Utility\Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue')
 $v1Plan=New-PublicPeerEntryCounterfactual $v1Source;$v2Plan=New-PublicPeerEntryCounterfactual $v2Source;Require ($v1Plan.flagAccessVersion -eq 1 -and $v2Plan.flagAccessVersion -eq 2 -and $v1Plan.restored -ceq $v1Source -and $v2Plan.restored -ceq $v2Source) 'ENTRY_CF_BOTH_EXACT_PAIRED_VERSIONS'
 foreach($badAccess in @($v1Source.Replace('([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))','([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))'),$v1Source.Replace('Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue','Microsoft.PowerShell.Utility\Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue'),$v2Source.Replace('Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest','PUBLIC_UNKNOWN\Get-Variable ownerCutoverPeerProbeDiagnosticRequest'),($v2Source+'([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))'))){$closed=$false;try{$null=New-PublicPeerEntryCounterfactual $badAccess}catch{$closed=$true};Require $closed 'ENTRY_CF_MIXED_UNKNOWN_DUPLICATE_ACCESS_REFUSED'}
 $entryReplay=&{param($Fragment,$Bytes) $b=$Bytes;.([scriptblock]::Create($Fragment));return $counterfactualSource} $entryPlan.fragment ([Text.Encoding]::UTF8.GetBytes($entryOriginal));Require ($entryReplay -ceq $entryPlan.source) 'ENTRY_CF_HELPER_FRAGMENT_EXACT'
 $fragmentTokens=$null;$fragmentErrors=$null;$fragmentAst=[Management.Automation.Language.Parser]::ParseInput($entryPlan.fragment,[ref]$fragmentTokens,[ref]$fragmentErrors);Require ($fragmentErrors.Count -eq 0 -and @($fragmentAst.FindAll({param($a) $a -is [Management.Automation.Language.CommandAst]},$true)).Count -eq 0) 'ENTRY_CF_NO_CMDLET_PROVIDER_OR_WARMUP_IN_HELPER_FRAGMENT'
 foreach($badSource in @('',($entryOriginal+'Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue'),$entryOriginal.Replace($entryPlan.flagExpression,'PUBLIC_CHANGED_FLAG_ANCHOR'))){$closed=$false;try{$null=New-PublicPeerEntryCounterfactual $badSource}catch{$closed=$true};Require $closed 'ENTRY_CF_CHANGED_SOURCE_ANCHOR_REFUSED'}
 $entryAsts=@();foreach($text in @($entryOriginal,$entryPlan.source)){$tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$parseErrors);Require ($parseErrors.Count -eq 0) 'ENTRY_CF_PARSE';$entryAsts+=,$ast}
 foreach($name in @('Get-OwnerCutoverPeerAncestryData','Get-OwnerCutoverPeerAncestryDiagnosticData')){
  $inventories=@();foreach($ast in $entryAsts){$f=@($ast.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq $name},$true));Require ($f.Count -eq 1) 'ENTRY_CF_ONE_ORIGINAL_FUNCTION';$inventory=@($f[0].FindAll({param($a) $a -is [Management.Automation.Language.CommandAst]},$true)|ForEach-Object {$_.GetCommandName()}|Sort-Object);$inventories+=,($inventory -join '|');if($name -ceq 'Get-OwnerCutoverPeerAncestryData'){Require (@($inventory|Where-Object {$_ -ceq $entryPlan.getCommand}).Count -eq 1 -and @($f[0].FindAll({param($a) $a -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $a.Expression.Extent.Text -ceq '[Diagnostics.Stopwatch]' -and $a.Member.Extent.Text -ceq 'StartNew'},$true)).Count -eq 1) 'ENTRY_CF_ORIGINAL_COMMAND_CALL_COUNTS'}else{Require (@($inventory|Where-Object {$_ -ceq $entryPlan.removeCommand}).Count -eq 1 -and @($inventory|Where-Object {$_ -ceq 'Get-OwnerCutoverPeerAncestryData'}).Count -eq 1) 'ENTRY_CF_ORIGINAL_COMMAND_CALL_COUNTS'}}
  Require ($inventories[0] -ceq $inventories[1]) 'ENTRY_CF_COMMAND_CLOSURE_EXACT'
 }
 foreach($entryVersion in @(@{original=$v1Source;plan=$v1Plan},@{original=$v2Source;plan=$v2Plan})){
 foreach($entryCase in @('success','numeric','expiry','raw-error')){
  $observations=@();foreach($text in @($entryVersion.original,$entryVersion.plan.source)){
   $script:peerCase=$entryCase;$script:peerTrace.Clear();$script:peerElapsed=0;$capture=[IO.StringWriter]::new()
   try{[Console]::SetOut($capture);$value=&{param($Source,$Adapters,$Case)
    .([scriptblock]::Create($Source));foreach($name in $Adapters.Keys){Set-Item -Path ('function:'+ $name) -Value $Adapters[$name]}
    if($Case -ceq 'raw-error'){function Read-OwnerCutoverPeerProcessData {throw [IO.IOException]::new('PRIVATE_CANARY C:\PRIVATE S-1-5-21-111 pid=777')}}
    $result=Get-OwnerCutoverPeerAncestryDiagnosticData;Require ($null -eq (Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue)) 'ENTRY_CF_CLEANUP_ORIGINAL_CALL';return $result
   } $text $entryAdapters $entryCase}finally{[Console]::SetOut($originalConsoleOut)}
   $lines=@($capture.ToString().Split([char]10)|Where-Object {$_});$plain=@($lines|Where-Object {-not $_.StartsWith('GORIQ_PUBLIC_PEER_CAPSULE_PHASE ')}) -join "`n";$capture.Dispose();$observations+=@{json=($value|ConvertTo-Json -Depth 4 -Compress);trace=($script:peerTrace -join ',');plain=$plain;markers=@($lines|Where-Object {$_.StartsWith('GORIQ_PUBLIC_PEER_CAPSULE_PHASE ')})}
  }
  Require ($observations[0].json -ceq $observations[1].json -and $observations[0].trace -ceq $observations[1].trace -and $observations[0].plain -ceq $observations[1].plain -and $observations[0].markers.Count -eq 0 -and $observations[1].markers.Count -eq 9) 'ENTRY_CF_DIFFERENTIAL_OBSERVATIONS'
 }
 }
 @{pass=$true;diagnosticCases=5;nativeAuthority=$false;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}
$cases=@('success','cycle','owner','session','node-hash','signature','image','numeric','creation','newer-parent','extra','expiry');$rows=@()
foreach($which in $cases){$script:peerCase=$which;$script:peerTrace.Clear();$script:peerElapsed=0
 if($which -ceq 'success'){$proof=Get-OwnerCutoverPeerAncestryData;Require ($proof.profile -ceq 'goriq-owned-node-peer-ancestry-data-v1' -and -not $proof.effectCapability -and $proof.helper.pid -eq 3101 -and $proof.node.pid -eq 3102 -and $proof.bootstrap.pid -eq 3103) 'DERIVED_CHAIN_DATA';Require (($script:peerTrace -join ',') -ceq '3101,3102,3103') 'ONLY_DERIVED_THREE_IDS'}else{$refused=$false;try{Get-OwnerCutoverPeerAncestryData|Out-Null}catch{$refused=$_.Exception.Message -ceq 'ROTATION_CUTOVER_PEER_PROOF_REJECTED'};Require $refused ('CLOSED_'+$which);if($which -ceq 'expiry'){Require ($script:peerTrace.Count -eq 1) 'NO_SECOND_OS_READ_AFTER_READONLY_EXPIRY'}}
 $rows+=@{case=$which;expected=$(if($which -ceq 'success'){'DATA_ONLY'}else{'REFUSE'})}
}
[ordered]@{pass=$true;cases=$rows;actualNativeCalls=0;authority=$false}|ConvertTo-Json -Depth 4 -Compress

# Frozen qualification corpus: two parameter bindings differ from private RED.
 $qualifiedFlagControls=@'
param([string]$NativePath,[string]$FixturePath)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$fixture=$FixturePath
function Definition([string]$File,[string]$Name){$t=$null;$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($File,[ref]$t,[ref]$e);if($e.Count){throw 'PUBLIC_CORPUS_PARSE'};$f=@($a.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $Name -and $n.Parent -is [Management.Automation.Language.NamedBlockAst]},$true));if($f.Count -ne 1){throw 'PUBLIC_CORPUS_DEFINITION'};return $f[0].Extent.Text}
$source=[IO.File]::ReadAllText($NativePath);$oldGet='([bool](Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))';$newGet='([bool](Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ValueOnly -ErrorAction SilentlyContinue))';$oldRemove='Remove-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue';$newRemove='Microsoft.PowerShell.Utility\'+$oldRemove
if($source.Contains($newGet)){$currentGet=$newGet}else{if(-not $source.Contains($oldGet)){throw 'PUBLIC_SOURCE_GET_FORM'};$currentGet=$oldGet};if($source.Contains($newRemove)){$currentRemove=$newRemove}else{if(-not $source.Contains($oldRemove)){throw 'PUBLIC_SOURCE_REMOVE_FORM'};$currentRemove=$oldRemove}
$rows=@();foreach($kind in @('absent','null','false','true','empty-array','one-false','two-false','zero','one','private','allscope','readonly','constant')){
 $value=switch($kind){'null'{$null}'false'{$false}'empty-array'{,@()}'one-false'{,@($false)}'two-false'{,@($false,$false)}'zero'{0}'one'{1}default{$true}}
 foreach($cleanup in @('old','qualified')){
  $module=New-Module -ArgumentList @($kind,$value,$oldGet,$newGet,$oldRemove,$newRemove) -ScriptBlock {param($Kind,$Value,$OldGet,$NewGet,$OldRemove,$NewRemove)
   $ErrorActionPreference='Stop';Set-StrictMode -Version Latest
   if($Kind -cne 'absent'){$option=switch($Kind){'private'{[Management.Automation.ScopedItemOptions]::Private}'allscope'{[Management.Automation.ScopedItemOptions]::AllScope}'readonly'{[Management.Automation.ScopedItemOptions]::ReadOnly}'constant'{[Management.Automation.ScopedItemOptions]::Constant}default{[Management.Automation.ScopedItemOptions]::None}};New-Variable -Name ownerCutoverPeerProbeDiagnosticRequest -Scope Script -Value $Value -Option $option}
   .([scriptblock]::Create(('function Read-Old {return '+$OldGet+'};function Read-Qualified {return '+$NewGet+'};function Clear-Old {'+$OldRemove+'};function Clear-Qualified {'+$NewRemove+'}')))
   function Read-Nested {$local:ownerCutoverPeerProbeDiagnosticRequest='PUBLIC_LOCAL_SHADOW';return @{old=(Read-Old);qualified=(Read-Qualified)}}
  }
  $row=&$module {param($Cleanup,$Kind)
   $nested=Read-Nested;$old=Read-Old;$qualified=Read-Qualified;$same=$old -eq $qualified -and $nested.old -eq $old -and $nested.qualified -eq $qualified
   $before=Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue
   $prior=$Error.Count;if($Cleanup -ceq 'old'){Clear-Old}else{Clear-Qualified};$count=$Error.Count-$prior;$fqid=if($count){$Error[0].FullyQualifiedErrorId}else{'NONE'}
   $after=Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue
   return @{kind=$Kind;cleanup=$Cleanup;old=$old;qualified=$qualified;nestedSame=$same;remains=($null -ne $after);errorCount=$count;errorId=$fqid;variableIdentityPreserved=($null -eq $after -or [object]::ReferenceEquals($before,$after))}
  } $cleanup $kind
  $rows+=,$row
 }
}
$normalPass=$true;foreach($kind in @('absent','null','false','true','empty-array','one-false','two-false','zero','one','private','allscope','readonly','constant')){$pair=@($rows|Where-Object {$_.kind -ceq $kind});if($pair.Count -ne 2 -or -not $pair[0].nestedSame -or -not $pair[1].nestedSame -or $pair[0].remains -ne $pair[1].remains -or $pair[0].errorCount -ne $pair[1].errorCount -or $pair[0].errorId -cne $pair[1].errorId -or -not $pair[0].variableIdentityPreserved -or -not $pair[1].variableIdentityPreserved){$normalPass=$false}}
$definitions='';foreach($n in @('Assert-OwnerRotationEntryShape','Get-OwnerCutoverPeerAncestryData','Get-OwnerCutoverPeerAncestryDiagnosticData','Write-OwnerCutoverPeerProbeDiagnosticProgress','Assert-OwnerCutoverPeerProbeBudget')){$definitions+=(Definition $NativePath $n)+"`n"};foreach($n in @('Get-OwnerCutoverPeerProbePlatform','Get-OwnerCutoverPeerProbeSelfId','Get-OwnerCutoverPeerProbeElapsedMs','Read-OwnerCutoverPeerProcessData')){$definitions+=(Definition $fixture $n)+"`n"}
# The only resolver trap is last, in its own disposable module. These fixed
# public fakes model unavailable UNQUALIFIED resolution, never the Windows cause.
$counter=New-Module -ArgumentList $definitions -ScriptBlock {param($Definitions)
 .([scriptblock]::Create($Definitions));$script:peerCase='success';$script:peerTrace=[Collections.Generic.List[int]]::new();$script:peerElapsed=[long]0;$script:gets=0;$script:removes=0
 function Get-Variable {[CmdletBinding()]param([Parameter(Position=0)][string]$Name,[string]$Scope,[switch]$ValueOnly) if($Name -cne 'ownerCutoverPeerProbeDiagnosticRequest'){throw 'PUBLIC_TRAP_SCOPE'};$script:gets++;throw 'PUBLIC_UNQUALIFIED_RESOLVER_UNAVAILABLE'}
 function Remove-Variable {[CmdletBinding()]param([Parameter(Position=0)][string]$Name,[string]$Scope) if($Name -cne 'ownerCutoverPeerProbeDiagnosticRequest'){throw 'PUBLIC_TRAP_SCOPE'};$script:removes++;throw 'PUBLIC_UNQUALIFIED_RESOLVER_UNAVAILABLE'}
 function Run-Counter { $capture=[IO.StringWriter]::new();$out=[Console]::Out;$value=$null;$refused=$false;try{[Console]::SetOut($capture);$value=Get-OwnerCutoverPeerAncestryDiagnosticData}catch{$refused=$true}finally{[Console]::SetOut($out);$capture.Dispose()};$flag=Microsoft.PowerShell.Utility\Get-Variable ownerCutoverPeerProbeDiagnosticRequest -Scope Script -ErrorAction SilentlyContinue;return @{returned=(-not $refused);completed=($null -ne $value -and $value.ancestryCompleted);cleaned=($null -eq $flag);getResolverTrapHits=$script:gets;removeResolverTrapHits=$script:removes;observationCount=$script:peerTrace.Count}}
}
$result=&$counter {Run-Counter};$counterPass=$result.returned -and $result.completed -and $result.cleaned -and $result.getResolverTrapHits -eq 0 -and $result.removeResolverTrapHits -eq 0 -and $result.observationCount -eq 3
@{profile='goriq-public-qualified-flag-regression-v1';normalRows=$rows;normalEquivalence=$normalPass;counterfactual=$result;counterfactualPass=$counterPass;pass=($normalPass -and $counterPass);meaning='UNQUALIFIED_RESOLVER_TRAP_NOT_PROVED_WINDOWS_CAUSE';actualWindows=$false;nativeAuthority=$false;actualNativeCalls=0}|ConvertTo-Json -Depth 6 -Compress
if(-not $normalPass -or -not $counterPass){exit 1}
'@

# Frozen legal own-System folder DATA corpus; only Root is bound by its caller.
 $platformCaseControls=@'
param([string]$Root)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. (Join-Path $Root 'scripts/owner-code-rotation-native-1218.ps1')
$fixture=Join-Path $Root 'tests/owner-code-cutover-peer.fixture.ps1';$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($fixture,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'PUBLIC_PARSE'}
foreach($name in @('Get-OwnerCutoverPeerProbeSelfId','Get-OwnerCutoverPeerProbeElapsedMs','Read-OwnerCutoverPeerProcessData')){$f=@($ast.FindAll({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -ceq $name -and $a.Parent -is [Management.Automation.Language.NamedBlockAst]},$true));if($f.Count -ne 1){throw 'PUBLIC_DEFINITION'};.([scriptblock]::Create($f[0].Extent.Text))}
$script:peerTrace=[Collections.Generic.List[int]]::new();$script:peerElapsed=[long]0;$script:peerCase='success'
function Get-OwnerCutoverPeerProbePlatform {return @{windows=$script:caseWindows;major=$script:caseMajor;nativeSystem=$script:caseSystem}}
$cases=@(@{id='canonical';system='C:\Windows\System32';valid=$true},@{id='lower-system';system='C:\Windows\system32';valid=$true},@{id='mixed-system';system='c:\wInDoWs\sYsTeM32';valid=$true},@{id='suffix';system='C:\Windows\System320';valid=$false},@{id='child';system='C:\Windows\System32\child';valid=$false},@{id='unc';system='\\server\share\System32';valid=$false},@{id='colon';system='C:\Windows:System32';valid=$false},@{id='not-windows';system='C:\Windows\System32';valid=$false;windows=$false},@{id='major-seven';system='C:\Windows\System32';valid=$false;major=7},@{id='number';system=123;valid=$false})
$rows=@();foreach($case in $cases){$script:caseSystem=$case.system;$script:caseWindows=$true;$script:caseMajor=[int]5;if($case.ContainsKey('windows')){$script:caseWindows=$case.windows};if($case.ContainsKey('major')){$script:caseMajor=$case.major};$script:peerTrace.Clear();$caught=$false;try{$value=Get-OwnerCutoverPeerAncestryData}catch{$caught=$true};$rows+=@{id=$case.id;expectedData=$case.valid;returned=(-not $caught);lastPhase=$script:ownerCutoverPeerProbeState.phase;observationCount=$script:peerTrace.Count;pass=(((-not $caught) -eq $case.valid) -and $script:peerTrace.Count -eq $(if($case.valid){3}else{0}))}}
@{profile='goriq-public-platform-case-regression-v1';rows=$rows;pass=@($rows|Where-Object {-not $_.pass}).Count -eq 0;actualNativeCalls=0;nativeAuthority=$false;meaning='LEGAL_DATA_COUNTEREXAMPLE_NOT_ACTUAL_WINDOWS_PATH_OBSERVATION'}|ConvertTo-Json -Depth 5 -Compress
if(@($rows|Where-Object {-not $_.pass}).Count){exit 1}
'@

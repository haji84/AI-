param([ValidateSet('kernel','clock','scope','default','denials','stage','node','archive','configuration','validator-child','journal','entry','kernel-producers','all')][string]$Scenario='kernel',[string]$FixtureInput='')
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path $PSScriptRoot;. (Join-Path $root 'scripts/owner-code-rotation-native-1218.ps1')
if(-not (Get-Command Get-OwnerCutoverPublicReadiness -ErrorAction SilentlyContinue)){throw 'CUTOVER_PUBLIC_READINESS_MISSING'}
function Require([bool]$Value,[string]$Code){if(-not $Value){throw ('CUTOVER_BOOTSTRAP_FIXTURE_'+$Code)}}
$inputText=if($FixtureInput){$FixtureInput}else{[Console]::In.ReadToEnd()};$inputData=$inputText|ConvertFrom-Json;$script:baseNow=[datetimeoffset]::Parse($inputData.now);$script:utc=$script:baseNow;$script:stamp=[long]10000000;$script:case='';$script:calls=[Collections.Generic.List[string]]::new();$script:stage='';$script:run=0
function Get-OwnerCutoverUtcNow {$script:utc}
function Get-OwnerCutoverMonotonicStamp {$script:stamp}
function Get-OwnerCutoverMonotonicFrequency {$script:frequency}
$script:realPublicGetter=(Get-Command Get-OwnerCutoverBootstrapPublicResource).ScriptBlock
function Get-OwnerCutoverBootstrapPublicResource([string]$Uri){
 [void]$script:calls.Add($Uri);if($script:case -eq 'transport'){throw 'PUBLIC_FAKE_PRIVATE_TRANSPORT_CANARY'};if($script:case -eq 'slow'){$script:stamp+=880000};if($script:case -eq 'provisional' -and $script:calls.Count -le 2){$script:stamp+=2000;$script:utc=$script:utc.AddSeconds(2)}
 $prefix='https://api.github.com/repos/haji84/AI-/'
 if($Uri -ceq ($prefix+'actions/runs/'+$script:run)){$value=@{id=$script:run;run_attempt=1;name='GORIQ Owner Code 1218 Bounded Native Acceptance';path='.github/workflows/gai-zbook-diagnostic-1218.yml';event='workflow_dispatch';head_sha=('a'*40);head_branch='main';status='in_progress';conclusion=$null;repository=@{full_name='haji84/AI-'};actor=@{login='haji84'}};if($script:case -eq 'native-event'){$value.event='push'};if($script:case -eq 'attempt'){$value.run_attempt=2}}
 elseif($Uri -ceq ($prefix+'actions/runs/'+$script:run+'/attempts/1/jobs?per_page=100')){$job=@{id=(50000+$script:run);run_id=$script:run;run_attempt=1;name='inspect';head_sha=('a'*40);status='in_progress';conclusion=$null;labels=@('self-hosted','Windows','X64');started_at=$script:baseNow.AddSeconds(-20).ToString('yyyy-MM-ddTHH:mm:ssZ');completed_at=$null};if($script:case -eq 'provisional'){$job.started_at=$script:baseNow.AddSeconds(1).ToString('yyyy-MM-ddTHH:mm:ssZ')};if($script:case -eq 'future-start'){$job.started_at=$script:baseNow.AddSeconds(20).ToString('yyyy-MM-ddTHH:mm:ssZ')};if($script:case -eq 'labels'){$job.labels=@('ubuntu-latest')};$value=@{total_count=$(if($script:case -eq 'job-count'){2}else{1});jobs=@($job)}}
 elseif($Uri -ceq ($prefix+'git/ref/heads/main')){$value=@{object=@{sha=$(if($script:case -eq 'main'){'f'*40}else{'a'*40})}}}
 elseif($Uri -ceq ($prefix+'actions/runs/1001')){$value=@{id=1001;run_attempt=1;name='CI';path='.github/workflows/ci.yml';event=$(if($script:case -eq 'ci-event'){'workflow_dispatch'}else{'push'});head_sha=('a'*40);head_branch='main';status='completed';conclusion='success'}}
 elseif($Uri -ceq ($prefix+'actions/runs/1001/attempts/1/jobs?per_page=100')){$jobs=@(foreach($n in @('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures')){@{name=$n;status='completed';conclusion='success'}});if($script:case -eq 'ci-job'){$jobs[0].conclusion='failure'};$value=@{total_count=$(if($script:case -eq 'ci-count'){5}else{4});jobs=$jobs}}
 elseif($Uri.StartsWith(('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/'))){$path=$Uri.Substring(('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/').Length);Require ($path -cin @($script:grant.sourceHashes.PSObject.Properties.Name)+@('.github/workflows/gai-zbook-diagnostic-1218.yml')) 'FIXED_SOURCE_URL';if($script:case -eq 'source-oversize'){return ,(New-Object byte[] 1048577)};$b=[IO.File]::ReadAllBytes((Join-Path $root $path));if($script:case -eq 'remote-source'){$b=[Text.Encoding]::UTF8.GetBytes('PUBLIC_SOURCE_MISMATCH')};return ,$b}
 else{throw 'UNEXPECTED_PUBLIC_URL'}
 return ,[Text.Encoding]::UTF8.GetBytes(($value|ConvertTo-Json -Depth 8 -Compress))
}
function Setup([int]$Index){$script:utc=$script:baseNow;$script:stamp=[long]10000000;$script:frequency=[long]1000;$script:run=[long](12345000+$Index);$script:case='';$script:calls.Clear();$script:grant=ConvertFrom-OwnerRotationEntryJson ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($inputData.encoded)));$dir=[IO.Path]::Combine([IO.Path]::GetTempPath(),('public-bootstrap-'+[IO.Path]::GetRandomFileName()));$script:stage=[IO.Path]::Combine($dir,('owner-native-'+$script:run+'-1'));$null=[IO.Directory]::CreateDirectory($script:stage);foreach($path in @($script:grant.sourceHashes.PSObject.Properties.Name)+@('.github/workflows/gai-zbook-diagnostic-1218.yml')){$target=Join-Path $script:stage $path;$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target));[IO.File]::Copy((Join-Path $root $path),$target)};foreach($property in $inputData.environment.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value)};$env:GITHUB_RUN_ID=[string]$script:run;$env:GITHUB_WORKSPACE=$dir;$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64=$inputData.encoded;$env:JARVIS_PRODUCTION_CONFIG='';Push-Location $script:stage;return $dir}
function Refused([scriptblock]$Action){$caught=$false;try{&$Action|Out-Null}catch{$caught=$true};Require $caught 'EXPECTED_REFUSAL'}
function Close([string]$Dir){Pop-Location;[IO.Directory]::Delete($Dir,$true)}

$script:owner='S-1-5-21-111-222-333-1001';$script:ownerHash=Get-OwnerRotationEntryDigest ([Text.Encoding]::UTF8.GetBytes($script:owner))
function PrivateSetup([int]$Index){$dir=Setup $Index;$script:grant.ownerSidSha256=$script:ownerHash;$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerRotationEntryJson $script:grant)));return $dir}
# One owned PS process runs all fixed public scenarios; assertions remain in
# each scenario and no producer cases are skipped. Direct individual scenarios
# remain available for focused diagnosis. This is test transport only.
if($Scenario -ceq 'all'){
 $rows=[ordered]@{}
 foreach($name in @('kernel','scope','clock','default','denials','stage','node','archive','configuration','validator-child','journal','entry','kernel-producers')){
  $wire=&$PSCommandPath -Scenario $name -FixtureInput $inputText
  $rows[$name]=($wire|ConvertFrom-Json)
 }
 $rows|ConvertTo-Json -Depth 8 -Compress;return
}

function InstallFixtureKernel($Module){
 &$Module {
  $script:kernelCase='';$script:kernelCalls=[Collections.Generic.List[string]]::new()
  function script:Get-OwnerCutoverKernelPlatform {[void]$script:kernelCalls.Add('platform');if($script:kernelCase -eq 'cross'){$null=&$script:fixtureExpire};return @{windows=$true;major=$(if($script:kernelCase -eq 'typed'){[string]'5'}else{5});languageMode='FullLanguage';separator=92}}
  function script:Get-OwnerCutoverKernelProcess {[void]$script:kernelCalls.Add('process');return @{pid=451;creationTicks='638980000000000000';sessionId=$(if($script:kernelCase -eq 'session'){0}else{2});interactive=($script:kernelCase -ne 'interactive');actual='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';fixed='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'}}
  function script:Get-OwnerCutoverKernelIdentity {[void]$script:kernelCalls.Add('identity');return @{sid=$(if($script:kernelCase -eq 'owner'){'S-1-5-21-111-222-333-1002'}else{'S-1-5-21-111-222-333-1001'});isSystem=($script:kernelCase -eq 'system')}}
  function script:Get-OwnerCutoverKernelFolders {[void]$script:kernelCalls.Add('folders');return @{profile='C:\Users\Owner';localAppData='C:\Users\Owner\AppData\Local';environmentProfile=$(if($script:kernelCase -eq 'folder'){'C:\Users\Other'}else{'C:\Users\Owner'});environmentLocalAppData='C:\Users\Owner\AppData\Local'}}
  function script:Get-OwnerCutoverKernelSignature([string]$Path){[void]$script:kernelCalls.Add('signature');return @{status=$(if($script:kernelCase -eq 'signature'){'UnknownError'}else{'Valid'});subject='CN=Microsoft Windows, O=Microsoft Corporation, C=US'}}
 }
}
# This factory alone is a test wrapper: the product constructor receives no
# kernel callback, flags or module object. Every OS fake remains in this file.
$factory=(Get-Command New-OwnerCutoverPrivateModule -ErrorAction SilentlyContinue)
if($factory){$script:realPrivateFactory=$factory.ScriptBlock;function New-OwnerCutoverPrivateModule($State){$module=&$script:realPrivateFactory $State;&$module {$script:actualKernelProcessProducer=(Get-Command Get-OwnerCutoverKernelProcess).ScriptBlock;$script:actualKernelFoldersProducer=(Get-Command Get-OwnerCutoverKernelFolders).ScriptBlock};if($Scenario -cne 'default'){InstallFixtureKernel $module;if($Scenario -cin @('stage','node','archive','configuration','journal','entry')){InstallFixtureSource $module};if($Scenario -cin @('node','configuration','journal','entry')){InstallFixtureNode $module};if($Scenario -cin @('configuration','journal','entry')){InstallFixtureConfiguration $module}};return $module}}

function InstallFixtureSource($Module){
 &$Module {
  $script:memoryFiles=@{};$script:memoryDirs=@{'C:\'=$true;'C:\Users'=$true;'C:\Users\Owner'=$true};$script:writes=[Collections.Generic.List[string]]::new();$script:stageCase='';$script:identities=@{};$script:nextIdentity=0
  function script:Get-OwnerCutoverPathObservation([string]$Path){
   $present=$script:memoryDirs.ContainsKey($Path) -or $script:memoryFiles.ContainsKey($Path)
   if(-not $present){return @{exists=$false}}
   $aces=@(@{allow=$true;sid='S-1-5-21-111-222-333-1001';rights=[long]2032127})
   if($script:stageCase -eq 'writer' -and $Path -ceq 'C:\Users\Owner'){$aces+=@{allow=$true;sid='S-1-5-21-111-222-333-1999';rights=[long]2}}
   return @{exists=$true;directory=$script:memoryDirs.ContainsKey($Path);reparse=($script:stageCase -eq 'reparse' -and $Path -ceq 'C:\Users');fullPath=$Path;ownerSid='S-1-5-21-111-222-333-1001';aces=$aces}
  }
  function script:Open-OwnerCutoverParentHandles([string]$Path){Assert-OwnerCutoverPrivateClock}
  function script:New-OwnerCutoverPrivateDirectory([string]$Path){if($script:memoryDirs.ContainsKey($Path) -or $script:memoryFiles.ContainsKey($Path)){throw 'OWNED_FIXTURE_CREATE_NEW'};$script:memoryDirs[$Path]=$true;[void]$script:writes.Add($Path)}
  function script:New-OwnerCutoverPrivateFile([string]$Path,[byte[]]$Bytes){if($script:memoryDirs.ContainsKey($Path) -or $script:memoryFiles.ContainsKey($Path)){throw 'OWNED_FIXTURE_CREATE_NEW'};$script:memoryFiles[$Path]=[byte[]]$Bytes.Clone();$script:nextIdentity++;$script:identities[$Path]=[string]$script:nextIdentity;[void]$script:writes.Add($Path);if(($script:stageCase -eq 'claimthrow' -and $Path.EndsWith('.claim')) -or ($script:stageCase -eq 'journalthrow' -and $Path.EndsWith('cutover-journal.json'))){throw 'OWNED_FIXTURE_AMBIGUOUS_CREATE'}}
  function script:Open-OwnerCutoverImmutableFile([string]$Path){$bytes=[byte[]]$script:memoryFiles[$Path].Clone();if($script:stageCase -eq 'bytes' -and $Path.EndsWith('owner-code-rotation-worker.ps1')){$bytes=[Text.Encoding]::UTF8.GetBytes('PUBLIC_TAMPER')};return [IO.MemoryStream]::new($bytes,$false)}
  function script:Get-OwnerCutoverFileIdentity($Stream,[string]$Path){return @{key=$script:identities[$Path];finalPath=$Path;links=$(if($script:stageCase -eq 'links'){2}else{1})}}
 }
}



function InstallFixtureConfiguration($Module){
 &$Module {
  $script:configurationCase='';$script:decryptCalls=0;$script:validatorCalls=0;$script:mutableOpens=0;$script:mutableClosed=0
  $script:configurationFake=[pscustomobject]@{version=1;commit=('c'*40);releaseRoot='D:\Installed\release-current';environment=[pscustomobject]@{JARVIS_DB_PATH='C:\Users\Owner\JARVIS\production\broker.sqlite';JARVIS_OWNER_SECRET='PUBLIC_SECRET_CANARY_NOT_FOR_OUTPUT'}}
  foreach($dirName in @('C:\Users\Owner\JARVIS','C:\Users\Owner\JARVIS\production','C:\Users\Owner\JARVIS\tools','C:\Users\Owner\JARVIS\tools\node-v24.19.0-win-x64','D:\','D:\Installed','D:\Installed\release-current','D:\Installed\release-current\.next','D:\Installed\release-current\scripts')){$script:memoryDirs[$dirName]=$true}
  $contents=@{'C:\Users\Owner\JARVIS\production\config.dpapi'='PUBLIC_DPAPI_CIPHERTEXT_FAKE';'C:\Users\Owner\JARVIS\production\broker.sqlite'='PUBLIC_DB_FAKE';'C:\Users\Owner\JARVIS\production\broker.sqlite.pc-tasks.json'='[]';'D:\Installed\release-current\jarvis-release.json'='{"commit":"cccccccccccccccccccccccccccccccccccccccc"}';'D:\Installed\release-current\.next\BUILD_ID'='PUBLIC_BUILD';'D:\Installed\release-current\scripts\jarvis-remote-host.mjs'='PUBLIC_INSTALLED_HOST';'C:\Users\Owner\JARVIS\tools\node-v24.19.0-win-x64\node.exe'='PUBLIC_OS_IMAGE_OBSERVATION_FAKE'}
  foreach($key in $contents.Keys){$script:memoryFiles[$key]=[Text.Encoding]::UTF8.GetBytes($contents[$key]);$script:identities[$key]='context-'+$key}
  function script:Open-OwnerCutoverMutableFile([string]$Path){$script:mutableOpens++;return [IO.MemoryStream]::new([byte[]]$script:memoryFiles[$Path],$false)}
  function script:Get-OwnerCutoverMutableAclHash([string]$Path){return ('a'*64)}
  function script:ConvertFrom-OwnerCutoverProtectedConfiguration([byte[]]$Bytes){$script:decryptCalls++;if($script:configurationCase -ceq 'decrypt'){throw 'PUBLIC_DECRYPT_PRIVATE_CANARY'};if($script:configurationCase -ceq 'config-change'){$script:memoryFiles['C:\Users\Owner\JARVIS\production\config.dpapi']=[Text.Encoding]::UTF8.GetBytes('CHANGED_CIPHERTEXT')};return @{configuration=$script:configurationFake;plaintext=($script:configurationFake|ConvertTo-Json -Depth 6 -Compress)}}
  function script:Invoke-OwnerCutoverConfigurationValidator([string]$Json,[string]$ReleaseRoot,[string]$StateRoot){$script:validatorCalls++;if($ReleaseRoot -cne 'D:\Installed\release-current' -or $StateRoot -cne 'C:\Users\Owner\JARVIS\production' -or $script:configurationCase -ceq 'validator'){throw 'PUBLIC_VALIDATOR_PRIVATE_CANARY'}}
 }
}


if($Scenario -eq 'kernel-producers'){
 Add-Type @'
using System;public static class CutoverKernelLeafTrace {public static Action Cross;public static int Id,Start,Session,Module,Folders,Disposed;public static void Reset(){Id=Start=Session=Module=Folders=Disposed=0;Cross=null;}}
public class CutoverKernelLeafProcess:IDisposable {public int Id{get{CutoverKernelLeafTrace.Id++;return 451;}}public DateTime StartTime{get{CutoverKernelLeafTrace.Start++;if(CutoverKernelLeafTrace.Cross!=null)CutoverKernelLeafTrace.Cross();return new DateTime(2026,11,6,17,0,0,DateTimeKind.Utc);}}public int SessionId{get{CutoverKernelLeafTrace.Session++;return 2;}}public CutoverKernelLeafModule MainModule{get{CutoverKernelLeafTrace.Module++;return new CutoverKernelLeafModule();}}public void Dispose(){CutoverKernelLeafTrace.Disposed++;}}
public class CutoverKernelLeafModule{public string FileName{get{return "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";}}}
'@|Out-Null
 $index=1800;foreach($caseName in @('process','folders')){$index++;$dir=PrivateSetup $index;try{
  $public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;[CutoverKernelLeafTrace]::Reset();function ExpireFixtureClock {$script:stamp+=880001};[CutoverKernelLeafTrace]::Cross=[System.Action](Get-Command ExpireFixtureClock).ScriptBlock
  &$module {function script:Get-OwnerCutoverCurrentProcess {return [CutoverKernelLeafProcess]::new()};function script:Get-OwnerCutoverKnownFolder([string]$Name){[CutoverKernelLeafTrace]::Folders++;if([CutoverKernelLeafTrace]::Folders -eq 1){[CutoverKernelLeafTrace]::Cross.Invoke()};return 'C:\Users\Owner'}}
  if($caseName -ceq 'process'){Refused {&$module {&$script:actualKernelProcessProducer}};Require ([CutoverKernelLeafTrace]::Id -eq 1 -and [CutoverKernelLeafTrace]::Start -eq 1 -and [CutoverKernelLeafTrace]::Session -eq 0 -and [CutoverKernelLeafTrace]::Module -eq 0 -and [CutoverKernelLeafTrace]::Disposed -eq 1) 'NO_PROCESS_GETTER_AFTER_ORIGINAL_EXPIRY'}else{Refused {&$module {&$script:actualKernelFoldersProducer}};Require ([CutoverKernelLeafTrace]::Folders -eq 1) 'NO_SECOND_KNOWN_FOLDER_AFTER_EXPIRY'}
 }finally{Close $dir}}
 @{pass=$true;leafCases=@('process','folders');actualNativeCalls=0}|ConvertTo-Json -Compress;return
}


# PUBLIC fixture diagnostic only. No message, source line, stack, JSON input,
# stream content, path or identifier enters these bounded facts.
function Get-CutoverPublicTypeName($Value){if($null -eq $Value){return $null};$name=$Value.GetType().FullName;if($name -isnot [string] -or $name.Length -gt 192 -or $name -cnotmatch '^[A-Za-z0-9_.+`\[\], =-]+$'){return 'OTHER_CLR_TYPE'};return $name}
function Get-CutoverPublicValidatorLeafFacts {
 $rows=@();foreach($record in @($global:Error|Select-Object -First 8)){
  $line=$null;$role='OTHER';if($record.InvocationInfo){$number=$record.InvocationInfo.ScriptLineNumber;if($number -is [int] -and $number -ge 0 -and $number -le 20000){$line=$number};$leaf=[IO.Path]::GetFileName([string]$record.InvocationInfo.ScriptName);if($leaf -ceq 'owner-code-rotation-native-1218.ps1'){$role='NATIVE'}elseif($leaf -ceq 'owner-code-cutover-private-bootstrap.fixture.ps1'){$role='PUBLIC_FIXTURE'}}
  $rows+=[ordered]@{role=$role;scriptLineNumber=$line;exceptionType=(Get-CutoverPublicTypeName $record.Exception);innerExceptionType=(Get-CutoverPublicTypeName $record.Exception.InnerException)}
 };return ,$rows
}
function Invoke-CutoverPublicDefaultInputProbe([string]$Node,[string]$Script,[string]$WorkingDirectory){
 $facts=[ordered]@{kind='PUBLIC_DEFAULT_PROCESS_STDIN_PROBE';codePage=$null;preambleBytes=$null;writeExceptionType=$null;status='NOT_STARTED';exitCode=$null;outputMatched=$false;stderrPresent=$false;ownedNodeChildren=1}
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Node;$info.Arguments='"'+$Script+'"';$info.WorkingDirectory=$WorkingDirectory;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.EnvironmentVariables.Clear();$info.EnvironmentVariables['SystemRoot']='C:\Windows';$info.EnvironmentVariables['USERPROFILE']='C:\Users\Owner';$info.EnvironmentVariables['LOCALAPPDATA']='C:\Users\Owner\AppData\Local';$info.EnvironmentVariables['PATH']=[IO.Path]::GetDirectoryName($Node)
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;$started=$false
 try{
  $started=$process.Start();if(-not $started){return $facts};$facts.status='STARTED';$facts.codePage=[int]$process.StandardInput.Encoding.CodePage;$facts.preambleBytes=[int]$process.StandardInput.Encoding.GetPreamble().Length
  $outRead=$process.StandardOutput.ReadToEndAsync();$errRead=$process.StandardError.ReadToEndAsync()
  try{$write=$process.StandardInput.WriteAsync('{"mode":"success","canary":"PUBLIC_ONLY"}');$null=$write.GetAwaiter().GetResult()}catch{$facts.writeExceptionType=Get-CutoverPublicTypeName $_.Exception}
  $process.StandardInput.Close()
  if(-not $process.WaitForExit(5000)){$facts.status='TIMEOUT';return $facts}
  $facts.status='EXITED';$facts.exitCode=[int]$process.ExitCode;$facts.outputMatched=($outRead.Result.Trim() -ceq 'Production configuration structure: PASS');$facts.stderrPresent=($errRead.Result.Length -gt 0);return $facts
 }catch{$facts.status='EXCEPTION';if(-not $facts.writeExceptionType){$facts.writeExceptionType=Get-CutoverPublicTypeName $_.Exception};return $facts}finally{try{if($started -and -not $process.HasExited){$process.Kill();$null=$process.WaitForExit(1000)}}catch{};$process.Dispose()}
}

if($Scenario -eq 'validator-child'){
 $dir=PrivateSetup 1500;$owned=[IO.Path]::Combine([IO.Path]::GetTempPath(),('cutover-validator-'+[IO.Path]::GetRandomFileName()));$null=[IO.Directory]::CreateDirectory($owned)
 try{
  $public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;$stage=[IO.Path]::Combine($owned,'stage');$null=[IO.Directory]::CreateDirectory($stage);$scriptPath=[IO.Path]::Combine($stage,'scripts','validate-jarvis-production-config.mjs');$null=[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($scriptPath))
  $js="let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const j=JSON.parse(s.replace(/^\uFEFF/,''));if(process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.PUBLIC_PARENT_CANARY)process.exit(8);if(j.mode==='stderr')process.stderr.write('PUBLIC_CHILD_PRIVATE_CANARY');if(j.mode==='oversize')process.stdout.write('x'.repeat(5000));else if(j.mode==='exit')process.exit(7);else console.log('Production configuration structure: PASS');});"
  [IO.File]::WriteAllText($scriptPath,$js,[Text.UTF8Encoding]::new($false));$env:PUBLIC_PARENT_CANARY='PUBLIC_PARENT_ONLY'
  $publicInputProbe=Invoke-CutoverPublicDefaultInputProbe ([string]$inputData.nodeExecutable) $scriptPath $stage
  &$module {param($stagePath,$node);$script:stagePath=$stagePath;$script:nodePath=$node;$script:ownedValidatorChildren=0;$script:realProcessFactory=(Get-Command New-OwnerCutoverConfigurationValidatorProcess).ScriptBlock;function script:New-OwnerCutoverConfigurationValidatorProcess($Info){$script:ownedValidatorChildren++;&$script:realProcessFactory $Info};function script:Get-OwnerCutoverWindowsDirectory {'C:\Windows'}} $stage ([string]$inputData.nodeExecutable)
  $cases=@('success','stderr','oversize','exit');foreach($mode in $cases){$wire=@{mode=$mode;canary='PUBLIC_SECRET_INPUT_NOT_OUTPUT'}|ConvertTo-Json -Compress
   if($mode -ceq 'success'){try{&$module {param($j);Invoke-OwnerCutoverConfigurationValidator $j 'D:\Installed\release-current' 'C:\Users\Owner\JARVIS\production'} $wire}catch{$diagnostic=[ordered]@{scenario='validator-child';mode='success';probe=$publicInputProbe;errors=(Get-CutoverPublicValidatorLeafFacts)};[Console]::Error.WriteLine('CUTOVER_PUBLIC_VALIDATOR_DIAGNOSTIC '+($diagnostic|ConvertTo-Json -Depth 6 -Compress));throw}}else{$code=$null;try{&$module {param($j);Invoke-OwnerCutoverConfigurationValidator $j 'D:\Installed\release-current' 'C:\Users\Owner\JARVIS\production'} $wire}catch{$code=$_.Exception.Message};Require ($code -ceq 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED') 'CLOSED_OWNED_VALIDATOR_FAILURE'}
  }
  Require ((&$module {$script:ownedValidatorChildren}) -eq 4) 'REAL_OWNED_PUBLIC_CHILD_COUNT';@{pass=$true;validatorCases=$cases;ownedNodeChildren=4;diagnosticOwnedNodeChildren=1;defaultInputProbe=$publicInputProbe;actualNativeCalls=0}|ConvertTo-Json -Compress
 }finally{$env:PUBLIC_PARENT_CANARY='';Close $dir;[IO.Directory]::Delete($owned,$true)};return
}

if($Scenario -eq 'archive'){
 Add-Type @'
using System;using System.IO;
public static class CutoverNodeTransportTrace {public static int Reads,Streams,Aborts;public static Action ReadAction,ResponseAction;public static string Target="https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip";public static long Size=37304352;public static void Reset(){Reads=Streams=Aborts=0;ReadAction=ResponseAction=null;Size=37304352;Target="https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip";}}
public class CutoverNodeFixtureStream:Stream {public override bool CanRead{get{return true;}}public override bool CanSeek{get{return false;}}public override bool CanWrite{get{return false;}}public override bool CanTimeout{get{return true;}}public override long Length{get{return 1;}}public override long Position{get;set;}public override int ReadTimeout{get;set;}public override void Flush(){}public override long Seek(long a,SeekOrigin b){throw new NotSupportedException();}public override void SetLength(long a){throw new NotSupportedException();}public override void Write(byte[] b,int o,int c){throw new NotSupportedException();}public override int Read(byte[] b,int o,int c){CutoverNodeTransportTrace.Reads++;if(CutoverNodeTransportTrace.ReadAction!=null)CutoverNodeTransportTrace.ReadAction();if(CutoverNodeTransportTrace.Reads==1){b[o]=1;return 1;}return 0;}}
public class CutoverNodeFixtureResponse:IDisposable {public int StatusCode=200;public long ContentLength{get{return CutoverNodeTransportTrace.Size;}}public Uri ResponseUri{get{return new Uri(CutoverNodeTransportTrace.Target);}}public Stream GetResponseStream(){CutoverNodeTransportTrace.Streams++;return new CutoverNodeFixtureStream();}public void Dispose(){}}
public class CutoverNodeFixtureRequest {public string Method,UserAgent;public int Timeout,ReadWriteTimeout;public bool AllowAutoRedirect,UseDefaultCredentials,PreAuthenticate;public object Credentials;public object GetResponse(){if(CutoverNodeTransportTrace.ResponseAction!=null)CutoverNodeTransportTrace.ResponseAction();return new CutoverNodeFixtureResponse();}public void Abort(){CutoverNodeTransportTrace.Aborts++;}}
'@|Out-Null
 $index=1100;$modes=@('read-expiry','response-expiry','redirect','oversize','short-body')
 foreach($mode in $modes){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;&$module {function script:New-OwnerCutoverNodeRequest {return [CutoverNodeFixtureRequest]::new()}};[CutoverNodeTransportTrace]::Reset();function ExpireFixtureClock {$script:stamp+=880001}
  if($mode -ceq 'read-expiry'){[CutoverNodeTransportTrace]::ReadAction=[System.Action](Get-Command ExpireFixtureClock).ScriptBlock}elseif($mode -ceq 'response-expiry'){[CutoverNodeTransportTrace]::ResponseAction=[System.Action](Get-Command ExpireFixtureClock).ScriptBlock}elseif($mode -ceq 'redirect'){[CutoverNodeTransportTrace]::Target='https://example.invalid/node.zip'}elseif($mode -ceq 'oversize'){[CutoverNodeTransportTrace]::Size=37304353}
  Refused {&$module {Read-OwnerCutoverNodeArchive}}
  $expected=if($mode -ceq 'read-expiry'){1}elseif($mode -ceq 'short-body'){2}else{0};Require ([CutoverNodeTransportTrace]::Reads -eq $expected) ('NODE_FIXED_TRANSPORT_READS_'+$mode);Require ([CutoverNodeTransportTrace]::Aborts -eq 1) 'NODE_OWNED_TRANSPORT_ABORT';if($mode -cin @('response-expiry','redirect','oversize')){Require ([CutoverNodeTransportTrace]::Streams -eq 0) 'NODE_NO_STREAM_AFTER_REJECTED_RESPONSE'}
 }finally{Close $dir}}
 @{pass=$true;archiveCases=$modes;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}

function InstallFixtureNode($Module){
 &$Module {
  $script:nodeCase='';$script:nodeReads=0;$script:nodeSignatures=0
  function script:Get-OwnerCutoverNodeImageFacts([string]$Path){$script:nodeReads++;return @{length=$(if($script:nodeCase -ceq 'size'){92825415}else{92825416});sha256=$(if($script:nodeCase -ceq 'hash'){'0'*64}else{'3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'});machine=$(if($script:nodeCase -ceq 'architecture'){332}else{34404});magic=$(if($script:nodeCase -ceq 'magic'){267}else{523});singleLink=$(if($script:nodeCase -ceq 'typed'){'true'}else{$true})}}
  function script:Get-OwnerCutoverNodeSignature([string]$Path){$script:nodeSignatures++;return @{status=$(if($script:nodeCase -ceq 'signature'){'UnknownError'}else{'Valid'});certificateSha256=$(if($script:nodeCase -ceq 'certificate'){'0'*64}else{'c5b94f1334367cb4fa004504d0cb62a558d30e1c3c712f729a02333bf5011522'});subject=$(if($script:nodeCase -ceq 'publisher'){'CN=Other,O=Other,C=US'}else{'CN=OpenJS Foundation,O=OpenJS Foundation,L=San Francisco,ST=California,C=US'})}}
  function script:Install-OwnerCutoverPublicNode {throw 'FIXTURE_NO_DOWNLOAD_OR_EXECUTION'}
 }
}


if($Scenario -eq 'entry'){
 $dir=PrivateSetup 1700;try{
  $result=Invoke-OwnerCutoverBootstrap;Require (-not $result.complete -and -not $result.effectCapability -and $result.failureCode -ceq 'ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE') 'READONLY_ENTRY_NEVER_MINTS_NATIVE'
  Require ($script:ownerCutoverEntryWorkspaceContext.ContainsKey('privateReadinessIdentity')) 'REAL_ENTRY_PRIVATE_ADAPTERS_CONNECTED'
  $token=$script:ownerCutoverEntryWorkspaceContext.privateReadinessIdentity;$record=$null;Require ($script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($token,[ref]$record)) 'ENTRY_PRIVATE_REFERENCE';$status=&$record.module {Assert-OwnerCutoverPrivateJournal;@{sourceCount=$script:originalState.sourceFiles.Count;journal=$script:journalLifetime.consumed;configuration=($null -ne $script:configurationBinding);node=($null -ne $script:nodePath);effect=$false}};Require ($status.sourceCount -eq 15 -and $status.journal -and $status.configuration -and $status.node -and -not $status.effect) 'GENUINE_READONLY_PREREQUISITES_NO_FAKE_READY'
  . (Join-Path $root 'scripts/owner-code-production-cutover-1218.ps1');$code=$null;try{Get-OwnerProductionTaskBinding -Admission $token|Out-Null}catch{$code=$_.Exception.Message};Require ($code -ceq 'ROTATION_CUTOVER_ADMISSION_REQUIRED') 'PRIVATE_DATA_NOT_TASK_AUTHORITY'
  $count=&$record.module {$script:writes.Count};$again=Invoke-OwnerCutoverBootstrap;Require (-not $again.complete -and -not $again.effectCapability) 'ENTRY_REPLAY_REFUSED';Require ((&$record.module {$script:writes.Count}) -eq $count) 'ENTRY_REPLAY_NO_WRITES'
  @{pass=$true;readonlyEntryConnected=$true;taskAdmissionRefused=$true;actualNativeCalls=0}|ConvertTo-Json -Compress
 }finally{Close $dir};return
}

if($Scenario -eq 'journal'){
 $index=1600;$cases=@('success','journalthrow')
 foreach($caseName in $cases){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;$null=&$module {Initialize-OwnerCutoverPrivateSource};$null=&$module {Initialize-OwnerCutoverProtectedNode};$null=&$module {Initialize-OwnerCutoverPrivateConfiguration};&$module {param($n);$script:stageCase=$n} $caseName
  if($caseName -ceq 'success'){$status=&$module {Initialize-OwnerCutoverPrivateJournal};Require ($status.phase -ceq 'JOURNAL_DATA_BOUND' -and $status.durableClaimBound -and -not $status.effectCapability -and -not $status.privateContextVerified) 'DURABLE_JOURNAL_NO_NATIVE_AUTHORITY';$null=&$module {Assert-OwnerCutoverPrivateJournal};$count=&$module {$script:writes.Count};Refused {&$module {Initialize-OwnerCutoverPrivateJournal}};Require ((&$module {$script:writes.Count}) -eq $count) 'NO_ORIGINAL_JOURNAL_REISSUE'}
  else{Refused {&$module {Initialize-OwnerCutoverPrivateJournal}};$count=&$module {$script:writes.Count};Refused {&$module {Initialize-OwnerCutoverPrivateJournal}};Require ((&$module {$script:writes.Count}) -eq $count) 'UNKNOWN_JOURNAL_WRITE_CONSUMES_ATTEMPT'}
 }finally{Close $dir}}
 @{pass=$true;journalCases=$cases;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}

if($Scenario -eq 'configuration'){
 $index=1400;$cases=@('success','decrypt','validator','manifest','build-missing','sidecar','config-change')
 foreach($caseName in $cases){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;$null=&$module {Initialize-OwnerCutoverPrivateSource};$null=&$module {Initialize-OwnerCutoverProtectedNode}
  &$module {param($c);$script:configurationCase=$c;if($c -ceq 'manifest'){$script:memoryFiles['D:\Installed\release-current\jarvis-release.json']=[Text.Encoding]::UTF8.GetBytes('{"commit":"ffffffffffffffffffffffffffffffffffffffff"}')}elseif($c -ceq 'build-missing'){$script:memoryFiles.Remove('D:\Installed\release-current\.next\BUILD_ID')}elseif($c -ceq 'sidecar'){$script:memoryFiles.Remove('C:\Users\Owner\JARVIS\production\broker.sqlite.pc-tasks.json')}} $caseName
  if($caseName -ceq 'success'){$status=&$module {Initialize-OwnerCutoverPrivateConfiguration};$wire=$status|ConvertTo-Json -Compress;Require ($status.phase -ceq 'CONFIGURATION_DATA_BOUND' -and -not $status.effectCapability -and -not $status.privateContextVerified -and -not $status.targetEnvironmentVerified -and $wire -notmatch 'PUBLIC_SECRET_CANARY|Installed|broker.sqlite|S-1-5') 'PRIVATE_CONFIG_R_DATA_NOT_EFFECT';$retained=&$module {$script:configurationBinding.releaseRoot};Require ($retained -ceq 'D:\Installed\release-current') 'ACTUAL_CONFIG_R_NOT_CHECKOUT_OR_TASK_CWD';Require ((&$module {$script:immutableFileBindings.Count}) -eq 18) 'INSTALLED_MANIFEST_BUILD_HOST_HELD_IMMUTABLY';Require (-not (&$module {$script:immutableFileBindings.ContainsKey('C:\Users\Owner\JARVIS\production\config.dpapi')})) 'MUTABLE_CONFIG_NOT_NO_WRITE_LOCKED'}
  else{$code=$null;try{&$module {Initialize-OwnerCutoverPrivateConfiguration}|Out-Null}catch{$code=$_.Exception.Message};Require ($code -ceq 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED') ('CLOSED_CONTEXT_REJECTION_'+$caseName);Refused {&$module {Initialize-OwnerCutoverPrivateConfiguration}}}
 }finally{Close $dir}}
 @{pass=$true;configurationCases=$cases;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}

if($Scenario -eq 'node'){
 $index=1000;$cases=@('success','hash','size','architecture','magic','signature','certificate','publisher','typed')
 foreach($caseName in $cases){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module
  Refused {&$module {Initialize-OwnerCutoverProtectedNode}};Require ((&$module {$script:nodeReads}) -eq 0) 'NO_NODE_BEFORE_SOURCE_CLAIM'
  $null=&$module {Initialize-OwnerCutoverPrivateSource};&$module {param($n);$script:nodeCase=$n;foreach($path in @('C:\Users\Owner\JARVIS','C:\Users\Owner\JARVIS\tools','C:\Users\Owner\JARVIS\tools\node-v24.19.0-win-x64')){$script:memoryDirs[$path]=$true};$script:memoryFiles['C:\Users\Owner\JARVIS\tools\node-v24.19.0-win-x64\node.exe']=[Text.Encoding]::UTF8.GetBytes('PUBLIC_OS_IMAGE_OBSERVATION_FAKE')} $caseName
  if($caseName -ceq 'success'){$status=&$module {Initialize-OwnerCutoverProtectedNode};Require ($status.phase -ceq 'PROTECTED_NODE_BOUND' -and -not $status.effectCapability -and -not $status.privateContextVerified -and $status.retainedDependency) 'FIXED_NODE_NOT_NATIVE_ADMISSION'}else{Refused {&$module {Initialize-OwnerCutoverProtectedNode}}}
 }finally{Close $dir}}
 @{pass=$true;nodeCases=$cases;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}

if($Scenario -eq 'stage'){
 $index=900;$cases=@('success','writer','reparse','links','bytes','claimthrow')
 foreach($caseName in $cases){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);$module=$record.module;&$module {param($n);$script:stageCase=$n} $caseName
  if($caseName -ceq 'success'){$status=&$module {Initialize-OwnerCutoverPrivateSource};Require ($status.phase -ceq 'SOURCE_STAGE_BOUND' -and $status.sourceFilesVerified -eq 15 -and $status.claimConsumed -and -not $status.effectCapability -and -not $status.privateContextVerified) 'REAL_SOURCE_ALGORITHM_HOLDS_15';$locks=&$module {$script:sourceHandles.Count};Require ($locks -eq 15) 'IMMUTABLE_SOURCE_HANDLES';Refused {&$module {Initialize-OwnerCutoverPrivateSource}}}
  else{Refused {&$module {Initialize-OwnerCutoverPrivateSource}};$count=&$module {$script:writes.Count};if($caseName -cin @('writer','reparse')){Require ($count -eq 0) 'NO_WRITE_BEFORE_PATH_TRUST'}else{Refused {&$module {Initialize-OwnerCutoverPrivateSource}};Require ((&$module {$script:writes.Count}) -eq $count) 'AMBIGUOUS_STAGE_NO_RETRY'}}
 }finally{Close $dir}}
 @{pass=$true;sourceCases=$cases;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}

if($Scenario -eq 'denials'){
 $index=800;$cases=@('system','session','interactive','signature','folder','typed')
 foreach($caseName in $cases){$index++;$dir=PrivateSetup $index;try{$public=Get-OwnerCutoverPublicReadiness;$private=New-OwnerCutoverPrivateBackend -PublicToken $public;$record=$null;$null=$script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record);&$record.module {param($n);$script:kernelCase=$n} $caseName;Refused {Get-OwnerCutoverPrivateBackendStatus -Token $private};Refused {New-OwnerCutoverPrivateBackend -PublicToken $public}}finally{Close $dir}}
 @{pass=$true;denied=$cases;actualNativeCalls=0}|ConvertTo-Json -Compress;return
}
$dir=PrivateSetup 700
try{
 $public=Get-OwnerCutoverPublicReadiness
 if($Scenario -eq 'default'){
  if([IO.Path]::DirectorySeparatorChar -eq [char]92){@{pass=$true;nativeDefaultNotInvoked=$true;actualNativeCalls=0}|ConvertTo-Json -Compress;return}
  $errorCode=$null;try{New-OwnerCutoverPrivateBackend -PublicToken $public|Out-Null}catch{$errorCode=$_.Exception.Message};Require ($errorCode -ceq 'ROTATION_CUTOVER_PRIVATE_CONTEXT_REJECTED') 'REAL_DEFAULT_LINUX_REFUSAL';@{pass=$true;defaultRejected=$true;actualNativeCalls=0}|ConvertTo-Json -Compress;return
 }
 function NestedConstructor {$owned=New-OwnerCutoverPrivateBackend -PublicToken $public;return $owned}
 $private=NestedConstructor;$record=$null;Require ($script:ownerCutoverPrivateLifetimes.tokens.TryGetValue($private,[ref]$record)) 'PRIVATE_REFERENCE_IDENTITY';$module=$record.module
 if($Scenario -eq 'scope'){
  function BuildUiCallback($Reference){$ownedReference=$Reference;$reader=(Get-Command Get-OwnerCutoverPrivateBackendStatus).ScriptBlock;return {&$reader -Token $ownedReference}.GetNewClosure()}
  $callback=BuildUiCallback $private;$status=&$callback;Require ($status.phase -ceq 'KERNEL_DATA_BOUND' -and -not $status.effectCapability -and -not $status.privateContextVerified) 'RETURNED_UI_CLOSURE_ORIGINAL_STATE';$again=New-OwnerCutoverPrivateBackend -PublicToken $public;Require ([object]::ReferenceEquals($private,$again)) 'NO_BACKEND_REMINT';Refused {Get-OwnerCutoverPrivateBackendStatus -Token ([pscustomobject]@{phase='KERNEL_DATA_BOUND';verified=$true})};$script:stamp+=880001;Refused {&$callback};@{pass=$true;closureRetainsOriginal=$true;noRemint=$true;actualNativeCalls=0}|ConvertTo-Json -Compress;return
 }
 if($Scenario -eq 'clock'){
  function ExpireFixtureClock {$script:stamp+=880001};$expire=(Get-Command ExpireFixtureClock).ScriptBlock;&$module {param($p);$script:fixtureExpire=$p;$script:kernelCase='cross';$script:kernelCalls.Clear()} $expire
  Refused {Get-OwnerCutoverPrivateBackendStatus -Token $private};$calls=@(&$module {$script:kernelCalls.ToArray()});Require (@($calls).Count -eq 1 -and $calls[0] -ceq 'platform') 'NO_OBSERVATION_AFTER_CLOCK_EXPIRY';@{pass=$true;kernelCalls=@($calls);actualNativeCalls=0}|ConvertTo-Json -Compress;return
 }
 $status=Get-OwnerCutoverPrivateBackendStatus -Token $private;Require ($status.phase -ceq 'KERNEL_DATA_BOUND' -and -not $status.effectCapability) 'OWNER_ONLY_NO_EFFECT'
 # Same own backend can be checked repeatedly. Once a measured mismatch occurs,
 # it must remain consumed even if the private fake later becomes healthy.
 &$module {$script:kernelCase='owner'};Refused {Get-OwnerCutoverPrivateBackendStatus -Token $private};&$module {$script:kernelCase=''};Refused {New-OwnerCutoverPrivateBackend -PublicToken $public}
 @{pass=$true;observedOwnerBound=$true;mismatchTerminal=$true;actualNativeCalls=0}|ConvertTo-Json -Compress
}finally{Close $dir}

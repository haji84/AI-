param([ValidateSet('selector','capsule','execution-boundary','clr-public-policy','clr-public-profiler','clr-product-data','clr-product-profiler')][string]$Scenario='selector')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
# Test-only literal policy. This is deliberately NOT the product compiler.
# Future acceptance requires running/byte-binding its actual private output at
# this same A/B child boundary, followed by independent source review.
if($Scenario -in @('clr-public-policy','clr-public-profiler','clr-product-data','clr-product-profiler')){
 $literalPolicy='set "COR_ENABLE_PROFILING="&set "COR_PROFILER="&set "COR_PROFILER_PATH_32="&set "COR_PROFILER_PATH_64="&set "COR_PROFILER_PATH_ARM64="&set "COR_PROFILER_PATH="&set "APPDOMAIN_MANAGER_ASM="&set "APPDOMAIN_MANAGER_TYPE="&set "DEVPATH="&set "COMPLUS_ProfAPI_ProfilerCompatibilitySetting="&set "COMPLUS_MDA="&set "PSModuleAnalysisCachePath="&set "PSDisableModuleAnalysisCacheCleanup="'
 $policyBytes=[Text.Encoding]::UTF8.GetBytes($literalPolicy+'&set "PSModulePath={FIXED_SYSTEM_MODULES}"&"{FIXED_SYSTEM_PS}" -NoLogo -NoProfile -NonInteractive -File "{OWNED_PUBLIC_SCRIPT}"')
 $digest=[Security.Cryptography.SHA256]::Create();try{$policyHash=([BitConverter]::ToString($digest.ComputeHash($policyBytes))).Replace('-','').ToLowerInvariant()}finally{$digest.Dispose()}
 function Test-ClrPublicPath([string]$Path){
  # Spaces are supported. Shell expansions, quotes, control/non-ASCII chars,
  # alternate streams, relative/device/UNC forms and ambiguous segments refuse.
  if($Path -cnotmatch '^[A-Za-z]:\\[A-Za-z0-9 ._\\-]+$'){return $false}
  foreach($part in $Path.Substring(3).Split([char]92)){if(-not $part -or $part -in @('.','..') -or $part.EndsWith('.') -or $part.EndsWith(' ')){return $false}}
  return $true
 }
 function New-ClrPublicCommand([string]$FixedSystemPS,[string]$FixedModules,[string]$PublicScript){
  foreach($path in @($FixedSystemPS,$FixedModules,$PublicScript)){if(-not (Test-ClrPublicPath $path)){throw 'PUBLIC_CLR_PATH_REFUSED'}}
  # No command text or environment-name parameter exists. The sole action is
  # the owned fixed public script under fixed Windows PowerShell.
  return '/d /v:off /s /c "'+$literalPolicy+'&set "PSModulePath='+$FixedModules+'"&"'+$FixedSystemPS+'" -NoLogo -NoProfile -NonInteractive -File "'+$PublicScript+'""'
 }
 function Get-ClrPublicPairVerdict($Positive,$Clean){
  if(-not $Positive.profilerMarker){return 'INCONCLUSIVE_POSITIVE_MARKER_MISSING'}
  if(-not $Positive.scriptMarker){return 'INCONCLUSIVE_POSITIVE_SCRIPT_MISSING'}
  if(-not $Positive.profilerBeforeScript){return 'INCONCLUSIVE_POSITIVE_ORDER'}
  if($Positive.exitCode -ne 0){return 'INCONCLUSIVE_POSITIVE_EXIT'}
  if($Clean.profilerMarker){return 'FAIL_CLEAN_PROFILER_EXECUTED'}
  if(-not $Clean.scriptMarker){return 'FAIL_CLEAN_SCRIPT_MISSING'}
  if($Clean.exitCode -ne 0){return 'FAIL_CLEAN_EXIT'}
  return 'PASS'
 }
 function Get-ClrPublicDigest([byte[]]$Bytes){$sha=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
 function New-ClrProductFixtureData([string]$WindowsDirectory,[string]$OwnerProfile,[string]$ReleaseRoot,[string]$EntrySha256){
  return [pscustomobject][ordered]@{profile='goriq-clean-start-command-data-v1';windowsDirectory=$WindowsDirectory;systemPowerShellPath=$WindowsDirectory+'\System32\WindowsPowerShell\v1.0\powershell.exe';ownerProfile=$OwnerProfile;ownerLocalAppData=$OwnerProfile+'\AppData\Local';retainedNodePath=$OwnerProfile+'\JARVIS\tools\node-v24.19.0-win-x64\node.exe';installRoot=$OwnerProfile+'\installation';releaseRoot=$ReleaseRoot;startupStateDirectory=$OwnerProfile+'\installation\startup-state';entrySha256=$EntrySha256;sourceRevision=('b'*40)}
 }
 $productCase=$Scenario -in @('clr-product-data','clr-product-profiler');$productDataResult=$null
 if($productCase){
  $productDataResult=@{scope='ACTUAL_PRODUCT_COMPILER_DATA_ONLY';actualProductCompilerDataCompiled=$false;actualProductCompilerLinked=$false;actualPrivateEntryReady=$false;nativeGrant=$false;actualWindowsExecuted=$false;status='INCONCLUSIVE';failureCode='PUBLIC_CLR_PRODUCT_COMPILER_REQUIRED'}
  try{
   # Retain and import the actual checkout bytes unchanged. No AST extraction,
   # tail rewriting, handoff path, environment backend or private-host call.
   $productSource=[IO.File]::ReadAllBytes((Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1'));$productDataResult.sourceUnderTestSha256=Get-ClrPublicDigest $productSource
   $importOutput=@(. ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($productSource))))
   if(-not (Get-Command New-OwnerCutoverCleanStartCommandData -ErrorAction SilentlyContinue)){throw 'PUBLIC_CLR_PRODUCT_COMPILER_REQUIRED'}
   $productDataResult.defaultSourceInvocationInert=($importOutput.Count -eq 0)
  }catch{$productDataResult|ConvertTo-Json -Depth 5 -Compress;exit}
 }
 if($Scenario -eq 'clr-product-data'){
  $data=New-ClrProductFixtureData 'C:\Windows' 'C:\Owned Public\owner profile' 'C:\Owned Public\release' ('a'*64)
  $command=New-OwnerCutoverCleanStartCommandData $data;$accepted=@($true)
  foreach($mutate in @({param($d)$d|Add-Member extra 'public'},{param($d)$d.PSObject.Properties.Remove('entrySha256')},{param($d)$d.profile='unknown'},{param($d)$d.windowsDirectory='C:\bad%windows'},{param($d)$d.ownerProfile="C:\bad'owner"},{param($d)$d.systemPowerShellPath='C:\Windows\foreign.exe'},{param($d)$d.retainedNodePath='C:\Owned Public\foreign.exe'},{param($d)$d.startupStateDirectory='C:\outside'},{param($d)$d.entrySha256='z'*64},{param($d)$d.sourceRevision='b'*39},{param($d)$d.ownerProfile=@($d.ownerProfile)})){
   $copy=$data.PSObject.Copy();&$mutate $copy;try{$null=New-OwnerCutoverCleanStartCommandData $copy;$accepted+=$true}catch{$accepted+=$false}
  }
  $match=[regex]::Match($command.arguments,' -EncodedCommand ([A-Za-z0-9+/=]+)"$');$capsule=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($match.Groups[1].Value));$payload=[regex]::Match($capsule,"FromBase64String\('([A-Za-z0-9+/=]+)'\)");$metadata=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Groups[1].Value)))|Microsoft.PowerShell.Utility\ConvertFrom-Json
  $productDataResult.actualProductCompilerDataCompiled=$true;$productDataResult.status='PASS';$productDataResult.failureCode='NONE';$productDataResult.compiledCommandSha256=Get-ClrPublicDigest ([Text.Encoding]::UTF8.GetBytes($command.execute+"`n"+$command.arguments+"`n"+$command.workingDirectory))
  $productDataResult.closedTuple=(@($command.PSObject.Properties).Count -eq 5 -and @('profile','execute','arguments','workingDirectory','effectCapability'|Where-Object {$command.PSObject.Properties.Name -cnotcontains $_}).Count -eq 0 -and $command.profile -ceq 'goriq-clean-start-command-data-v1')
  $productDataResult.fixedCmd=($command.execute -ceq 'C:\Windows\System32\cmd.exe' -and $command.arguments.StartsWith('/d /v:off /s /c "'));$productDataResult.fixedWorkingDirectory=($command.workingDirectory -ceq $data.releaseRoot);$productDataResult.fixedPowerShell=$command.arguments.Contains(('"'+$data.systemPowerShellPath+'" -NoLogo -NoProfile -NonInteractive -EncodedCommand '));$productDataResult.effectCapability=$command.effectCapability;$productDataResult.retainedHashCapsuleBound=($metadata.installRoot -ceq $data.installRoot -and $metadata.entrySha256 -ceq $data.entrySha256 -and $metadata.sourceRevision -ceq $data.sourceRevision -and $capsule.Contains('\scripts\owner-code-rotation-native-1218.ps1') -and $capsule.Contains('if($x -cne $d.entrySha256)'));$productDataResult.acceptedCases=$accepted
  $productDataResult|ConvertTo-Json -Depth 5 -Compress;exit
 }
 if($Scenario -eq 'clr-public-policy'){
  $paths=@('C:\Windows\System32\cmd.exe','C:\Owned Public\probe.ps1','C:\bad&path\probe.ps1','C:\bad%path\probe.ps1','C:\bad!path\probe.ps1','C:\bad"path\probe.ps1',"C:\bad`npath\probe.ps1",'\\server\share\probe.ps1','C:\..\probe.ps1','C:\trailing.\probe.ps1','C:\bad(path)\probe.ps1','C:\bad^path\probe.ps1')
  $positive=@{profilerMarker=$true;scriptMarker=$true;profilerBeforeScript=$true;exitCode=0};$clean=@{profilerMarker=$false;scriptMarker=$true;profilerBeforeScript=$false;exitCode=0}
  $verdicts=@(Get-ClrPublicPairVerdict $positive $clean)
  foreach($patch in @(@{profilerMarker=$false},@{profilerBeforeScript=$false},@{scriptMarker=$false},@{exitCode=1})){$copy=$positive.Clone();foreach($k in $patch.Keys){$copy[$k]=$patch[$k]};$verdicts+=Get-ClrPublicPairVerdict $copy $clean}
  foreach($patch in @(@{profilerMarker=$true},@{scriptMarker=$false},@{exitCode=1})){$copy=$clean.Clone();foreach($k in $patch.Keys){$copy[$k]=$patch[$k]};$verdicts+=Get-ClrPublicPairVerdict $positive $copy}
  $command=New-ClrPublicCommand 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules' 'C:\Owned Public\probe.ps1'
  $names=@('COR_ENABLE_PROFILING','COR_PROFILER','COR_PROFILER_PATH_32','COR_PROFILER_PATH_64','COR_PROFILER_PATH_ARM64','COR_PROFILER_PATH','APPDOMAIN_MANAGER_ASM','APPDOMAIN_MANAGER_TYPE','DEVPATH','COMPLUS_ProfAPI_ProfilerCompatibilitySetting','COMPLUS_MDA','PSModuleAnalysisCachePath','PSDisableModuleAnalysisCacheCleanup')
  $envTable=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase);foreach($name in $names){$envTable.Add($name.ToLowerInvariant(),'public')}
  $clearMatches=[regex]::Matches($literalPolicy,'(?:^|&)set "([A-Za-z0-9_]+)="');foreach($m in $clearMatches){[void]$envTable.Remove($m.Groups[1].Value)}
  @{scope='PUBLIC_PLATFORM_MECHANISM_ONLY';actualProductPrefixLinked=$false;actualWindowsExecuted=$false;constantPolicySha256=$policyHash;pathCases=@($paths|ForEach-Object {Test-ClrPublicPath $_});verdictCases=$verdicts;staticInputsCleared=($clearMatches.Count -eq $names.Count -and @($names|Where-Object {-not $literalPolicy.Contains(('set "'+$_+'="'))}).Count -eq 0);caseInsensitiveAliasesCleared=($envTable.Count -eq 0);fixedSystemModulePath=$command.Contains('set "PSModulePath=C:\Windows\System32\WindowsPowerShell\v1.0\Modules"');fixedCmdFlags=$command.StartsWith('/d /v:off /s /c "');closedPublicScriptOnly=$command.EndsWith('-NoLogo -NoProfile -NonInteractive -File "C:\Owned Public\probe.ps1""');arbitraryEnvironmentNameInput=$false}|ConvertTo-Json -Depth 5 -Compress;exit
 }
 $result=@{scope='PUBLIC_PLATFORM_MECHANISM_ONLY';actualProductPrefixLinked=$false;actualWindowsExecuted=$false;constantPolicySha256=$policyHash;status='INCONCLUSIVE';failureCode='PUBLIC_CLR_WINDOWS_REQUIRED';pairs=@();ownedArtifactsRemoved=$true;ownedChildrenExited=$true}
 if($productCase){$result.scope='PUBLIC_ACTUAL_COMPILER_MECHANISM_ONLY';$result.Remove('actualProductPrefixLinked');$result.actualProductCompilerDataCompiled=$false;$result.actualProductCompilerLinked=$false;$result.actualPrivateEntryReady=$false;$result.nativeGrant=$false;$result.sourceUnderTestSha256=$productDataResult.sourceUnderTestSha256;$result.unmodifiedCommandExecuted=$false;$result.retainedHashRefusalObserved=$false}
 if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){$result.status='NOT_RUN';$result|ConvertTo-Json -Depth 6 -Compress;exit}
 $result.actualWindowsExecuted=$true;$root=$null
 function Invoke-ClrPublicOwnedProcess([string]$Image,[string]$Arguments,[string]$Directory,[hashtable]$Overrides){
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Image;$info.Arguments=$Arguments;$info.WorkingDirectory=$Directory;$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  # Owned public baseline: never execute unrelated inherited CLR hooks. Only
  # this new process receives the three deliberate profiler inputs below.
  $info.EnvironmentVariables.Clear();$info.EnvironmentVariables['SystemRoot']=$windows;$info.EnvironmentVariables['windir']=$windows;$info.EnvironmentVariables['PATH']=[IO.Path]::Combine($windows,'System32');$info.EnvironmentVariables['TEMP']=$Directory;$info.EnvironmentVariables['TMP']=$Directory;$info.EnvironmentVariables['PSModulePath']=$modules
  foreach($k in $Overrides.Keys){$info.EnvironmentVariables[$k]=[string]$Overrides[$k]}
  $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false
  try{if(-not $child.Start()){throw 'PUBLIC_CLR_CHILD_START'};$started=$true;$stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync();if(-not $child.WaitForExit(10000)){throw 'PUBLIC_CLR_CHILD_TIMEOUT'};[void]$stdout.Result;[void]$stderr.Result;return $child.ExitCode}
  finally{
   if($started -and -not $child.HasExited){
    # Kill the owned CMD tree before closing its live process handle. The tree
    # contains only the new fixed public PS child, never an existing runtime.
    $killer=[Diagnostics.Process]::new();$killer.StartInfo=[Diagnostics.ProcessStartInfo]::new();$killer.StartInfo.FileName=[IO.Path]::Combine($windows,'System32\taskkill.exe');$killer.StartInfo.Arguments='/PID '+$child.Id+' /T /F';$killer.StartInfo.UseShellExecute=$false;$killer.StartInfo.RedirectStandardOutput=$true;$killer.StartInfo.RedirectStandardError=$true;$killerStarted=$false
    try{
     if(-not $killer.Start()){throw 'PUBLIC_CLR_OWNED_TREE_CLEANUP_FAILED'};$killerStarted=$true;$killOut=$killer.StandardOutput.ReadToEndAsync();$killErr=$killer.StandardError.ReadToEndAsync()
     if(-not $killer.WaitForExit(2000)){$killer.Kill();[void]$killer.WaitForExit(1000);$result.ownedChildrenExited=$false}
     if($killer.HasExited){[void]$killOut.Result;[void]$killErr.Result;if($killer.ExitCode -ne 0){$result.ownedChildrenExited=$false}}else{$result.ownedChildrenExited=$false}
     [void]$child.WaitForExit(2000)
    }catch{$result.ownedChildrenExited=$false}finally{if($killerStarted -and -not $killer.HasExited){$result.ownedChildrenExited=$false};$killer.Dispose()}
    if(-not $child.HasExited){try{$child.Kill();[void]$child.WaitForExit(1000)}catch{};$result.ownedChildrenExited=$false}
   }
   $child.Dispose()
  }
 }
 try{
  if([IntPtr]::Size -ne 8){throw 'PUBLIC_CLR_X64_REQUIRED'}
  $windows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows);$programFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  $fixedPS=[IO.Path]::Combine($windows,'System32\WindowsPowerShell\v1.0\powershell.exe');$fixedCmd=[IO.Path]::Combine($windows,'System32\cmd.exe');$modules=[IO.Path]::Combine($windows,'System32\WindowsPowerShell\v1.0\Modules')
  foreach($path in @($fixedPS,$fixedCmd,$modules)){if(-not (Test-ClrPublicPath $path) -or -not [IO.File]::Exists($path) -and -not [IO.Directory]::Exists($path)){throw 'PUBLIC_CLR_FIXED_IMAGE_REQUIRED'}}
  $root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('owned public clr '+[Guid]::NewGuid().ToString('N')));if($productCase){$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('p '+[Guid]::NewGuid().ToString('N')))};if(-not (Test-ClrPublicPath $root)){throw 'PUBLIC_CLR_PATH_REFUSED'};$null=[IO.Directory]::CreateDirectory($root)
  # Installed MSVC only; no package/toolchain installation, shell setup script,
  # registry registration, GAC/system config or product binary is involved.
  $vsRoot=[IO.Path]::Combine($programFiles,'Microsoft Visual Studio');$candidates=@()
  foreach($base in @($vsRoot,[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),'Microsoft Visual Studio'))){if([IO.Directory]::Exists($base)){foreach($year in [IO.Directory]::GetDirectories($base)){foreach($edition in [IO.Directory]::GetDirectories($year)){$tools=[IO.Path]::Combine($edition,'VC\Tools\MSVC');if([IO.Directory]::Exists($tools)){foreach($version in [IO.Directory]::GetDirectories($tools)){$cl=[IO.Path]::Combine($version,'bin\Hostx64\x64\cl.exe');if([IO.File]::Exists($cl)){$candidates+= $cl}}}}}}}
  if($candidates.Count -eq 0){throw 'PUBLIC_CLR_INSTALLED_COMPILER_REQUIRED'};$compiler=@($candidates|Sort-Object -Descending)[0]
  $kit=[IO.Path]::Combine($programFiles,'Windows Kits\10\Lib');$libs=@();if([IO.Directory]::Exists($kit)){foreach($version in [IO.Directory]::GetDirectories($kit)){$lib=[IO.Path]::Combine($version,'um\x64\kernel32.lib');if([IO.File]::Exists($lib)){$libs+=$lib}}};if($libs.Count -eq 0){throw 'PUBLIC_CLR_INSTALLED_SDK_REQUIRED'};$kernel=@($libs|Sort-Object -Descending)[0]
  # These installed tool paths are passed directly to ProcessStartInfo/MSVC,
  # never CMD. The standard Program Files (x86) parentheses are safe here.
  foreach($path in @($compiler,$kernel)){if($path -cnotmatch '^[A-Za-z]:\\[A-Za-z0-9 ._()\\-]+$' -or $path.Contains('\..\')){throw 'PUBLIC_CLR_TOOL_PATH_REFUSED'}}
  $events=[IO.Path]::Combine($root,'public.events');$source=[IO.Path]::Combine($root,'public-profiler.c');$dll=[IO.Path]::Combine($root,'public-profiler.dll');$script=[IO.Path]::Combine($root,'public-script.ps1')
  # The only C interpolation is an already conservatively validated owned path.
  $cPath=$events.Replace('\','\\')
  $c=@'
typedef void *HANDLE;
__declspec(dllimport) HANDLE __stdcall CreateFileW(const unsigned short *,unsigned long,unsigned long,void *,unsigned long,unsigned long,HANDLE);
__declspec(dllimport) int __stdcall WriteFile(HANDLE,const void *,unsigned long,unsigned long *,void *);
__declspec(dllimport) int __stdcall CloseHandle(HANDLE);
static const char marker[]="PUBLIC_CLR_PROFILER\n";
__declspec(dllexport) long __stdcall DllGetClassObject(const void *clsid,const void *iid,void **object) {
 HANDLE file=CreateFileW(L"OWNED_MARKER_PATH",4,7,0,4,128,0);
 unsigned long written=0;
 if(file!=(HANDLE)-1){WriteFile(file,marker,sizeof(marker)-1,&written,0);CloseHandle(file);}
 if(object)*object=0;
 return (long)0x80040111;
}
'@
  [IO.File]::WriteAllText($source,$c.Replace('OWNED_MARKER_PATH',$cPath),[Text.Encoding]::ASCII)
  $publicScript=@'
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::Version.Major -ne 4 -or [IntPtr]::Size -ne 8){exit 31}
[IO.File]::AppendAllText([IO.Path]::Combine($PSScriptRoot,'public.events'),"PUBLIC_WINPS51_SCRIPT`n",[Text.Encoding]::ASCII)
exit 0
'@
  [IO.File]::WriteAllText($script,$publicScript,[Text.Encoding]::ASCII)
  if($productCase){
   $data=New-ClrProductFixtureData $windows $root ([IO.Path]::Combine($root,'release')) ('a'*64)
   foreach($directory in @($data.ownerLocalAppData,$data.releaseRoot,$data.startupStateDirectory,[IO.Path]::Combine($data.installRoot,'scripts'))){$null=[IO.Directory]::CreateDirectory($directory)}
   $retainedEntry=[IO.Path]::Combine($data.installRoot,'scripts\owner-code-rotation-native-1218.ps1')
   # Owned dummy bytes are DATA only. They neither import the private entry nor
   # call Owner/task/receipt/activation/configuration/native-grant functions.
   $dummy=@'
param([switch]$StartOnly)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(-not $StartOnly -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or [Environment]::Version.Major -ne 4 -or [IntPtr]::Size -ne 8){exit 31}
if($script:ownerCutoverRetainedStartupEntryContext.sourceRevision -cne ('b'*40)){exit 32}
[IO.File]::AppendAllText('OWNED_PUBLIC_EVENT_PATH',"PUBLIC_WINPS51_SCRIPT`n",[Text.Encoding]::ASCII)
exit 0
'@
   $dummyBytes=[Text.Encoding]::ASCII.GetBytes($dummy.Replace('OWNED_PUBLIC_EVENT_PATH',$events));[IO.File]::WriteAllBytes($retainedEntry,$dummyBytes);$data.entrySha256=Get-ClrPublicDigest $dummyBytes
   $productCommand=New-OwnerCutoverCleanStartCommandData $data
   if($productCommand.execute -cne $fixedCmd -or $productCommand.workingDirectory -cne $data.releaseRoot -or $productCommand.effectCapability -ne $false){throw 'PUBLIC_CLR_PRODUCT_TUPLE_REJECTED'}
   $result.actualProductCompilerDataCompiled=$true;$result.compiledCommandSha256=Get-ClrPublicDigest ([Text.Encoding]::UTF8.GetBytes($productCommand.execute+"`n"+$productCommand.arguments+"`n"+$productCommand.workingDirectory))
  }
  $compileArgs='/nologo /LD /O1 /Zl /Fo"'+[IO.Path]::Combine($root,'public-profiler.obj')+'" "'+$source+'" /link /NOENTRY /NODEFAULTLIB /MACHINE:X64 /OUT:"'+$dll+'" "'+$kernel+'"'
  # CL/_CL_ may inject compiler flags. Clear them only on this owned compiler.
  $compiled=Invoke-ClrPublicOwnedProcess $compiler $compileArgs $root @{CL='';_CL_=''}
  if($compiled -ne 0 -or -not [IO.File]::Exists($dll)){throw 'PUBLIC_CLR_COMPILE_FAILED'}
  $cleanArguments=if($productCase){$null}else{New-ClrPublicCommand $fixedPS $modules $script}
  $caseAliases=if($productCase){@($false)}else{@($false,$true)}
  foreach($lowerCase in $caseAliases){
   $positive=$null;$clean=$null
   foreach($isClean in @($false,$true)){
    if([IO.File]::Exists($events)){[IO.File]::Delete($events)}
    $hooks=@{COR_ENABLE_PROFILING='1';COR_PROFILER='{7E9D36B6-2E77-4D2D-AE54-6C455C24DB83}';COR_PROFILER_PATH_64=$dll}
    if($lowerCase){$alias=@{};foreach($k in $hooks.Keys){$alias[$k.ToLowerInvariant()]=$hooks[$k]};$hooks=$alias}
    $image=if($isClean){$fixedCmd}else{$fixedPS};$arguments=if($isClean){$cleanArguments}else{'-NoLogo -NoProfile -NonInteractive -File "'+$script+'"'}
    if($productCase -and $isClean){
     # Execute every returned tuple field verbatim. Never patch the capsule or
     # replace its tail, and never execute the dummy as an independent grant.
     $code=Invoke-ClrPublicOwnedProcess $productCommand.execute $productCommand.arguments $productCommand.workingDirectory $hooks;$result.unmodifiedCommandExecuted=$true
    }else{$code=Invoke-ClrPublicOwnedProcess $image $arguments $root $hooks}
    $text=if([IO.File]::Exists($events)){[IO.File]::ReadAllText($events)}else{''};$nativeIndex=$text.IndexOf("PUBLIC_CLR_PROFILER`n",[StringComparison]::Ordinal);$scriptIndex=$text.IndexOf("PUBLIC_WINPS51_SCRIPT`n",[StringComparison]::Ordinal)
    $observation=@{profilerMarker=($nativeIndex -ge 0);scriptMarker=($scriptIndex -ge 0);profilerBeforeScript=($nativeIndex -ge 0 -and $scriptIndex -gt $nativeIndex);exitCode=$code}
    if($isClean){$clean=$observation}else{$positive=$observation}
    if($productCase -and -not $isClean){
     $result.positiveControl=$positive
     # Do not even execute/count the actual-compiler clean child unless its
     # corresponding public native pre-script positive really worked.
     if(-not $positive.profilerMarker){throw 'INCONCLUSIVE_POSITIVE_MARKER_MISSING'}
     if(-not $positive.scriptMarker){throw 'INCONCLUSIVE_POSITIVE_SCRIPT_MISSING'}
     if(-not $positive.profilerBeforeScript){throw 'INCONCLUSIVE_POSITIVE_ORDER'}
     if($positive.exitCode -ne 0){throw 'INCONCLUSIVE_POSITIVE_EXIT'}
    }
   }
   $verdict=Get-ClrPublicPairVerdict $positive $clean;$result.pairs+=@{aliasCase=$lowerCase;unclean=$positive;clean=$clean;verdict=$verdict}
   if($verdict -cne 'PASS'){throw $verdict}
  }
  if($productCase){
   [IO.File]::Delete($events);[IO.File]::WriteAllBytes($retainedEntry,($dummyBytes+[byte]10))
   # The SAME unmodified compiler output must now refuse before dummy execution.
   $code=Invoke-ClrPublicOwnedProcess $productCommand.execute $productCommand.arguments $productCommand.workingDirectory $hooks
   $text=if([IO.File]::Exists($events)){[IO.File]::ReadAllText($events)}else{''};$nativeIndex=$text.IndexOf("PUBLIC_CLR_PROFILER`n",[StringComparison]::Ordinal);$scriptIndex=$text.IndexOf("PUBLIC_WINPS51_SCRIPT`n",[StringComparison]::Ordinal)
   $result.tamperedEntry=@{profilerMarker=($nativeIndex -ge 0);scriptMarker=($scriptIndex -ge 0);profilerBeforeScript=($nativeIndex -ge 0 -and $scriptIndex -gt $nativeIndex);exitCode=$code}
   if($nativeIndex -ge 0 -or $scriptIndex -ge 0 -or $code -ne 1){throw 'PUBLIC_CLR_RETAINED_HASH_REFUSAL_MISSING'}
   $result.retainedHashRefusalObserved=$true;$result.actualProductCompilerLinked=$true
  }
  $result.status='PASS';$result.failureCode='NONE'
 }catch{
  $code=[string]$_.Exception.Message
  if($code -cnotmatch '^(PUBLIC_CLR_[A-Z0-9_]+|INCONCLUSIVE_POSITIVE_[A-Z0-9_]+|FAIL_CLEAN_[A-Z0-9_]+)$'){$code='PUBLIC_CLR_PROBE_FAILED'}
  $result.failureCode=$code;$result.status=if($code.StartsWith('FAIL_')){'FAIL'}else{'INCONCLUSIVE'}
 }finally{
  if($root -and [IO.Directory]::Exists($root)){try{[IO.Directory]::Delete($root,$true)}catch{$result.ownedArtifactsRemoved=$false;$result.status='FAIL';$result.failureCode='PUBLIC_CLR_OWNED_CLEANUP_FAILED'}}
  if(-not $result.ownedChildrenExited){$result.status='FAIL';$result.failureCode='PUBLIC_CLR_OWNED_CHILD_STILL_RUNNING'}
 }
 $result|ConvertTo-Json -Depth 6 -Compress;exit
}
. (Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1')
if(-not (Get-Command Get-OwnerRotationProfileSelection -ErrorAction SilentlyContinue)){throw 'CUTOVER_PROFILE_SELECTION_MISSING'}
$inputData=[Console]::In.ReadToEnd()|ConvertFrom-Json
function node {throw 'FORBIDDEN_PATH_NODE'}
function Get-OwnerLauncherKernelContext {throw 'FORBIDDEN_PRIVATE_KERNEL'}
function Get-OwnerRotationPublicResource {throw 'FORBIDDEN_PUBLIC_API'}
if($Scenario -in @('capsule','execution-boundary')){
 $workflow=[IO.File]::ReadAllText((Join-Path (Split-Path $PSScriptRoot) '.github/workflows/gai-zbook-diagnostic-1218.yml'))
 $step=[regex]::Match($workflow,'(?ms)^      - name: Select closed rotation profile before any PATH Node\n(?<step>.*?)(?=^      - )').Groups['step'].Value
 if(-not $step){throw 'CUTOVER_PROFILE_CAPSULE_MISSING'};$body=[regex]::Match($step,'(?m)^        run: \|\n(?<body>(?:          .*\n)+)').Groups['body'].Value;$code=($body -split '\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
 $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($code,[ref]$tokens,[ref]$errors);if($errors.Count -ne 0){throw 'WORKFLOW_CAPSULE_PARSE'};$resource=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-OwnerRotationSelectorPublicResource'},$true);if(-not $resource){throw 'RESOURCE_BOUNDARY_MISSING'};$program=$code.Remove($resource.Extent.StartOffset,$resource.Extent.EndOffset-$resource.Extent.StartOffset)
 $script:capsuleCalls=[Collections.Generic.List[string]]::new();$script:capsuleCase='';$script:capsuleEntry=[IO.File]::ReadAllBytes((Join-Path (Split-Path $PSScriptRoot) 'scripts/owner-code-rotation-native-1218.ps1'))
 function Get-OwnerRotationSelectorPublicResource([string]$Uri){[void]$script:capsuleCalls.Add($Uri);if($script:capsuleCase -eq 'transport'){throw 'FAKE_TRANSPORT_PRIVATE_CANARY'};if($Uri -ceq 'https://api.github.com/repos/haji84/AI-/git/ref/heads/main'){$sha=if($script:capsuleCase -eq 'main-mismatch'){'f'*40}else{'a'*40};return ,[Text.Encoding]::UTF8.GetBytes(('{"object":{"sha":"'+$sha+'"}}'))};if($Uri -ceq ('https://raw.githubusercontent.com/haji84/AI-/'+('a'*40)+'/scripts/owner-code-rotation-native-1218.ps1')){if($script:capsuleCase -eq 'source-mismatch'){return ,[Text.Encoding]::UTF8.GetBytes("throw 'UNTRUSTED_SOURCE_EXECUTED'")};return ,$script:capsuleEntry};throw 'UNEXPECTED_PUBLIC_URL'}
 $results=@();foreach($request in $inputData.requests){$root=[IO.Path]::Combine([IO.Path]::GetTempPath(),('cutover-public-capsule-'+[IO.Path]::GetRandomFileName()));$null=[IO.Directory]::CreateDirectory([IO.Path]::Combine($root,'owner-native-12345678-1','scripts'));$local=[IO.Path]::Combine($root,'owner-native-12345678-1','scripts','owner-code-rotation-native-1218.ps1');[IO.File]::WriteAllBytes($local,$script:capsuleEntry);$script:capsuleCase=$request.case;$script:capsuleCalls.Clear();foreach($property in $request.environment.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value)};$env:GORIQ_OWNER_ROTATION_SCOPE_BASE64=$request.encoded;$env:GITHUB_WORKSPACE=$root;$env:GITHUB_OUTPUT=[IO.Path]::Combine($root,'profile-output');$env:JARVIS_PRODUCTION_CONFIG=''
  if($request.case -eq 'local-tamper'){[IO.File]::WriteAllText($local,"throw 'UNTRUSTED_SOURCE_EXECUTED'")}
  try{& ([scriptblock]::Create($program));$output=[IO.File]::ReadAllText($env:GITHUB_OUTPUT)
  if($Scenario -eq 'execution-boundary'){
   $env:GORIQ_OWNER_ROTATION_PROFILE='CUTOVER_V1';$env:GORIQ_C1_PROBE_MARKER=[IO.Path]::Combine($root,'owned-marker');$mutation='[IO.File]::WriteAllText($env:GORIQ_C1_PROBE_MARKER,"PUBLIC_UNVERIFIED_ENTRY_EXECUTED"); exit 0'
   if($request.case -eq 'post-selector'){[IO.File]::WriteAllText($local,$mutation)}
   $rotation=[regex]::Match($workflow,'(?ms)^      - name: Run separately approved bounded native rotation entry\n(?<step>.*?)(?=^      - )').Groups['step'].Value;$rotationBody=[regex]::Match($rotation,'(?m)^        run: \|\n(?<body>(?:          .*\n)+)').Groups['body'].Value;$programChild=($rotationBody -split '\n'|ForEach-Object {if($_.Length -ge 10){$_.Substring(10)}else{$_}})-join "`n"
   $t=$null;$err=$null;$tree=[Management.Automation.Language.Parser]::ParseInput($programChild,[ref]$t,[ref]$err);if($err.Count -ne 0){throw 'ROTATION_BODY_PARSE'};$fetchFunction=$tree.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-OwnerRotationSelectorPublicResource'},$true);if($fetchFunction){$programChild=$programChild.Remove($fetchFunction.Extent.StartOffset,$fetchFunction.Extent.EndOffset-$fetchFunction.Extent.StartOffset)}
   $boundary='. ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($entryBytes)))';$boundaryFound=$programChild.Contains($boundary)
   if($request.case -eq 'post-final-verification' -and $boundaryFound){$programChild=$programChild.Replace($boundary,('[IO.File]::WriteAllText($localEntry,'+"'"+$mutation.Replace("'","''")+"'"+");`n"+$boundary))}
   # Substitute only the unavailable Windows child image on Linux; retain the actual body/arguments.
   $shell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;if([IO.Path]::DirectorySeparatorChar -ne [char]92){$programChild=$programChild.Replace("'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'",("'"+$shell.Replace("'","''")+"'"))}
   $fake='function Get-OwnerRotationSelectorPublicResource {'+(Get-Item Function:Get-OwnerRotationSelectorPublicResource).Definition+'}'
   $prefix="`$ErrorActionPreference='Stop'`n"+'$script:capsuleCalls=[Collections.Generic.List[string]]::new();$script:capsuleCase="";$script:capsuleEntry=[Convert]::FromBase64String("'+[Convert]::ToBase64String($script:capsuleEntry)+'");'+"`n"+$fake+"`n"
   $programChild=$programChild.Replace('$bootstrap = Invoke-OwnerCutoverBootstrap',"function Get-OwnerCutoverPublicReadiness {throw 'ROTATION_CUTOVER_BOOTSTRAP_INCOMPLETE'}`n"+'$bootstrap = Invoke-OwnerCutoverBootstrap')
   $scriptPath=[IO.Path]::Combine($root,'actual-rotation-wrapper.ps1');[IO.File]::WriteAllText($scriptPath,$prefix+$programChild,[Text.UTF8Encoding]::new($false));$info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$shell;$info.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$scriptPath+'"';$info.WorkingDirectory=if($request.case -eq 'wrong-cwd'){$root}else{[IO.Path]::Combine($root,'owner-native-12345678-1')};$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$child=[Diagnostics.Process]::new();$child.StartInfo=$info
   try{if(-not $child.Start()){throw 'OWNED_CHILD_START'};$out=$child.StandardOutput.ReadToEndAsync();$errors=$child.StandardError.ReadToEndAsync();if(-not $child.WaitForExit(10000)){$child.Kill();[void]$child.WaitForExit(2000);throw 'OWNED_CHILD_TIMEOUT'};$stdout=$out.Result;$stderr=$errors.Result;$value=$null;try{$value=$stdout|ConvertFrom-Json}catch{};$results+=@{accepted=$true;selectorOutput=$output;modifiedCheckoutExecuted=[IO.File]::Exists($env:GORIQ_C1_PROBE_MARKER);processExit=$child.ExitCode;stdoutValue=$value;stderrPresent=($stderr.Length -gt 0);heldBytesBoundaryFound=$boundaryFound;ownedChildExited=$child.HasExited;actualApiNativeCalls=0}}finally{$child.Dispose()}
  }else{$results+=@{accepted=$true;output=$output;calls=@($script:capsuleCalls)}}}catch{$results+=@{accepted=$false;output='';calls=@($script:capsuleCalls);errorText=[string]$_.Exception.Message}}finally{[IO.Directory]::Delete($root,$true)}
 }
 @{rows=$results;actualApiNativeCalls=0}|ConvertTo-Json -Depth 8 -Compress;exit
}
$rows=@();foreach($request in $inputData.requests){try{$value=Get-OwnerRotationProfileSelection -Encoded $request.encoded -Environment $request.environment -Now ([datetimeoffset]::Parse($request.now));$rows+=@{accepted=$true;value=$value}}catch{$rows+=@{accepted=$false;code='ROTATION_ENTRY_PROFILE_REFUSED'}}}
@{rows=$rows;actualApiNativeCalls=0}|ConvertTo-Json -Depth 8 -Compress

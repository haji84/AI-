[CmdletBinding()]
param([switch]$Inspect,[string]$AuthorizationPath)

# Import/default only define public capabilities. No Owner, grant or file is read.
$script:ownerLauncherGrantKeys=@('schemaVersion','kind','scopeId','issue','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','sourceHashes','ciRunId','ciRunAttempt','workflowPath','ownerSidSha256','taskSha256','roles','issuedAt','expiresAt','maxAttempts','maxFiles','maxBytesPerFile','maxDurationSeconds','highContentReadApproval','allowProtectionRefusedDataRead','newProtectedInspectionObjectsApproval')
function Get-OwnerLauncherNow { [datetimeoffset]::UtcNow }
function Get-OwnerLauncherDigest([byte[]]$Bytes) {
 $sha=[Security.Cryptography.SHA256]::Create();try { ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally {$sha.Dispose()}
}
function ConvertFrom-OwnerLauncherDictionary($Value) {
 if($Value -is [Collections.IDictionary]){$map=[ordered]@{};foreach($key in $Value.Keys){$map.Add($key,(ConvertFrom-OwnerLauncherDictionary $Value[$key]))};return [pscustomobject]$map}
 if($Value -is [array]){return ,@(foreach($item in $Value){ConvertFrom-OwnerLauncherDictionary $item})};return $Value
}
function ConvertFrom-OwnerLauncherJson([string]$Text) {
 if([IO.Path]::DirectorySeparatorChar -ne [char]92){return ($Text|Microsoft.PowerShell.Utility\ConvertFrom-Json -DateKind String)}
 $null=[Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
 $codec=[Web.Script.Serialization.JavaScriptSerializer]::new();$codec.MaxJsonLength=1048576;$codec.RecursionLimit=20
 return (ConvertFrom-OwnerLauncherDictionary ($codec.DeserializeObject($Text)))
}
function Assert-OwnerLauncherShape($Value,[string[]]$Keys) {
 if($null -eq $Value -or $Value -isnot [pscustomobject] -or @($Value.PSObject.Properties).Count -ne $Keys.Count){throw 'LBI_GRANT_REQUIRED'}
 foreach($key in $Keys){if($Value.PSObject.Properties.Name -cnotcontains $key){throw 'LBI_GRANT_REQUIRED'}}
}
function ConvertTo-OwnerLauncherGrantJson($Grant) {
 Assert-OwnerLauncherShape $Grant $script:ownerLauncherGrantKeys
 $ordered=[ordered]@{};foreach($key in $script:ownerLauncherGrantKeys){
  if($key -ceq 'sourceHashes'){$map=[ordered]@{};foreach($file in @('scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')){$map[$file]=$Grant.sourceHashes.$file};$ordered[$key]=$map}
  else{$ordered[$key]=$Grant.$key}
 };return ($ordered|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 6 -Compress)
}
function Assert-OwnerLauncherGrant {
 param($Grant,$Environment,[datetimeoffset]$Now=(Get-OwnerLauncherNow))
 Assert-OwnerLauncherShape $Grant $script:ownerLauncherGrantKeys
 foreach($key in @('schemaVersion','issue','ciRunAttempt','maxAttempts','maxFiles','maxBytesPerFile','maxDurationSeconds')){if($Grant.$key -isnot [int] -and $Grant.$key -isnot [long]){throw 'LBI_GRANT_REQUIRED'}}
 foreach($key in @('kind','scopeId','goalId','authorityType','issuedBy','approvalId','approvalReference','sourceRevision','ciRunId','workflowPath','ownerSidSha256','taskSha256','issuedAt','expiresAt')){if($Grant.$key -isnot [string]){throw 'LBI_GRANT_REQUIRED'}}
 foreach($key in @('highContentReadApproval','allowProtectionRefusedDataRead','newProtectedInspectionObjectsApproval')){if($Grant.$key -isnot [bool]){throw 'LBI_GRANT_REQUIRED'}}
 if($Grant.schemaVersion -ne 1 -or $Grant.issue -ne 1218 -or $Grant.kind -cne 'NONSECRET_ORIGINAL_LAUNCHER_INSPECTION_GRANT' -or $Grant.scopeId -cne 'issue:1218:launcher-binding-inspection' -or $Grant.goalId -cne 'goal-fcc81c97e09153f7' -or $Grant.authorityType -cne 'FRESH_OWNER_HIGH_READ_APPROVAL' -or $Grant.issuedBy -cne 'owner-approved-task-operator' -or -not $Grant.highContentReadApproval -or -not $Grant.newProtectedInspectionObjectsApproval -or $Grant.maxAttempts -ne 1 -or $Grant.maxFiles -ne 2 -or $Grant.maxBytesPerFile -ne 65536 -or $Grant.maxDurationSeconds -ne 60 -or $Grant.ciRunAttempt -lt 1){throw 'LBI_GRANT_REQUIRED'}
 if($Grant.approvalId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' -or $Grant.approvalReference -cnotmatch '^owner-approval:[a-f0-9]{64}$' -or $Grant.sourceRevision -cnotmatch '^[a-f0-9]{40}$' -or $Grant.ciRunId -cnotmatch '^[1-9][0-9]{0,19}$' -or $Grant.workflowPath -cne '.github/workflows/gai-zbook-diagnostic-1218.yml' -or $Grant.ownerSidSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Grant.taskSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'LBI_GRANT_REQUIRED'}
 if($Grant.roles -isnot [array] -or $Grant.roles.Count -ne 2 -or $Grant.roles[0] -isnot [string] -or $Grant.roles[1] -isnot [string] -or $Grant.roles[0] -cne 'compatibility' -or $Grant.roles[1] -cne 'native'){throw 'LBI_GRANT_REQUIRED'}
 $files=@('scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1');Assert-OwnerLauncherShape $Grant.sourceHashes $files
 foreach($file in $files){if($Grant.sourceHashes.$file -isnot [string] -or $Grant.sourceHashes.$file -cnotmatch '^[a-f0-9]{64}$'){throw 'LBI_SOURCE_REJECTED'}}
 if($Grant.sourceHashes.'scripts/rotate-jarvis-owner-code-windows.ps1' -cne '588cae41ffdc4aac330629877e4757844e489fb737564bd0465f7a1f5cfa00f3'){throw 'LBI_SOURCE_REJECTED'}
 if($Environment.GITHUB_ACTOR -cne 'haji84' -or $Environment.GITHUB_REPOSITORY -cne 'haji84/AI-' -or $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_SHA -cne $Grant.sourceRevision -or $Environment.GITHUB_RUN_ID -cnotmatch '^[1-9][0-9]{0,19}$' -or $Environment.GITHUB_RUN_ATTEMPT -cne '1' -or $Environment.GITHUB_WORKFLOW_REF -cne 'haji84/AI-/.github/workflows/gai-zbook-diagnostic-1218.yml@refs/heads/main'){throw 'LBI_CONTEXT_REQUIRED'}
 foreach($key in @('issuedAt','expiresAt')){if($Grant.$key -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'){throw 'LBI_GRANT_REQUIRED'}}
 try{$issued=[datetimeoffset]::Parse($Grant.issuedAt);$expires=[datetimeoffset]::Parse($Grant.expiresAt)}catch{throw 'LBI_GRANT_REQUIRED'}
 if($issued -gt $Now -or ($expires-$Now).TotalSeconds -lt 60 -or $expires -le $issued -or ($expires-$issued).TotalSeconds -gt 7200 -or $expires -gt [datetimeoffset]::Parse('2026-11-10T08:00:00Z')){throw 'LBI_EXPIRED'}
}
function ConvertFrom-OwnerLauncherGrantBase64 {
 param([string]$Encoded,$Environment,[datetimeoffset]$Now=(Get-OwnerLauncherNow))
 try{
  if(-not $Encoded -or $Encoded.Length -gt 10924 -or $Encoded -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'LBI_GRANT_REQUIRED'}
  $bytes=[Convert]::FromBase64String($Encoded);if($bytes.Length -gt 8192 -or [Convert]::ToBase64String($bytes) -cne $Encoded){throw 'LBI_GRANT_REQUIRED'}
  $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes);$grant=ConvertFrom-OwnerLauncherJson $text
  Assert-OwnerLauncherGrant -Grant $grant -Environment $Environment -Now $Now
  if((ConvertTo-OwnerLauncherGrantJson $grant) -cne $text){throw 'LBI_GRANT_REQUIRED'};return $grant
 }catch{throw 'LBI_GRANT_REQUIRED'}
}
function New-OwnerLauncherResult {
 return [ordered]@{schemaVersion=1;issue=1218;operation='launcher-binding-inspection';complete=$false;failureCode='LBI_UNVERIFIED';sourceRevision=$null;workflowRunId=$null;workflowRunAttempt=$null;sourceHashesVerified=$false;publicCiVerified=$false;actualWindowsOwnerContextVerified=$false;taskBindingVerified=$false;claimConsumed=$false;exactlyTwoTargets=$false;compatibilityStructure='UNKNOWN';nativeStructure='UNKNOWN';fixedDelegationMatched=$false;nativeRelationCandidate=$false;protectedLocalRecordWritten=$false;noExecution=$true;authorizationGranted=$false;readyForRotation=$false;actualAcceptanceConditionsPassed=0}
}
function Assert-OwnerLauncherDeadline([datetimeoffset]$Deadline) {if((Get-OwnerLauncherNow) -ge $Deadline){throw 'LBI_EXPIRED'}}
function Get-OwnerLauncherPublicResource([string]$Uri) {
 if($Uri -cnotmatch '^https://(?:api\.github\.com/repos/haji84/AI-/|raw\.githubusercontent\.com/haji84/AI-/)[A-Za-z0-9?=._/-]+$'){throw 'LBI_SOURCE_REJECTED'}
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $request=[Net.HttpWebRequest]::Create($Uri);$request.Method='GET';$request.AllowAutoRedirect=$false;$request.Timeout=10000;$request.ReadWriteTimeout=10000;$request.UserAgent='GORIQ-1218-fixed-launcher-inspection';$request.Accept='application/vnd.github+json'
 $response=$null;$stream=$null;$memory=[IO.MemoryStream]::new()
 try{$response=$request.GetResponse();if([int]$response.StatusCode -ne 200){throw 'LBI_SOURCE_REJECTED'};$stream=$response.GetResponseStream();$buffer=New-Object byte[] 8192;while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){if($memory.Length+$count -gt 1048576){throw 'LBI_SOURCE_REJECTED'};$memory.Write($buffer,0,$count)};return ,$memory.ToArray()}finally{if($stream){$stream.Dispose()};if($response){$response.Dispose()};$memory.Dispose()}
}
function Assert-OwnerLauncherPublicSource($Grant,[string]$Root) {
 $base='https://api.github.com/repos/haji84/AI-/'
 $main=ConvertFrom-OwnerLauncherJson ([Text.Encoding]::UTF8.GetString((Get-OwnerLauncherPublicResource ($base+'git/ref/heads/main'))))
 $run=ConvertFrom-OwnerLauncherJson ([Text.Encoding]::UTF8.GetString((Get-OwnerLauncherPublicResource ($base+'actions/runs/'+$Grant.ciRunId))))
 if($main.object.sha -cne $Grant.sourceRevision -or [string]$run.id -cne $Grant.ciRunId -or $run.run_attempt -ne $Grant.ciRunAttempt -or $run.name -cne 'CI' -or $run.path -cne '.github/workflows/ci.yml' -or $run.event -cne 'push' -or $run.head_branch -cne 'main' -or $run.head_sha -cne $Grant.sourceRevision -or $run.status -cne 'completed' -or $run.conclusion -cne 'success'){throw 'LBI_SOURCE_REJECTED'}
 $jobs=ConvertFrom-OwnerLauncherJson ([Text.Encoding]::UTF8.GetString((Get-OwnerLauncherPublicResource ($base+'actions/runs/'+$Grant.ciRunId+'/attempts/'+$Grant.ciRunAttempt+'/jobs?per_page=100'))))
 $names=@('repository-guard','project-checks','independent-verifier-container','windows-runtime-byte-fixtures');if(@($jobs.jobs).Count -ne 4){throw 'LBI_SOURCE_REJECTED'}
 foreach($name in $names){$selected=@($jobs.jobs|Where-Object {$_.name -ceq $name -and $_.status -ceq 'completed' -and $_.conclusion -ceq 'success'});if($selected.Count -ne 1){throw 'LBI_SOURCE_REJECTED'}}
 foreach($file in @('scripts/owner-code-launcher-binding-inspection-1218.ps1','scripts/rotate-jarvis-owner-code-windows.ps1')){
  $remote=Get-OwnerLauncherPublicResource ('https://raw.githubusercontent.com/haji84/AI-/'+$Grant.sourceRevision+'/'+$file)
  $path=Get-OwnerLauncherSafePath ([IO.Path]::GetFullPath([IO.Path]::Combine($Root,$file)));$local=[IO.File]::ReadAllBytes($path)
  if($local.Length -gt 262144 -or $remote.Length -gt 262144 -or (Get-OwnerLauncherDigest $local) -cne $Grant.sourceHashes.$file -or (Get-OwnerLauncherDigest $remote) -cne $Grant.sourceHashes.$file){throw 'LBI_SOURCE_REJECTED'}
 };return $true
}
function Get-OwnerLauncherSafePath([string]$Path) {
 if(-not $Path -or $Path -match '[\r\n\0]' -or $Path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($Path)){throw 'LBI_ACQUISITION_REJECTED'}
 $full=[IO.Path]::GetFullPath($Path);$root=[IO.Path]::GetPathRoot($full);if($full -ine $Path){throw 'LBI_ACQUISITION_REJECTED'}
 if([IO.Path]::DirectorySeparatorChar -eq [char]92 -and ($full -cnotmatch '^[A-Za-z]:\\[^:]*$' -or ([IO.DriveInfo]::new($root)).DriveType -ne [IO.DriveType]::Fixed)){throw 'LBI_ACQUISITION_REJECTED'}
 $current=$root;foreach($part in @('')+$full.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)){if($part){$current=[IO.Path]::Combine($current,$part)};try{$attrs=[IO.File]::GetAttributes($current)}catch{throw 'LBI_ACQUISITION_REJECTED'};if(($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'LBI_ACQUISITION_REJECTED'}};return $full
}
function Get-OwnerLauncherKernelContext {
 if([IO.Path]::DirectorySeparatorChar -ne [char]92 -or $PSVersionTable.PSVersion.Major -ne 5 -or $ExecutionContext.SessionState.LanguageMode -cne 'FullLanguage'){throw 'LBI_CONTEXT_REQUIRED'}
 $fixed=[IO.Path]::Combine([Environment]::GetFolderPath('System'),'WindowsPowerShell','v1.0','powershell.exe');$actual=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
 if($actual -ine $fixed){throw 'LBI_CONTEXT_REQUIRED'};$null=Get-OwnerLauncherSafePath $fixed
 $signature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $fixed;if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|, )O=Microsoft Corporation(?:,|$)'){throw 'LBI_CONTEXT_REQUIRED'}
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 try{return [pscustomobject]@{isWindows=$true;languageMode=[string]$ExecutionContext.SessionState.LanguageMode;processPath=$actual;systemPowerShell=$fixed;trustedPowerShell=$true;ownerSid=$identity.User.Value;ownerName=$identity.Name;isSystem=$identity.IsSystem;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;interactive=[Environment]::UserInteractive;profile=[Environment]::GetFolderPath('UserProfile');localAppData=[Environment]::GetFolderPath('LocalApplicationData');environmentProfile=$env:USERPROFILE;environmentLocalAppData=$env:LOCALAPPDATA}}finally{$identity.Dispose()}
}
function Get-OwnerLauncherTask { ScheduledTasks\Get-ScheduledTask -TaskName 'JARVIS Remote Host' -ErrorAction Stop }
function Assert-OwnerLauncherContext($Grant,$Environment,$Context,$Task) {
 Assert-OwnerLauncherGrant -Grant $Grant -Environment $Environment
 if($Context.isWindows -isnot [bool] -or -not $Context.isWindows -or $Context.trustedPowerShell -isnot [bool] -or -not $Context.trustedPowerShell -or $Context.languageMode -cne 'FullLanguage' -or $Context.processPath -ine $Context.systemPowerShell -or $Context.isSystem -or $Context.sessionId -le 0 -or -not $Context.interactive -or $Context.ownerSid -cnotmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or (Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes($Context.ownerSid))) -cne $Grant.ownerSidSha256){throw 'LBI_CONTEXT_REQUIRED'}
 foreach($key in @('profile','localAppData')){if(-not [IO.Path]::IsPathRooted($Context.$key) -or [IO.Path]::GetFullPath($Context.$key) -ine $Context.$key){throw 'LBI_CONTEXT_REQUIRED'}}
 if($Context.profile -ine $Context.environmentProfile -or $Context.localAppData -ine $Context.environmentLocalAppData -or -not $Context.localAppData.StartsWith($Context.profile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'LBI_CONTEXT_REQUIRED'}
 $targets=[ordered]@{compatibility=[IO.Path]::Combine($Context.localAppData,'JARVIS','production','launch-current.ps1');native=[IO.Path]::Combine($Context.profile,'JARVIS','production','launch-current.ps1')}
 $actions=@($Task.Actions);if($actions.Count -ne 1 -or $Task.TaskName -cne 'JARVIS Remote Host' -or $Task.TaskPath -cne '\' -or [string]$Task.State -cne 'Running' -or [string]$Task.Principal.LogonType -cne 'Password' -or [string]$Task.Principal.RunLevel -cne 'Limited' -or [string]$actions[0].Execute -ine $Context.systemPowerShell -or [string]$actions[0].Arguments -cne ('-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$targets.compatibility+'"')){throw 'LBI_TASK_REJECTED'}
 $principal=[string]$Task.Principal.UserId;$matched=$principal -ceq $Context.ownerSid -or $principal -ieq $Context.ownerName
 if(-not $matched){$parts=@($Context.ownerName.Split([char]92));if($parts.Count -eq 2 -and $parts[0] -ieq [Environment]::MachineName -and $principal -ieq $parts[1]){try{$matched=([Security.Principal.NTAccount]::new([Environment]::MachineName,$principal)).Translate([Security.Principal.SecurityIdentifier]).Value -ceq $Context.ownerSid}catch{$matched=$false}}}
 $taskHash=Get-OwnerRotationTaskHash $Task;if(-not $matched -or $taskHash -cne $Grant.taskSha256){throw 'LBI_TASK_REJECTED'}
 return @{grant=$Grant;environment=$Environment;context=$Context;taskHash=$taskHash;targets=$targets;deadline=(Get-OwnerLauncherNow).AddSeconds(60);grantHash=(Get-OwnerLauncherDigest ([Text.Encoding]::UTF8.GetBytes((ConvertTo-OwnerLauncherGrantJson $Grant))))}
}
function Initialize-OwnerLauncherNative {
 if('GoriqLauncherInspectionNative' -as [type]){return}
 Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;using System.IO;using System.Text;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class GoriqLauncherInspectionNative {
 [StructLayout(LayoutKind.Sequential)] public struct Info {public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,High,Low,Links,IndexHigh,IndexLow;}
 [StructLayout(LayoutKind.Sequential)] struct SA {public int Length;public IntPtr Descriptor;public int Inherit;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectory(string path,ref SA security);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 public static string[] Identity(SafeFileHandle file){Info i;if(!GetFileInformationByHandle(file,out i))throw new IOException();var b=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(file,b,(uint)b.Capacity,0);if(n==0||n>=b.Capacity)throw new IOException();return new[]{i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8"),b.ToString(),i.Links.ToString()};}
 public static void NewDirectory(string path,byte[] descriptor){var pin=GCHandle.Alloc(descriptor,GCHandleType.Pinned);try{var sa=new SA{Length=Marshal.SizeOf(typeof(SA)),Descriptor=pin.AddrOfPinnedObject(),Inherit=0};if(!CreateDirectory(path,ref sa))throw new IOException();}finally{pin.Free();}}
 // Include FILE_LIST_DIRECTORY so the handle participates in sharing checks;
 // FILE_READ_ATTRIBUTES alone is a metadata-only open. No entries are listed.
 public static SafeFileHandle HoldDirectory(string path){var handle=CreateFile(path,0x00000001|0x00000080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle.IsInvalid){handle.Dispose();throw new IOException();}try{Info info;if(!GetFileInformationByHandle(handle,out info)||(info.Attributes&16)==0||(info.Attributes&1024)!=0)throw new IOException();var identity=Identity(handle);var final=identity[1];if(final.StartsWith("\\\\?\\"))final=final.Substring(4);if(!String.Equals(final.TrimEnd('\\'),path.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new IOException();return handle;}catch{handle.Dispose();throw;}}
}
'@ | Out-Null
}
function Get-OwnerLauncherHandleIdentity($Stream,[string]$Path) {
 Initialize-OwnerLauncherNative;$parts=[GoriqLauncherInspectionNative]::Identity($Stream.SafeFileHandle);$final=$parts[1];if($final.StartsWith('\\?\')){$final=$final.Substring(4)}
 return @{key=$parts[0];finalPath=$final;links=[int]$parts[2]}
}
function New-OwnerLauncherSecurity([string]$OwnerSid,[bool]$Directory) {
 $security=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()};$security.SetAccessRuleProtection($true,$false);$security.SetOwner([Security.Principal.SecurityIdentifier]::new($OwnerSid))
 foreach($sid in @($OwnerSid,'S-1-5-18','S-1-5-32-544')){$inherit=if($Directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None};$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))};return $security
}
function Get-OwnerLauncherParentLocks([string]$Path) {
 Initialize-OwnerLauncherNative;$parent=Get-OwnerLauncherSafePath ([IO.Path]::GetDirectoryName($Path));$root=[IO.Path]::GetPathRoot($parent);$current=$root
 $handles=[Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
 try{
  foreach($part in @('')+$parent.Substring($root.Length).Split([IO.Path]::DirectorySeparatorChar)){if($part){$current=[IO.Path]::Combine($current,$part)};$handles.Add([GoriqLauncherInspectionNative]::HoldDirectory($current))}
  $null=Get-OwnerLauncherSafePath $parent;return ,$handles.ToArray()
 }catch{foreach($handle in $handles){$handle.Dispose()};throw 'LBI_ACQUISITION_REJECTED'}
}
function New-OwnerLauncherProtectedFile([string]$Path,[byte[]]$Bytes,[string]$OwnerSid) {
 $locks=Get-OwnerLauncherParentLocks $Path;$stream=$null
 try{$security=New-OwnerLauncherSecurity $OwnerSid $false;$stream=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$security);$stream.Write($Bytes,0,$Bytes.Length);$stream.Flush($true)}finally{if($stream){$stream.Dispose()};foreach($handle in $locks){$handle.Dispose()}}
}
function New-OwnerLauncherProtectedDirectory([string]$Path,[string]$OwnerSid) {
 $locks=Get-OwnerLauncherParentLocks $Path
 try{$security=New-OwnerLauncherSecurity $OwnerSid $true;[GoriqLauncherInspectionNative]::NewDirectory($Path,$security.GetSecurityDescriptorBinaryForm())}finally{foreach($handle in $locks){$handle.Dispose()}}
}
function New-OwnerLauncherRuntime($Admission) {
 $g=$Admission.grant;$c=$Admission.context;Assert-OwnerLauncherDeadline $Admission.deadline
 $profile=Get-OwnerRotationSafePath -Path $c.profile -NativeMetadata
 Assert-OwnerRotationProtectedPath -Path $profile -OwnerSid $c.ownerSid -OwnerProfile $profile -NativeMetadata
 $stage=[IO.Path]::Combine($profile,('.goriq-owner-launcher-inspection-1218-'+$g.approvalId));$claim=$stage+'.claim'
 if([IO.Directory]::Exists($stage) -or [IO.File]::Exists($stage) -or [IO.File]::Exists($claim) -or [IO.Directory]::Exists($claim)){throw 'LBI_ATTEMPT_CONSUMED'}
 $claimRecord=[ordered]@{schemaVersion=1;approvalId=$g.approvalId;originalGrantSha256=$Admission.grantHash;sourceRevision=$g.sourceRevision;workflowRunId=$Admission.environment.GITHUB_RUN_ID;workflowRunAttempt=1}
 $claimBytes=[Text.Encoding]::UTF8.GetBytes(($claimRecord|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress))
 try{New-OwnerLauncherProtectedFile -Path $claim -Bytes $claimBytes -OwnerSid $c.ownerSid}catch{throw 'LBI_ATTEMPT_CONSUMED'}
 $Admission.claimConsumed=$true
 Assert-OwnerRotationProtectedPath -Path $claim -OwnerSid $c.ownerSid -OwnerProfile $profile -NativeMetadata
 Assert-OwnerLauncherDeadline $Admission.deadline;New-OwnerLauncherProtectedDirectory -Path $stage -OwnerSid $c.ownerSid
 Assert-OwnerRotationProtectedPath -Path $stage -OwnerSid $c.ownerSid -OwnerProfile $profile -NativeMetadata
 $receipt=[IO.Path]::Combine($stage,'runtime-receipt.json');$findings=[IO.Path]::Combine($stage,'binding-record.json')
 $runtime=[ordered]@{schemaVersion=1;kind='INSPECTION_RUNTIME_RECEIPT';originalGrantSha256=$Admission.grantHash;grant=$g;ownerSid=$c.ownerSid;profile=$profile;localAppData=$c.localAppData;targets=$Admission.targets;sourceRevision=$g.sourceRevision;taskSha256=$Admission.taskHash;workflowRunId=$Admission.environment.GITHUB_RUN_ID;workflowRunAttempt=1;deadline=$Admission.deadline.ToString('o');claimPath=$claim;receiptPath=$receipt;findingsPath=$findings}
 $bytes=[Text.Encoding]::UTF8.GetBytes(($runtime|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 10 -Compress));New-OwnerLauncherProtectedFile -Path $receipt -Bytes $bytes -OwnerSid $c.ownerSid
 Assert-OwnerRotationProtectedPath -Path $receipt -OwnerSid $c.ownerSid -OwnerProfile $profile -NativeMetadata
 $held=[IO.File]::Open($receipt,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{if($held.Length -ne $bytes.Length){throw 'LBI_ACQUISITION_REJECTED'};$copy=New-Object byte[] $bytes.Length;$count=$held.Read($copy,0,$copy.Length);if($count -ne $copy.Length -or (Get-OwnerLauncherDigest $copy) -cne (Get-OwnerLauncherDigest $bytes)){throw 'LBI_ACQUISITION_REJECTED'}}finally{$held.Dispose()}
 return @{claimPath=$claim;claimHash=(Get-OwnerLauncherDigest $claimBytes);receiptPath=$receipt;findingsPath=$findings;receiptHash=(Get-OwnerLauncherDigest $bytes);runtime=$runtime;admission=$Admission;used=$false}
}
function Assert-OwnerLauncherLocalRecord([string]$Path,[string]$ExpectedHash,[string]$Profile,[string]$OwnerSid,[datetimeoffset]$Deadline) {
 Assert-OwnerLauncherDeadline $Deadline;$safe=Get-OwnerLauncherSafePath $Path
 Assert-OwnerRotationProtectedPath -Path $safe -OwnerSid $OwnerSid -OwnerProfile $Profile -NativeMetadata
 $stream=$null;$other=$null
 try{
  $stream=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  if($stream.Length -gt 16384){throw 'LBI_CONTEXT_REQUIRED'};$first=Get-OwnerLauncherHandleIdentity -Stream $stream -Path $safe
  if($first.links -ne 1 -or $first.finalPath -ine $safe){throw 'LBI_CONTEXT_REQUIRED'}
  $bytes=New-Object byte[] ([int]$stream.Length);$count=0;while($count -lt $bytes.Length){$n=$stream.Read($bytes,$count,$bytes.Length-$count);if($n -eq 0){throw 'LBI_CONTEXT_REQUIRED'};$count+=$n}
  $null=Get-OwnerLauncherSafePath $safe;$other=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$after=Get-OwnerLauncherHandleIdentity -Stream $other -Path $safe
  if($after.links -ne 1 -or $after.finalPath -ine $safe -or $after.key -cne $first.key -or $other.Length -ne $bytes.Length -or (Get-OwnerLauncherDigest $bytes) -cne $ExpectedHash){throw 'LBI_CONTEXT_REQUIRED'}
  Assert-OwnerLauncherDeadline $Deadline
 }finally{if($stream){$stream.Dispose()};if($other){$other.Dispose()}}
}
function Read-OwnerLauncherData {
 param([string]$Path,[string]$OwnerSid,[bool]$AllowProtectionRefusedDataRead,[datetimeoffset]$Deadline)
 Assert-OwnerLauncherDeadline $Deadline;$safe=Get-OwnerLauncherSafePath $Path;$protected='matched'
 try{Assert-OwnerRotationProtectedPath -Path $safe -OwnerSid $OwnerSid -NativeMetadata}catch{if(-not $AllowProtectionRefusedDataRead){throw 'LBI_ACQUISITION_REJECTED'};$protected='refused'}
 $stream=$null;$second=$null
 try{
  Assert-OwnerLauncherDeadline $Deadline;$stream=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $first=Get-OwnerLauncherHandleIdentity -Stream $stream -Path $safe
  if($first.links -ne 1 -or $first.finalPath -ine $safe -or $stream.Length -gt 65536){throw 'LBI_ACQUISITION_REJECTED'}
  $buffer=New-Object byte[] 65537;$count=0
  while($count -lt $buffer.Length){Assert-OwnerLauncherDeadline $Deadline;$n=$stream.Read($buffer,$count,$buffer.Length-$count);if($n -eq 0){break};$count+=$n}
  if($count -gt 65536){throw 'LBI_ACQUISITION_REJECTED'}
  $null=Get-OwnerLauncherSafePath $safe;$second=[IO.File]::Open($safe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $after=Get-OwnerLauncherHandleIdentity -Stream $second -Path $safe
  if($after.key -cne $first.key -or $after.links -ne 1 -or $after.finalPath -ine $safe -or $second.Length -ne $count -or $stream.Length -ne $count){throw 'LBI_ACQUISITION_REJECTED'}
  Assert-OwnerLauncherDeadline $Deadline;$bytes=New-Object byte[] $count;[Array]::Copy($buffer,$bytes,$count)
  return @{bytes=$bytes;sha256=(Get-OwnerLauncherDigest $bytes);identity=$first;protection=$protected}
 }finally{if($stream){$stream.Dispose()};if($second){$second.Dispose()}}
}
function Get-OwnerLauncherLiteral($Node) {
 if($Node.PSObject.Properties.Name -contains 'Redirections' -and $Node.Redirections.Count -ne 0){throw 'LBI_AST_UNKNOWN'}
 if($Node -is [Management.Automation.Language.PipelineAst] -and $Node.PSObject.Properties.Name -contains 'Background' -and $Node.Background){throw 'LBI_AST_UNKNOWN'}
 if($Node -is [Management.Automation.Language.StatementBlockAst] -and $Node.Statements.Count -eq 1){return (Get-OwnerLauncherLiteral $Node.Statements[0])}
 if($Node -is [Management.Automation.Language.PipelineAst] -and $Node.PipelineElements.Count -eq 1){return (Get-OwnerLauncherLiteral $Node.PipelineElements[0])}
 if($Node -is [Management.Automation.Language.CommandExpressionAst]){return (Get-OwnerLauncherLiteral $Node.Expression)}
 if($Node -is [Management.Automation.Language.StringConstantExpressionAst]){return [string]$Node.Value};throw 'LBI_AST_UNKNOWN'
}
function Get-OwnerLauncherStructure {
 param([byte[]]$Bytes,[ValidateSet('compatibility','native')][string]$Role,[string]$NativePath)
 $answer=@{kind='UNKNOWN';environmentLiteralsPresent=$false;nodeCandidate=$null;releaseCandidate=$null;configCandidate=$null;fixedDelegationMatched=$false}
 try{
  if($Bytes.Length -gt 65536){return $answer}
  if($Bytes.Length -ge 2 -and $Bytes[0] -eq 255 -and $Bytes[1] -eq 254){$text=[Text.UnicodeEncoding]::new($false,$true,$true).GetString($Bytes,2,$Bytes.Length-2)}
  else{$text=[Text.UTF8Encoding]::new($false,$true).GetString($Bytes).TrimStart([char]0xfeff)}
  if($text.IndexOf([char]0) -ge 0){return $answer};$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
  if(@($errors).Count -ne 0 -or $ast.ParamBlock -or $ast.BeginBlock -or $ast.ProcessBlock -or $ast.DynamicParamBlock -or $ast.EndBlock.Traps.Count -ne 0){return $answer}
  if($ast.UsingStatements.Count -ne 0 -or $ast.Attributes.Count -ne 0 -or $null -ne $ast.ScriptRequirements -or -not $ast.EndBlock.Unnamed){return $answer}
  if($ast.PSObject.Properties.Name -contains 'CleanBlock' -and $null -ne $ast.CleanBlock){return $answer}
  $effects=@($ast.FindAll({param($node)
   if($node -is [Management.Automation.Language.RedirectionAst]){return $true}
   if($node -is [Management.Automation.Language.PipelineAst] -and $node.PSObject.Properties.Name -contains 'Background'){return $node.Background}
   return $false
  },$true));if($effects.Count -ne 0){return $answer}
  $statements=@($ast.EndBlock.Statements)
  if($Role -ceq 'compatibility'){
   if($statements.Count -ne 1 -or $statements[0] -isnot [Management.Automation.Language.PipelineAst] -or $statements[0].PipelineElements.Count -ne 1){return $answer};$command=$statements[0].PipelineElements[0]
   if($command -is [Management.Automation.Language.CommandAst] -and $command.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Ampersand -and $command.Redirections.Count -eq 0 -and $command.CommandElements.Count -eq 1 -and (Get-OwnerLauncherLiteral $command.CommandElements[0]) -ieq $NativePath){$answer.kind='FIXED_COMPATIBILITY_DELEGATION';$answer.fixedDelegationMatched=$true};return $answer
  }
  $location=$null;$node=$null;$hostPath=$null;$config=$null;$environment=$false;$invoked=$false;$exited=$false
  foreach($statement in $statements){
   if($statement -is [Management.Automation.Language.AssignmentStatementAst] -and -not $invoked){
    if($statement.Left -isnot [Management.Automation.Language.VariableExpressionAst] -or $statement.Operator -ne [Management.Automation.Language.TokenKind]::Equals){throw 'LBI_AST_UNKNOWN'}
    $name=$statement.Left.VariablePath.UserPath;$literal=Get-OwnerLauncherLiteral $statement.Right
    if($name -ceq 'ErrorActionPreference'){if($literal -cne 'Stop'){throw 'LBI_AST_UNKNOWN'}}
    elseif($name -cmatch '^env:[A-Za-z_][A-Za-z0-9_]*$'){$environment=$true;if($name -ceq 'env:JARVIS_PRODUCTION_CONFIG'){if($config){throw 'LBI_AST_UNKNOWN'};$config=$literal}}
    else{throw 'LBI_AST_UNKNOWN'};continue
   }
   if($statement -is [Management.Automation.Language.ExitStatementAst] -and $invoked -and -not $exited){if($statement.Pipeline.Extent.Text -cne '$LASTEXITCODE'){throw 'LBI_AST_UNKNOWN'};$exited=$true;continue}
   if($statement -isnot [Management.Automation.Language.PipelineAst] -or $statement.PipelineElements.Count -ne 1 -or $exited){throw 'LBI_AST_UNKNOWN'};$command=$statement.PipelineElements[0]
   if($command -isnot [Management.Automation.Language.CommandAst] -or $command.Redirections.Count -ne 0){throw 'LBI_AST_UNKNOWN'};$elements=@($command.CommandElements)
   if(-not $invoked -and -not $location -and $command.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Unknown -and $elements.Count -eq 3 -and (Get-OwnerLauncherLiteral $elements[0]) -ceq 'Set-Location' -and $elements[1] -is [Management.Automation.Language.CommandParameterAst] -and $elements[1].ParameterName -ceq 'LiteralPath'){$location=Get-OwnerLauncherLiteral $elements[2];continue}
   if(-not $invoked -and $command.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Ampersand -and $elements.Count -eq 2){$node=Get-OwnerLauncherLiteral $elements[0];$hostPath=Get-OwnerLauncherLiteral $elements[1];$invoked=$true;continue};throw 'LBI_AST_UNKNOWN'
  }
  if(-not $invoked -or -not $location -or -not $config -or -not [IO.Path]::IsPathRooted($node) -or [IO.Path]::GetFileName($node) -ine 'node.exe' -or $hostPath -ine [IO.Path]::Combine($location,'scripts','jarvis-remote-host.mjs') -or $config -ine [IO.Path]::Combine([IO.Path]::GetDirectoryName($NativePath),'config.dpapi')){return $answer}
  foreach($path in @($node,$location,$config)){if($path -match '[\r\n\0]' -or $path -match '^[\\/]{2}' -or -not [IO.Path]::IsPathRooted($path) -or [IO.Path]::GetFullPath($path) -ine $path){throw 'LBI_AST_UNKNOWN'}}
  $answer.kind='NATIVE_LITERAL_NODE_HOST';$answer.environmentLiteralsPresent=$environment;$answer.nodeCandidate=$node;$answer.releaseCandidate=$location;$answer.configCandidate=$config
 }catch{};return $answer
}
function Invoke-OwnerLauncherLocalInspection($Prepared,[string]$AuthorizationPath) {
 $a=$Prepared.admission;$g=$a.grant;$c=$a.context
 if($Prepared.used){throw 'LBI_ATTEMPT_CONSUMED'};$Prepared.used=$true
 if($AuthorizationPath -cne $Prepared.receiptPath -or $AuthorizationPath -cne [IO.Path]::Combine($c.profile,('.goriq-owner-launcher-inspection-1218-'+$g.approvalId),'runtime-receipt.json')){throw 'LBI_CONTEXT_REQUIRED'}
 Assert-OwnerLauncherDeadline $a.deadline
 Assert-OwnerLauncherLocalRecord -Path $Prepared.claimPath -ExpectedHash $Prepared.claimHash -Profile $c.profile -OwnerSid $c.ownerSid -Deadline $a.deadline
 Assert-OwnerLauncherLocalRecord -Path $AuthorizationPath -ExpectedHash $Prepared.receiptHash -Profile $c.profile -OwnerSid $c.ownerSid -Deadline $a.deadline
 $records=@();$summaries=@{}
 foreach($role in @('compatibility','native')){
  Assert-OwnerLauncherDeadline $a.deadline;Assert-OwnerLauncherGrant -Grant $g -Environment $a.environment
  $current=Get-OwnerLauncherKernelContext;$task=Get-OwnerLauncherTask;$fresh=Assert-OwnerLauncherContext -Grant $g -Environment $a.environment -Context $current -Task $task
  if($fresh.context.ownerSid -cne $c.ownerSid -or $fresh.context.profile -ine $c.profile -or $fresh.targets[$role] -ine $a.targets[$role]){throw 'LBI_CONTEXT_REQUIRED'}
  $data=Read-OwnerLauncherData -Path $a.targets[$role] -OwnerSid $c.ownerSid -AllowProtectionRefusedDataRead $g.allowProtectionRefusedDataRead -Deadline $a.deadline
  try{$structure=Get-OwnerLauncherStructure -Bytes $data.bytes -Role $role -NativePath $a.targets.native;$summaries[$role]=$structure;$records+=@{role=$role;sha256=$data.sha256;identity=$data.identity;protection=$data.protection;structure=$structure}}finally{[Array]::Clear($data.bytes,0,$data.bytes.Length)}
 }
 Assert-OwnerLauncherDeadline $a.deadline;$record=[ordered]@{schemaVersion=1;sourceRevision=$g.sourceRevision;originalGrantSha256=$a.grantHash;workflowRunId=$a.environment.GITHUB_RUN_ID;workflowRunAttempt=1;taskSha256=$a.taskHash;files=$records;authorizationGranted=$false;readyForRotation=$false}
 New-OwnerLauncherProtectedFile -Path $Prepared.findingsPath -Bytes ([Text.Encoding]::UTF8.GetBytes(($record|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 10 -Compress))) -OwnerSid $c.ownerSid
 Assert-OwnerRotationProtectedPath -Path $Prepared.findingsPath -OwnerSid $c.ownerSid -OwnerProfile $c.profile -NativeMetadata
 return $summaries
}
function Invoke-OwnerLauncherBindingInspection {
 param([string]$RequestedAuthorizationPath)
 $result=New-OwnerLauncherResult;$ErrorActionPreference='Stop';$admission=$null
 try{
  if($RequestedAuthorizationPath){throw 'LBI_GRANT_REQUIRED'}
  $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
  $environment=[pscustomobject]@{GITHUB_ACTOR=$env:GITHUB_ACTOR;GITHUB_REPOSITORY=$env:GITHUB_REPOSITORY;GITHUB_REF=$env:GITHUB_REF;GITHUB_SHA=$env:GITHUB_SHA;GITHUB_RUN_ID=$env:GITHUB_RUN_ID;GITHUB_RUN_ATTEMPT=$env:GITHUB_RUN_ATTEMPT;GITHUB_WORKFLOW_REF=$env:GITHUB_WORKFLOW_REF}
  $grant=ConvertFrom-OwnerLauncherGrantBase64 -Encoded $env:GORIQ_OWNER_LAUNCHER_BINDING_GRANT_BASE64 -Environment $environment
  $deadline=(Get-OwnerLauncherNow).AddSeconds(60);$result.sourceRevision=$grant.sourceRevision;$result.workflowRunId=$environment.GITHUB_RUN_ID;$result.workflowRunAttempt=1
  $context=Get-OwnerLauncherKernelContext
  $root=[IO.Path]::GetDirectoryName($PSScriptRoot);$null=Assert-OwnerLauncherPublicSource -Grant $grant -Root $root;$result.sourceHashesVerified=$true;$result.publicCiVerified=$true;Assert-OwnerLauncherDeadline $deadline
  $publicCore=[IO.File]::ReadAllBytes((Get-OwnerLauncherSafePath ([IO.Path]::Combine($root,'scripts','rotate-jarvis-owner-code-windows.ps1'))))
  if((Get-OwnerLauncherDigest $publicCore) -cne $grant.sourceHashes.'scripts/rotate-jarvis-owner-code-windows.ps1'){throw 'LBI_SOURCE_REJECTED'}
  # These are verified PUBLIC source bytes, never an inspected private AST.
  . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($publicCore))) -Apply:$false -AuthorizationPath ''
  $task=Get-OwnerLauncherTask;$admission=Assert-OwnerLauncherContext -Grant $grant -Environment $environment -Context $context -Task $task;$admission.deadline=$deadline
  $result.actualWindowsOwnerContextVerified=$true;$result.taskBindingVerified=$true
  $prepared=New-OwnerLauncherRuntime -Admission $admission;$result.claimConsumed=$true
  $structures=Invoke-OwnerLauncherLocalInspection -Prepared $prepared -AuthorizationPath $prepared.receiptPath
  $result.exactlyTwoTargets=$true;$result.compatibilityStructure=$structures.compatibility.kind;$result.nativeStructure=$structures.native.kind;$result.fixedDelegationMatched=$structures.compatibility.fixedDelegationMatched;$result.nativeRelationCandidate=$structures.native.kind -ceq 'NATIVE_LITERAL_NODE_HOST';$result.protectedLocalRecordWritten=$true;$result.complete=$true;$result.failureCode=$null
 }catch{$code=[string]$_.Exception.Message;if($code -in @('LBI_GRANT_REQUIRED','LBI_CONTEXT_REQUIRED','LBI_SOURCE_REJECTED','LBI_TASK_REJECTED','LBI_ATTEMPT_CONSUMED','LBI_ACQUISITION_REJECTED','LBI_EXPIRED')){$result.failureCode=$code}else{$result.failureCode='LBI_INSPECTION_REFUSED'}}
 if($null -ne $admission -and $admission.ContainsKey('claimConsumed') -and $admission.claimConsumed){$result.claimConsumed=$true}
 return $result
}
if($MyInvocation.InvocationName -ne '.'){
 if(-not $Inspect){[Console]::Out.WriteLine('PLAN ONLY: fixed launcher inspection requires a fresh exact High read and new-protected-objects grant. No Owner state is accessed.');exit 0}
 $result=Invoke-OwnerLauncherBindingInspection -RequestedAuthorizationPath $AuthorizationPath
 [Console]::Out.WriteLine(($result|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 6 -Compress));if(-not $result.complete){exit 1}
}

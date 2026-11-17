param([switch]$ReusePolicyTypes)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$checks=0
function Assert-SourceAclNative([string]$Name,[bool]$Value){if(-not $Value){throw ('SOURCE_ACL_NATIVE_FAILED:'+$Name)};$script:checks++;Write-Output ('PASS '+$Name)}
if(-not $ReusePolicyTypes){
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))
 if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
 else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
}
Assert-SourceAclNative 'source_reader_available' ($null -ne ('GoriqSourceAclProbe' -as [type]))
$profile='C:\Users\Fixture';$local=$profile+'\AppData\Local'
$plan=[GoriqSourceAclProbe]::FixedTargets($profile,$local)
$roles='VOLUME_ROOT,PROFILE_ANCESTOR_01,PROFILE,APPDATA,LOCAL,WORKER,SOURCE,DB,WAL,SHM,JOURNAL,SIDECAR,JOBS,CHANGES,HANDOFF,CAPTURE,RAW,WORK,CONTEXT,RAW_DB,RAW_WAL,RAW_SHM,RAW_JOBS,RAW_CHANGES,WORK_DB,WORK_WAL,WORK_SHM,WORK_JOBS,WORK_CHANGES'
Assert-SourceAclNative 'fixed_plan_all_source_and_failed_capture_roles' (($plan.Target -join ',') -ceq $roles)
Assert-SourceAclNative 'fixed_source_database' ($plan[7].Path -ceq 'C:\Users\Fixture\AppData\Local\GAIWorker\goal-1218-bridge-state\compass.sqlite')
Assert-SourceAclNative 'fixed_source_sidecar' ($plan[11].Path -ceq 'C:\Users\Fixture\AppData\Local\GAIWorker\goal-1218-bridge-state\self-development')
Assert-SourceAclNative 'fixed_failed_capture' ($plan[15].Path -ceq 'C:\Users\Fixture\.goriq-handoff\1219-original-inspection-44178348410-1')
Assert-SourceAclNative 'copied_raw_names' ($plan[23].Path -ceq 'C:\Users\Fixture\.goriq-handoff\1219-original-inspection-44178348410-1\raw\change-sets.json')
Assert-SourceAclNative 'copied_work_names' ($plan[28].Path -ceq 'C:\Users\Fixture\.goriq-handoff\1219-original-inspection-44178348410-1\work\change-sets.json')
Assert-SourceAclNative 'source_child_uses_source_parent' ($plan[7].ParentIndex -eq 6 -and $plan[12].ParentIndex -eq 11)
Assert-SourceAclNative 'capture_branch_uses_profile_parent' ($plan[14].ParentIndex -eq 2 -and $plan[15].ParentIndex -eq 14)
$same=[GoriqSourceAclProbe]::FixedTargets($profile,($profile+'\Local'))
Assert-SourceAclNative 'appdata_profile_alias_recorded_separately' ($same[3].Target.ToString() -ceq 'APPDATA' -and $same[3].Path -ceq $profile -and $same[3].ParentIndex -eq 1)
$nested=[GoriqSourceAclProbe]::FixedTargets($profile,($profile+'\A\B\AppData\Local'))
Assert-SourceAclNative 'source_intermediate_ancestors_ordered' (($nested[3..5].Target -join ',') -ceq 'SOURCE_ANCESTOR_01,SOURCE_ANCESTOR_02,APPDATA')
$deepProfile='C:\a\b\c\d\e\f\g\h';$deepLocal=$deepProfile+'\a\b\c\d\e\f\g\AppData\Local'
$deep=[GoriqSourceAclProbe]::FixedTargets($deepProfile,$deepLocal)
Assert-SourceAclNative 'max_seven_ancestors_each_branch' ($deep.Count -eq 42 -and $deep[7].Target.ToString() -ceq 'PROFILE_ANCESTOR_07' -and $deep[15].Target.ToString() -ceq 'SOURCE_ANCESTOR_07')
foreach($case in @(
 @('profile_root','C:\','C:\Local'),@('profile_depth','C:\a\b\c\d\e\f\g\h\i','C:\a\b\c\d\e\f\g\h\i\Local'),
 @('source_depth',$profile,($profile+'\a\b\c\d\e\f\g\h\AppData\Local')),@('local_equals_profile',$profile,$profile),
 @('local_outside_profile',$profile,'C:\Other\AppData\Local'),@('local_other_volume',$profile,'D:\Local')
)){Assert-SourceAclNative ('unsafe_plan_'+$case[0]) ([GoriqSourceAclProbe]::FixedTargets([string]$case[1],[string]$case[2]).Count -eq 0)}
Assert-SourceAclNative 'knownfolder_environment_and_workspace_valid' ([GoriqSourceAclProbe]::ProfileContextSafe($profile,$profile,$local,$local,'C:\runner\work'))
foreach($case in @(
 @('profile_mismatch',($profile+'x'),$local,'C:\runner\work'),@('local_mismatch',$profile,($local+'x'),'C:\runner\work'),
 @('workspace_source',$profile,$local,($local+'\GAIWorker')),@('workspace_capture',$profile,$local,($profile+'\.goriq-handoff\nested')),
 @('workspace_parent',$profile,$local,'C:\Users'),@('workspace_unc',$profile,$local,'\\server\work')
)){Assert-SourceAclNative ('context_refuses_'+$case[0]) (-not [GoriqSourceAclProbe]::ProfileContextSafe($profile,[string]$case[1],$local,[string]$case[2],[string]$case[3]))}
foreach($path in @('C:\..\a','C:\a.','C:\a ','C:\a\\b','C:\A:stream','C:/a','\\?\C:\a','C:\CON','C:\com9.txt',('C:\a'+[char]1))){Assert-SourceAclNative ('canonical_refuses_'+$checks) (-not [GoriqSourceAclProbe]::CanonicalLocalPath($path))}
$user='S-1-5-21-1-2-3-1001';$silo='S-1-15-3-65536-1-2-3-4-5-6-7-8'
foreach($case in @(
 @($user,'CURRENT_USER'),@('S-1-5-18','SYSTEM'),@('S-1-5-32-544','ADMINISTRATORS'),
 @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464','TRUSTED_INSTALLER'),
 @($silo,'APP_SILO'),@('S-1-15-3-1','APP_CAPABILITY'),@('S-1-15-2-1','APP_PACKAGE'),
 @('S-1-1-0','EVERYONE'),@('S-1-5-11','AUTHENTICATED_USERS'),@('S-1-5-32-545','USERS'),@('S-1-5-21-1-2-3-1009','OTHER')
)){Assert-SourceAclNative ('account_'+$case[1]) ([GoriqSourceAclProbe]::ClassifyAccount([string]$case[0],$user).ToString() -ceq $case[1])}
foreach($sid in @('',($silo+"`n"),'S-1-15-3-65536-01-2-3-4-5-6-7-8','S-1-15-3-4294967296','S-01-15-3-1','S-1-281474976710656-1','S-1-15-3-',('S-1-15-'+(('1-'*15)+'1')))){
 Assert-SourceAclNative ('malformed_sid_other_'+$checks) ([GoriqSourceAclProbe]::ClassifyAccount($sid,$user).ToString() -ceq 'OTHER')
}
foreach($case in @(@($null,'UNOBSERVED'),@($user,'CURRENT_USER'),@('S-1-5-18','SYSTEM'),@('S-1-5-32-544','ADMINISTRATORS'),@('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464','TRUSTED_INSTALLER'),@($silo,'OTHER'))){Assert-SourceAclNative ('owner_'+$case[1]) ([GoriqSourceAclProbe]::ClassifyOwner([string]$case[0],$user).ToString() -ceq $case[1])}
foreach($case in @(@(0,$false,'ALLOW'),@(1,$false,'DENY'),@(0,$true,'CALLBACK_ALLOW'),@(1,$true,'CALLBACK_DENY'),@(2,$false,'OTHER'),@(999,$false,'OTHER'))){Assert-SourceAclNative ('qualifier_'+$case[2]) ([GoriqSourceAclProbe]::ClassifyQualifier([int]$case[0],[bool]$case[1]).ToString() -ceq $case[2])}
function New-SourceAclNativeReport {
 $r=New-Object 'GoriqSourceAclProbe+Report';$r.Completed=$true;$r.Reason=[GoriqSourceAclProbe+Reason]::OBSERVED
 foreach($s in $plan){$f=New-Object 'GoriqSourceAclProbe+Fact';$f.Target=$s.Target;$f.Status=[GoriqSourceAclProbe+Status]::TARGET_MISSING;$r.Observations.Add($f)}
 return $r
}
$report=New-SourceAclNativeReport
$fact=$report.Observations[7];$fact.Status=[GoriqSourceAclProbe+Status]::ACL_OBSERVED;$fact.StorageVerified=$true;$fact.AttributesVerified=$true;$fact.FinalPathVerified=$true;$fact.Owner=[GoriqSourceAclProbe+Owner]::CURRENT_USER;$fact.Dacl=[GoriqSourceAclProbe+Dacl]::PRESENT
$ace=New-Object 'GoriqSourceAclProbe+Ace';$ace.Account=[GoriqSourceAclProbe+Account]::APP_SILO;$ace.Qualifier=[GoriqSourceAclProbe+Qualifier]::CALLBACK_ALLOW;$ace.Mask=[uint32]::MaxValue;$ace.Flags=[byte]255;$fact.Aces.Add($ace)
$wire=[GoriqSourceAclProbe]::Render($report);$json=$wire|ConvertFrom-Json
Assert-SourceAclNative 'metadata_only_complete_is_not_goal_success' ($json.schema -ceq 'SOURCE_ACL_PROBE_V1' -and $json.status -ceq 'METADATA_ONLY_COMPLETE' -and $json.reason -ceq 'OBSERVED' -and $json.readOnly -and $json.metadataOnly -and -not $json.recovered -and -not $json.historicalStateProven -and $json.g1 -ceq 'HOLD')
Assert-SourceAclNative 'closed_exact_header' (($json.PSObject.Properties.Name -join ',') -ceq 'schema,authority,status,readOnly,metadataOnly,recovered,g1,historicalStateProven,maxTargets,maxAces,budgetSeconds,reason,observations')
Assert-SourceAclNative 'closed_exact_fact' (($json.observations[7].PSObject.Properties.Name -join ',') -ceq 'target,status,storageVerified,attributesVerified,finalPathVerified,owner,dacl,aces')
Assert-SourceAclNative 'closed_exact_ace_uint_and_byte' (($json.observations[7].aces[0].PSObject.Properties.Name -join ',') -ceq 'account,qualifier,mask,flags' -and $json.observations[7].aces[0].mask -eq 4294967295 -and $json.observations[7].aces[0].flags -eq 255)
Assert-SourceAclNative 'no_raw_identity_or_path' (-not $wire.Contains($profile) -and -not $wire.Contains($user) -and -not $wire.Contains($silo))
Assert-SourceAclNative 'fixed_resource_contract' ($json.maxTargets -eq 48 -and $json.maxAces -eq 16 -and $json.budgetSeconds -eq 20 -and [Text.Encoding]::UTF8.GetByteCount($wire) -le 131072)
foreach($kind in @('unknown_target','duplicate_target','jumped_ancestor','false_complete','false_reason','unknown_status','owner_before_final','aces_without_dacl','seventeen_aces','too_many_rows','unobserved_acl_owner')){
 $r=New-SourceAclNativeReport
 switch($kind){
  'unknown_target' {$r.Observations[0].Target=[Enum]::ToObject([GoriqSourceAclProbe+Target],999)}
  'duplicate_target' {$r.Observations[1].Target=$r.Observations[0].Target}
  'jumped_ancestor' {$r.Observations[1].Target=[GoriqSourceAclProbe+Target]::PROFILE_ANCESTOR_02}
  'false_complete' {$r.Observations.RemoveAt($r.Observations.Count-1)}
  'false_reason' {$r.Reason=[GoriqSourceAclProbe+Reason]::TIMEOUT}
  'unknown_status' {$r.Observations[0].Status=[Enum]::ToObject([GoriqSourceAclProbe+Status],999)}
  'owner_before_final' {$r.Observations[0].Owner=[GoriqSourceAclProbe+Owner]::SYSTEM}
  'aces_without_dacl' {$r.Observations[0].Aces.Add($ace)}
  'seventeen_aces' {for($i=0;$i -lt 17;$i++){$r.Observations[0].Aces.Add($ace)}}
  'too_many_rows' {for($i=0;$i -lt 49;$i++){$r.Observations.Add($r.Observations[0])}}
  'unobserved_acl_owner' {$f=$r.Observations[0];$f.Status=[GoriqSourceAclProbe+Status]::ACL_OBSERVED;$f.StorageVerified=$true;$f.AttributesVerified=$true;$f.FinalPathVerified=$true;$f.Dacl=[GoriqSourceAclProbe+Dacl]::NULL}
 }
 $closed=[GoriqSourceAclProbe]::Render($r)|ConvertFrom-Json
 Assert-SourceAclNative ('serializer_rejects_'+$kind) ($closed.reason -ceq 'OUTPUT_REJECTED' -and $closed.status -ceq 'INCOMPLETE' -and $closed.observations.Count -eq 0)
}
foreach($count in @(0,1,2,3,7,28,29)){
 $r=New-SourceAclNativeReport;$r.Completed=$false;$r.Reason=[GoriqSourceAclProbe+Reason]::TIMEOUT
 while($r.Observations.Count -gt $count){$r.Observations.RemoveAt($r.Observations.Count-1)}
 $closed=[GoriqSourceAclProbe]::Render($r)|ConvertFrom-Json
 Assert-SourceAclNative ('timeout_prefix_'+$count) ($closed.reason -ceq 'TIMEOUT' -and $closed.observations.Count -eq $count)
}
# Replace only the operating-system boundary. The real plan, ancestor gate,
# metadata inspection, descriptor lifetime and report renderer still execute.
# Every path here is a synthetic fixture; the public observation entry is unused.
$completeSource=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs'))
$classMarker='public static class GoriqSourceAclProbe {'
$classStart=$completeSource.IndexOf($classMarker,[StringComparison]::Ordinal)
Assert-SourceAclNative 'boundary_source_class_found' ($classStart -ge 0)
$boundary=$completeSource.Substring(0,$completeSource.IndexOf('public enum OwnerProbeTarget',[StringComparison]::Ordinal))+$completeSource.Substring($classStart).Replace('GoriqSourceAclProbe','GoriqSourceAclBoundary')
$replacements=@{
 'SourceCreateFile'='static SafeFileHandle SourceCreateFile(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template){if(access!=0x20080u||share!=7u||mode!=3u||flags!=0x02200000u||security!=IntPtr.Zero||template!=IntPtr.Zero)throw new Exception("FIXTURE_OPEN_CONTRACT");fixtureOpened.Add(path);int id=fixtureOpened.Count;fixturePaths[id]=path;if(path==fixtureLocal+"\\GAIWorker"&&fixtureMode=="parent_replace_on_open")fixtureParentMoved=true;return new SafeFileHandle(new IntPtr(id),false);}'
 'SourceGetFileInformation'='static bool SourceGetFileInformation(SafeFileHandle file,out Info info){string path=fixturePaths[file.DangerousGetHandle().ToInt32()];info=new Info();info.attributes=fixtureDirectories.Contains(path)?16u:0u;info.links=1;info.volume=1;info.indexLow=(uint)file.DangerousGetHandle().ToInt32();if(path==fixtureLocal&&fixtureMode=="source_reparse")info.attributes|=1024;if(path==fixtureDb&&fixtureMode=="multi_link")info.links=2;if(path==fixtureDb&&fixtureMode=="file_directory")info.attributes=16;return !(path==fixtureLocal&&fixtureMode=="metadata_failure");}'
 'SourceGetFinalPath'='static uint SourceGetFinalPath(SafeFileHandle file,StringBuilder path,uint length,uint flags){string value=fixturePaths[file.DangerousGetHandle().ToInt32()];if(value==fixtureLocal&&fixtureMode=="source_final")value+="-other";if(value==fixtureLocal&&fixtureMode=="parent_rename"&&++fixtureLocalFinalCalls>2)value+="-renamed";if(value==fixtureLocal&&fixtureParentMoved)value+="-moved";value="\\\\?\\"+value;path.Append(value);return (uint)value.Length;}'
 'SourceGetSecurityInfo'='static uint SourceGetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor){if(type!=1||requested!=5)throw new Exception("FIXTURE_SD_REQUEST");string path=fixturePaths[handle.DangerousGetHandle().ToInt32()];fixtureSecurityRead.Add(path);if(path==fixtureLocal+"\\GAIWorker"&&fixtureMode=="parent_replace_after_security")fixtureParentMoved=true;if(fixtureMode=="timeout_inside_target")fixtureMilliseconds=20000;owner=group=dacl=sacl=descriptor=IntPtr.Zero;if(fixtureBytes==null)return 5;descriptor=Marshal.AllocHGlobal(fixtureBytes.Length);Marshal.Copy(fixtureBytes,0,descriptor,fixtureBytes.Length);fixtureAllocations++;return fixtureMode=="descriptor_error_allocated"?5u:0u;}'
 'SourceGetDescriptorLength'='static uint SourceGetDescriptorLength(IntPtr descriptor){return fixtureMode=="descriptor_oversize"?65537u:(uint)fixtureBytes.Length;}'
 'SourceLocalFree'='static IntPtr SourceLocalFree(IntPtr memory){Marshal.FreeHGlobal(memory);fixtureAllocations--;return IntPtr.Zero;}'
}
foreach($name in $replacements.Keys){
 $pattern='(?m)^ \[DllImport\([^\r\n]+ static extern [^\r\n]+\b'+$name+'\([^\r\n]+;\r?$'
 Assert-SourceAclNative ('boundary_decl_'+$name) ([regex]::Matches($boundary,$pattern).Count -eq 1)
 $boundary=[regex]::Replace($boundary,$pattern,(' '+$replacements[$name]))
}
$storagePattern='(?m)^ static bool StorageSafe\(string path\)\{[^\r\n]+\}\r?$'
Assert-SourceAclNative 'boundary_storage_method' ([regex]::Matches($boundary,$storagePattern).Count -eq 1)
$boundary=[regex]::Replace($boundary,$storagePattern,' static bool StorageSafe(string path){return !(fixtureMode=="root_storage"&&path=="C:\\");}')
# Keep the actual Budget comparison and loop/catch behavior; only elapsed time
# is controlled, with expiration injected immediately after a finished target.
$operationPattern='(?m)^(     ObserveTarget\([^\r\n;]+\);)\r?$'
Assert-SourceAclNative 'boundary_finished_operation_found' ([regex]::Matches($boundary,$operationPattern).Count -eq 1)
$boundary=[regex]::Replace($boundary,$operationPattern,'$1 FixtureTargetFinished(plan[n].Target);')
$fixture=@'
 static string fixtureMode;
 static byte[] fixtureBytes;
 static int fixtureAllocations,fixtureLocalFinalCalls;
 static bool fixtureParentMoved;
 static long fixtureMilliseconds;
 public sealed class FixtureClock {public static FixtureClock StartNew(){return new FixtureClock();}public long ElapsedMilliseconds {get{return fixtureMilliseconds;}}}
 static void FixtureTargetFinished(Target target){if((fixtureMode=="timeout_after_root"&&target==Target.VOLUME_ROOT)||(fixtureMode=="timeout_after_final"&&target==Target.WORK_CHANGES))fixtureMilliseconds=20000;}
 static readonly string fixtureLocal=@"C:\Users\Fixture\AppData\Local";
 static readonly string fixtureDb=fixtureLocal+@"\GAIWorker\goal-1218-bridge-state\compass.sqlite";
 static List<string> fixtureOpened;
 static List<string> fixtureSecurityRead;
 static Dictionary<int,string> fixturePaths;
 static HashSet<string> fixtureDirectories;
 public static string FixtureObserve(string mode,byte[] bytes) {
  fixtureMode=mode;fixtureBytes=bytes;fixtureAllocations=0;fixtureLocalFinalCalls=0;fixtureParentMoved=false;fixtureMilliseconds=0;
  fixtureOpened=new List<string>();fixtureSecurityRead=new List<string>();fixturePaths=new Dictionary<int,string>();fixtureDirectories=new HashSet<string>();
  var plan=FixedTargets(@"C:\Users\Fixture",fixtureLocal);
  foreach(var spec in plan)if(spec.Directory)fixtureDirectories.Add(spec.Path);
  string result=Render(ObservePlan(plan,"S-1-5-21-1-2-3-1001",Stopwatch.StartNew()));
  if(fixtureAllocations!=0)throw new Exception("FIXTURE_SD_LEAK");
  return result;
 }
 public static bool FixtureOpened(string path){return fixtureOpened.Contains(path);}
 public static bool FixtureSecurityRead(string path){return fixtureSecurityRead.Contains(path);}
'@
$boundary=$boundary.Replace('public static class GoriqSourceAclBoundary {',('public static class GoriqSourceAclBoundary {'+"`n"+$fixture))
$boundary=$boundary.Replace('Stopwatch','FixtureClock')
if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $boundary -Language CSharp}
else{$null=Add-Type -TypeDefinition $boundary -Language CSharp -CompilerOptions '/langversion:5'}
foreach($case in @(
 @('normal','SECURITY_DESCRIPTOR_UNVERIFIED','SECURITY_DESCRIPTOR_UNVERIFIED'),
 @('source_reparse','ATTRIBUTES_UNVERIFIED','ANCESTOR_UNVERIFIED'),@('source_final','FINAL_PATH_UNVERIFIED','ANCESTOR_UNVERIFIED'),
 @('metadata_failure','ATTRIBUTES_UNVERIFIED','ANCESTOR_UNVERIFIED'),@('parent_rename','SECURITY_DESCRIPTOR_UNVERIFIED','ANCESTOR_UNVERIFIED')
)){
 $r=[GoriqSourceAclBoundary]::FixtureObserve([string]$case[0],$null)|ConvertFrom-Json
 Assert-SourceAclNative ('boundary_local_'+$case[0]) ($r.reason -ceq 'OBSERVED' -and $r.observations.Count -eq 29 -and $r.observations[4].status -ceq $case[1])
 Assert-SourceAclNative ('boundary_child_'+$case[0]) ($r.observations[5].status -ceq $case[2])
 Assert-SourceAclNative ('boundary_independent_capture_'+$case[0]) ($r.observations[15].status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED' -and [GoriqSourceAclBoundary]::FixtureOpened('C:\Users\Fixture\.goriq-handoff\1219-original-inspection-44178348410-1'))
 if($case[0] -ne 'normal'){Assert-SourceAclNative ('boundary_unsafe_descendant_never_opened_'+$case[0]) (-not [GoriqSourceAclBoundary]::FixtureOpened($local+'\GAIWorker'))}
}
foreach($mode in @('multi_link','file_directory')){
 $r=[GoriqSourceAclBoundary]::FixtureObserve($mode,$null)|ConvertFrom-Json
 Assert-SourceAclNative ('boundary_file_attributes_'+$mode) ($r.observations[7].status -ceq 'ATTRIBUTES_UNVERIFIED' -and $r.observations[8].status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED')
}
foreach($mode in @('parent_replace_on_open','parent_replace_after_security')){
 $r=[GoriqSourceAclBoundary]::FixtureObserve($mode,$null)|ConvertFrom-Json;$f=$r.observations[5]
 Assert-SourceAclNative ('boundary_rechecks_held_ancestry_'+$mode) ($r.reason -ceq 'OBSERVED' -and $r.observations.Count -eq 29 -and $f.status -ceq 'ANCESTOR_UNVERIFIED' -and -not $f.storageVerified -and -not $f.attributesVerified -and -not $f.finalPathVerified -and $f.owner -ceq 'UNOBSERVED' -and $f.dacl -ceq 'UNOBSERVED' -and $f.aces.Count -eq 0)
 Assert-SourceAclNative ('boundary_acquired_child_suppresses_descendants_'+$mode) ([GoriqSourceAclBoundary]::FixtureOpened($local+'\GAIWorker') -and -not [GoriqSourceAclBoundary]::FixtureOpened($local+'\GAIWorker\goal-1218-bridge-state') -and $r.observations[6].status -ceq 'ANCESTOR_UNVERIFIED')
 Assert-SourceAclNative ('boundary_replacement_preserves_other_branch_'+$mode) ($r.observations[15].status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED')
 if($mode -eq 'parent_replace_on_open'){Assert-SourceAclNative 'boundary_rechecks_ancestry_before_reading_descriptor' (-not [GoriqSourceAclBoundary]::FixtureSecurityRead($local+'\GAIWorker'))}
}
foreach($case in @(@('timeout_after_root',1),@('timeout_after_final',29))){
 $r=[GoriqSourceAclBoundary]::FixtureObserve([string]$case[0],$null)|ConvertFrom-Json
 Assert-SourceAclNative ('boundary_timeout_preserves_finished_row_'+$case[0]) ($r.status -ceq 'INCOMPLETE' -and $r.reason -ceq 'TIMEOUT' -and $r.observations.Count -eq $case[1] -and $r.observations[-1].status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED' -and $r.observations[-1].storageVerified -and $r.observations[-1].attributesVerified -and $r.observations[-1].finalPathVerified)
}
$r=[GoriqSourceAclBoundary]::FixtureObserve('timeout_inside_target',$null)|ConvertFrom-Json
Assert-SourceAclNative 'boundary_timeout_marks_active_row' ($r.reason -ceq 'TIMEOUT' -and $r.observations.Count -eq 1 -and $r.observations[0].status -ceq 'TIMEOUT' -and $r.observations[0].owner -ceq 'UNOBSERVED' -and $r.observations[0].dacl -ceq 'UNOBSERVED' -and $r.observations[0].aces.Count -eq 0)
$r=[GoriqSourceAclBoundary]::FixtureObserve('root_storage',$null)|ConvertFrom-Json
Assert-SourceAclNative 'boundary_storage_failure_gates_all_descendants' ($r.observations[0].status -ceq 'STORAGE_UNVERIFIED' -and @($r.observations|Where-Object {$_.status -ceq 'ANCESTOR_UNVERIFIED'}).Count -eq 28 -and -not [GoriqSourceAclBoundary]::FixtureOpened('C:\'))
foreach($case in @(@(2,'TARGET_MISSING'),@(3,'TARGET_MISSING'),@(5,'ACCESS_DENIED'),@(0,'UNEXPECTED_FAILURE'),@(87,'UNEXPECTED_FAILURE'))){Assert-SourceAclNative ('open_failure_'+$case[0]) ([GoriqSourceAclProbe]::ClassifyOpenError([int]$case[0]).ToString() -ceq $case[1])}

if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){
 # Windows RawSecurityDescriptor and actual unmanaged-memory copy/free path.
 # No Windows files, identities, ACLs or public ObserveJson entry are accessed.
 function ConvertTo-SourceAclDescriptorBytes($Descriptor){$b=New-Object byte[] $Descriptor.BinaryLength;$Descriptor.GetBinaryForm($b,0);return ,$b}
 foreach($kind in @('present','null','absent','missing_owner','callback','object_ace','unknown_ace','seventeen')){
  $sd=[Security.AccessControl.RawSecurityDescriptor]::new(('O:'+$user+'G:SYD:'))
  $acl=[Security.AccessControl.RawAcl]::new([byte]2,0)
  if($kind -in @('present','callback','seventeen')){
   $count=1;if($kind -eq 'seventeen'){$count=17}
   for($i=0;$i -lt $count;$i++){
    $nativeAce=[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]31,[Security.AccessControl.AceQualifier]::AccessAllowed,-1,[Security.Principal.SecurityIdentifier]::new($silo),($kind -eq 'callback'),$null)
    $acl.InsertAce($i,$nativeAce)
   }
  }
  if($kind -eq 'object_ace'){$acl=[Security.AccessControl.RawAcl]::new([byte]4,1);$acl.InsertAce(0,[Security.AccessControl.ObjectAce]::new([Security.AccessControl.AceFlags]16,[Security.AccessControl.AceQualifier]::AccessDenied,-2147483648,[Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.ObjectAceFlags]::None,[Guid]::Empty,[Guid]::Empty,$false,$null))}
  if($kind -eq 'unknown_ace'){$acl.InsertAce(0,[Security.AccessControl.CustomAce]::new([Enum]::ToObject([Security.AccessControl.AceType],17),[Security.AccessControl.AceFlags]128,[byte[]]@(0,0,0,0)))}
  $sd.DiscretionaryAcl=$acl
  if($kind -eq 'null'){$sd.DiscretionaryAcl=$null}
  if($kind -eq 'absent'){$sd=[Security.AccessControl.RawSecurityDescriptor]::new([Security.AccessControl.ControlFlags]::SelfRelative,[Security.Principal.SecurityIdentifier]::new($user),$null,$null,$null)}
  if($kind -eq 'missing_owner'){$sd.Owner=$null}
  $bytes=ConvertTo-SourceAclDescriptorBytes $sd
  $r=[GoriqSourceAclBoundary]::FixtureObserve('normal',$bytes)|ConvertFrom-Json;$f=$r.observations[7]
  $wantStatus='ACL_OBSERVED';if($kind -eq 'seventeen'){$wantStatus='ACE_LIMIT'};if($kind -eq 'missing_owner'){$wantStatus='SECURITY_DESCRIPTOR_UNVERIFIED'}
  Assert-SourceAclNative ('windows_descriptor_status_'+$kind) ($f.status -ceq $wantStatus)
  switch($kind){
   'present' {Assert-SourceAclNative 'windows_unsigned_mask_inherit_flags' ($f.aces.Count -eq 1 -and $f.aces[0].mask -eq 4294967295 -and $f.aces[0].flags -eq 31 -and $f.aces[0].account -ceq 'APP_SILO')}
   'null' {Assert-SourceAclNative 'windows_null_dacl_observed' ($f.dacl -ceq 'NULL' -and $f.aces.Count -eq 0)}
   'absent' {Assert-SourceAclNative 'windows_absent_dacl_observed' ($f.dacl -ceq 'ABSENT' -and $f.aces.Count -eq 0)}
   'missing_owner' {Assert-SourceAclNative 'windows_missing_owner_clears_security' ($f.owner -ceq 'UNOBSERVED' -and $f.dacl -ceq 'UNOBSERVED' -and $f.aces.Count -eq 0)}
   'callback' {Assert-SourceAclNative 'windows_callback_not_dropped' ($f.aces[0].qualifier -ceq 'CALLBACK_ALLOW')}
   'object_ace' {Assert-SourceAclNative 'windows_object_denial_unsigned' ($f.aces[0].qualifier -ceq 'DENY' -and $f.aces[0].account -ceq 'EVERYONE' -and $f.aces[0].mask -eq 2147483648 -and $f.aces[0].flags -eq 16)}
   'unknown_ace' {Assert-SourceAclNative 'windows_unknown_ace_not_dropped' ($f.aces[0].qualifier -ceq 'OTHER' -and $f.aces[0].account -ceq 'OTHER' -and $f.aces[0].flags -eq 128)}
   'seventeen' {Assert-SourceAclNative 'windows_ace_limit_retains_bounded_partial' ($f.owner -ceq 'CURRENT_USER' -and $f.dacl -ceq 'PRESENT' -and $f.aces.Count -eq 16)}
  }
  foreach($mode in @('descriptor_oversize','descriptor_error_allocated')){
   $bad=[GoriqSourceAclBoundary]::FixtureObserve($mode,$bytes)|ConvertFrom-Json
   Assert-SourceAclNative ('windows_descriptor_failure_frees_memory_'+$kind+'_'+$mode) ($bad.observations[7].status -ceq 'SECURITY_DESCRIPTOR_UNVERIFIED' -and $bad.observations[7].aces.Count -eq 0)
  }
 }
}
Write-Output ('SOURCE_ACL_NATIVE_PASS='+$checks)

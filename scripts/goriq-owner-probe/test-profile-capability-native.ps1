# Synthetic Windows descriptors only; no OS object or production constructor.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$user='S-1-5-21-1-2-3-1001';$cap='S-1-15-3-65536-1-2-3-4-5-6-7-8';$profile='\\?\C:\Users\Fixture';$mask=1048608
$cases=@(
 @('profile_current',$user,$cap,$mask,0,16,$profile,$true,$false,'PASS'),
 @('profile_system','SY',$cap,$mask,0,16,$profile,$true,$false,'PASS'),
 @('profile_list',$user,$cap,($mask -bor 1),0,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_write',$user,$cap,($mask -bor 2),0,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_control',$user,$cap,($mask -bor 262144),0,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_inheritance',$user,$cap,$mask,3,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_inherited',$user,$cap,$mask,16,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('handoff',$user,$cap,$mask,0,16,($profile+'\.goriq-handoff'),$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_file',$user,$cap,$mask,0,0,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_reparse',$user,$cap,$mask,0,1040,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('metadata_failure',$user,$cap,$mask,0,16,$profile,$false,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('final_mismatch',$user,$cap,$mask,0,16,($profile+'2'),$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('other_owner','S-1-5-21-1-2-3-1009',$cap,$mask,0,16,$profile,$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('runtime_unchanged','SY',$cap,$mask,0,0,'fixture',$false,$true,'PASS'),
 @('package_sid',$user,'S-1-15-2-1',$mask,0,16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('sibling',$user,$cap,$mask,0,16,'\\?\C:\Users\Other',$true,$false,'PRIVATE_DACL_UNVERIFIED')
)
foreach($case in $cases){if(@($case).Count -ne 10){throw 'CAPABILITY_CASE_SHAPE_INVALID'}}
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){return}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs'))
$source=$source.Replace('GoriqBridge','GoriqBridgeCapabilityFixture')
$replacements=@{
 'GetFileInformationByHandle'='static bool GetFileInformationByHandle(SafeFileHandle file,out Info info){info=new Info();info.attributes=fixtureAttributes;return fixtureMetadata;}'
 'GetFinalPathNameByHandle'='static uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags){path.Append(fixtureFinal);return (uint)fixtureFinal.Length;}'
 'GetSecurityInfo'='static uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor){owner=group=dacl=sacl=IntPtr.Zero;descriptor=Marshal.AllocHGlobal(fixtureBytes.Length);Marshal.Copy(fixtureBytes,0,descriptor,fixtureBytes.Length);fixtureAllocations++;return 0;}'
 'GetSecurityDescriptorLength'='static uint GetSecurityDescriptorLength(IntPtr descriptor){return (uint)fixtureBytes.Length;}'
 'LocalFree'='static IntPtr LocalFree(IntPtr memory){Marshal.FreeHGlobal(memory);fixtureAllocations--;return IntPtr.Zero;}'
}
foreach($name in $replacements.Keys){
 $pattern='(?m)^ \[DllImport\([^\r\n]+ static extern [^\r\n]+\b'+$name+'\([^\r\n]+;\r?$'
 if([regex]::Matches($source,$pattern).Count -ne 1){throw 'FIXTURE_NATIVE_BOUNDARY_NOT_FOUND'}
 $source=[regex]::Replace($source,$pattern,(' '+$replacements[$name]))
}
$fixture=@'
 static uint fixtureAttributes;
 static bool fixtureMetadata;
 static string fixtureFinal;
 static byte[] fixtureBytes;
 static int fixtureAllocations;
 GoriqBridgeCapabilityFixtureCapture(string fixtureProfile,string fixtureUser,bool inert) {
  profile=fixtureProfile;sid=fixtureUser;source="";
 }
 public static string CheckSecurity(string owner,string ace,uint mask,int flags,uint attributes,string finalPath,bool metadata,bool runtime) {
  const string user="S-1-5-21-1-2-3-1001";
  var sd=new RawSecurityDescriptor("O:"+owner+"G:SYD:");
  var acl=new RawAcl(2,1);acl.InsertAce(0,new CommonAce((AceFlags)flags,AceQualifier.AccessAllowed,unchecked((int)mask),new SecurityIdentifier(ace),false,null));sd.DiscretionaryAcl=acl;
  fixtureBytes=new byte[sd.BinaryLength];sd.GetBinaryForm(fixtureBytes,0);
  fixtureAttributes=attributes;fixtureFinal=finalPath;fixtureMetadata=metadata;fixtureAllocations=0;
  var capture=new GoriqBridgeCapabilityFixtureCapture(@"C:\Users\Fixture",user,true);
  string result="PASS";
  using(var handle=new SafeFileHandle(new IntPtr(123),false)) {
   try {
    // Invoke the actual central method twice, as descriptor snapshot/recheck do.
    byte[] first=capture.Security(handle,!runtime,runtime);
    byte[] second=capture.Security(handle,!runtime,runtime);
    if(Hash(first)!=Hash(second))throw new InvalidOperationException("FIXTURE_UNSTABLE");
   } catch(GoriqBridgeCapabilityFixturePrivateGuardException ex) {result=ex.Code;}
  }
  if(fixtureAllocations!=0)throw new InvalidOperationException("FIXTURE_MEMORY_LEAK");
  return result;
 }
'@
$marker='public sealed class GoriqBridgeCapabilityFixtureCapture : IDisposable {'
if($source.Split(@($marker),[StringSplitOptions]::None).Length -ne 2){throw 'FIXTURE_CLASS_NOT_FOUND'}
$source=$source.Replace($marker,($marker+"`n"+$fixture))
$null=Add-Type -TypeDefinition $source -Language CSharp
foreach($case in $cases){
 $actual=[GoriqBridgeCapabilityFixtureCapture]::CheckSecurity([string]$case[1],[string]$case[2],[uint32]$case[3],[int]$case[4],[uint32]$case[5],[string]$case[6],[bool]$case[7],[bool]$case[8])
 if($actual -cne $case[9]){throw ('CAPABILITY_CAPTURE_FAILED:'+$case[0]+':'+$actual)}
 Write-Output ('PASS capability_capture_'+$case[0])
}
Write-Output ('CAPTURE_CAPABILITY_BOUNDARY_PASS='+$cases.Count)

$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs')).Replace('OwnerProbe','CapabilityFixture')
foreach($name in @('GetSecurityInfo','GetSecurityDescriptorLength','LocalFree')){
 $pattern='(?m)^ \[DllImport\([^\r\n]+ static extern [^\r\n]+\b'+$name+'\([^\r\n]+;\r?$'
 if([regex]::Matches($source,$pattern).Count -ne 1){throw 'CAPABILITY_OBSERVER_BOUNDARY_NOT_FOUND'}
 $source=[regex]::Replace($source,$pattern,(' '+$replacements[$name]))
}
$fixture=@'
 static byte[] fixtureBytes;
 static int fixtureAllocations;
 public static string CheckCapability(string owner,string ace,uint mask,int flags,CapabilityFixtureTarget target) {
  var sd=new RawSecurityDescriptor("O:"+owner+"G:SYD:");
  var acl=new RawAcl(2,1);acl.InsertAce(0,new CommonAce((AceFlags)flags,AceQualifier.AccessAllowed,unchecked((int)mask),new SecurityIdentifier(ace),false,null));sd.DiscretionaryAcl=acl;
  fixtureBytes=new byte[sd.BinaryLength];sd.GetBinaryForm(fixtureBytes,0);fixtureAllocations=0;
  var fact=new CapabilityFixtureFact();fact.Target=target;
  string result="PASS";
  using(var handle=new SafeFileHandle(new IntPtr(123),false)) {
   try {InspectSecurity(handle,"S-1-5-21-1-2-3-1001",true,fact);if(fact.Dacl!=CapabilityFixtureDacl.PRIVATE_POLICY_MATCH)throw new InvalidOperationException("FIXTURE_DACL_MISMATCH");}
   catch(Refused ex){result=ex.Reason.ToString();}
  }
  if(fixtureAllocations!=0)throw new InvalidOperationException("FIXTURE_MEMORY_LEAK");
  return result;
 }
'@
$marker='public static class GoriqPrivateCapabilityFixture {'
if($source.Split(@($marker),[StringSplitOptions]::None).Length -ne 2){throw 'CAPABILITY_OBSERVER_CLASS_NOT_FOUND'}
$source=$source.Replace($marker,($marker+"`n"+$fixture))
$null=Add-Type -TypeDefinition $source -Language CSharp
$observerCases=@(
 @($user,$cap,$mask,0,'PROFILE','PASS'),
 @('SY',$cap,$mask,0,'PROFILE','PASS'),
 @($user,$cap,$mask,0,'HANDOFF','PRIVATE_DACL_UNVERIFIED'),
 @($user,$cap,$mask,0,'CONTEXT','PRIVATE_DACL_UNVERIFIED'),
 @('SY',$cap,($mask -bor 1),0,'PROFILE','PRIVATE_DACL_UNVERIFIED'),
 @('SY',$cap,$mask,3,'PROFILE','PRIVATE_DACL_UNVERIFIED'),
 @('S-1-5-21-1-2-3-1009',$cap,$mask,0,'PROFILE','PRIVATE_OWNER_UNVERIFIED')
)
foreach($case in $observerCases){
 if(@($case).Count -ne 6){throw 'CAPABILITY_OBSERVER_CASE_SHAPE_INVALID'}
 $role=[CapabilityFixtureTarget][Enum]::Parse([CapabilityFixtureTarget],[string]$case[4])
 $actual=[GoriqPrivateCapabilityFixture]::CheckCapability([string]$case[0],[string]$case[1],[uint32]$case[2],[int]$case[3],$role)
 if($actual -cne $case[5]){throw ('CAPABILITY_OBSERVER_FAILED:'+$actual)}
 Write-Output ('PASS capability_observer_'+$case[4])
}
Write-Output ('OBSERVER_CAPABILITY_BOUNDARY_PASS='+$observerCases.Count)

# Synthetic Windows boundary only: no capture constructor, native handles or OS ACLs.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'WINDOWS_FIXTURE_ONLY'}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs'))
$source=$source.Replace('GoriqBridge','GoriqBridgeProfileFixture')
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
 GoriqBridgeProfileFixtureCapture(string fixtureProfile,string fixtureUser,bool inert) {
  profile=fixtureProfile;sid=fixtureUser;source="";
 }
 public static string CheckSecurity(string owner,string ace,uint attributes,string finalPath,bool metadata,bool runtime) {
  const string user="S-1-5-21-1-2-3-1001";
  var sd=new RawSecurityDescriptor("O:"+owner+"G:SYD:(A;;FA;;;"+ace+")");
  fixtureBytes=new byte[sd.BinaryLength];sd.GetBinaryForm(fixtureBytes,0);
  fixtureAttributes=attributes;fixtureFinal=finalPath;fixtureMetadata=metadata;fixtureAllocations=0;
  var capture=new GoriqBridgeProfileFixtureCapture(@"C:\Users\Fixture",user,true);
  string result="PASS";
  using(var handle=new SafeFileHandle(new IntPtr(123),false)) {
   try {
    // Invoke the actual central method twice, as descriptor snapshot/recheck do.
    byte[] first=capture.Security(handle,!runtime,runtime);
    byte[] second=capture.Security(handle,!runtime,runtime);
    if(Hash(first)!=Hash(second))throw new InvalidOperationException("FIXTURE_UNSTABLE");
   } catch(GoriqBridgeProfileFixturePrivateGuardException ex) {result=ex.Code;}
  }
  if(fixtureAllocations!=0)throw new InvalidOperationException("FIXTURE_MEMORY_LEAK");
  return result;
 }
'@
$marker='public sealed class GoriqBridgeProfileFixtureCapture : IDisposable {'
if($source.Split(@($marker),[StringSplitOptions]::None).Length -ne 2){throw 'FIXTURE_CLASS_NOT_FOUND'}
$source=$source.Replace($marker,($marker+"`n"+$fixture))
$null=Add-Type -TypeDefinition $source -Language CSharp
$user='S-1-5-21-1-2-3-1001';$profile='\\?\C:\Users\Fixture'
$cases=@(
 @('profile_system_snapshot','SY',$user,16,$profile,$true,$false,'PASS'),
 @('profile_system_strict_dacl','SY','WD',16,$profile,$true,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('profile_other_owner',$user+'2',$user,16,$profile,$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('handoff_system','SY',$user,16,($profile+'\.goriq-handoff'),$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('handoff_current_user',$user,$user,16,($profile+'\.goriq-handoff'),$true,$false,'PASS'),
 @('profile_system_reparse','SY',$user,1040,$profile,$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('profile_system_file','SY',$user,0,$profile,$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('profile_metadata_failure','SY',$user,16,$profile,$false,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('profile_final_path_mismatch','SY',$user,16,($profile+'2'),$true,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('runtime_system_preserved','SY','SY',0,'fixture',$false,$true,'PASS'),
 @('runtime_other_write_refused',$user,$user,0,'fixture',$false,$true,'PRIVATE_OWNER_UNVERIFIED')
)
foreach($case in $cases){
 $actual=[GoriqBridgeProfileFixtureCapture]::CheckSecurity([string]$case[1],[string]$case[2],[uint32]$case[3],[string]$case[4],[bool]$case[5],[bool]$case[6])
 if($actual -cne $case[7]){throw ('FIXTURE_SECURITY_FAILED:'+$case[0]+':'+$actual)}
 Write-Output ('PASS security_boundary_'+$case[0])
}
Write-Output ('SECURITY_BOUNDARY_PASS='+$cases.Count)

# Actual central capture methods with synthetic native handles/descriptors only.
# No production constructor, Observe entry, Windows file or OS ACL is accessed.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$user='S-1-5-21-1-2-3-1001';$reader='S-1-5-21-9-8-7-1002';$profile='C:\Users\Fixture'
$fixed=$profile+'\AppData\Local\GAIWorker\goal-1218-bridge-state';$app=$profile+'\AppData'
$cases=@(
 @('walk',$app,$user,$reader,1179817,19,16,$true,'PASS'),
 @('normal',$app,$user,$reader,1179817,19,16,$true,'PASS'),
 @('normal',($profile+'\AppData\Local'),'SY',$reader,1179817,3,16,$true,'PASS'),
 @('normal',($profile+'\AppData\Local\GAIWorker'),'BA',$reader,1179817,16,16,$true,'PASS'),
 @('normal',$app,'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464',$reader,1179817,0,16,$true,'PASS'),
 @('normal',$app,$reader,$reader,1179817,0,16,$true,'PRIVATE_OWNER_UNVERIFIED'),
 @('normal',$app,$user,$reader,1179817,0,16,$false,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$app,'BA',$user,2032127,0,16,$false,'PRIVATE_OWNER_UNVERIFIED'),
 @('normal',$fixed,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$fixed,'SY',$user,2032127,0,16,$true,'PRIVATE_OWNER_UNVERIFIED'),
 @('normal',($fixed+'\self-development'),$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',($fixed+'\compass.sqlite'),$user,$reader,1179817,0,0,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',($profile+'\.goriq-handoff'),$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',($profile+'\raw'),$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',($profile+'\AppData2'),$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$profile,'SY',$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$profile,'SY','S-1-15-3-65536-1-2-3-4-5-6-7-8',1048608,0,16,$true,'PASS'),
 @('normal',$app,$user,$reader,1179817,0,1040,$true,'PRIVATE_FILE_METADATA_UNVERIFIED'),
 @('normal',$app,$user,$reader,1179817,0,0,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('metadata_failure',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_FILE_METADATA_UNVERIFIED'),
 @('final_mismatch',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_FINAL_PATH_UNVERIFIED'),
 @('drift_path',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_FINAL_PATH_UNVERIFIED'),
 @('drift_attributes',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_FILE_METADATA_UNVERIFIED'),
 @('other_handle',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('callback',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('callback',$app,$user,$reader,1179817,8,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('object_allow',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('object_deny',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$app,$user,$reader,1179817,32,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('normal',$app,$user,$reader,1179817,128,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('deny',$app,$user,$reader,2032127,0,16,$true,'PASS'),
 @('empty',$app,$user,$reader,1179817,0,16,$true,'PASS'),
 @('null_dacl',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('absent_dacl',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('missing_owner',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED'),
 @('oversize',$app,$user,$reader,1179817,0,16,$true,'PRIVATE_DACL_UNVERIFIED')
)
foreach($bit in @([uint32]2,[uint32]4,[uint32]16,[uint32]64,[uint32]256,[uint32]512,[uint32]65536,[uint32]262144,[uint32]524288,[uint32]16777216,[uint32]33554432,[uint32]268435456,[uint32]536870912,[uint32]1073741824,[uint32]2147483648)){
 $cases+=,@('normal',$app,$user,$reader,([uint32]1179817 -bor $bit),0,16,$true,'PRIVATE_DACL_UNVERIFIED')
}
foreach($case in $cases){if(@($case).Count -ne 9){throw 'SOURCE_ANCESTOR_NATIVE_CASE_SHAPE_INVALID'}}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../goriq-zbook-bridge-capture.cs')).Replace('GoriqBridge','GoriqBridgeSourceAncestorFixture')
$replacements=@{
 'CreateFileW'='static SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template){if(share!=7)throw new InvalidOperationException("FIXTURE_SOURCE_SHARE");var h=new SafeFileHandle(new IntPtr(++fixtureNext),false);fixturePaths.Add(h.DangerousGetHandle(),path);return h;}'
 'GetFileInformationByHandle'='static bool GetFileInformationByHandle(SafeFileHandle file,out Info info){info=new Info();string path=fixturePaths[file.DangerousGetHandle()];info.attributes=path==fixtureSelected?fixtureAttributes:16;info.links=1;return path!=fixtureSelected||fixtureMode!="metadata_failure";}'
 'GetFileInformationByHandleEx'='static bool GetFileInformationByHandleEx(SafeFileHandle file,int infoClass,out BasicInfo info,uint size){info=new BasicInfo();return true;}'
 'GetFinalPathNameByHandle'='static uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags){string p=fixturePaths[file.DangerousGetHandle()];path.Append(@"\\?\"+p);if(p==fixtureSelected&&fixtureBadFinal)path.Append("2");return (uint)path.Length;}'
 'GetSecurityInfo'='static uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor){owner=group=dacl=sacl=IntPtr.Zero;byte[] bytes=fixturePaths[handle.DangerousGetHandle()]==fixtureSelected?fixtureBytes:fixturePrivateBytes;descriptor=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,descriptor,bytes.Length);fixtureSizes.Add(descriptor,bytes.Length);return 0;}'
 'GetSecurityDescriptorLength'='static uint GetSecurityDescriptorLength(IntPtr descriptor){return fixtureMode=="oversize"?65537u:(uint)fixtureSizes[descriptor];}'
 'LocalFree'='static IntPtr LocalFree(IntPtr memory){Marshal.FreeHGlobal(memory);fixtureSizes.Remove(memory);return IntPtr.Zero;}'
}
foreach($name in $replacements.Keys){
 $pattern='(?m)^ \[DllImport\([^\r\n]+ static extern [^\r\n]+\b'+$name+'\([^\r\n]+;\r?$'
 if([regex]::Matches($source,$pattern).Count -ne 1){throw 'SOURCE_ANCESTOR_NATIVE_BOUNDARY_NOT_FOUND'}
 $source=[regex]::Replace($source,$pattern,(' '+$replacements[$name]))
}
$fixture=@'
 // DriveInfo is also inert: the real Open/Inspect walk runs without disk I/O.
 sealed class DriveInfo {public DriveInfo(string path){} public bool IsReady {get{return true;}} public DriveType DriveType {get{return DriveType.Fixed;}} public string DriveFormat {get{return "NTFS";}}}
 static Dictionary<IntPtr,string> fixturePaths=new Dictionary<IntPtr,string>();
 static Dictionary<IntPtr,int> fixtureSizes=new Dictionary<IntPtr,int>();
 static int fixtureNext;
 static string fixtureMode,fixtureSelected;
 static uint fixtureAttributes;
 static bool fixtureBadFinal;
 static byte[] fixtureBytes,fixturePrivateBytes;
 GoriqBridgeSourceAncestorFixtureCapture(bool inert) {
  profile=@"C:\Users\Fixture";sid="S-1-5-21-1-2-3-1001";source=profile+@"\AppData\Local\GAIWorker\goal-1218-bridge-state";
 }
 static byte[] Descriptor(string owner,string ace,uint mask,int flags,string mode) {
  var sd=new RawSecurityDescriptor("O:"+owner+"G:SYD:");var acl=new RawAcl(2,1);
  if(mode=="object_allow"||mode=="object_deny") {
   acl=new RawAcl(4,1);acl.InsertAce(0,new ObjectAce((AceFlags)flags,mode=="object_allow"?AceQualifier.AccessAllowed:AceQualifier.AccessDenied,unchecked((int)mask),new SecurityIdentifier(ace),ObjectAceFlags.None,Guid.Empty,Guid.Empty,false,null));
  } else if(mode!="empty")acl.InsertAce(0,new CommonAce((AceFlags)flags,mode=="deny"?AceQualifier.AccessDenied:AceQualifier.AccessAllowed,unchecked((int)mask),new SecurityIdentifier(ace),mode=="callback",null));
  sd.DiscretionaryAcl=acl;
  if(mode=="null_dacl")sd.DiscretionaryAcl=null;
  if(mode=="absent_dacl")sd=new RawSecurityDescriptor(ControlFlags.SelfRelative,new SecurityIdentifier(owner),null,null,null);
  if(mode=="missing_owner")sd.Owner=null;
  byte[] bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);return bytes;
 }
 public static string Check(string mode,string path,string owner,string ace,uint mask,int flags,uint attributes,bool walk) {
  fixtureMode=mode;fixtureSelected=path;fixtureAttributes=attributes;fixtureBadFinal=mode=="final_mismatch";fixturePaths.Clear();fixtureSizes.Clear();fixtureNext=100;
  fixtureBytes=Descriptor(owner,ace,mask,flags,mode);fixturePrivateBytes=Descriptor("S-1-5-21-1-2-3-1001","S-1-5-21-1-2-3-1001",2032127,0,"normal");
  var capture=new GoriqBridgeSourceAncestorFixtureCapture(true);string result="PASS";
  try {
   if(mode=="walk") {
    capture.Ancestors(capture.source,true,true);
    foreach(var dir in capture.sourceDirectories)if(capture.SourceIdentity(dir.Item2,dir.Item1,true)!=dir.Item3||Hash(capture.Security(dir.Item2,Within(capture.profile,dir.Item1)))!=dir.Item4)throw new InvalidOperationException("FIXTURE_WALK_RECHECK");
   } else {
    var handle=CreateFileW(path,0,7,IntPtr.Zero,3,0,IntPtr.Zero);
    capture.Inspect(handle,path,(attributes&16)!=0,true,false,walk);
    string first=capture.SourceIdentity(handle,path,(attributes&16)!=0);byte[] before=capture.Security(handle,true);
    if(mode=="drift_path")fixtureBadFinal=true;
    if(mode=="drift_attributes")fixtureAttributes=0;
    if(mode=="other_handle")handle=CreateFileW(path,0,7,IntPtr.Zero,3,0,IntPtr.Zero);
    if(capture.SourceIdentity(handle,path,(attributes&16)!=0)!=first||Hash(capture.Security(handle,true))!=Hash(before))throw new InvalidOperationException("FIXTURE_UNSTABLE");
   }
  } catch(GoriqBridgeSourceAncestorFixturePrivateGuardException ex){result=ex.Code;}
  finally{capture.Dispose();}
  if(fixtureSizes.Count!=0)throw new InvalidOperationException("FIXTURE_MEMORY_LEAK");return result;
 }
'@
$marker='public sealed class GoriqBridgeSourceAncestorFixtureCapture : IDisposable {'
if($source.Split(@($marker),[StringSplitOptions]::None).Length -ne 2){throw 'SOURCE_ANCESTOR_FIXTURE_CLASS_NOT_FOUND'}
$source=$source.Replace($marker,($marker+"`n"+$fixture))
if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
Write-Output ('SOURCE_ANCESTOR_NATIVE_COMPILE_CASES='+$cases.Count)
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){return}
$checks=0
foreach($case in $cases){
 $actual=[GoriqBridgeSourceAncestorFixtureCapture]::Check([string]$case[0],[string]$case[1],[string]$case[2],[string]$case[3],[uint32]$case[4],[int]$case[5],[uint32]$case[6],[bool]$case[7])
 if($actual -cne $case[8]){throw ('SOURCE_ANCESTOR_NATIVE_FAILED:'+ $checks+':'+$case[0]+':'+$actual)}
 $checks++;Write-Output ('PASS source_ancestor_native_'+$checks)
}
Write-Output ('SOURCE_ANCESTOR_NATIVE_PASS='+$checks)

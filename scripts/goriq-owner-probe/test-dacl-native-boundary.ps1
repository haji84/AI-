# Windows-only synthetic descriptor parsing; never opens an OS object.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'WINDOWS_FIXTURE_ONLY'}
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'goriq-private-owner-probe.cs')).Replace('OwnerProbe','DaclFixture')
$replacements=@{
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
 static byte[] fixtureBytes;
 static int fixtureAllocations;
 public static string InspectFixture(string principal,uint mask,bool callback,bool unqualified,bool inheritOnly,bool denyFirst) {
  const string user="S-1-5-21-1-2-3-1001";
  var acl=new RawAcl(2,4);
  acl.InsertAce(acl.Count,new CommonAce(AceFlags.None,AceQualifier.AccessAllowed,0x1f01ff,new SecurityIdentifier(user),false,null));
  if(denyFirst)acl.InsertAce(acl.Count,new CommonAce(AceFlags.None,AceQualifier.AccessDenied,0x1f01ff,new SecurityIdentifier("S-1-1-0"),false,null));
  AceFlags flags=inheritOnly?AceFlags.ObjectInherit|AceFlags.ContainerInherit|AceFlags.InheritOnly:AceFlags.None;
  GenericAce candidate=unqualified?(GenericAce)new CustomAce((AceType)0x42,flags,new byte[0]):new CommonAce(flags,AceQualifier.AccessAllowed,unchecked((int)mask),new SecurityIdentifier(principal),callback,null);
  acl.InsertAce(acl.Count,candidate);
  if(inheritOnly)acl.InsertAce(acl.Count,new CommonAce(AceFlags.None,AceQualifier.AccessAllowed,0x1200a9,new SecurityIdentifier("S-1-15-2-1"),false,null));
  var sd=new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent,new SecurityIdentifier("S-1-5-18"),null,null,acl);
  fixtureBytes=new byte[sd.BinaryLength];sd.GetBinaryForm(fixtureBytes,0);fixtureAllocations=0;
  var fact=new DaclFixtureFact();fact.Target=DaclFixtureTarget.PROFILE;
  bool refused=false;
  using(var handle=new SafeFileHandle(new IntPtr(123),false)) {
   try {InspectSecurity(handle,user,true,fact);}
   catch(Refused ex){if(ex.Reason!=DaclFixtureReason.PRIVATE_DACL_UNVERIFIED)throw;refused=true;}
  }
  if(!refused||fixtureAllocations!=0||fact.Owner!=DaclFixtureOwner.SYSTEM)throw new InvalidOperationException("FIXTURE_RESULT_INVALID");
  return fact.Dacl.ToString();
 }
'@
$marker='public static class GoriqPrivateDaclFixture {'
if($source.Split(@($marker),[StringSplitOptions]::None).Length -ne 2){throw 'FIXTURE_CLASS_NOT_FOUND'}
$source=$source.Replace($marker,($marker+"`n"+$fixture))
$null=Add-Type -TypeDefinition $source -Language CSharp
$cases=@(
 @('S-1-1-0',1179817,$false,$false,$false,$false,'REFUSED_EVERYONE_NONWRITING'),
 @('S-1-5-11',2,$false,$false,$false,$false,'REFUSED_AUTHENTICATED_USERS_WRITE_OR_OTHER'),
 @('S-1-5-32-545',512,$false,$false,$false,$false,'REFUSED_BUILTIN_USERS_WRITE_OR_OTHER'),
 @('S-1-15-2-1',1179817,$false,$false,$false,$true,'REFUSED_ALL_APPLICATION_PACKAGES_NONWRITING'),
 @('S-1-15-2-2',262144,$false,$false,$false,$false,'REFUSED_ALL_RESTRICTED_APPLICATION_PACKAGES_WRITE_OR_OTHER'),
 @('S-1-5-21-1-2-3-1009',1179817,$false,$false,$false,$false,'REFUSED_OTHER_ACCOUNT_NONWRITING'),
 @('S-1-1-0',2,$true,$false,$false,$false,'REFUSED_CALLBACK_ACE'),
 @('S-1-1-0',2,$false,$true,$false,$false,'REFUSED_UNQUALIFIED_ACE'),
 @('S-1-1-0',2,$true,$false,$true,$false,'REFUSED_ALL_APPLICATION_PACKAGES_NONWRITING')
)
foreach($case in $cases){
 if(@($case).Count -ne 7){throw 'FIXTURE_CASE_SHAPE_INVALID'}
 $actual=[GoriqPrivateDaclFixture]::InspectFixture([string]$case[0],[uint32]$case[1],[bool]$case[2],[bool]$case[3],[bool]$case[4],[bool]$case[5])
 if($actual -cne $case[6]){throw ('FIXTURE_DACL_FAILED:'+ $actual)}
 Write-Output ('PASS native_dacl_'+$actual)
}
Write-Output ('DACL_BOUNDARY_PASS='+$cases.Count)

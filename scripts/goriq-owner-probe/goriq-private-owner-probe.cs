// Standalone metadata observation. No capture constructor, acquisition, content
// read, creation, ACL mutation, runtime probe, directory enumeration or repair.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

public enum OwnerProbeTarget { NONE, IDENTITY, PROFILE_ENVIRONMENT, VOLUME_ROOT, ANCESTOR_01, ANCESTOR_02, ANCESTOR_03, ANCESTOR_04, ANCESTOR_05, ANCESTOR_06, ANCESTOR_07, PROFILE, HANDOFF, LAYOUT, RAW, WORK, CONTEXT }
public enum OwnerProbeReason { NOT_STARTED, OBSERVED_POLICY_MATCH, UNSUPPORTED_PLATFORM, IDENTITY_UNVERIFIED, UNSAFE_PROFILE, TARGET_LIMIT, TIMEOUT, TARGET_MISSING, ACCESS_DENIED, PRIVATE_LOCAL_STORAGE_UNAVAILABLE, PRIVATE_NATIVE_OPEN_UNAVAILABLE, PRIVATE_FILE_METADATA_UNVERIFIED, PRIVATE_FINAL_PATH_UNVERIFIED, PRIVATE_OWNER_UNVERIFIED, PRIVATE_DACL_UNVERIFIED, UNEXPECTED_FAILURE, OUTPUT_REJECTED }
public enum OwnerProbeOwner { UNOBSERVED, CURRENT_USER, OTHER, SYSTEM }
public enum OwnerProbeDacl { UNOBSERVED, PRIVATE_POLICY_MATCH, ANCESTOR_METADATA_ONLY, UNVERIFIED }
public enum OwnerProbeAccount { CURRENT_USER, SYSTEM, ADMINISTRATORS, TRUSTED_INSTALLER, OTHER }
public enum OwnerProbeQualifier { ALLOW, DENY, OTHER }
public sealed class OwnerProbeAce { public bool InheritOnly, Qualified, Callback; public OwnerProbeAccount Account; public OwnerProbeQualifier Qualifier; public string Sid; public uint Mask; public int Flags; }
public sealed class OwnerProbeSpec { public OwnerProbeTarget Target; public string Path; public bool Directory, Private; }
public sealed class OwnerProbeFact {
 public OwnerProbeTarget Target; public OwnerProbeReason Reason=OwnerProbeReason.NOT_STARTED;
 public bool StorageVerified, AttributesVerified, FinalPathVerified;
 public OwnerProbeOwner Owner=OwnerProbeOwner.UNOBSERVED; public OwnerProbeDacl Dacl=OwnerProbeDacl.UNOBSERVED;
}
public sealed class OwnerProbeReport {
 public bool AllFixedTargetsObserved;
 public OwnerProbeTarget Target=OwnerProbeTarget.NONE;
 public OwnerProbeReason Reason=OwnerProbeReason.NOT_STARTED;
 public List<OwnerProbeFact> Observations=new List<OwnerProbeFact>();
}
public static class GoriqPrivateOwnerProbe {
 const string Installer="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
 const uint READ_CONTROL=0x20000, READ_ATTRIBUTES=0x80, OPEN_EXISTING=3, SHARE_ALL=7, BACKUP=0x02000000, OPEN_REPARSE=0x00200000;
 [StructLayout(LayoutKind.Sequential)] struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags);
 [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 sealed class Refused : Exception {public OwnerProbeReason Reason;public Refused(OwnerProbeReason reason){Reason=reason;}}
 static void Require(bool value,OwnerProbeReason reason){if(!value)throw new Refused(reason);}
 static bool Within(string parent,string path){return path.Equals(parent,StringComparison.OrdinalIgnoreCase)||path.StartsWith(parent.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
 public static bool CanonicalLocalPath(string path) {
  if(String.IsNullOrEmpty(path)||path.Length>240||!Regex.IsMatch(path,@"^[A-Za-z]:\\")||path.Substring(2).IndexOfAny(new char[]{':','/','"','<','>','|','?','*'})>=0)return false;
  foreach(char c in path)if(Char.IsControl(c))return false;
  if(path.Length==3)return true;
  foreach(string part in path.Substring(3).Split('\\'))if(part.Length==0||part=="."||part==".."||part.EndsWith(" ")||part.EndsWith(".")||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase))return false;
  return true;
 }
 public static bool ProfileContextSafe(string profile,string environmentProfile,string local,string environmentLocal,string workspace) {
  if(profile!=environmentProfile||local!=environmentLocal||!CanonicalLocalPath(profile)||profile.Length==3||!CanonicalLocalPath(local)||!CanonicalLocalPath(workspace)||!Within(profile,local))return false;
  string parent=profile+"\\.goriq-handoff",source=local+"\\GAIWorker\\goal-1218-bridge-state";
  return CanonicalLocalPath(source)&&FixedTargets(profile).Length!=0&&!Within(workspace,parent)&&!Within(parent,workspace)&&!Within(source,parent)&&!Within(parent,source)&&!Within(source,workspace)&&!Within(workspace,source);
 }
 // Pure fixed plan: at most 14 native targets plus identity/environment = 16.
 public static OwnerProbeSpec[] FixedTargets(string profile) {
  if(!CanonicalLocalPath(profile)||profile.Length==3)return new OwnerProbeSpec[0];
  string[] parts=profile.Substring(3).Split('\\');if(parts.Length>8)return new OwnerProbeSpec[0];
  var result=new List<OwnerProbeSpec>();string current=profile.Substring(0,3);
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.VOLUME_ROOT,Path=current,Directory=true});
  for(int n=0;n<parts.Length;n++) {
   current+=(current.Length==3?"":"\\")+parts[n];
   result.Add(new OwnerProbeSpec{Target=n==parts.Length-1?OwnerProbeTarget.PROFILE:(OwnerProbeTarget)((int)OwnerProbeTarget.ANCESTOR_01+n),Path=current,Directory=true,Private=n==parts.Length-1});
  }
  string parent=profile+"\\.goriq-handoff",layout=parent+"\\1219-original-inspection-43843790970-1";
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.HANDOFF,Path=parent,Directory=true,Private=true});
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.LAYOUT,Path=layout,Directory=true,Private=true});
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.RAW,Path=layout+"\\raw",Directory=true,Private=true});
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.WORK,Path=layout+"\\work",Directory=true,Private=true});
  result.Add(new OwnerProbeSpec{Target=OwnerProbeTarget.CONTEXT,Path=layout+"\\context.txt",Directory=false,Private=true});
  foreach(var target in result)if(!CanonicalLocalPath(target.Path))return new OwnerProbeSpec[0];
  return result.ToArray();
 }
 public static bool PrivateOwnerPermitted(OwnerProbeTarget target,OwnerProbeOwner owner) {
  return Defined(target)&&Defined(owner)&&(owner==OwnerProbeOwner.CURRENT_USER||(target==OwnerProbeTarget.PROFILE&&owner==OwnerProbeOwner.SYSTEM));
 }
 public static bool ProfileCapabilityTraversePermitted(string who,uint mask,int flags,bool exactProfileDirectory) {
  // Keep identical to Capture: only noninheriting app-silo directory traversal,
  // never list/read/write/control access or a private child/file exception.
  if(!exactProfileDirectory||mask!=0x100020u||flags!=0||String.IsNullOrEmpty(who)||who.Length>184||!Regex.IsMatch(who,@"^S-1-15-3-65536-(?:[0-9]+-){7}[0-9]+\z"))return false;
  string[] parts=who.Split('-');
  for(int n=5;n<parts.Length;n++){uint value;if(!UInt32.TryParse(parts[n],out value)||value.ToString(System.Globalization.CultureInfo.InvariantCulture)!=parts[n])return false;}
  return true;
 }
 // Preserve the original pure API; callers without a validated target never
 // acquire the profile-only SYSTEM exception.
 public static OwnerProbeReason ReduceSecurity(bool ownerPresent,bool daclPresent,bool ownerMatches,bool privacy,OwnerProbeAce[] aces) {
  return ReduceSecurity(ownerPresent,daclPresent,ownerMatches?OwnerProbeOwner.CURRENT_USER:OwnerProbeOwner.OTHER,privacy,aces,OwnerProbeTarget.NONE);
 }
 // Owner remains checked before ACEs. Only the fixed PROFILE role receives
 // the approved exception after native attributes/final path validation.
 public static OwnerProbeReason ReduceSecurity(bool ownerPresent,bool daclPresent,OwnerProbeOwner owner,bool privacy,OwnerProbeAce[] aces,OwnerProbeTarget target) {
  if(!ownerPresent||!daclPresent||aces==null)return OwnerProbeReason.PRIVATE_DACL_UNVERIFIED;
  if(privacy&&!PrivateOwnerPermitted(target,owner))return OwnerProbeReason.PRIVATE_OWNER_UNVERIFIED;
  foreach(var ace in aces) {
   if(ace==null)return OwnerProbeReason.PRIVATE_DACL_UNVERIFIED;
   if(ace.InheritOnly)continue;
   if(!ace.Qualified||ace.Callback)return OwnerProbeReason.PRIVATE_DACL_UNVERIFIED;
   if(ace.Qualifier==OwnerProbeQualifier.ALLOW&&privacy&&ace.Account==OwnerProbeAccount.OTHER&&!ProfileCapabilityTraversePermitted(ace.Sid,ace.Mask,ace.Flags,target==OwnerProbeTarget.PROFILE))return OwnerProbeReason.PRIVATE_DACL_UNVERIFIED;
  }
  return OwnerProbeReason.OBSERVED_POLICY_MATCH;
 }
 static OwnerProbeAccount Account(string who,string sid) {
  if(who==sid)return OwnerProbeAccount.CURRENT_USER;
  if(who=="S-1-5-18")return OwnerProbeAccount.SYSTEM;
  if(who=="S-1-5-32-544")return OwnerProbeAccount.ADMINISTRATORS;
  return who==Installer?OwnerProbeAccount.TRUSTED_INSTALLER:OwnerProbeAccount.OTHER;
 }
 static void InspectSecurity(SafeFileHandle handle,string sid,bool privacy,OwnerProbeFact fact) {
  IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
  try {
   Require(GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)==0&&descriptor!=IntPtr.Zero,OwnerProbeReason.PRIVATE_DACL_UNVERIFIED);
   uint size=GetSecurityDescriptorLength(descriptor);Require(size>0&&size<=65536,OwnerProbeReason.PRIVATE_DACL_UNVERIFIED);
   byte[] bytes=new byte[size];Marshal.Copy(descriptor,bytes,0,(int)size);var sd=new RawSecurityDescriptor(bytes,0);
   bool present=sd.DiscretionaryAcl!=null&&(sd.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0;
   if(sd.Owner!=null)fact.Owner=sd.Owner.Value==sid?OwnerProbeOwner.CURRENT_USER:sd.Owner.Value=="S-1-5-18"?OwnerProbeOwner.SYSTEM:OwnerProbeOwner.OTHER;
   // Stop at nonpermitted owner before examining ACEs; DACL remains strict
   // for the SYSTEM-owned profile just as for a current-user-owned profile.
   var preliminary=ReduceSecurity(sd.Owner!=null,present,fact.Owner,privacy,new OwnerProbeAce[0],fact.Target);
   Require(preliminary==OwnerProbeReason.OBSERVED_POLICY_MATCH,preliminary);
   var aces=new List<OwnerProbeAce>();
   foreach(GenericAce ace in sd.DiscretionaryAcl) {
    var item=new OwnerProbeAce();item.InheritOnly=(ace.AceFlags&AceFlags.InheritOnly)!=0;
    if(!item.InheritOnly) {
     var known=ace as QualifiedAce;item.Qualified=known!=null;
     if(known!=null){item.Callback=known.IsCallback;item.Qualifier=known.AceQualifier==AceQualifier.AccessAllowed?OwnerProbeQualifier.ALLOW:known.AceQualifier==AceQualifier.AccessDenied?OwnerProbeQualifier.DENY:OwnerProbeQualifier.OTHER;item.Account=Account(known.SecurityIdentifier.Value,sid);item.Sid=known.SecurityIdentifier.Value;item.Mask=(uint)known.AccessMask;item.Flags=(int)known.AceFlags;}
    }
    aces.Add(item);
   }
   var reason=ReduceSecurity(true,true,fact.Owner,privacy,aces.ToArray(),fact.Target);
   fact.Dacl=reason==OwnerProbeReason.OBSERVED_POLICY_MATCH?(privacy?OwnerProbeDacl.PRIVATE_POLICY_MATCH:OwnerProbeDacl.ANCESTOR_METADATA_ONLY):OwnerProbeDacl.UNVERIFIED;
   Require(reason==OwnerProbeReason.OBSERVED_POLICY_MATCH,reason);
  } finally {if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
 }
 static void Budget(Stopwatch time){Require(time.ElapsedMilliseconds<20000,OwnerProbeReason.TIMEOUT);}
 public static string ObserveJson() {
  var report=new OwnerProbeReport();var held=new List<SafeFileHandle>();var time=Stopwatch.StartNew();OwnerProbeFact fact=null;
  try {
   Require(Environment.OSVersion.Platform==PlatformID.Win32NT,OwnerProbeReason.UNSUPPORTED_PLATFORM);
   fact=new OwnerProbeFact{Target=OwnerProbeTarget.IDENTITY};report.Observations.Add(fact);string sid;
   using(var identity=WindowsIdentity.GetCurrent()) {
    Require(identity.User!=null&&!identity.IsSystem&&!identity.IsAnonymous&&identity.ImpersonationLevel!=TokenImpersonationLevel.Impersonation&&identity.ImpersonationLevel!=TokenImpersonationLevel.Delegation,OwnerProbeReason.IDENTITY_UNVERIFIED);sid=identity.User.Value;
   }
   fact.Reason=OwnerProbeReason.OBSERVED_POLICY_MATCH;
   fact=new OwnerProbeFact{Target=OwnerProbeTarget.PROFILE_ENVIRONMENT};report.Observations.Add(fact);
   string profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
   Require(ProfileContextSafe(profile,Environment.GetEnvironmentVariable("USERPROFILE"),local,Environment.GetEnvironmentVariable("LOCALAPPDATA"),Environment.GetEnvironmentVariable("GITHUB_WORKSPACE")),OwnerProbeReason.UNSAFE_PROFILE);
   fact.Reason=OwnerProbeReason.OBSERVED_POLICY_MATCH;
   foreach(var spec in FixedTargets(profile)) {
    Budget(time);Require(report.Observations.Count<16,OwnerProbeReason.TARGET_LIMIT);
    fact=new OwnerProbeFact{Target=spec.Target};report.Observations.Add(fact);
    var drive=new DriveInfo(spec.Path.Substring(0,3));Require(drive.IsReady&&drive.DriveType==DriveType.Fixed&&drive.DriveFormat=="NTFS",OwnerProbeReason.PRIVATE_LOCAL_STORAGE_UNAVAILABLE);fact.StorageVerified=true;
    Budget(time);var handle=CreateFileW(spec.Path,READ_CONTROL|READ_ATTRIBUTES,SHARE_ALL,IntPtr.Zero,OPEN_EXISTING,BACKUP|OPEN_REPARSE,IntPtr.Zero);
    if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Refused(error==2||error==3?OwnerProbeReason.TARGET_MISSING:error==5?OwnerProbeReason.ACCESS_DENIED:OwnerProbeReason.PRIVATE_NATIVE_OPEN_UNAVAILABLE);}
    held.Add(handle);Info info;Budget(time);
    Require(GetFileInformationByHandle(handle,out info)&&(info.attributes&0x400)==0&&((info.attributes&0x10)!=0)==spec.Directory&&(spec.Directory||info.links==1),OwnerProbeReason.PRIVATE_FILE_METADATA_UNVERIFIED);fact.AttributesVerified=true;
    var final=new StringBuilder(1024);Budget(time);uint count=GetFinalPathNameByHandle(handle,final,1024,0);
    Require(count>0&&count<1024&&String.Equals(final.ToString(),"\\\\?\\"+spec.Path,StringComparison.OrdinalIgnoreCase),OwnerProbeReason.PRIVATE_FINAL_PATH_UNVERIFIED);fact.FinalPathVerified=true;
    Budget(time);InspectSecurity(handle,sid,spec.Private,fact);fact.Reason=OwnerProbeReason.OBSERVED_POLICY_MATCH;
   }
   Budget(time);report.AllFixedTargetsObserved=true;report.Reason=OwnerProbeReason.OBSERVED_POLICY_MATCH;report.Target=OwnerProbeTarget.CONTEXT;
  } catch(Refused failure) {report.Reason=failure.Reason;if(fact!=null){fact.Reason=failure.Reason;report.Target=fact.Target;}}
    catch {report.Reason=OwnerProbeReason.UNEXPECTED_FAILURE;if(fact!=null){fact.Reason=report.Reason;report.Target=fact.Target;}}
  finally {for(int n=held.Count-1;n>=0;n--)held[n].Dispose();}
  return Render(report);
 }
 static bool Defined<T>(T value){return Enum.IsDefined(typeof(T),value);}
 public static string Render(OwnerProbeReport report) {
  bool valid=report!=null&&Defined(report.Target)&&Defined(report.Reason)&&report.Observations!=null&&report.Observations.Count<=16;
  if(valid)foreach(var fact in report.Observations)if(fact==null||!Defined(fact.Target)||!Defined(fact.Reason)||!Defined(fact.Owner)||!Defined(fact.Dacl)){valid=false;break;}
  if(!valid)report=new OwnerProbeReport{Reason=OwnerProbeReason.OUTPUT_REJECTED};
  var text=new StringBuilder("{\"schema\":\"OWNER_PROBE_V1\",\"authority\":\"NOT_AUTHORITATIVE\",\"status\":\"INCOMPLETE\",\"readOnly\":true,\"metadataOnly\":true,\"recovered\":false,\"g1\":\"HOLD\",\"historicalStateProven\":false,\"allFixedTargetsObserved\":");
  text.Append(report.AllFixedTargetsObserved?"true":"false").Append(",\"target\":\"").Append(report.Target).Append("\",\"reason\":\"").Append(report.Reason).Append("\",\"observations\":[");
  bool first=true;foreach(var fact in report.Observations){if(!first)text.Append(',');first=false;text.Append("{\"target\":\"").Append(fact.Target).Append("\",\"reason\":\"").Append(fact.Reason).Append("\",\"storageVerified\":").Append(fact.StorageVerified?"true":"false").Append(",\"attributesVerified\":").Append(fact.AttributesVerified?"true":"false").Append(",\"finalPathVerified\":").Append(fact.FinalPathVerified?"true":"false").Append(",\"owner\":\"").Append(fact.Owner).Append("\",\"dacl\":\"").Append(fact.Dacl).Append("\"}");}
  return text.Append("]}").ToString();
 }
}

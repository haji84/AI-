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

// Separate read-only diagnostic. The legacy observer and Capture policy above
// are deliberately not used to decide whether these observed ACLs are private.
public static class GoriqSourceAclProbe {
 public enum Target { VOLUME_ROOT, PROFILE_ANCESTOR_01, PROFILE_ANCESTOR_02, PROFILE_ANCESTOR_03, PROFILE_ANCESTOR_04, PROFILE_ANCESTOR_05, PROFILE_ANCESTOR_06, PROFILE_ANCESTOR_07, PROFILE, SOURCE_ANCESTOR_01, SOURCE_ANCESTOR_02, SOURCE_ANCESTOR_03, SOURCE_ANCESTOR_04, SOURCE_ANCESTOR_05, SOURCE_ANCESTOR_06, SOURCE_ANCESTOR_07, APPDATA, LOCAL, WORKER, SOURCE, DB, WAL, SHM, JOURNAL, SIDECAR, JOBS, CHANGES, HANDOFF, CAPTURE, RAW, WORK, CONTEXT, RAW_DB, RAW_WAL, RAW_SHM, RAW_JOBS, RAW_CHANGES, WORK_DB, WORK_WAL, WORK_SHM, WORK_JOBS, WORK_CHANGES }
 public enum Reason { OBSERVED, UNSUPPORTED_PLATFORM, IDENTITY_UNVERIFIED, UNSAFE_PROFILE, TARGET_LIMIT, TIMEOUT, UNEXPECTED_FAILURE, OUTPUT_REJECTED }
 public enum Status { ACL_OBSERVED, TARGET_MISSING, ACCESS_DENIED, ANCESTOR_UNVERIFIED, STORAGE_UNVERIFIED, ATTRIBUTES_UNVERIFIED, FINAL_PATH_UNVERIFIED, SECURITY_DESCRIPTOR_UNVERIFIED, ACE_LIMIT, TIMEOUT, UNEXPECTED_FAILURE }
 public enum Owner { UNOBSERVED, CURRENT_USER, SYSTEM, ADMINISTRATORS, TRUSTED_INSTALLER, OTHER }
 public enum Dacl { UNOBSERVED, PRESENT, NULL, ABSENT }
 public enum Account { CURRENT_USER, SYSTEM, ADMINISTRATORS, TRUSTED_INSTALLER, APP_SILO, APP_CAPABILITY, APP_PACKAGE, EVERYONE, AUTHENTICATED_USERS, USERS, OTHER }
 public enum Qualifier { ALLOW, DENY, CALLBACK_ALLOW, CALLBACK_DENY, OTHER }
 public sealed class Spec { public Target Target; public string Path; public bool Directory; public int ParentIndex=-1; }
 public sealed class Ace { public Account Account; public Qualifier Qualifier; public uint Mask; public byte Flags; }
 public sealed class Fact {
  public Target Target; public Status Status=Status.UNEXPECTED_FAILURE;
  public bool StorageVerified,AttributesVerified,FinalPathVerified;
  public Owner Owner=Owner.UNOBSERVED; public Dacl Dacl=Dacl.UNOBSERVED;
  public List<Ace> Aces=new List<Ace>();
 }
 public sealed class Report {
  public bool Completed; public Reason Reason=Reason.UNEXPECTED_FAILURE;
  public List<Fact> Observations=new List<Fact>();
 }
 const int MaxTargets=48,MaxAces=16,MaxDescriptorBytes=65536,MaxOutputBytes=131072;
 const uint READ_CONTROL=0x20000,READ_ATTRIBUTES=0x80,OPEN_EXISTING=3,SHARE_ALL=7,BACKUP=0x02000000,OPEN_REPARSE=0x00200000;
 const string Installer="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow; }
 [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern SafeFileHandle SourceCreateFile(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandle",ExactSpelling=true,SetLastError=true)] static extern bool SourceGetFileInformation(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",EntryPoint="GetFinalPathNameByHandleW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern uint SourceGetFinalPath(SafeFileHandle file,StringBuilder path,uint length,uint flags);
 [DllImport("advapi32.dll",EntryPoint="GetSecurityInfo",ExactSpelling=true,SetLastError=true)] static extern uint SourceGetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll",EntryPoint="GetSecurityDescriptorLength",ExactSpelling=true)] static extern uint SourceGetDescriptorLength(IntPtr descriptor);
 [DllImport("kernel32.dll",EntryPoint="LocalFree",ExactSpelling=true)] static extern IntPtr SourceLocalFree(IntPtr memory);
 sealed class Refused : Exception { public Reason Reason; public Refused(Reason reason){Reason=reason;} }
 sealed class Held { public SafeFileHandle Handle; public Spec Spec; public Info Info; }
 static void Require(bool value,Reason reason){if(!value)throw new Refused(reason);}
 static void Budget(Stopwatch time){Require(time.ElapsedMilliseconds<20000,Reason.TIMEOUT);}
 static bool Within(string parent,string path){return path.Equals(parent,StringComparison.OrdinalIgnoreCase)||path.StartsWith(parent.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
 static string ParentPath(string path){int n=path.LastIndexOf('\\');return n==2?path.Substring(0,3):path.Substring(0,n);}
 public static bool CanonicalLocalPath(string path) {
  if(String.IsNullOrEmpty(path)||path.Length>240||!Regex.IsMatch(path,@"^[A-Za-z]:\\")||path.Substring(2).IndexOfAny(new char[]{':','/','"','<','>','|','?','*'})>=0)return false;
  foreach(char c in path)if(Char.IsControl(c))return false;
  if(path.Length==3)return true;
  foreach(string part in path.Substring(3).Split('\\'))if(part.Length==0||part=="."||part==".."||part.EndsWith(" ")||part.EndsWith(".")||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase))return false;
  return true;
 }
 public static bool ProfileContextSafe(string profile,string environmentProfile,string local,string environmentLocal,string workspace) {
  if(!String.Equals(profile,environmentProfile,StringComparison.Ordinal)||!String.Equals(local,environmentLocal,StringComparison.Ordinal)||!CanonicalLocalPath(workspace)||FixedTargets(profile,local).Length==0)return false;
  string source=local+"\\GAIWorker\\goal-1218-bridge-state",handoff=profile+"\\.goriq-handoff";
  return !Within(workspace,source)&&!Within(source,workspace)&&!Within(workspace,handoff)&&!Within(handoff,workspace)&&!Within(source,handoff)&&!Within(handoff,source);
 }
 static void AddTarget(List<Spec> plan,Target target,string path,bool directory) {
  int parent=-1;
  if(path.Length>3){string parentPath=ParentPath(path);for(int n=plan.Count-1;n>=0;n--)if(plan[n].Directory&&String.Equals(plan[n].Path,parentPath,StringComparison.OrdinalIgnoreCase)){parent=n;break;}}
  plan.Add(new Spec{Target=target,Path=path,Directory=directory,ParentIndex=parent});
 }
 // The only native plan: no discovery, enumeration, caller-supplied target or
 // current-run directory. APPDATA remains a row even when it aliases PROFILE.
 public static Spec[] FixedTargets(string profile,string local) {
  if(!CanonicalLocalPath(profile)||profile.Length==3||!CanonicalLocalPath(local)||local.Length==3||!Within(profile,local))return new Spec[0];
  string appdata=ParentPath(local);if(!Within(profile,appdata))return new Spec[0];
  string[] profileParts=profile.Substring(3).Split('\\');if(profileParts.Length>8)return new Spec[0];
  string sourceParents=appdata.Length==profile.Length?"":appdata.Substring(profile.Length+1);
  string[] sourceParts=sourceParents.Length==0?new string[0]:sourceParents.Split('\\');if(sourceParts.Length>8)return new Spec[0];
  var plan=new List<Spec>();string current=profile.Substring(0,3);AddTarget(plan,Target.VOLUME_ROOT,current,true);
  for(int n=0;n<profileParts.Length;n++){
   current+=(current.Length==3?"":"\\")+profileParts[n];
   AddTarget(plan,n==profileParts.Length-1?Target.PROFILE:(Target)((int)Target.PROFILE_ANCESTOR_01+n),current,true);
  }
  current=profile;
  for(int n=0;n<sourceParts.Length-1;n++){current+="\\"+sourceParts[n];AddTarget(plan,(Target)((int)Target.SOURCE_ANCESTOR_01+n),current,true);}
  AddTarget(plan,Target.APPDATA,appdata,true);AddTarget(plan,Target.LOCAL,local,true);
  string worker=local+"\\GAIWorker",source=worker+"\\goal-1218-bridge-state",db=source+"\\compass.sqlite",side=source+"\\self-development";
  AddTarget(plan,Target.WORKER,worker,true);AddTarget(plan,Target.SOURCE,source,true);
  AddTarget(plan,Target.DB,db,false);AddTarget(plan,Target.WAL,db+"-wal",false);AddTarget(plan,Target.SHM,db+"-shm",false);AddTarget(plan,Target.JOURNAL,db+"-journal",false);
  AddTarget(plan,Target.SIDECAR,side,true);AddTarget(plan,Target.JOBS,side+"\\jobs.json",false);AddTarget(plan,Target.CHANGES,side+"\\change-sets.json",false);
  string handoff=profile+"\\.goriq-handoff",capture=handoff+"\\1219-original-inspection-44178348410-1";
  AddTarget(plan,Target.HANDOFF,handoff,true);AddTarget(plan,Target.CAPTURE,capture,true);AddTarget(plan,Target.RAW,capture+"\\raw",true);AddTarget(plan,Target.WORK,capture+"\\work",true);AddTarget(plan,Target.CONTEXT,capture+"\\context.txt",false);
  string[] leaves={"compass.sqlite","compass.sqlite-wal","compass.sqlite-shm","jobs.json","change-sets.json"};
  for(int branch=0;branch<2;branch++)for(int n=0;n<leaves.Length;n++)AddTarget(plan,(Target)((int)(branch==0?Target.RAW_DB:Target.WORK_DB)+n),capture+(branch==0?"\\raw\\":"\\work\\")+leaves[n],false);
  if(plan.Count>MaxTargets)return new Spec[0];
  foreach(var spec in plan)if(!CanonicalLocalPath(spec.Path)||(spec.Path.Length>3&&spec.ParentIndex<0))return new Spec[0];
  return plan.ToArray();
 }
 static bool CanonicalSid(string value) {
  if(String.IsNullOrEmpty(value)||value.Length>184||!Regex.IsMatch(value,@"^S-1-(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*)){1,15}\z"))return false;
  string[] parts=value.Split('-');ulong authority;if(!UInt64.TryParse(parts[2],out authority)||authority>281474976710655UL)return false;
  for(int n=3;n<parts.Length;n++){uint item;if(!UInt32.TryParse(parts[n],out item))return false;}
  return true;
 }
 public static Account ClassifyAccount(string who,string sid) {
  if(!CanonicalSid(who))return Account.OTHER;
  if(CanonicalSid(sid)&&String.Equals(who,sid,StringComparison.Ordinal))return Account.CURRENT_USER;
  if(who=="S-1-5-18")return Account.SYSTEM;if(who=="S-1-5-32-544")return Account.ADMINISTRATORS;if(who==Installer)return Account.TRUSTED_INSTALLER;
  if(who=="S-1-1-0")return Account.EVERYONE;if(who=="S-1-5-11")return Account.AUTHENTICATED_USERS;if(who=="S-1-5-32-545")return Account.USERS;
  if(Regex.IsMatch(who,@"^S-1-15-3-65536-(?:[0-9]+-){7}[0-9]+\z"))return Account.APP_SILO;
  if(who.StartsWith("S-1-15-3-",StringComparison.Ordinal))return Account.APP_CAPABILITY;
  if(who.StartsWith("S-1-15-2-",StringComparison.Ordinal))return Account.APP_PACKAGE;
  return Account.OTHER;
 }
 public static Owner ClassifyOwner(string who,string sid) {
  if(String.IsNullOrEmpty(who))return Owner.UNOBSERVED;
  switch(ClassifyAccount(who,sid)){
   case Account.CURRENT_USER:return Owner.CURRENT_USER;case Account.SYSTEM:return Owner.SYSTEM;case Account.ADMINISTRATORS:return Owner.ADMINISTRATORS;case Account.TRUSTED_INSTALLER:return Owner.TRUSTED_INSTALLER;default:return Owner.OTHER;
  }
 }
 public static Qualifier ClassifyQualifier(int qualifier,bool callback) {
  if(qualifier==(int)AceQualifier.AccessAllowed)return callback?Qualifier.CALLBACK_ALLOW:Qualifier.ALLOW;
  if(qualifier==(int)AceQualifier.AccessDenied)return callback?Qualifier.CALLBACK_DENY:Qualifier.DENY;
  return Qualifier.OTHER;
 }
 public static Status ClassifyOpenError(int error){return error==2||error==3?Status.TARGET_MISSING:error==5?Status.ACCESS_DENIED:Status.UNEXPECTED_FAILURE;}
 static void ClearSecurity(Fact fact){fact.Owner=Owner.UNOBSERVED;fact.Dacl=Dacl.UNOBSERVED;fact.Aces.Clear();}
 // Descriptor projection has no policy reducer. Inherit-only, callback,
 // object and unknown ACEs all retain their place in the bounded observation.
 public static void DescribeSecurity(byte[] bytes,string sid,Fact fact) {
  ClearSecurity(fact);fact.Status=Status.SECURITY_DESCRIPTOR_UNVERIFIED;
  if(bytes==null||bytes.Length==0||bytes.Length>MaxDescriptorBytes||!CanonicalSid(sid))return;
  try {
   var descriptor=new RawSecurityDescriptor(bytes,0);if(descriptor.Owner==null)return;
   var owner=ClassifyOwner(descriptor.Owner.Value,sid);
   Dacl dacl=(descriptor.ControlFlags&ControlFlags.DiscretionaryAclPresent)==0?Dacl.ABSENT:descriptor.DiscretionaryAcl==null?Dacl.NULL:Dacl.PRESENT;
   var aces=new List<Ace>();bool limited=false;
   if(dacl==Dacl.PRESENT){
    limited=descriptor.DiscretionaryAcl.Count>MaxAces;
    for(int n=0;n<descriptor.DiscretionaryAcl.Count&&n<MaxAces;n++){
     GenericAce original=descriptor.DiscretionaryAcl[n];var known=original as KnownAce;var qualified=original as QualifiedAce;
     aces.Add(new Ace{Account=known==null?Account.OTHER:ClassifyAccount(known.SecurityIdentifier.Value,sid),Qualifier=qualified==null?Qualifier.OTHER:ClassifyQualifier((int)qualified.AceQualifier,qualified.IsCallback),Mask=known==null?0u:unchecked((uint)known.AccessMask),Flags=(byte)original.AceFlags});
    }
   }
   fact.Owner=owner;fact.Dacl=dacl;fact.Aces=aces;fact.Status=limited?Status.ACE_LIMIT:Status.ACL_OBSERVED;
  }catch{ClearSecurity(fact);fact.Status=Status.SECURITY_DESCRIPTOR_UNVERIFIED;}
 }
 static bool StorageSafe(string path){var drive=new DriveInfo(path.Substring(0,3));return drive.IsReady&&drive.DriveType==DriveType.Fixed&&String.Equals(drive.DriveFormat,"NTFS",StringComparison.OrdinalIgnoreCase);}
 static bool AttributesSafe(Info info,bool directory){return (info.attributes&0x400)==0&&((info.attributes&0x10)!=0)==directory&&(directory||info.links==1);}
 static bool FinalPathSafe(SafeFileHandle handle,string path,Stopwatch time) {
  Budget(time);var final=new StringBuilder(1024);uint count=SourceGetFinalPath(handle,final,1024,0);Budget(time);
  return count>0&&count<1024&&String.Equals(final.ToString(),"\\\\?\\"+path,StringComparison.OrdinalIgnoreCase);
 }
 static bool HeldSafe(Held held,Stopwatch time) {
  Budget(time);Info current;bool success=SourceGetFileInformation(held.Handle,out current);Budget(time);
  return success&&AttributesSafe(current,true)&&current.volume==held.Info.volume&&current.indexHigh==held.Info.indexHigh&&current.indexLow==held.Info.indexLow&&FinalPathSafe(held.Handle,held.Spec.Path,time);
 }
 static bool AncestorsSafe(Spec[] plan,int index,Dictionary<int,Held> verified,Stopwatch time) {
  int parent=plan[index].ParentIndex;
  while(parent>=0){Held held;if(!verified.TryGetValue(parent,out held)||!HeldSafe(held,time))return false;parent=plan[parent].ParentIndex;}
  return true;
 }
 static void InspectSecurity(SafeFileHandle handle,string sid,Fact fact,Stopwatch time) {
  IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
  fact.Status=Status.SECURITY_DESCRIPTOR_UNVERIFIED;
  try {
   Budget(time);uint result=SourceGetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor);Budget(time);
   if(result!=0||descriptor==IntPtr.Zero)return;
   uint size=SourceGetDescriptorLength(descriptor);Budget(time);if(size==0||size>MaxDescriptorBytes)return;
   byte[] bytes=new byte[(int)size];Marshal.Copy(descriptor,bytes,0,(int)size);Budget(time);DescribeSecurity(bytes,sid,fact);Budget(time);
  }finally{if(descriptor!=IntPtr.Zero)SourceLocalFree(descriptor);}
 }
 static void RefuseAncestry(Fact fact){ClearSecurity(fact);fact.StorageVerified=false;fact.AttributesVerified=false;fact.FinalPathVerified=false;fact.Status=Status.ANCESTOR_UNVERIFIED;}
 static void ObserveTarget(Spec[] plan,string sid,Fact fact,List<SafeFileHandle> handles,Dictionary<int,Held> verified,int index,Stopwatch time) {
  Spec spec=plan[index];Budget(time);bool storage;
  try{storage=StorageSafe(spec.Path);}catch{storage=false;}
  Budget(time);if(!storage){fact.Status=Status.STORAGE_UNVERIFIED;return;}fact.StorageVerified=true;
  Budget(time);var handle=SourceCreateFile(spec.Path,READ_CONTROL|READ_ATTRIBUTES,SHARE_ALL,IntPtr.Zero,OPEN_EXISTING,BACKUP|OPEN_REPARSE,IntPtr.Zero);
  if(handle==null){fact.Status=Status.UNEXPECTED_FAILURE;return;}
  if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();fact.Status=ClassifyOpenError(error);return;}
  handles.Add(handle);Budget(time);Info info;bool metadata=SourceGetFileInformation(handle,out info);Budget(time);
  if(!metadata||!AttributesSafe(info,spec.Directory)){fact.Status=Status.ATTRIBUTES_UNVERIFIED;return;}fact.AttributesVerified=true;
  if(!FinalPathSafe(handle,spec.Path,time)){fact.Status=Status.FINAL_PATH_UNVERIFIED;return;}fact.FinalPathVerified=true;
  if(!AncestorsSafe(plan,index,verified,time)){RefuseAncestry(fact);return;}
  InspectSecurity(handle,sid,fact,time);
  // SHARE_ALL permits ordinary parent replacement even when a new child has
  // the expected DOS path. Sample the held ancestry before ACL inspection and
  // again before publishing/registering this child. These separate samples
  // do not establish atomic ancestry continuity or freeze producer changes.
  Budget(time);Info after;metadata=SourceGetFileInformation(handle,out after);Budget(time);
  if(!metadata||!AttributesSafe(after,spec.Directory)||after.volume!=info.volume||after.indexHigh!=info.indexHigh||after.indexLow!=info.indexLow){ClearSecurity(fact);fact.AttributesVerified=false;fact.FinalPathVerified=false;fact.Status=Status.ATTRIBUTES_UNVERIFIED;return;}
  if(!FinalPathSafe(handle,spec.Path,time)){ClearSecurity(fact);fact.FinalPathVerified=false;fact.Status=Status.FINAL_PATH_UNVERIFIED;return;}
  if(!AncestorsSafe(plan,index,verified,time)){RefuseAncestry(fact);return;}
  if(spec.Directory)verified[index]=new Held{Handle=handle,Spec=spec,Info=info};
 }
 static Report ObservePlan(Spec[] plan,string sid,Stopwatch time) {
  var report=new Report();var handles=new List<SafeFileHandle>();var verified=new Dictionary<int,Held>();Fact current=null;
  try {
   Require(plan!=null&&plan.Length>0&&plan.Length<=MaxTargets,Reason.TARGET_LIMIT);
   for(int n=0;n<plan.Length;n++){
    current=null;Budget(time);Require(report.Observations.Count<MaxTargets,Reason.TARGET_LIMIT);
    current=new Fact{Target=plan[n].Target};report.Observations.Add(current);
    try {
     if(!AncestorsSafe(plan,n,verified,time)){current.Status=Status.ANCESTOR_UNVERIFIED;continue;}
     ObserveTarget(plan,sid,current,handles,verified,n,time);
    }catch(Refused){throw;}catch{ClearSecurity(current);current.Status=Status.UNEXPECTED_FAILURE;}
   }
   current=null;Budget(time);report.Completed=true;report.Reason=Reason.OBSERVED;
  }catch(Refused failure){report.Reason=failure.Reason;if(current!=null&&failure.Reason==Reason.TIMEOUT){ClearSecurity(current);current.Status=Status.TIMEOUT;}}
   catch{report.Reason=Reason.UNEXPECTED_FAILURE;if(current!=null){ClearSecurity(current);current.Status=Status.UNEXPECTED_FAILURE;}}
  finally{for(int n=handles.Count-1;n>=0;n--)handles[n].Dispose();}
  return report;
 }
 public static string ObserveJson() {
  var time=Stopwatch.StartNew();var report=new Report();
  try {
   Require(Environment.OSVersion.Platform==PlatformID.Win32NT,Reason.UNSUPPORTED_PLATFORM);string sid;
   try {
    using(var identity=WindowsIdentity.GetCurrent()){
     Require(identity.User!=null&&!identity.IsSystem&&!identity.IsAnonymous&&identity.ImpersonationLevel!=TokenImpersonationLevel.Impersonation&&identity.ImpersonationLevel!=TokenImpersonationLevel.Delegation,Reason.IDENTITY_UNVERIFIED);sid=identity.User.Value;Require(CanonicalSid(sid),Reason.IDENTITY_UNVERIFIED);
    }
   }catch(Refused){throw;}catch{throw new Refused(Reason.IDENTITY_UNVERIFIED);}
   Budget(time);string profile,local;
   try {
    profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    Require(ProfileContextSafe(profile,Environment.GetEnvironmentVariable("USERPROFILE"),local,Environment.GetEnvironmentVariable("LOCALAPPDATA"),Environment.GetEnvironmentVariable("GITHUB_WORKSPACE")),Reason.UNSAFE_PROFILE);
   }catch(Refused){throw;}catch{throw new Refused(Reason.UNSAFE_PROFILE);}
   Budget(time);report=ObservePlan(FixedTargets(profile,local),sid,time);
  }catch(Refused failure){report.Reason=failure.Reason;}catch{report.Reason=Reason.UNEXPECTED_FAILURE;}
  return Render(report);
 }
 static bool Defined<T>(T value){return Enum.IsDefined(typeof(T),value);}
 static bool PlanRolesValid(List<Fact> facts,bool complete) {
  int n=0;if(facts.Count==0)return !complete;if(facts[n++].Target!=Target.VOLUME_ROOT)return false;
  for(int role=(int)Target.PROFILE_ANCESTOR_01;role<=(int)Target.PROFILE_ANCESTOR_07&&n<facts.Count&&facts[n].Target==(Target)role;role++)n++;
  if(n==facts.Count)return !complete;if(facts[n++].Target!=Target.PROFILE)return false;
  for(int role=(int)Target.SOURCE_ANCESTOR_01;role<=(int)Target.SOURCE_ANCESTOR_07&&n<facts.Count&&facts[n].Target==(Target)role;role++)n++;
  for(int role=(int)Target.APPDATA;role<=(int)Target.WORK_CHANGES;role++){
   if(n==facts.Count)return !complete;if(facts[n++].Target!=(Target)role)return false;
  }
  return n==facts.Count;
 }
 static bool ValidFact(Fact fact) {
  if(fact==null||!Defined(fact.Target)||!Defined(fact.Status)||!Defined(fact.Owner)||!Defined(fact.Dacl)||fact.Aces==null||fact.Aces.Count>MaxAces)return false;
  if((fact.AttributesVerified&&!fact.StorageVerified)||(fact.FinalPathVerified&&!fact.AttributesVerified))return false;
  bool observed=fact.Status==Status.ACL_OBSERVED||fact.Status==Status.ACE_LIMIT;
  if(observed){
   if(!fact.FinalPathVerified||fact.Owner==Owner.UNOBSERVED||fact.Dacl==Dacl.UNOBSERVED)return false;
   if(fact.Status==Status.ACE_LIMIT&&(fact.Dacl!=Dacl.PRESENT||fact.Aces.Count!=MaxAces))return false;
   if(fact.Dacl!=Dacl.PRESENT&&fact.Aces.Count!=0)return false;
  }else if(fact.Owner!=Owner.UNOBSERVED||fact.Dacl!=Dacl.UNOBSERVED||fact.Aces.Count!=0)return false;
  foreach(var ace in fact.Aces)if(ace==null||!Defined(ace.Account)||!Defined(ace.Qualifier))return false;
  return true;
 }
 static bool ValidReport(Report report) {
  if(report==null||!Defined(report.Reason)||report.Observations==null||report.Observations.Count>MaxTargets||report.Completed!=(report.Reason==Reason.OBSERVED))return false;
  foreach(var fact in report.Observations)if(!ValidFact(fact))return false;
  if(!report.Completed&&report.Observations.Count>0&&report.Reason!=Reason.TIMEOUT&&report.Reason!=Reason.TARGET_LIMIT&&report.Reason!=Reason.UNEXPECTED_FAILURE)return false;
  return PlanRolesValid(report.Observations,report.Completed);
 }
 static string RenderValid(Report report) {
  var text=new StringBuilder("{\"schema\":\"SOURCE_ACL_PROBE_V1\",\"authority\":\"NOT_AUTHORITATIVE\",\"status\":\"");
  text.Append(report.Completed?"METADATA_ONLY_COMPLETE":"INCOMPLETE").Append("\",\"readOnly\":true,\"metadataOnly\":true,\"recovered\":false,\"g1\":\"HOLD\",\"historicalStateProven\":false,\"maxTargets\":48,\"maxAces\":16,\"budgetSeconds\":20,\"reason\":\"").Append(report.Reason).Append("\",\"observations\":[");
  bool first=true;foreach(var fact in report.Observations){
   if(!first)text.Append(',');first=false;
   text.Append("{\"target\":\"").Append(fact.Target).Append("\",\"status\":\"").Append(fact.Status).Append("\",\"storageVerified\":").Append(fact.StorageVerified?"true":"false").Append(",\"attributesVerified\":").Append(fact.AttributesVerified?"true":"false").Append(",\"finalPathVerified\":").Append(fact.FinalPathVerified?"true":"false").Append(",\"owner\":\"").Append(fact.Owner).Append("\",\"dacl\":\"").Append(fact.Dacl).Append("\",\"aces\":[");
   bool firstAce=true;foreach(var ace in fact.Aces){if(!firstAce)text.Append(',');firstAce=false;text.Append("{\"account\":\"").Append(ace.Account).Append("\",\"qualifier\":\"").Append(ace.Qualifier).Append("\",\"mask\":").Append(ace.Mask.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append(",\"flags\":").Append(ace.Flags.ToString(System.Globalization.CultureInfo.InvariantCulture)).Append('}');}
   text.Append("]}");
  }
  return text.Append("]}").ToString();
 }
 public static string Render(Report report) {
  if(!ValidReport(report))report=new Report{Reason=Reason.OUTPUT_REJECTED};
  string text=RenderValid(report);return Encoding.UTF8.GetByteCount(text)<=MaxOutputBytes?text:RenderValid(new Report{Reason=Reason.OUTPUT_REJECTED});
 }
}

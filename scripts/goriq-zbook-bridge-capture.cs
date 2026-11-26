// Fixed, local Windows byte acquisition only. No SQLite, grants, repair or source writes.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
public enum GoriqBridgeInitializationPhase {
 PRIVATE_IDENTITY_UNAVAILABLE,
 PRIVATE_ENVIRONMENT_UNAVAILABLE,
 PRIVATE_ANCESTRY_UNAVAILABLE,
 PRIVATE_PARENT_UNAVAILABLE,
 PRIVATE_LAYOUT_UNAVAILABLE,
 PRIVATE_CONTEXT_UNAVAILABLE
}
public enum GoriqBridgePrivateGuardReason {
 PRIVATE_PATH_UNVERIFIED,
 PRIVATE_LOCAL_STORAGE_UNAVAILABLE,
 PRIVATE_NATIVE_OPEN_UNAVAILABLE,
 PRIVATE_FILE_METADATA_UNVERIFIED,
 PRIVATE_FINAL_PATH_UNVERIFIED,
 PRIVATE_OWNER_UNVERIFIED,
 PRIVATE_DACL_UNVERIFIED,
 PRIVATE_CREATE_UNAVAILABLE
}
public sealed class GoriqBridgePrivateGuardException : IOException {
 public string Code {get; private set;}
 public GoriqBridgePrivateGuardException(GoriqBridgePrivateGuardReason reason)
  : base("BRIDGE_PRIVATE_GUARD_REFUSED"){Code=reason.ToString();}
}
public sealed class GoriqBridgeInitializationException : IOException {
 public string PhaseCode {get; private set;}
 public GoriqBridgeInitializationException(GoriqBridgeInitializationPhase phase,Exception inner)
  : base("BRIDGE_INITIALIZATION_REFUSED",inner){
   var guard=inner as GoriqBridgePrivateGuardException;
   PhaseCode=guard==null?phase.ToString():guard.Code;
  }
}
public sealed class GoriqBridgeCapture : IDisposable {
 const uint FILE_SHARE_READ=1, FILE_SHARE_READWRITEDELETE=7, CREATE_NEW=1, OPEN_EXISTING=3;
 const uint READ_CONTROL=0x20000, READ_ATTRIBUTES=0x80, GENERIC_READ=0x80000000, GENERIC_WRITE=0x40000000;
 const uint BACKUP=0x02000000, OPEN_REPARSE=0x00200000, REPARSE=0x400, DIRECTORY=0x10;
 [StructLayout(LayoutKind.Sequential)] struct Info {
  public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string path,IntPtr security);
 [StructLayout(LayoutKind.Sequential)] struct BasicInfo {public long CreationTime,LastAccessTime,LastWriteTime,ChangeTime;public uint Attributes;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,int infoClass,out BasicInfo info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint length,uint flags);
 [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 readonly List<SafeFileHandle> held=new List<SafeFileHandle>();
 readonly List<FileStream> streams=new List<FileStream>();
 readonly List<Tuple<string,SafeFileHandle,string,string>> sourceDirectories=new List<Tuple<string,SafeFileHandle,string,string>>();
 readonly Dictionary<SafeFileHandle,string> sourceAncestorHandles=new Dictionary<SafeFileHandle,string>();
 readonly List<string> provenance=new List<string>();
 readonly string sid,profile,source;
 readonly List<Tuple<string,SafeFileHandle,string,string>> runtimeDirectories=new List<Tuple<string,SafeFileHandle,string,string>>();
 string runtimeNode;SafeFileHandle runtimeHandle;string runtimeIdentity,runtimeSecurity;
 readonly DateTime deadline=DateTime.UtcNow.AddSeconds(65);
 public string Root {get; private set;}
 public bool Preserved {get; private set;}
 static void Require(bool value){if(!value)throw new IOException("BRIDGE_ACQUISITION_REFUSED");}
 static void Require(bool value,GoriqBridgePrivateGuardReason reason){if(!value)throw new GoriqBridgePrivateGuardException(reason);}
 void Budget(){Require(DateTime.UtcNow<deadline);}
 static bool Within(string parent,string path){return path.Equals(parent,StringComparison.OrdinalIgnoreCase)||path.StartsWith(parent.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
 public static bool CanonicalLocalPath(string path) {
  if(String.IsNullOrEmpty(path)||path.Length>240||!Regex.IsMatch(path,@"^[A-Za-z]:\\")||path.Substring(2).IndexOfAny(new char[]{':','/','\r','\n','\0','"','<','>','|','?','*'})>=0)return false;
  if(path.Length==3)return true;
  foreach(string part in path.Substring(3).Split('\\')) {
   if(part.Length==0||part=="."||part==".."||part.EndsWith(" ")||part.EndsWith(".")||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",RegexOptions.IgnoreCase))return false;
  }
  return true;
 }
 public static bool IsExactProfileDirectory(uint attributes,string finalPath,string profilePath) {
  return (attributes&DIRECTORY)!=0&&(attributes&REPARSE)==0&&CanonicalLocalPath(profilePath)&&profilePath.Length>3&&String.Equals(finalPath,"\\\\?\\"+profilePath,StringComparison.OrdinalIgnoreCase);
 }
 public static bool PrivateOwnerPermitted(string ownerSid,string userSid,bool exactProfileDirectory) {
  return !String.IsNullOrEmpty(ownerSid)&&!String.IsNullOrEmpty(userSid)&&(ownerSid==userSid||(exactProfileDirectory&&ownerSid=="S-1-5-18"));
 }
 public static bool SourceAncestorOwnerPermitted(string who,string currentSid) {
  return !String.IsNullOrEmpty(who)&&(who=="S-1-5-18"||who=="S-1-5-32-544"||who=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"||(!String.IsNullOrEmpty(currentSid)&&who==currentSid));
 }
 public static bool SourceAncestorAcePermitted(string who,uint mask,string currentSid) {
  return SourceAncestorOwnerPermitted(who,currentSid)||(mask&~0x001200A9u)==0;
 }
 public static bool SourceAncestorAceShapePermitted(int aceType,int flags,bool callback) {
  return !callback&&(aceType==0||aceType==1)&&(flags&~31)==0;
 }
 public static bool IsSourceAncestorDirectory(uint attributes,string finalPath,string profilePath,string sourcePath) {
  if((attributes&DIRECTORY)==0||(attributes&REPARSE)!=0||!CanonicalLocalPath(profilePath)||profilePath.Length<=3||!CanonicalLocalPath(sourcePath)||!Within(profilePath,sourcePath)||!sourcePath.EndsWith(@"\GAIWorker\goal-1218-bridge-state",StringComparison.OrdinalIgnoreCase)||String.IsNullOrEmpty(finalPath)||!finalPath.StartsWith(@"\\?\",StringComparison.OrdinalIgnoreCase))return false;
  string path=finalPath.Substring(4);
  return CanonicalLocalPath(path)&&!path.Equals(profilePath,StringComparison.OrdinalIgnoreCase)&&Within(profilePath,path)&&!path.Equals(sourcePath,StringComparison.OrdinalIgnoreCase)&&Within(path,sourcePath);
 }
 public static bool ProfileCapabilityTraversePermitted(string who,uint mask,int flags,bool exactProfileDirectory) {
  // SDK app-package authority15, capability3, app-silo65536. This directory
  // ACE grants only FILE_TRAVERSE|SYNCHRONIZE and never propagates to data.
  if(!exactProfileDirectory||mask!=0x100020u||flags!=0||String.IsNullOrEmpty(who)||who.Length>184||!Regex.IsMatch(who,@"^S-1-15-3-65536-(?:[0-9]+-){7}[0-9]+\z"))return false;
  string[] parts=who.Split('-');
  for(int n=5;n<parts.Length;n++){uint value;if(!UInt32.TryParse(parts[n],out value)||value.ToString(System.Globalization.CultureInfo.InvariantCulture)!=parts[n])return false;}
  return true;
 }
 public static bool AcePermitted(string who,uint mask,bool privacy,bool runtime,string ownerSid) {
  if(!privacy&&!runtime)return true; // metadata-only ancestors; no permission inference
  bool trusted=who=="S-1-5-18"||who=="S-1-5-32-544"||(privacy&&who==ownerSid)||who=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  return trusted||(!privacy&&(mask&0x500D0156)==0);
 }
 static string Hash(byte[] bytes){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 public static bool RuntimeDirectoryAcePermitted(string who,uint mask,bool volumeRoot) {
  if(volumeRoot)mask&=~6u; // create a new child is not replacement of a protected existing child
  return AcePermitted(who,mask,false,true,null);
 }
 bool ExactProfileScope(SafeFileHandle handle) {
  Budget();Info info;if(!GetFileInformationByHandle(handle,out info))return false;
  var final=new StringBuilder(1024);Budget();uint count=GetFinalPathNameByHandle(handle,final,1024,0);
  return count>0&&count<1024&&IsExactProfileDirectory(info.attributes,final.ToString(),profile);
 }
 bool SourceAncestorScope(SafeFileHandle handle) {
  string walkedPath;if(!sourceAncestorHandles.TryGetValue(handle,out walkedPath))return false;
  Budget();Info info;Require(GetFileInformationByHandle(handle,out info),GoriqBridgePrivateGuardReason.PRIVATE_FILE_METADATA_UNVERIFIED);
  var final=new StringBuilder(1024);Budget();uint count=GetFinalPathNameByHandle(handle,final,1024,0);
  Require(count>0&&count<1024&&String.Equals(final.ToString(),@"\\?\"+walkedPath,StringComparison.OrdinalIgnoreCase),GoriqBridgePrivateGuardReason.PRIVATE_FINAL_PATH_UNVERIFIED);
  Require(IsSourceAncestorDirectory(info.attributes,final.ToString(),profile,source),GoriqBridgePrivateGuardReason.PRIVATE_FILE_METADATA_UNVERIFIED);return true;
 }
 byte[] Security(SafeFileHandle handle,bool privacy,bool runtime=false,bool runtimeDirectory=false,bool volumeRoot=false) {
  IntPtr owner,group,dacl,sacl,descriptor;Require(GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)==0&&descriptor!=IntPtr.Zero,GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
  try {
   uint size=GetSecurityDescriptorLength(descriptor);Require(size>0&&size<=65536,GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);byte[] bytes=new byte[size];Marshal.Copy(descriptor,bytes,0,(int)size);
   var sd=new RawSecurityDescriptor(bytes,0);Require(sd.Owner!=null&&sd.DiscretionaryAcl!=null&&(sd.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0,GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
   bool exactProfileDirectory=false,sourceAncestor=privacy&&!runtime&&SourceAncestorScope(handle);
   if(privacy) {
    // Centralize the approved exception so descriptor snapshots and rechecks
    // receive the same handle-derived scope as Open/Inspect. Never trust a
    // caller's path label for SYSTEM ownership of a private child or file.
    if(!runtime&&!sourceAncestor&&sd.Owner.Value=="S-1-5-18") {
     exactProfileDirectory=ExactProfileScope(handle);
    }
    Require(sourceAncestor?SourceAncestorOwnerPermitted(sd.Owner.Value,sid):PrivateOwnerPermitted(sd.Owner.Value,sid,exactProfileDirectory),GoriqBridgePrivateGuardReason.PRIVATE_OWNER_UNVERIFIED);
   }
   if(runtime)Require(sd.Owner.Value=="S-1-5-18"||sd.Owner.Value=="S-1-5-32-544"||sd.Owner.Value=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464",GoriqBridgePrivateGuardReason.PRIVATE_OWNER_UNVERIFIED);
   foreach(GenericAce ace in sd.DiscretionaryAcl) {
    if(sourceAncestor) {
     var common=ace as CommonAce;
     Require(common!=null&&SourceAncestorAceShapePermitted((int)common.AceType,(int)common.AceFlags,common.IsCallback),GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
     if(common.AceQualifier==AceQualifier.AccessAllowed)Require(SourceAncestorAcePermitted(common.SecurityIdentifier.Value,unchecked((uint)common.AccessMask),sid),GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
     continue;
    }
    if((ace.AceFlags&AceFlags.InheritOnly)!=0)continue;
    var known=ace as QualifiedAce;Require(known!=null&&!known.IsCallback,GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
    if(known.AceQualifier!=AceQualifier.AccessAllowed)continue;
    string who=known.SecurityIdentifier.Value;
    if(privacy&&!runtime&&ProfileCapabilityTraversePermitted(who,(uint)known.AccessMask,(int)known.AceFlags,true)) {
     if(!exactProfileDirectory)exactProfileDirectory=ExactProfileScope(handle);
     if(exactProfileDirectory)continue;
    }
    Require(runtimeDirectory?RuntimeDirectoryAcePermitted(who,(uint)known.AccessMask,volumeRoot):AcePermitted(who,(uint)known.AccessMask,privacy,runtime,sid),GoriqBridgePrivateGuardReason.PRIVATE_DACL_UNVERIFIED);
   }
   return bytes;
  } finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
 }
 Info Inspect(SafeFileHandle handle,string path,bool directory,bool privacy,bool runtime=false,bool sourceWalk=false) {
  Require(!handle.IsInvalid,GoriqBridgePrivateGuardReason.PRIVATE_NATIVE_OPEN_UNAVAILABLE);Info i;Require(GetFileInformationByHandle(handle,out i),GoriqBridgePrivateGuardReason.PRIVATE_FILE_METADATA_UNVERIFIED);
  Require((i.attributes&REPARSE)==0&&((i.attributes&DIRECTORY)!=0)==directory,GoriqBridgePrivateGuardReason.PRIVATE_FILE_METADATA_UNVERIFIED);
  if(!directory)Require(i.links==1,GoriqBridgePrivateGuardReason.PRIVATE_FILE_METADATA_UNVERIFIED);
  var final=new StringBuilder(1024);uint count=GetFinalPathNameByHandle(handle,final,1024,0);
  Require(count>0&&count<1024&&String.Equals(final.ToString(),"\\\\?\\"+path,StringComparison.OrdinalIgnoreCase),GoriqBridgePrivateGuardReason.PRIVATE_FINAL_PATH_UNVERIFIED);
  // Only the fixed source walk can register an ancestor. Security snapshots
  // and identity rechecks independently revalidate its native directory/path.
  if(sourceWalk&&privacy&&!runtime&&directory&&IsSourceAncestorDirectory(i.attributes,final.ToString(),profile,source))sourceAncestorHandles[handle]=path;
  Security(handle,privacy,runtime,runtime&&directory,directory&&path.Equals(Path.GetPathRoot(path),StringComparison.OrdinalIgnoreCase));return i;
 }
 SafeFileHandle Open(string path,bool directory,bool privacy,bool runtime=false,uint access=READ_CONTROL|READ_ATTRIBUTES,uint share=FILE_SHARE_READ,bool sourceWalk=false) {
  Budget();Require(CanonicalLocalPath(path),GoriqBridgePrivateGuardReason.PRIVATE_PATH_UNVERIFIED);var drive=new DriveInfo(Path.GetPathRoot(path));Require(drive.IsReady&&drive.DriveType==DriveType.Fixed&&drive.DriveFormat=="NTFS",GoriqBridgePrivateGuardReason.PRIVATE_LOCAL_STORAGE_UNAVAILABLE);
  var handle=CreateFileW(path,access,share,IntPtr.Zero,OPEN_EXISTING,BACKUP|OPEN_REPARSE,IntPtr.Zero);
  try{Inspect(handle,path,directory,privacy,runtime,sourceWalk);held.Add(handle);return handle;}catch{sourceAncestorHandles.Remove(handle);handle.Dispose();throw;}
 }
 void Ancestors(string path,bool privateBelowProfile,bool observe=false) {
  string root=Path.GetPathRoot(path),current=root;Open(current,true,false,false,READ_CONTROL|READ_ATTRIBUTES,FILE_SHARE_READWRITEDELETE);
  foreach(string part in path.Substring(root.Length).Split('\\')) {
   if(part.Length==0)continue;current=Path.Combine(current,part);var handle=Open(current,true,privateBelowProfile&&Within(profile,current),false,READ_CONTROL|READ_ATTRIBUTES,FILE_SHARE_READWRITEDELETE,observe&&Within(source,path));if(observe)sourceDirectories.Add(Tuple.Create(current,handle,SourceIdentity(handle,current,true),Hash(Security(handle,privateBelowProfile&&Within(profile,current)))));
  }
 }
 static long Size(Info i){return ((long)i.sizeHigh<<32)|i.sizeLow;}
 static string Identity(Info i){return i.volume+":"+i.indexHigh+":"+i.indexLow+":"+Size(i)+":"+i.writeHigh+":"+i.writeLow+":"+i.creationHigh+":"+i.creationLow+":"+i.attributes+":"+i.links;}
 string DirectoryNew(string parent,string leaf) {
  string path=Path.Combine(parent,leaf);Require(CreateDirectoryW(path,IntPtr.Zero),GoriqBridgePrivateGuardReason.PRIVATE_CREATE_UNAVAILABLE);Open(path,true,true,false,READ_CONTROL|READ_ATTRIBUTES,FILE_SHARE_READWRITEDELETE);return path;
 }
 public GoriqBridgeCapture(string run,string attempt) {
  GoriqBridgeInitializationPhase phase=GoriqBridgeInitializationPhase.PRIVATE_IDENTITY_UNAVAILABLE;
  try {
  Require(Environment.OSVersion.Platform==PlatformID.Win32NT);
  using(var identity=WindowsIdentity.GetCurrent()){Require(!identity.IsSystem&&!identity.IsAnonymous&&identity.ImpersonationLevel!=TokenImpersonationLevel.Impersonation&&identity.ImpersonationLevel!=TokenImpersonationLevel.Delegation);sid=identity.User.Value;}
  phase=GoriqBridgeInitializationPhase.PRIVATE_ENVIRONMENT_UNAVAILABLE;
  profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
  Require(profile==Environment.GetEnvironmentVariable("USERPROFILE")&&local==Environment.GetEnvironmentVariable("LOCALAPPDATA")&&CanonicalLocalPath(profile)&&CanonicalLocalPath(local)&&Within(profile,local));
  source=Path.Combine(local,"GAIWorker","goal-1218-bridge-state");
  string workspace=Environment.GetEnvironmentVariable("GITHUB_WORKSPACE");Require(CanonicalLocalPath(workspace));
  string parent=Path.Combine(profile,".goriq-handoff");
  Require(!Within(workspace,parent)&&!Within(parent,workspace)&&!Within(source,parent)&&!Within(parent,source));
   phase=GoriqBridgeInitializationPhase.PRIVATE_ANCESTRY_UNAVAILABLE;
   Ancestors(profile,true);
   // An existing protected parent is used as-is; a missing handoff directory
   // may inherit the already verified private profile DACL. Never repair ACLs.
   phase=GoriqBridgeInitializationPhase.PRIVATE_PARENT_UNAVAILABLE;
   if(Directory.Exists(parent))Open(parent,true,true,false,READ_CONTROL|READ_ATTRIBUTES,FILE_SHARE_READWRITEDELETE);else parent=DirectoryNew(profile,".goriq-handoff");
   phase=GoriqBridgeInitializationPhase.PRIVATE_LAYOUT_UNAVAILABLE;
   Root=DirectoryNew(parent,"1219-original-inspection-"+run+"-"+attempt);
   DirectoryNew(Root,"raw");DirectoryNew(Root,"work");
   phase=GoriqBridgeInitializationPhase.PRIVATE_CONTEXT_UNAVAILABLE;
   WritePrivate("context.txt",Encoding.UTF8.GetBytes("owner="+sid+"\nprofile="+profile+"\nsource="+source+"\nrevision="+Environment.GetEnvironmentVariable("GITHUB_SHA")+"\nrun="+run+"\nattempt="+attempt+"\nacquired="+DateTime.UtcNow.ToString("o")));
  }catch(Exception error){Dispose();throw new GoriqBridgeInitializationException(phase,error);}
 }
 public void WritePrivate(string name,byte[] bytes) {
  Budget();Require(name==Path.GetFileName(name)&&bytes.Length<=16*1024*1024);
  WriteNew(Path.Combine(Root,name),bytes);
 }
 string SourceIdentity(SafeFileHandle handle,string path,bool directory=false) {
  Info info=Inspect(handle,path,directory,Within(profile,path));BasicInfo basic;Require(GetFileInformationByHandleEx(handle,0,out basic,(uint)Marshal.SizeOf(typeof(BasicInfo))));
  return Identity(info)+":change="+basic.ChangeTime;
 }
 byte[] ReadBounded(FileStream stream,long limit) {
  Budget();stream.Position=0;using(var memory=new MemoryStream()) {
   byte[] block=new byte[65536];int count;
   while((count=stream.Read(block,0,block.Length))>0){Budget();Require(memory.Length+count<=limit);memory.Write(block,0,count);}return memory.ToArray();
  }
 }
 void WriteNew(string path,byte[] bytes,uint share=FILE_SHARE_READ) {
  var handle=CreateFileW(path,GENERIC_READ|GENERIC_WRITE|READ_CONTROL,share,IntPtr.Zero,CREATE_NEW,BACKUP|OPEN_REPARSE,IntPtr.Zero);
  try {
   Inspect(handle,path,false,true);
   var stream=new FileStream(handle,FileAccess.ReadWrite);handle=null;streams.Add(stream);
   stream.Write(bytes,0,bytes.Length);stream.Flush(true);
   Inspect(stream.SafeFileHandle,path,false,true);
   // Keep this exact verified data-access creation handle through child exit.
   // Raw/staged files deny other writers/deleters; disposable work uses share7.
  }finally{if(handle!=null)handle.Dispose();}
 }
 public void Stage(string name,byte[] bytes) {
  Require(name=="goriq-zbook-bridge-original-read.mjs"||name=="goriq-g1-backup-inventory.mjs");WritePrivate(name,bytes);
 }
 bool ExistsExact(string path) {
  // GetAttributes distinguishes missing from inaccessible, unlike File.Exists.
  try {File.GetAttributes(path);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}
 }
 public void Acquire() {
  try {
   Budget();Ancestors(source,true,true);string db=Path.Combine(source,"compass.sqlite");
   string side=Path.Combine(source,"self-development");bool sidePresent=ExistsExact(side);if(sidePresent)Ancestors(side,true,true);
   string[] paths={db,db+"-wal",db+"-shm",db+"-journal",Path.Combine(side,"jobs.json"),Path.Combine(side,"change-sets.json")};
   string[] names={"compass.sqlite","compass.sqlite-wal","compass.sqlite-shm","journal","jobs.json","change-sets.json"};
   long[] limits={67108864,67108864,4194304,0,4194304,4194304};
   var present=new bool[6];var handles=new SafeFileHandle[6];var readers=new FileStream[6];var identities=new string[6];var securities=new string[6];var beforeHash=new string[6];long total=0;
   for(int n=0;n<paths.Length;n++) {
    present[n]=ExistsExact(paths[n]);provenance.Add(names[n]+"|"+paths[n]+"|present="+present[n]);
    if(!present[n]){Require(n!=0);continue;}
    handles[n]=Open(paths[n],false,true,false,GENERIC_READ|READ_CONTROL,FILE_SHARE_READWRITEDELETE);
    Info info=Inspect(handles[n],paths[n],false,true);identities[n]=SourceIdentity(handles[n],paths[n]);securities[n]=Convert.ToBase64String(Security(handles[n],true));
    provenance.Add(names[n]+"|identity="+identities[n]+"|security="+securities[n]);
    Require(n!=3&&Size(info)<=limits[n]&&(n!=0||Size(info)>0));total+=Size(info);Require(total<=146800640);
    readers[n]=new FileStream(handles[n],FileAccess.Read);streams.Add(readers[n]);
   }
   // Share read/write/delete throughout: producers are never denied new opens.
   // Three complete byte observations plus path/handle IDs, ACL, ChangeTime and
   // sidecar presence establish OBSERVED_STABLE_SHARED, never atomicity.
   for(int n=0;n<paths.Length;n++)if(present[n]){
    beforeHash[n]=Hash(ReadBounded(readers[n],limits[n]));
    Require(SourceIdentity(handles[n],paths[n])==identities[n]);provenance.Add(names[n]+"|beforeHash="+beforeHash[n]);
   }
   for(int n=0;n<paths.Length;n++)if(present[n]){
    byte[] bytes=ReadBounded(readers[n],limits[n]);string capturedHash=Hash(bytes);
    Require(capturedHash==beforeHash[n]&&SourceIdentity(handles[n],paths[n])==identities[n]&&Convert.ToBase64String(Security(handles[n],true))==securities[n]);
    WriteNew(Path.Combine(Root,"raw",names[n]),bytes);
    if(n!=2)WriteNew(Path.Combine(Root,"work",names[n]),bytes,FILE_SHARE_READWRITEDELETE);
    provenance.Add(names[n]+"|capturedHash="+capturedHash+"|size="+bytes.Length);
   }
   for(int n=0;n<paths.Length;n++){
    Budget();Require(ExistsExact(paths[n])==present[n]);
    if(present[n]){
     string afterHash=Hash(ReadBounded(readers[n],limits[n]));var pathHandle=Open(paths[n],false,true,false,GENERIC_READ|READ_CONTROL,FILE_SHARE_READWRITEDELETE);
     Require(afterHash==beforeHash[n]&&SourceIdentity(handles[n],paths[n])==identities[n]&&SourceIdentity(pathHandle,paths[n])==identities[n]&&Convert.ToBase64String(Security(handles[n],true))==securities[n]&&Convert.ToBase64String(Security(pathHandle,true))==securities[n]);
     provenance.Add(names[n]+"|afterHash="+afterHash);
    }
   }
   Require(ExistsExact(side)==sidePresent);
   foreach(var dir in sourceDirectories)Require(SourceIdentity(dir.Item2,dir.Item1,true)==dir.Item3&&Hash(Security(dir.Item2,Within(profile,dir.Item1)))==dir.Item4);
   WritePrivate("manifest.txt",Encoding.UTF8.GetBytes("consistency=OBSERVED_STABLE_SHARED\natomicSnapshot=false\n"+String.Join("\n",provenance.ToArray())));Preserved=true;
  } finally {
   if(!Preserved)try{WritePrivate("incomplete-provenance.txt",Encoding.UTF8.GetBytes(String.Join("\n",provenance.ToArray())));}catch{}
  }
 }
 public void PrepareOutputs() {
  // Verify newly inherited output ACLs before the child writes any private data.
  WriteNew(Path.Combine(Root,"interpretation.json"),new byte[0],3);
  if(ExistsExact(Path.Combine(Root,"work","compass.sqlite-wal")))WriteNew(Path.Combine(Root,"work","compass.sqlite-shm"),new byte[0],FILE_SHARE_READWRITEDELETE);
 }
 void RuntimeDirectory(string path,bool volumeRoot) {
  // Runtime-only subtree locks cannot overlap live source/profile ancestors.
  uint access=volumeRoot?READ_CONTROL|READ_ATTRIBUTES:GENERIC_READ|READ_CONTROL;
  uint share=volumeRoot?FILE_SHARE_READWRITEDELETE:FILE_SHARE_READ;
  var handle=Open(path,true,false,true,access,share);
  runtimeDirectories.Add(Tuple.Create(path,handle,Identity(Inspect(handle,path,true,false,true)),Hash(Security(handle,false,true,true,volumeRoot))));
 }
 public string TrustedNode() {
  string root=Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);Require(CanonicalLocalPath(root));
  Require(!Within(root,profile)&&!Within(root,source)&&!Within(profile,root)&&!Within(source,root));
  string folder=Path.Combine(root,"nodejs"),current=Path.GetPathRoot(folder);RuntimeDirectory(current,true);
  foreach(string part in folder.Substring(current.Length).Split('\\')){if(part.Length==0)continue;current=Path.Combine(current,part);RuntimeDirectory(current,false);}
  runtimeNode=Path.Combine(folder,"node.exe");runtimeHandle=Open(runtimeNode,false,false,true,GENERIC_READ|READ_CONTROL);
  runtimeIdentity=Identity(Inspect(runtimeHandle,runtimeNode,false,false,true));runtimeSecurity=Hash(Security(runtimeHandle,false,true));
  return runtimeNode;
 }
 public void VerifyRuntime() {
  Budget();Require(runtimeNode!=null&&runtimeHandle!=null);
  foreach(var dir in runtimeDirectories){bool volumeRoot=dir.Item1.Equals(Path.GetPathRoot(dir.Item1),StringComparison.OrdinalIgnoreCase);Require(Identity(Inspect(dir.Item2,dir.Item1,true,false,true))==dir.Item3&&Hash(Security(dir.Item2,false,true,true,volumeRoot))==dir.Item4);}
  Require(Identity(Inspect(runtimeHandle,runtimeNode,false,false,true))==runtimeIdentity&&Hash(Security(runtimeHandle,false,true))==runtimeSecurity);
  var current=Open(runtimeNode,false,false,true,GENERIC_READ|READ_CONTROL);Require(Identity(Inspect(current,runtimeNode,false,false,true))==runtimeIdentity);
 }
 public void Dispose(){foreach(var stream in streams)stream.Dispose();streams.Clear();for(int n=held.Count-1;n>=0;n--)held[n].Dispose();held.Clear();}
}

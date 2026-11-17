param([switch]$CompileOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Synthetic Windows filesystem proof only. Run has no path arguments and owns
# one newly created random temporary tree; it never opens the real source tree.
# MAXIMUM_ALLOWED nonpropagation: Microsoft SetSecurityInfo API documentation.
$source=@'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
public static class GoriqSourceBoundaryNativeProof {
 const uint MAXIMUM_ALLOWED=0x02000000, DACL=4, PROTECTED=0x80000000, UNPROTECTED=0x20000000;
 const int Full=2032127, Read=1179817;
 static readonly AceFlags Inherit=AceFlags.ContainerInherit|AceFlags.ObjectInherit;
 static readonly AccessControlSections Sections=AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access;
 [StructLayout(LayoutKind.Sequential)] struct Attributes {public int Length;public IntPtr Descriptor;public int Inherit;}
 [StructLayout(LayoutKind.Sequential)] struct Info {public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh,volume,sizeHigh,sizeLow,links,indexHigh,indexLow;}
 [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool CreatePrivate(string path,ref Attributes attributes);
 [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool CreateDirectory(string path,IntPtr attributes);
 [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
 [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandle",ExactSpelling=true,SetLastError=true)] static extern bool GetInfo(SafeFileHandle file,out Info info);
 [DllImport("kernel32.dll",EntryPoint="GetFinalPathNameByHandleW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern uint GetFinal(SafeFileHandle file,StringBuilder path,uint length,uint flags);
 [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint SetSecurityInfo(SafeFileHandle handle,int type,uint requested,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
 [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
 [DllImport("kernel32.dll",ExactSpelling=true)] static extern IntPtr LocalFree(IntPtr memory);
 sealed class Failure:Exception {public string Code;public Failure(string code){Code=code;}}
 sealed class Node {public string Role,Path;public bool Directory,IdentityKnown;public uint Volume,IndexHigh,IndexLow;}
 sealed class Snapshot {public RawSecurityDescriptor Descriptor;public string Semantic;public bool Protected;}
 static List<Node> nodes;static string root,phase;static int checks,setCalls;
 static void Need(bool value,string code){if(!value)throw new Failure(phase+"_"+code);}
 static void Check(bool value,string code){Need(value,code);checks++;Console.WriteLine("PASS "+phase+"_"+code);}
 static bool Same(Snapshot a,Snapshot b){return String.Equals(a.Semantic,b.Semantic,StringComparison.Ordinal);}
 static SafeFileHandle Open(Node node,bool record=false) {
  Need(root!=null&&(node.Path==root||node.Path.StartsWith(root+"\\",StringComparison.Ordinal)),"OWNED_PATH");
  var handle=CreateFile(node.Path,MAXIMUM_ALLOWED,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  try {
   Need(handle!=null&&!handle.IsInvalid,"OPEN");Info info;Need(GetInfo(handle,out info)&&(info.attributes&0x400)==0&&((info.attributes&16)!=0)==node.Directory&&(node.Directory||info.links==1),"METADATA");
   var final=new StringBuilder(1024);uint count=GetFinal(handle,final,1024,0);
   Need(count>0&&count<1024&&String.Equals(final.ToString(),"\\\\?\\"+node.Path,StringComparison.OrdinalIgnoreCase),"FINAL_PATH");
   if(record){Need(!node.IdentityKnown,"IDENTITY_ALREADY_RECORDED");node.Volume=info.volume;node.IndexHigh=info.indexHigh;node.IndexLow=info.indexLow;node.IdentityKnown=true;}
   else Need(node.IdentityKnown&&node.Volume==info.volume&&node.IndexHigh==info.indexHigh&&node.IndexLow==info.indexLow,"CREATED_IDENTITY");return handle;
  }catch{if(handle!=null)handle.Dispose();throw;}
 }
 static Snapshot ReadDescriptor(SafeFileHandle handle) {
  IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
  try {
   uint result=GetSecurityInfo(handle,1,7,out owner,out group,out dacl,out sacl,out descriptor);Need(result==0&&descriptor!=IntPtr.Zero,"GET_DESCRIPTOR");
   uint size=GetSecurityDescriptorLength(descriptor);Need(size>=20&&size<=65536,"DESCRIPTOR_BOUND");byte[] bytes=new byte[(int)size];Marshal.Copy(descriptor,bytes,0,bytes.Length);
   var value=new RawSecurityDescriptor(bytes,0);Need(value.Owner!=null&&value.Group!=null&&value.DiscretionaryAcl!=null&&(value.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0,"DESCRIPTOR_SHAPE");
   return new Snapshot{Descriptor=value,Semantic=value.GetSddlForm(Sections),Protected=(value.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0};
  }finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
 }
 static Snapshot State(Node node){using(var handle=Open(node))return ReadDescriptor(handle);}
 static void SetDacl(SafeFileHandle handle,RawAcl acl,bool protect) {
  Need(acl!=null&&acl.BinaryLength>=8&&acl.BinaryLength<=65516,"ACL_BOUND");byte[] bytes=new byte[acl.BinaryLength];acl.GetBinaryForm(bytes,0);IntPtr memory=Marshal.AllocHGlobal(bytes.Length);
  try {Marshal.Copy(bytes,0,memory,bytes.Length);setCalls++;uint result=SetSecurityInfo(handle,1,DACL|(protect?PROTECTED:UNPROTECTED),IntPtr.Zero,IntPtr.Zero,memory,IntPtr.Zero);Need(result==0,"SET_DACL_"+result);}
  finally{Marshal.FreeHGlobal(memory);}
 }
 static bool TryChange(Node node,Snapshot expected,RawAcl acl,bool protect,out Snapshot after) {
  using(var handle=Open(node)) {
   Snapshot before=ReadDescriptor(handle);after=before;if(!Same(before,expected))return false;
   // Both comparison and DACL-only write use this MAXIMUM_ALLOWED handle.
   // This is a mismatch guard, not an atomic compare-and-swap with other writers.
   SetDacl(handle,acl,protect);after=ReadDescriptor(handle);
   Need(before.Descriptor.Owner.Equals(after.Descriptor.Owner)&&before.Descriptor.Group.Equals(after.Descriptor.Group),"OWNER_GROUP_CHANGED");return true;
  }
 }
 static Snapshot Change(Node node,Snapshot expected,RawAcl acl,bool protect) {Snapshot after;Check(TryChange(node,expected,acl,protect,out after),"COMPARE_GUARD");return after;}
 static RawAcl PrivateAcl(SecurityIdentifier user) {
  var acl=new RawAcl(2,3);foreach(var sid in new[]{user,new SecurityIdentifier("S-1-5-18"),new SecurityIdentifier("S-1-5-32-544")})acl.InsertAce(acl.Count,new CommonAce(Inherit,AceQualifier.AccessAllowed,Full,sid,false,null));return acl;
 }
 static RawAcl RemoveReader(RawAcl original,SecurityIdentifier reader) {
  var acl=new RawAcl(original.Revision,original.Count);
  foreach(GenericAce ace in original){var known=ace as QualifiedAce;if(known!=null&&known.SecurityIdentifier.Equals(reader)&&known.AccessMask==Read&&known.AceQualifier==AceQualifier.AccessAllowed&&!known.IsCallback&&(ace.AceFlags&AceFlags.Inherited)!=0)continue;acl.InsertAce(acl.Count,ace);}return acl;
 }
 static bool HasReader(Snapshot state,SecurityIdentifier reader,bool inherited) {
  foreach(GenericAce ace in state.Descriptor.DiscretionaryAcl){var known=ace as KnownAce;if(known!=null&&known.SecurityIdentifier.Equals(reader)&&known.AccessMask==Read&&((ace.AceFlags&AceFlags.Inherited)!=0)==inherited)return true;}return false;
 }
 static bool InheritedFlags(AceFlags flags,bool directory){return (int)flags==(directory?19:16);}
 public static bool VerifyFlagContract() {
  if(!InheritedFlags((AceFlags)16,false)||!InheritedFlags((AceFlags)19,true))return false;
  foreach(int flags in new[]{0,1,2,3,17,18,19,20,24,31,80,144})if(InheritedFlags((AceFlags)flags,false))return false;
  foreach(int flags in new[]{0,3,16,17,18,20,23,27,31,83,147})if(InheritedFlags((AceFlags)flags,true))return false;return true;
 }
 static bool PrivateInherited(Snapshot state,SecurityIdentifier user,SecurityIdentifier reader,bool directory) {
  if(state.Protected||state.Descriptor.DiscretionaryAcl.Count!=3)return false;
  var trusted=new HashSet<string>(new[]{user.Value,"S-1-5-18","S-1-5-32-544"});
  foreach(GenericAce ace in state.Descriptor.DiscretionaryAcl){var known=ace as QualifiedAce;if(known==null||known.SecurityIdentifier.Equals(reader)||!trusted.Remove(known.SecurityIdentifier.Value)||known.AccessMask!=Full||known.AceQualifier!=AceQualifier.AccessAllowed||known.IsCallback||!InheritedFlags(ace.AceFlags,directory))return false;}return trusted.Count==0;
 }
 static Node NewDirectory(string role,string path) {Need(CreateDirectory(path,IntPtr.Zero),"CREATE_DIRECTORY");var node=new Node{Role=role,Path=path,Directory=true};nodes.Add(node);using(var h=Open(node,true)){}return node;}
 static Node NewFile(string role,string path) {
  using(var file=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.ReadWrite|FileShare.Delete)) {var node=new Node{Role=role,Path=path};nodes.Add(node);byte[] dummy=Encoding.ASCII.GetBytes("fixture");file.Write(dummy,0,dummy.Length);using(var h=Open(node,true)){}return node;}
 }
 static void CreateRoot(SecurityIdentifier user) {
  string temp=Path.GetFullPath(Path.GetTempPath()).TrimEnd('\\');root=Path.Combine(temp,"goriq-boundary-proof-"+Guid.NewGuid().ToString("N"));
  var drive=new DriveInfo(Path.GetPathRoot(root));Need(drive.IsReady&&drive.DriveType==DriveType.Fixed&&drive.DriveFormat=="NTFS","LOCAL_NTFS");
  var descriptor=new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected|ControlFlags.SelfRelative,null,null,null,PrivateAcl(user));
  byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
  try {var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};Need(CreatePrivate(root,ref attributes),"CREATE_PRIVATE_ROOT");nodes.Add(new Node{Role="ROOT",Path=root,Directory=true});}
  finally{pin.Free();}
  using(var handle=Open(nodes[0],true)){}
 }
 static Dictionary<Node,Snapshot> States() {var result=new Dictionary<Node,Snapshot>();foreach(var node in nodes)result.Add(node,State(node));return result;}
 static void Unchanged(Dictionary<Node,Snapshot> expected,Node except) {foreach(var pair in expected)if(pair.Key!=except)Check(Same(pair.Value,State(pair.Key)),"UNCHANGED_"+pair.Key.Role);}
 static void Restore(Node node,Snapshot expectedAfter,Snapshot original) {
  Snapshot restored=Change(node,expectedAfter,original.Descriptor.DiscretionaryAcl,original.Protected);
  // Restoring UNPROTECTED after the parent's rollback must reattach the original
  // inherited ACEs and protection state, not merely produce equivalent access.
  Check(Same(restored,original),"EXACT_ORIGINAL_SDDL");
 }
 static bool Cleanup() {
  bool success=true;
  for(int n=nodes.Count-1;n>=0;n--)try {using(var handle=Open(nodes[n])){}if(nodes[n].Directory)Directory.Delete(nodes[n].Path,false);else File.Delete(nodes[n].Path);}catch{success=false;}
  // Expected paths only, after checking the recorded volume/file ID; no
  // recursive traversal. This isolated private-runner fixture has no hostile
  // same-user writers; path deletion is not an atomic by-handle deletion API.
  return success;
 }
 public static int Run() {
  nodes=new List<Node>();root=null;phase="SETUP";checks=0;setCalls=0;string failure=null;
  try {
   Need(Environment.OSVersion.Platform==PlatformID.Win32NT,"WINDOWS_REQUIRED");SecurityIdentifier user,reader;
   using(var identity=WindowsIdentity.GetCurrent()) {
    Need(identity.User!=null&&!identity.IsSystem&&!identity.IsAnonymous,"IDENTITY");user=identity.User;
    byte[] seed=Guid.NewGuid().ToByteArray();reader=new SecurityIdentifier("S-1-5-21-"+BitConverter.ToUInt32(seed,0)+"-"+BitConverter.ToUInt32(seed,4)+"-"+BitConverter.ToUInt32(seed,8)+"-50001");
    Need(!reader.Equals(user),"READER_IS_USER");foreach(var group in identity.Groups)Need(!reader.Equals(group),"READER_IS_TOKEN_GROUP");
   }
   CreateRoot(user);Node outer=NewDirectory("OUTER",root+"\\Outer");RawAcl outerAcl=PrivateAcl(user);outerAcl.InsertAce(outerAcl.Count,new CommonAce(Inherit,AceQualifier.AccessAllowed,Read,reader,false,null));
   Change(outer,State(outer),outerAcl,true);
   Node source=NewDirectory("SOURCE",outer.Path+"\\Source"),db=NewFile("DB",source.Path+"\\dummy.db"),side=NewDirectory("SIDECAR",source.Path+"\\Sidecar"),nested=NewFile("NESTED",side.Path+"\\dummy.txt"),sibling=NewDirectory("SIBLING",outer.Path+"\\Outside"),outside=NewFile("OUTSIDE",sibling.Path+"\\dummy.txt");
   var original=States();foreach(var node in new[]{source,db,side,nested,sibling,outside})Check(!original[node].Protected&&HasReader(original[node],reader,true),"INHERITED_READER_"+node.Role);
   phase="ROOT_CHANGE";Snapshot sourceAfter=Change(source,original[source],PrivateAcl(user),true);
   Check(sourceAfter.Protected&&!HasReader(sourceAfter,reader,true)&&sourceAfter.Descriptor.DiscretionaryAcl.Count==3,"PRIVATE_PROTECTED");Unchanged(original,source);
   phase="FUTURE_INHERITANCE";Node future=NewFile("FUTURE",source.Path+"\\future.txt"),futureDir=NewDirectory("FUTURE_DIR",source.Path+"\\Future"),futureNested=NewFile("FUTURE_NESTED",futureDir.Path+"\\dummy.txt");
   foreach(var node in new[]{future,futureDir,futureNested})Check(PrivateInherited(State(node),user,reader,node.Directory),"PRIVATE_"+node.Role);var futureStates=States();
   phase="DIRECT_SIDECAR";Snapshot sideAfter=Change(side,original[side],RemoveReader(original[side].Descriptor.DiscretionaryAcl,reader),original[side].Protected);
   Check(PrivateInherited(sideAfter,user,reader,true),"PRESERVED_UNPROTECTED");Unchanged(futureStates,side);
   phase="SIDECAR_FUTURE";Node sideFuture=NewFile("SIDECAR_FUTURE",side.Path+"\\future.txt");Snapshot sideFutureState=State(sideFuture);
   Check(PrivateInherited(sideFutureState,user,reader,false),"EXACT_PRIVATE_FILE_FLAGS");Check(Same(State(nested),original[nested]),"OLD_NESTED_UNCHANGED");
   phase="DIRECT_FILE";var beforeFile=States();Snapshot dbAfter=Change(db,original[db],RemoveReader(original[db].Descriptor.DiscretionaryAcl,reader),original[db].Protected);
   Check(PrivateInherited(dbAfter,user,reader,false),"PRESERVED_UNPROTECTED");Unchanged(beforeFile,db);
   phase="CONCURRENT_GUARD";var concurrent=new RawAcl(2,dbAfter.Descriptor.DiscretionaryAcl.Count+1);concurrent.InsertAce(0,new CommonAce(AceFlags.None,AceQualifier.AccessAllowed,1,new SecurityIdentifier("S-1-5-18"),false,null));foreach(GenericAce ace in dbAfter.Descriptor.DiscretionaryAcl)concurrent.InsertAce(concurrent.Count,ace);
   Snapshot mismatched=Change(db,dbAfter,concurrent,false),refused;int calls=setCalls;
   Check(!TryChange(db,dbAfter,original[db].Descriptor.DiscretionaryAcl,original[db].Protected,out refused)&&setCalls==calls&&Same(mismatched,State(db)),"MISMATCH_REFUSES_WITHOUT_WRITE");
   Snapshot repairedFixture=Change(db,mismatched,dbAfter.Descriptor.DiscretionaryAcl,dbAfter.Protected);Check(Same(repairedFixture,dbAfter),"RESET_ONLY_SYNTHETIC_CONCURRENT_CHANGE");
   phase="ROLLBACK_ROOT_FIRST";Restore(source,sourceAfter,original[source]);Check(Same(State(side),sideAfter)&&Same(State(db),dbAfter),"SELECTED_CHILDREN_NOT_PROPAGATED");
   foreach(var node in new[]{future,futureDir,futureNested})Check(Same(State(node),futureStates[node]),"UNTOUCHED_FUTURE_RETAINS_"+node.Role);
   Snapshot sideFutureAfterRoot=State(sideFuture);Check(Same(sideFutureAfterRoot,sideFutureState)&&PrivateInherited(sideFutureAfterRoot,user,reader,false),"SIDECAR_FUTURE_RETAINS_PRIVATE");
   phase="ROLLBACK_SIDECAR";Restore(side,sideAfter,original[side]);Check(Same(State(nested),original[nested]),"NESTED_NOT_PROPAGATED");
   Snapshot sideFutureAfterSide=State(sideFuture);Check(Same(sideFutureAfterSide,sideFutureState)&&PrivateInherited(sideFutureAfterSide,user,reader,false),"SIDECAR_FUTURE_RETAINS_PRIVATE");
   phase="ROLLBACK_FILE";Restore(db,dbAfter,original[db]);foreach(var pair in original)Check(Same(State(pair.Key),pair.Value),"EXACT_ORIGINAL_"+pair.Key.Role);
   // Future-created untouched children retain the private inherited descriptor:
   // successful rollback of selected objects is deliberately not global rollback.
   foreach(var node in new[]{future,futureDir,futureNested})Check(Same(State(node),futureStates[node]),"UNTOUCHED_FUTURE_STILL_PRIVATE_"+node.Role);
   Check(Same(State(sideFuture),sideFutureState),"UNTOUCHED_SIDECAR_FUTURE_STILL_PRIVATE");
  }catch(Failure ex){failure=ex.Code;}catch{failure=phase+"_UNEXPECTED";}
  finally{if(!Cleanup())failure=(failure==null?"":failure+"_")+"CLEANUP_FAILED";}
  if(failure!=null)throw new InvalidOperationException("SOURCE_BOUNDARY_NATIVE_PROOF_FAILED:"+failure);return checks;
 }
}
'@
if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
if(-not [GoriqSourceBoundaryNativeProof]::VerifyFlagContract()){throw 'SOURCE_BOUNDARY_NATIVE_FLAG_CONTRACT_FAILED'}
Write-Output 'SOURCE_BOUNDARY_NATIVE_FLAG_CONTRACT_PASS=1'
if($CompileOnly){Write-Output 'SOURCE_BOUNDARY_NATIVE_COMPILE_PASS=1';return}
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'SOURCE_BOUNDARY_NATIVE_PROOF_UNSUPPORTED_PLATFORM'}
try{$checks=[GoriqSourceBoundaryNativeProof]::Run()}
catch{
 $failure=$_.Exception
 while($null -ne $failure.InnerException){$failure=$failure.InnerException}
 if($failure.Message -cmatch '^SOURCE_BOUNDARY_NATIVE_PROOF_FAILED:[A-Z0-9_]+$'){throw $failure.Message}
 throw 'SOURCE_BOUNDARY_NATIVE_PROOF_FAILED:UNEXPECTED'
}
Write-Output ('SOURCE_BOUNDARY_NATIVE_PROOF_PASS='+$checks)

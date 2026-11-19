// Issue 1219: approved fixed Source DACL boundary only. Concatenate after capture.
// MAXIMUM_ALLOWED handles deliberately avoid SetSecurityInfo child propagation.
// This is sampled comparison and verification, never an atomic ACL transaction.
public static class GoriqSourcePrivateAclRepair {
 public const string ScopeHash="477f156730cab88b3a27588ef4bee6af52dcb88a2594d7978c4b57aa935b5599";
 internal const string Installer="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
 internal static readonly DateTime NotBefore=new DateTime(2026,11,18,14,38,49,DateTimeKind.Utc).AddTicks(8228920);
 internal static readonly DateTime Expires=new DateTime(2026,11,20,6,0,0,DateTimeKind.Utc);
 internal const int Full=2032127,Reader=1179817,MaximumObjects=16,MaximumDescriptor=65536,MaximumBaseline=2097152;
 internal sealed class Refusal:IOException {internal readonly string Code;internal Refusal(string code):base("SOURCE_PRIVATE_ACL_REFUSED"){Code=code;}}
 internal static void Need(bool value,string code){if(!value)throw new Refusal(code);}
 internal static string Hash(byte[] bytes){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 internal static bool Equal(byte[] a,byte[] b){if(a==null||b==null||a.Length!=b.Length)return false;int different=0;for(int n=0;n<a.Length;n++)different|=a[n]^b[n];return different==0;}
 internal static void Approval(string run,string attempt,string scope,DateTime now){
  Need(scope==ScopeHash,"SCOPE_MISMATCH");Need(run!=null&&attempt!=null&&Regex.IsMatch(run,@"^[1-9][0-9]{0,19}\z")&&Regex.IsMatch(attempt,@"^[1-9][0-9]{0,3}\z"),"RUN_CONTEXT");
  Need(now>=NotBefore,"APPROVAL_NOT_YET_VALID");Need(now<Expires,"APPROVAL_EXPIRED");
 }
 internal static bool Trusted(string sid,string user){return sid==user||sid=="S-1-5-18"||sid=="S-1-5-32-544"||sid==Installer;}
 internal static bool ReaderSid(string value,string user){
  if(value==null||Trusted(value,user)||!Regex.IsMatch(value,@"^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+\z"))return false;
  string[] parts=value.Split('-');for(int n=4;n<parts.Length;n++){uint number;if(!UInt32.TryParse(parts[n],out number)||number.ToString(System.Globalization.CultureInfo.InvariantCulture)!=parts[n])return false;}return true;
 }
 internal static bool AllowedLeaf(bool sidecar,string leaf){
  if(sidecar)return leaf=="jobs.json"||leaf=="change-sets.json";
  return leaf=="compass.sqlite"||leaf=="compass.sqlite-wal"||leaf=="compass.sqlite-shm"||leaf=="compass.sqlite-journal"||leaf=="self-development";
 }
 internal sealed class Snapshot {internal string Key;internal byte[] Bytes;internal RawSecurityDescriptor Descriptor;internal bool Protected;}
 internal sealed class Item {internal string Role,Path,Identity;internal bool Directory,Root,AllowDaclWrite;internal Snapshot Before,After;internal SafeFileHandle Handle;}
 internal sealed class Plan {
  internal readonly List<Item> Items=new List<Item>();internal readonly List<Item> Ancestors=new List<Item>();
  internal string PlanHash="",ImplementationHash="",BackupId="",User,ReaderFingerprint,SelectedReader,Run,Attempt,Revision,RunnerIdentity;
 }
 internal sealed class Outcome {
  internal string Status="REFUSED",Reason="UNEXPECTED",PlanHash="",ImplementationHash="",BackupId="";internal int Planned,Changed,Restored;internal bool ManualRecovery,GlobalRestoreComplete;
  internal string Json(){return "{\"status\":\""+Status+"\",\"reason\":\""+Reason+"\",\"plannedObjects\":"+Planned+",\"changedObjects\":"+Changed+",\"restoredObjects\":"+Restored+",\"scopeSha256\":\""+ScopeHash+"\",\"planSha256\":\""+PlanHash+"\",\"implementationSha256\":\""+ImplementationHash+"\",\"backupId\":\""+BackupId+"\",\"consistency\":\"LIVE_SAMPLED\",\"manualRecovery\":"+(ManualRecovery?"true":"false")+",\"globalRestoreComplete\":"+(GlobalRestoreComplete?"true":"false")+",\"originalDataPreservationVerified\":false}";}
 }
 internal interface IStore {
  DateTime UtcNow{get;}void Claim();void SaveBaseline(Plan plan);bool Validate(Plan plan,bool rollback);Snapshot Read(Item item);void Write(Item item,Snapshot snapshot);void Journal(string phase,Item item,Snapshot observed);
 }
 internal interface IExecutionStore:IStore,IDisposable {Plan Preflight();}
 internal static bool Same(Snapshot a,Snapshot b){return a!=null&&b!=null&&String.Equals(a.Key,b.Key,StringComparison.Ordinal);}
 internal static void Admissible(Plan plan,IStore store,List<Item> changed,List<Item> restored){foreach(Item item in plan.Items)Need(Same(store.Read(item),changed.Contains(item)&&!restored.Contains(item)?item.After:item.Before),"DESCRIPTOR_DRIFT");}
 internal static Outcome Transact(Plan plan,IStore store,bool apply,Outcome recorded=null){
  var result=recorded??new Outcome{Planned=plan.Items.Count,PlanHash=plan.PlanHash,ImplementationHash=plan.ImplementationHash};
  if(!apply){result.Status="PLANNED";result.Reason="METADATA_ONLY";return result;}
  var changed=new List<Item>();Item attempted=null;bool uncertain=false;bool claimed=false;
  try {
   Need(store.UtcNow>=NotBefore&&store.UtcNow<Expires,"APPROVAL_EXPIRED");Need(plan.Items.Count>0&&plan.Items.Count<=MaximumObjects,"OBJECT_BOUND");
   store.Claim();claimed=true;result.BackupId=plan.BackupId;store.SaveBaseline(plan);result.PlanHash=plan.PlanHash;store.Journal("PREPARED",null,null);
   foreach(Item item in plan.Items){
    Need(store.UtcNow<Expires,"APPROVAL_EXPIRED");Need(store.Validate(plan,false),"INVENTORY_DRIFT");
    foreach(Item known in plan.Items)Need(Same(store.Read(known),changed.Contains(known)?known.After:known.Before),"DESCRIPTOR_DRIFT");
    if(Same(item.Before,item.After))continue;
    store.Journal("INTENT",item,item.Before);
    // The immediately preceding read and this write address the same retained
    // handle. A concurrent trusted ACL writer can still interleave here.
    Need(Same(store.Read(item),item.Before),"DESCRIPTOR_DRIFT");Need(store.UtcNow<Expires,"APPROVAL_EXPIRED");attempted=item;
    store.Write(item,item.After);Snapshot observed=store.Read(item);Need(Same(observed,item.After),"POSTVERIFY_DRIFT");
    changed.Add(item);attempted=null;result.Changed=changed.Count;store.Journal("APPLIED",item,observed);
   }
   Need(store.Validate(plan,false),"INVENTORY_DRIFT");foreach(Item item in plan.Items)Need(Same(store.Read(item),item.After),"POSTVERIFY_DRIFT");
   store.Journal("COMMITTED",null,null);result.Status="APPLIED";result.Reason="VERIFIED_SAMPLE";return result;
  }catch(Exception error){
   var refusal=error as Refusal;result.Reason=refusal==null?"UNEXPECTED":refusal.Code;result.PlanHash=plan.PlanHash;
   if(attempted!=null){
    try {Snapshot observed=store.Read(attempted);if(Same(observed,attempted.After)){changed.Add(attempted);result.Changed=changed.Count;}else if(!Same(observed,attempted.Before))uncertain=true;}catch{uncertain=true;}
   }
   if(changed.Count==0&&!uncertain){result.Status="REFUSED";return result;}
   try {
    Need(!uncertain,"UNATTRIBUTED_STATE");bool complete=store.Validate(plan,true);Need(complete,"INVENTORY_DRIFT");var restored=new List<Item>();Admissible(plan,store,changed,restored);
    // Baseline order is SOURCE, sidecar directories, files. Restoring a
    // parent's original default first is necessary for inherited ACEs.
    foreach(Item item in changed){
     complete=store.Validate(plan,true)&&complete;Need(complete,"INVENTORY_DRIFT");Admissible(plan,store,changed,restored);Need(Same(store.Read(item),item.After),"ROLLBACK_DRIFT");store.Journal("ROLLBACK_INTENT",item,item.After);
     Need(Same(store.Read(item),item.After),"ROLLBACK_DRIFT");store.Write(item,item.Before);Snapshot observed=store.Read(item);Need(Same(observed,item.Before),"ROLLBACK_POSTVERIFY");result.Restored++;restored.Add(item);store.Journal("RESTORED",item,observed);
    }
    complete=store.Validate(plan,true)&&complete;Need(complete,"INVENTORY_DRIFT");Admissible(plan,store,changed,restored);
    result.GlobalRestoreComplete=complete;result.Status=complete?"ROLLED_BACK":"INCOMPLETE";result.ManualRecovery=!complete;store.Journal("ROLLBACK_FINISHED",null,null);
   }catch{result.Status="INCOMPLETE";result.ManualRecovery=true;result.GlobalRestoreComplete=false;}
   if(!claimed)result.BackupId="";return result;
  }
 }
 internal static Snapshot FromDescriptor(RawSecurityDescriptor descriptor){
  Need(descriptor!=null&&descriptor.Owner!=null&&descriptor.Group!=null&&descriptor.DiscretionaryAcl!=null&&descriptor.DiscretionaryAcl.Revision==2&&(descriptor.ControlFlags&ControlFlags.DiscretionaryAclPresent)!=0,"DESCRIPTOR_SHAPE");
  Need(descriptor.BinaryLength>=20&&descriptor.BinaryLength<=MaximumDescriptor,"DESCRIPTOR_BOUND");
  ControlFlags permitted=ControlFlags.SelfRelative|ControlFlags.OwnerDefaulted|ControlFlags.GroupDefaulted|ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected|ControlFlags.DiscretionaryAclAutoInherited;
  Need((descriptor.ControlFlags&~permitted)==0,"DESCRIPTOR_FLAGS");
  byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);
  return new Snapshot{Descriptor=descriptor,Bytes=bytes,Key=((int)descriptor.ControlFlags).ToString(System.Globalization.CultureInfo.InvariantCulture)+":"+descriptor.GetSddlForm(AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access),Protected=(descriptor.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0};
 }
 internal static CommonAce Ace(GenericAce ace,bool directory){
  var common=ace as CommonAce;int flags=(int)ace.AceFlags;
  Need(common!=null&&!common.IsCallback&&common.OpaqueLength==0&&common.AceQualifier==AceQualifier.AccessAllowed&&(directory?(flags==0||flags==3||flags==16||flags==19):(flags==0||flags==16)),"ACE_SHAPE");return common;
 }
 internal static string SelectReader(Snapshot before,string user){
  string selected=null;int count=0;foreach(GenericAce raw in before.Descriptor.DiscretionaryAcl){CommonAce ace=Ace(raw,true);if(Trusted(ace.SecurityIdentifier.Value,user))continue;Need(ReaderSid(ace.SecurityIdentifier.Value,user)&&ace.AccessMask==Reader&&(int)ace.AceFlags==19,"READER_GRANT");selected=ace.SecurityIdentifier.Value;count++;}
  Need(count==1,"READER_AMBIGUOUS");return selected;
 }
 internal static bool TrustedFullControl(int mask,int flags,bool directory){return mask==Full&&(directory?(flags==3||flags==19):(flags==0||flags==16));}
 internal static Snapshot BuildAfter(Snapshot before,string user,string reader,bool directory,bool root,bool requireReader){
  Need(before.Descriptor.Owner.Value==user,"SOURCE_OWNER");Need(ReaderSid(reader,user),"READER_GRANT");var acl=new RawAcl(before.Descriptor.DiscretionaryAcl.Revision,before.Descriptor.DiscretionaryAcl.Count);
  int removed=0;bool current=false,system=false,admin=false;
  foreach(GenericAce raw in before.Descriptor.DiscretionaryAcl){CommonAce ace=Ace(raw,directory);string who=ace.SecurityIdentifier.Value;
   if(who==reader){Need(ace.AccessMask==Reader,"READER_GRANT");Need((int)ace.AceFlags==(directory?19:16),"ACE_SHAPE");removed++;continue;}
   Need(Trusted(who,user)&&ace.AccessMask!=0&&(((uint)ace.AccessMask)&~(uint)Full)==0,"OTHER_GRANT");
   bool full=TrustedFullControl(ace.AccessMask,(int)ace.AceFlags,directory);if(who==user&&full)current=true;if(who=="S-1-5-18"&&full)system=true;if(who=="S-1-5-32-544"&&full)admin=true;
   byte[] bytes=new byte[raw.BinaryLength];raw.GetBinaryForm(bytes,0);GenericAce copy=GenericAce.CreateFromBinaryForm(bytes,0);if(root)copy.AceFlags&=~AceFlags.Inherited;acl.InsertAce(acl.Count,copy);
  }
  Need(removed<=1&&(!requireReader||removed==1),"READER_AMBIGUOUS");Need(current&&system&&admin,"TRUSTED_GRANTS");
  ControlFlags flags=before.Descriptor.ControlFlags;if(root)flags|=ControlFlags.DiscretionaryAclProtected;
  return FromDescriptor(new RawSecurityDescriptor(flags,before.Descriptor.Owner,before.Descriptor.Group,null,acl));
 }
 internal static Outcome ExecuteStore(bool apply,Func<IExecutionStore> create){
  IExecutionStore store=null;Outcome result=null;bool transactionStarted=false;
  try {
   store=create();Plan plan=store.Preflight();result=new Outcome{Planned=plan.Items.Count,PlanHash=plan.PlanHash,ImplementationHash=plan.ImplementationHash};
   // Retain this same accounting object even if transaction/finalization fails.
   transactionStarted=true;Transact(plan,store,apply,result);
  }catch(Exception error){
   var refusal=error as Refusal;string reason=refusal==null?"UNEXPECTED":refusal.Code;
   if(result==null)result=new Outcome{Reason=reason};
   else{result.Status="INCOMPLETE";result.Reason=reason;result.ManualRecovery=true;result.GlobalRestoreComplete=false;}
  }finally{
   if(store!=null)try{store.Dispose();}catch{
    if(result==null)result=new Outcome();result.Reason="FINALIZATION_FAILED";
    if(transactionStarted){result.Status="INCOMPLETE";result.ManualRecovery=true;result.GlobalRestoreComplete=false;}
   }
  }
  return result;
 }
 public static string Execute(bool apply,string runId,string attempt,string approvedScopeSha256){
  Outcome result;
  try{Need(Environment.OSVersion.Platform==PlatformID.Win32NT,"WINDOWS_REQUIRED");Approval(runId,attempt,approvedScopeSha256,DateTime.UtcNow);}
  catch(Refusal error){return new Outcome{Reason=error.Code}.Json();}catch{return new Outcome{Reason="UNEXPECTED"}.Json();}
  result=ExecuteStore(apply,delegate{return new NativeStore(runId,attempt);});
  // Serialization is outside all catches which can create a fresh refusal.
  return result.Json();
 }
 internal sealed class NativeStore:IExecutionStore {
  const uint MaximumAllowed=0x02000000,ReadControl=0x20000,ReadAttributes=0x80,Backup=0x02000000,OpenReparse=0x00200000,DirectoryFlag=16,ReparseFlag=0x400,Dacl=4,ProtectedDacl=0x80000000,UnprotectedDacl=0x20000000;
  [StructLayout(LayoutKind.Sequential)] struct Info {public uint Attributes,CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
  [StructLayout(LayoutKind.Sequential)] struct Attributes {public int Length;public IntPtr Descriptor;public int Inherit;}
  [StructLayout(LayoutKind.Sequential)] struct Blob {public int Length;public IntPtr Data;}
  [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint mode,uint flags,IntPtr template);
  [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern SafeFileHandle CreatePrivateFile(string path,uint access,uint share,ref Attributes security,uint mode,uint flags,IntPtr template);
  [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool CreatePrivateDirectoryNative(string path,ref Attributes security);
  [DllImport("kernel32.dll",EntryPoint="GetFileInformationByHandle",ExactSpelling=true,SetLastError=true)] static extern bool GetInfo(SafeFileHandle handle,out Info info);
  [DllImport("kernel32.dll",EntryPoint="GetFinalPathNameByHandleW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern uint GetFinal(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
  [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,int type,uint requested,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint SetSecurityInfo(SafeFileHandle handle,int type,uint requested,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
  [DllImport("advapi32.dll",ExactSpelling=true)] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll",ExactSpelling=true)] static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("crypt32.dll",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool CryptProtectData(ref Blob input,string description,IntPtr entropy,IntPtr reserved,IntPtr prompt,uint flags,out Blob output);
  [DllImport("crypt32.dll",ExactSpelling=true,SetLastError=true)] static extern bool CryptUnprotectData(ref Blob input,IntPtr description,IntPtr entropy,IntPtr reserved,IntPtr prompt,uint flags,out Blob output);
  readonly List<Item> held=new List<Item>();readonly List<FileStream> streams=new List<FileStream>();
  readonly string run,attempt,user,profile,local,source,handoff,workspace,implementation,revision,runner;
  readonly DateTime deadline=DateTime.UtcNow.AddSeconds(30);FileStream journal;long journalBytes;Plan active;
  public DateTime UtcNow{get{return DateTime.UtcNow;}}
  internal NativeStore(string runId,string runAttempt){
   run=runId;attempt=runAttempt;
   using(var identity=WindowsIdentity.GetCurrent()){Need(identity.User!=null&&!identity.IsSystem&&!identity.IsAnonymous&&identity.ImpersonationLevel!=TokenImpersonationLevel.Impersonation&&identity.ImpersonationLevel!=TokenImpersonationLevel.Delegation,"CURRENT_IDENTITY");user=identity.User.Value;}
   profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);workspace=Environment.GetEnvironmentVariable("GITHUB_WORKSPACE");
   Need(profile==Environment.GetEnvironmentVariable("USERPROFILE")&&local==Environment.GetEnvironmentVariable("LOCALAPPDATA")&&GoriqBridgeCapture.CanonicalLocalPath(profile)&&GoriqBridgeCapture.CanonicalLocalPath(local)&&Within(profile,local)&&GoriqBridgeCapture.CanonicalLocalPath(workspace),"ENVIRONMENT_CONTEXT");
   Need(String.Equals(Path.Combine(profile,"AppData","Local"),local,StringComparison.OrdinalIgnoreCase),"KNOWN_FOLDER_CHAIN");source=Path.Combine(local,"GAIWorker","goal-1218-bridge-state");handoff=Path.Combine(profile,".goriq-handoff");
   Need(!Within(workspace,handoff)&&!Within(handoff,workspace)&&!Within(source,handoff)&&!Within(handoff,source),"PRIVATE_LAYOUT");
   implementation=Environment.GetEnvironmentVariable("GORIQ_SOURCE_ACL_IMPLEMENTATION_SHA256");revision=Environment.GetEnvironmentVariable("GITHUB_SHA");runner=Environment.GetEnvironmentVariable("RUNNER_NAME");
   Need(implementation!=null&&Regex.IsMatch(implementation,@"^[0-9a-f]{64}\z")&&revision!=null&&Regex.IsMatch(revision,@"^[0-9a-f]{40}\z"),"IMPLEMENTATION_BINDING");
   Need(Environment.GetEnvironmentVariable("GITHUB_REPOSITORY")=="haji84/AI-"&&Environment.GetEnvironmentVariable("GITHUB_ACTIONS")=="true"&&Environment.GetEnvironmentVariable("RUNNER_OS")=="Windows"&&Environment.GetEnvironmentVariable("GITHUB_RUN_ID")==run&&Environment.GetEnvironmentVariable("GITHUB_RUN_ATTEMPT")==attempt&&Environment.GetEnvironmentVariable("GITHUB_ACTOR")=="haji84"&&Environment.GetEnvironmentVariable("GITHUB_REF")=="refs/heads/main"&&runner!=null&&runner.IndexOf("ZBook",StringComparison.OrdinalIgnoreCase)>=0,"RUNNER_CONTEXT");
  }
  static bool Within(string parent,string path){return String.Equals(parent,path,StringComparison.OrdinalIgnoreCase)||path.StartsWith(parent.TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase);}
  void Budget(){Need(DateTime.UtcNow<deadline,"PREFLIGHT_TIMEOUT");}
  static string Identity(Info info){return info.Volume+":"+info.IndexHigh+":"+info.IndexLow+":"+info.CreationHigh+":"+info.CreationLow+":"+(info.Attributes&DirectoryFlag)+":"+info.Links;}
  static void Inspect(Item item){
   Need(GoriqBridgeCapture.CanonicalLocalPath(item.Path),"CANONICAL_PATH");Info info=new Info();Need(item.Handle!=null&&!item.Handle.IsInvalid&&GetInfo(item.Handle,out info)&&(info.Attributes&ReparseFlag)==0&&((info.Attributes&DirectoryFlag)!=0)==item.Directory&&(item.Directory||info.Links==1),"OBJECT_METADATA");
   var final=new StringBuilder(1024);uint count=GetFinal(item.Handle,final,1024,0);Need(count>0&&count<1024&&String.Equals(final.ToString(),"\\\\?\\"+item.Path,StringComparison.OrdinalIgnoreCase),"FINAL_PATH");
   string id=Identity(info);Need(item.Identity==null||item.Identity==id,"IDENTITY_DRIFT");item.Identity=id;
  }
  internal static Item OpenNative(string path,bool directory,bool maximum){
   Need(GoriqBridgeCapture.CanonicalLocalPath(path),"CANONICAL_PATH");var drive=new DriveInfo(Path.GetPathRoot(path));Need(drive.IsReady&&drive.DriveType==DriveType.Fixed&&drive.DriveFormat=="NTFS","LOCAL_NTFS");
   var item=new Item{Path=path,Directory=directory,AllowDaclWrite=maximum,Handle=CreateFile(path,maximum?MaximumAllowed:ReadControl|ReadAttributes,7,IntPtr.Zero,3,Backup|OpenReparse,IntPtr.Zero)};
   try{Inspect(item);return item;}catch{if(item.Handle!=null)item.Handle.Dispose();throw;}
  }
  internal static Snapshot ReadNative(Item item){
   Inspect(item);IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
   try{Need(GetSecurityInfo(item.Handle,1,7,out owner,out group,out dacl,out sacl,out descriptor)==0&&descriptor!=IntPtr.Zero,"READ_SECURITY");uint length=GetSecurityDescriptorLength(descriptor);Need(length>=20&&length<=MaximumDescriptor,"DESCRIPTOR_BOUND");byte[] bytes=new byte[(int)length];Marshal.Copy(descriptor,bytes,0,bytes.Length);return FromDescriptor(new RawSecurityDescriptor(bytes,0));}
   finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
  }
  internal static void WriteNative(Item item,Snapshot snapshot,bool requireUnexpiredApproval=false){
   Need(item.AllowDaclWrite,"WRITE_SCOPE");Inspect(item);RawAcl acl=snapshot.Descriptor.DiscretionaryAcl;Need(acl.BinaryLength>=8&&acl.BinaryLength<=MaximumDescriptor-20,"ACL_BOUND");byte[] bytes=new byte[acl.BinaryLength];acl.GetBinaryForm(bytes,0);IntPtr memory=Marshal.AllocHGlobal(bytes.Length);
   try{Marshal.Copy(bytes,0,memory,bytes.Length);if(requireUnexpiredApproval)Need(DateTime.UtcNow>=NotBefore&&DateTime.UtcNow<Expires,"APPROVAL_EXPIRED");Need(SetSecurityInfo(item.Handle,1,Dacl|(snapshot.Protected?ProtectedDacl:UnprotectedDacl),IntPtr.Zero,IntPtr.Zero,memory,IntPtr.Zero)==0,"SET_FAILED");}
   finally{Marshal.FreeHGlobal(memory);}
  }
  static byte[] CreationDescriptor(string sid,bool directory){
   var acl=new RawAcl(2,3);foreach(string principal in new[]{sid,"S-1-5-18","S-1-5-32-544"})acl.InsertAce(acl.Count,new CommonAce(directory?(AceFlags)3:AceFlags.None,AceQualifier.AccessAllowed,Full,new SecurityIdentifier(principal),false,null));
   var sd=new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent|ControlFlags.DiscretionaryAclProtected|ControlFlags.SelfRelative,new SecurityIdentifier(sid),null,null,acl);byte[] bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);return bytes;
  }
  internal static void CreatePrivateDirectory(string path,string sid){
   Need(GoriqBridgeCapture.CanonicalLocalPath(path),"CANONICAL_PATH");byte[] bytes=CreationDescriptor(sid,true);GCHandle pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
   try{var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};Need(CreatePrivateDirectoryNative(path,ref attributes),"PRIVATE_CREATE");}finally{pin.Free();}
  }
  internal static byte[] Protect(byte[] value){return Crypt(value,false);}
  internal static byte[] Unprotect(byte[] value){return Crypt(value,true);}
  static byte[] Crypt(byte[] value,bool decrypt){
   Need(value!=null&&value.Length<=MaximumBaseline+65536,"BACKUP_BOUND");IntPtr inputMemory=Marshal.AllocHGlobal(value.Length);Blob output=new Blob();
   try{Marshal.Copy(value,0,inputMemory,value.Length);var input=new Blob{Length=value.Length,Data=inputMemory};bool success=decrypt?CryptUnprotectData(ref input,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output):CryptProtectData(ref input,"GORIQ issue 1219 Source DACL baseline",IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output);Need(success&&output.Length>0&&output.Length<=MaximumBaseline+65536&&output.Data!=IntPtr.Zero,"DPAPI_BACKUP");byte[] bytes=new byte[output.Length];Marshal.Copy(output.Data,bytes,0,bytes.Length);return bytes;}
   finally{for(int n=0;n<value.Length;n++)Marshal.WriteByte(inputMemory,n,0);Marshal.FreeHGlobal(inputMemory);if(output.Data!=IntPtr.Zero)LocalFree(output.Data);}
  }
  Item Track(string path,bool directory,bool maximum,string role){Budget();Item item=OpenNative(path,directory,maximum);held.Add(item);item.Role=role;item.Before=ReadNative(item);return item;}
  static bool Exists(string path){try{File.GetAttributes(path);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}}
  void Private(Snapshot value,bool exactProfile,bool directory){
   Need(GoriqBridgeCapture.PrivateOwnerPermitted(value.Descriptor.Owner.Value,user,exactProfile),"PRIVATE_OWNER");bool full=false;
   foreach(GenericAce raw in value.Descriptor.DiscretionaryAcl){
    var ace=raw as CommonAce;Need(ace!=null&&!ace.IsCallback&&ace.OpaqueLength==0&&ace.AceQualifier==AceQualifier.AccessAllowed&&(((int)ace.AceFlags)&~31)==0,"PRIVATE_ACL");
    string who=ace.SecurityIdentifier.Value;bool capability=exactProfile&&GoriqBridgeCapture.ProfileCapabilityTraversePermitted(who,unchecked((uint)ace.AccessMask),(int)ace.AceFlags,true);
    Need(capability||Trusted(who,user),"PRIVATE_ACL");if(who==user&&ace.AccessMask==Full&&(ace.AceFlags&AceFlags.InheritOnly)==0)full=true;
   }
   Need(full,"PRIVATE_FULL_CONTROL");
  }
  void Ancestor(Snapshot value,string selected,bool appdata){
   Need(GoriqBridgeCapture.SourceAncestorOwnerPermitted(value.Descriptor.Owner.Value,user),"ANCESTOR_OWNER");int readerCount=0;
   foreach(GenericAce raw in value.Descriptor.DiscretionaryAcl){
    CommonAce ace=Ace(raw,true);string who=ace.SecurityIdentifier.Value;Need(GoriqBridgeCapture.SourceAncestorAcePermitted(who,unchecked((uint)ace.AccessMask),user),"ANCESTOR_GRANT");
    if(!Trusted(who,user)){Need(who==selected&&ace.AccessMask==Reader&&(int)ace.AceFlags==(appdata?3:19),"ANCESTOR_READER");readerCount++;}
   }
   Need(readerCount==1,"ANCESTOR_READER");
  }
  void ProfileChain(Plan plan){
   string root=Path.GetPathRoot(profile),current=root;plan.Ancestors.Add(Track(root,true,false,"VOLUME"));
   foreach(string part in profile.Substring(root.Length).Split('\\')){Need(part.Length>0,"KNOWN_FOLDER_CHAIN");current=Path.Combine(current,part);Item item=Track(current,true,false,"PROFILE_ANCESTOR");plan.Ancestors.Add(item);}
   Item profileItem=plan.Ancestors[plan.Ancestors.Count-1];profileItem.Role="PROFILE";Private(profileItem.Before,true,true);
   foreach(string path in new[]{Path.Combine(profile,"AppData"),local,Path.Combine(local,"GAIWorker")})plan.Ancestors.Add(Track(path,true,false,path==local?"LOCAL":path==Path.Combine(local,"GAIWorker")?"WORKER":"APPDATA"));
   if(Exists(handoff)){Item item=Track(handoff,true,false,"HANDOFF");Private(item.Before,false,true);plan.Ancestors.Add(item);}
  }
  Dictionary<string,bool> Inventory(){
   var values=new Dictionary<string,bool>(StringComparer.OrdinalIgnoreCase);values.Add("",true);
   foreach(string path in Directory.EnumerateFileSystemEntries(source)){
    string leaf=Path.GetFileName(path);Need(AllowedLeaf(false,leaf),"UNKNOWN_SOURCE_OBJECT");bool directory=leaf=="self-development";FileAttributes attributes=File.GetAttributes(path);
    Need((attributes&FileAttributes.ReparsePoint)==0&&((attributes&FileAttributes.Directory)!=0)==directory,"OBJECT_METADATA");Need(!values.ContainsKey(leaf),"UNKNOWN_SOURCE_OBJECT");values.Add(leaf,directory);Need(values.Count<=MaximumObjects,"OBJECT_BOUND");
    if(directory)foreach(string child in Directory.EnumerateFileSystemEntries(path)){string name=Path.GetFileName(child);Need(AllowedLeaf(true,name),"UNKNOWN_SOURCE_OBJECT");FileAttributes childAttributes=File.GetAttributes(child);Need((childAttributes&(FileAttributes.ReparsePoint|FileAttributes.Directory))==0,"OBJECT_METADATA");values.Add("self-development\\"+name,false);Need(values.Count<=MaximumObjects,"OBJECT_BOUND");}
   }
   Need(values.ContainsKey("compass.sqlite"),"DATABASE_REQUIRED");return values;
  }
  public Plan Preflight(){
   Budget();var plan=new Plan{Run=run,Attempt=attempt,User=user,ImplementationHash=implementation,Revision=revision,RunnerIdentity=runner,BackupId="1219-source-acl-"+run+"-"+attempt};active=plan;ProfileChain(plan);
   Item root=Track(source,true,true,"SOURCE");root.Root=true;plan.Items.Add(root);string reader=SelectReader(root.Before,user);plan.SelectedReader=reader;plan.ReaderFingerprint=Hash(Encoding.UTF8.GetBytes(reader));
   Dictionary<string,bool> inventory=Inventory();string[] order={"self-development","compass.sqlite","compass.sqlite-wal","compass.sqlite-shm","compass.sqlite-journal","self-development\\jobs.json","self-development\\change-sets.json"};
   foreach(string relative in order)if(inventory.ContainsKey(relative)){string role=relative=="self-development"?"SIDECAR":relative=="compass.sqlite"?"DB":relative=="compass.sqlite-wal"?"WAL":relative=="compass.sqlite-shm"?"SHM":relative=="compass.sqlite-journal"?"JOURNAL":relative.EndsWith("\\jobs.json",StringComparison.Ordinal)?"JOBS":"CHANGE_SETS";plan.Items.Add(Track(Path.Combine(source,relative),inventory[relative],true,role));}
   Need(plan.Items.Count==inventory.Count&&plan.Items.Count<=MaximumObjects,"INVENTORY_DRIFT");
   foreach(Item item in plan.Items)item.After=BuildAfter(item.Before,user,reader,item.Directory,item.Root,item.Root||item.Role=="DB");
   foreach(Item item in plan.Ancestors)if(item.Role=="APPDATA"||item.Role=="LOCAL"||item.Role=="WORKER")Ancestor(item.Before,reader,item.Role=="APPDATA");
   plan.PlanHash=Hash(PlanBytes(plan));Need(Validate(plan,false),"INVENTORY_DRIFT");Budget();return plan;
  }
  static void SerializeItem(BinaryWriter writer,Item item){writer.Write(item.Role);writer.Write(item.Path);writer.Write(item.Identity);writer.Write(item.Directory);writer.Write(item.Root);writer.Write(item.Before.Bytes.Length);writer.Write(item.Before.Bytes);writer.Write(item.After!=null);if(item.After!=null){writer.Write(item.After.Bytes.Length);writer.Write(item.After.Bytes);}}
  static byte[] PlanBytes(Plan plan){
   using(var memory=new MemoryStream()){using(var writer=new BinaryWriter(memory,Encoding.UTF8)){writer.Write("GORIQ_SOURCE_DACL_BASELINE_V1");writer.Write(ScopeHash);writer.Write(plan.ImplementationHash);writer.Write(plan.Run);writer.Write(plan.Attempt);writer.Write(plan.User);writer.Write(plan.SelectedReader);writer.Write(plan.ReaderFingerprint);writer.Write(plan.Revision);writer.Write(plan.RunnerIdentity);writer.Write(NotBefore.Ticks);writer.Write(Expires.Ticks);writer.Write(plan.Items.Count);foreach(Item item in plan.Items)SerializeItem(writer,item);writer.Write(plan.Ancestors.Count);foreach(Item item in plan.Ancestors)SerializeItem(writer,item);writer.Flush();Need(memory.Length<=MaximumBaseline,"BASELINE_BOUND");return memory.ToArray();}}
  }
  static void PathIdentity(Item item){using(ItemScope fresh=new ItemScope(OpenNative(item.Path,item.Directory,false))){Need(fresh.Item.Identity==item.Identity,"IDENTITY_DRIFT");}Inspect(item);}
  sealed class ItemScope:IDisposable {internal readonly Item Item;internal ItemScope(Item item){Item=item;}public void Dispose(){Item.Handle.Dispose();}}
  public bool Validate(Plan plan,bool rollback){
   foreach(Item item in plan.Ancestors){PathIdentity(item);Need(Same(ReadNative(item),item.Before),"ANCESTOR_DRIFT");}
   foreach(Item item in plan.Items)PathIdentity(item);
   var current=Inventory();bool complete=current.Count==plan.Items.Count;
   foreach(Item item in plan.Items){string relative=item.Root?"":item.Path.Substring(source.Length+1);Need(current.ContainsKey(relative)&&current[relative]==item.Directory,"IDENTITY_DRIFT");}
   if(!rollback)Need(complete,"INVENTORY_DRIFT");return complete;
  }
  public Snapshot Read(Item item){return ReadNative(item);}
  public void Write(Item item,Snapshot snapshot){Need(active!=null&&active.Items.Contains(item)&&(Object.ReferenceEquals(snapshot,item.Before)||Object.ReferenceEquals(snapshot,item.After)),"WRITE_SCOPE");bool rollback=Object.ReferenceEquals(snapshot,item.Before);Need(Same(ReadNative(item),rollback?item.After:item.Before),"DESCRIPTOR_DRIFT");WriteNative(item,snapshot,!rollback);}
  void EnsurePrivateParent(){
   Item existing=null;foreach(Item item in active.Ancestors)if(item.Role=="HANDOFF")existing=item;
   if(existing==null){Need(!Exists(handoff),"PRIVATE_LAYOUT_DRIFT");CreatePrivateDirectory(handoff,user);Item item=Track(handoff,true,false,"HANDOFF");Private(item.Before,false,true);active.Ancestors.Add(item);}
   else{PathIdentity(existing);Need(Same(ReadNative(existing),existing.Before),"PRIVATE_LAYOUT_DRIFT");Private(existing.Before,false,true);}
  }
  FileStream NewPrivateFile(string path,bool claim){
   Need(GoriqBridgeCapture.CanonicalLocalPath(path)&&Within(handoff,path),"PRIVATE_LAYOUT");byte[] bytes=CreationDescriptor(user,false);GCHandle pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);SafeFileHandle handle=null;
   try{
    var attributes=new Attributes{Length=Marshal.SizeOf(typeof(Attributes)),Descriptor=pin.AddrOfPinnedObject()};handle=CreatePrivateFile(path,0xC0020080,1,ref attributes,1,Backup|OpenReparse,IntPtr.Zero);
    Need(handle!=null&&!handle.IsInvalid,claim?"SCOPE_CONSUMED":"PRIVATE_FILE_CREATE");var item=new Item{Path=path,Directory=false,Handle=handle};Inspect(item);Private(ReadNative(item),false,false);
    item.Role=claim?"CLAIM":Path.GetFileName(path)=="baseline.dpapi"?"BASELINE":"JOURNAL_FILE";item.Before=ReadNative(item);active.Ancestors.Add(item);var stream=new FileStream(handle,FileAccess.ReadWrite);handle=null;streams.Add(stream);return stream;
   }finally{if(handle!=null)handle.Dispose();pin.Free();}
  }
  void WriteReadback(FileStream stream,byte[] bytes){
   stream.Write(bytes,0,bytes.Length);stream.Flush(true);stream.Position=0;byte[] actual=new byte[bytes.Length];int offset=0,count;
   while(offset<actual.Length&&(count=stream.Read(actual,offset,actual.Length-offset))>0)offset+=count;
   Need(offset==actual.Length&&stream.ReadByte()==-1&&Equal(actual,bytes),"BACKUP_READBACK");stream.Position=stream.Length;
  }
  public void Claim(){
   Budget();Need(active!=null,"PREFLIGHT_REQUIRED");EnsurePrivateParent();
   // CREATE_NEW makes this persistent scope claim exclusive across runs.
   // It is intentionally never removed, including on any later failure.
   FileStream claim=NewPrivateFile(Path.Combine(handoff,"1219-source-acl-scope-"+ScopeHash+".claim"),true);
   byte[] claimBytes=Encoding.UTF8.GetBytes("GORIQ_SOURCE_ACL_SCOPE_V1\n"+ScopeHash+"\n"+run+"\n"+attempt+"\n"+implementation+"\n"+Expires.ToString("o"));WriteReadback(claim,claimBytes);
  }
  public void SaveBaseline(Plan plan){
   Budget();Need(active==plan,"PREFLIGHT_REQUIRED");string backup=Path.Combine(handoff,plan.BackupId);CreatePrivateDirectory(backup,user);Item backupItem=Track(backup,true,false,"BACKUP");Private(backupItem.Before,false,true);plan.Ancestors.Add(backupItem);
   // The locally frozen hash binds exact runtime SIDs, object IDs, complete
   // Owner/Group/DACL/control before and intended after, and implementation.
   FileStream baseline=NewPrivateFile(Path.Combine(backup,"baseline.dpapi"),false);journal=NewPrivateFile(Path.Combine(backup,"journal.dpapi"),false);plan.PlanHash=Hash(PlanBytes(plan));byte[] payload=PlanBytes(plan);byte[] protectedPayload=Protect(payload);WriteReadback(baseline,protectedPayload);
   baseline.Position=0;byte[] disk=new byte[protectedPayload.Length];int offset=0,count;while(offset<disk.Length&&(count=baseline.Read(disk,offset,disk.Length-offset))>0)offset+=count;Need(offset==disk.Length&&Equal(payload,Unprotect(disk)),"DPAPI_READBACK");baseline.Position=baseline.Length;
   Need(Validate(plan,false),"INVENTORY_DRIFT");Budget();
  }
  internal static long AppendVerifiedRecord(FileStream stream,byte[] plain,Func<byte[],byte[]> protect,Func<byte[],byte[]> unprotect,long already){
   byte[] encrypted=protect(plain);Need(encrypted!=null&&encrypted.Length>0&&already+encrypted.Length+4<=MaximumBaseline,"JOURNAL_BOUND");Need(stream.Position==stream.Length&&stream.Length==already,"JOURNAL_STATE");long start=stream.Position;
   byte[] length=BitConverter.GetBytes(encrypted.Length);stream.Write(length,0,length.Length);stream.Write(encrypted,0,encrypted.Length);stream.Flush(true);long end=stream.Position;
   stream.Position=start;byte[] disk=new byte[encrypted.Length+4];int offset=0,count;while(offset<disk.Length&&(count=stream.Read(disk,offset,disk.Length-offset))>0)offset+=count;
   Need(offset==disk.Length&&BitConverter.ToInt32(disk,0)==encrypted.Length,"JOURNAL_READBACK");byte[] persisted=new byte[encrypted.Length];Buffer.BlockCopy(disk,4,persisted,0,persisted.Length);Need(Equal(encrypted,persisted)&&Equal(plain,unprotect(persisted)),"JOURNAL_READBACK");stream.Position=end;return disk.Length;
  }
  public void Journal(string phase,Item item,Snapshot observed){
   Need(journal!=null,"JOURNAL_UNAVAILABLE");byte[] plain;
   using(var memory=new MemoryStream()){using(var writer=new BinaryWriter(memory,Encoding.UTF8)){writer.Write("GORIQ_SOURCE_DACL_JOURNAL_V1");writer.Write(ScopeHash);writer.Write(active.PlanHash);writer.Write(DateTime.UtcNow.Ticks);writer.Write(phase);writer.Write(item==null?"":item.Role);writer.Write(item==null?"":item.Identity);writer.Write(observed==null?0:observed.Bytes.Length);if(observed!=null)writer.Write(observed.Bytes);writer.Flush();plain=memory.ToArray();}}
   journalBytes+=AppendVerifiedRecord(journal,plain,Protect,Unprotect,journalBytes);
  }
  public void Dispose(){bool failed=false;for(int n=streams.Count-1;n>=0;n--)try{streams[n].Dispose();}catch{failed=true;}streams.Clear();for(int n=held.Count-1;n>=0;n--)try{held[n].Handle.Dispose();}catch{failed=true;}held.Clear();Need(!failed,"FINALIZATION_FAILED");}
 }
}

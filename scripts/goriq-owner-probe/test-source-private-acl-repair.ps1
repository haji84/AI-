param([switch]$CompileOnly)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$repair=Join-Path $repo 'scripts/goriq-source-private-acl-repair.cs'
if(-not (Test-Path -LiteralPath $repair -PathType Leaf)){throw 'SOURCE_PRIVATE_REPAIR_MISSING_IMPLEMENTATION'}
$source=[IO.File]::ReadAllText((Join-Path $repo 'scripts/goriq-zbook-bridge-capture.cs'))+"`n"+[IO.File]::ReadAllText($repair)+"`n"+@'
public static class GoriqSourcePrivateRepairTests {
 static int checks;
 static void Check(bool ok,string name){if(!ok)throw new Exception("SOURCE_PRIVATE_REPAIR_TEST_FAILED:"+name);checks++;}
 static void Refuses(Action action,string code,string name){try{action();}catch(GoriqSourcePrivateAclRepair.Refusal e){Check(e.Code==code,name+"_CODE");return;}throw new Exception("SOURCE_PRIVATE_REPAIR_TEST_FAILED:"+name+"_ACCEPTED");}
 sealed class Fake:GoriqSourcePrivateAclRepair.IExecutionStore {
  internal DateTime Clock=new DateTime(2026,11,18,15,0,0,DateTimeKind.Utc);
  internal bool Claimed,Baseline,Extra,Drift,FailSet,FailAfterJournal,FailIntent,ExpiryAfterFirst,FailRollback,ExpireInIntent,ChangeUntouchedOnFailure,NewChildAfterFirst,RefreshPlanHash,ChangeUntouchedAfterFirst;
  internal int Writes,Restores,Claims;internal bool FailDispose,UnattributedOnFirst;internal GoriqSourcePrivateAclRepair.Plan PreflightPlan;
  public GoriqSourcePrivateAclRepair.Plan Preflight(){return PreflightPlan;}
  public void Dispose(){if(FailDispose)throw new IOException("untrusted exception detail");}
  internal List<string> Events=new List<string>();
  internal Dictionary<string,GoriqSourcePrivateAclRepair.Snapshot> Values=new Dictionary<string,GoriqSourcePrivateAclRepair.Snapshot>();
  public DateTime UtcNow {get{return Clock;}}
  public void Claim(){Claims++;if(Claimed)throw new GoriqSourcePrivateAclRepair.Refusal("SCOPE_CONSUMED");Claimed=true;Events.Add("CLAIM");}
  public void SaveBaseline(GoriqSourcePrivateAclRepair.Plan p){Baseline=true;Events.Add("BASELINE");if(RefreshPlanHash)p.PlanHash=new string('c',64);}
  public bool Validate(GoriqSourcePrivateAclRepair.Plan p,bool rollback){if(Drift)throw new GoriqSourcePrivateAclRepair.Refusal("IDENTITY_DRIFT");if(Extra&&!rollback)throw new GoriqSourcePrivateAclRepair.Refusal("INVENTORY_DRIFT");return !Extra;}
  public GoriqSourcePrivateAclRepair.Snapshot Read(GoriqSourcePrivateAclRepair.Item i){return Values[i.Role];}
  public void Write(GoriqSourcePrivateAclRepair.Item i,GoriqSourcePrivateAclRepair.Snapshot s){Check(Claimed&&Baseline,"NO_WRITE_BEFORE_BACKUP");if(UnattributedOnFirst){Values[i.Role]=new GoriqSourcePrivateAclRepair.Snapshot{Key="UNATTRIBUTED"};throw new GoriqSourcePrivateAclRepair.Refusal("SET_FAILED");}Events.Add("WRITE_"+i.Role+"_"+s.Key);if(FailSet&&i.Role=="DB"&&s==i.After){if(ChangeUntouchedOnFailure)Values["DB"]=new GoriqSourcePrivateAclRepair.Snapshot{Key="CONCURRENT"};throw new GoriqSourcePrivateAclRepair.Refusal("SET_FAILED");}if(FailRollback&&s==i.Before)throw new GoriqSourcePrivateAclRepair.Refusal("SET_FAILED");Values[i.Role]=s;if(s==i.Before)Restores++;else Writes++;if(ChangeUntouchedAfterFirst&&Writes==1)Values["DB"]=new GoriqSourcePrivateAclRepair.Snapshot{Key="CONCURRENT"};if(NewChildAfterFirst&&Writes==1)Extra=true;if(ExpiryAfterFirst&&Writes==1)Clock=new DateTime(2026,11,20,7,0,0,DateTimeKind.Utc);}
  public void Journal(string phase,GoriqSourcePrivateAclRepair.Item item,GoriqSourcePrivateAclRepair.Snapshot observed){Events.Add(phase+"_"+(item==null?"ALL":item.Role));if(ExpireInIntent&&phase=="INTENT")Clock=new DateTime(2026,11,20,7,0,0,DateTimeKind.Utc);if((FailAfterJournal&&phase=="APPLIED")||(FailIntent&&phase=="INTENT"))throw new GoriqSourcePrivateAclRepair.Refusal("JOURNAL_FAILED");}
 }
 static GoriqSourcePrivateAclRepair.Plan Fixture(Fake store){
  var p=new GoriqSourcePrivateAclRepair.Plan();p.PlanHash=new string('a',64);p.ImplementationHash=new string('b',64);p.BackupId="1219-source-acl-42-1";
  foreach(string role in new[]{"SOURCE","SIDECAR","DB"}){var i=new GoriqSourcePrivateAclRepair.Item{Role=role,Directory=role!="DB",Root=role=="SOURCE",Identity=role,Before=new GoriqSourcePrivateAclRepair.Snapshot{Key=role+"_BEFORE"},After=new GoriqSourcePrivateAclRepair.Snapshot{Key=role+"_AFTER"}};p.Items.Add(i);store.Values.Add(role,i.Before);}return p;
 }
 static void JournalRecords(){
  string path=Path.Combine(Path.GetTempPath(),"goriq-acl-journal-"+Guid.NewGuid().ToString("N"));byte[] payload=Encoding.ASCII.GetBytes("synthetic journal payload");
  try{using(var stream=new FileStream(path,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None)){
   long bytes=GoriqSourcePrivateAclRepair.NativeStore.AppendVerifiedRecord(stream,payload,delegate(byte[] value){return (byte[])value.Clone();},delegate(byte[] value){return (byte[])value.Clone();},0);
   Check(bytes==payload.Length+4&&stream.Position==bytes&&stream.Length==bytes,"JOURNAL_RECORD_READBACK");
   Refuses(delegate{GoriqSourcePrivateAclRepair.NativeStore.AppendVerifiedRecord(stream,payload,delegate(byte[] value){return (byte[])value.Clone();},delegate(byte[] value){return new byte[]{0};},bytes);},"JOURNAL_READBACK","JOURNAL_DECRYPT_MISMATCH");
   Refuses(delegate{GoriqSourcePrivateAclRepair.NativeStore.AppendVerifiedRecord(stream,payload,delegate(byte[] value){return (byte[])value.Clone();},delegate(byte[] value){return (byte[])value.Clone();},2097152);},"JOURNAL_BOUND","JOURNAL_BOUNDED");
  }}finally{if(File.Exists(path))File.Delete(path);}
 }
 static void Portable(){
  Refuses(delegate{GoriqSourcePrivateAclRepair.Approval("42","1","bad",new DateTime(2026,11,18,15,0,0,DateTimeKind.Utc));},"SCOPE_MISMATCH","SCOPE_BINDING");
  foreach(string run in new[]{"","0","01","-1","42\n","1/2",new string('1',21)})Refuses(delegate{GoriqSourcePrivateAclRepair.Approval(run,"1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,18,15,0,0,DateTimeKind.Utc));},"RUN_CONTEXT","RUN_CLOSED");
  Refuses(delegate{GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,20,6,0,1,DateTimeKind.Utc));},"APPROVAL_EXPIRED","EXPIRY");
  Refuses(delegate{GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,18,14,38,0,DateTimeKind.Utc));},"APPROVAL_NOT_YET_VALID","NOT_BEFORE");
  GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,18,16,58,55,DateTimeKind.Utc).AddTicks(2553670));Check(true,"EXTENDED_WINDOW_ACCEPTS_FORMER_EXPIRY");
  GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,20,6,0,0,DateTimeKind.Utc).AddTicks(-1));Check(true,"EXTENSION_LAST_TICK_ACCEPTED");
  Refuses(delegate{GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,20,6,0,0,DateTimeKind.Utc));},"APPROVAL_EXPIRED","EXTENSION_EXACT_BOUNDARY_REFUSED");
  Refuses(delegate{GoriqSourcePrivateAclRepair.Approval("42","1",GoriqSourcePrivateAclRepair.ScopeHash,new DateTime(2026,11,20,6,0,0,DateTimeKind.Utc).AddTicks(1));},"APPROVAL_EXPIRED","EXTENSION_AFTER_BOUNDARY_REFUSED");
  Check(!GoriqSourcePrivateAclRepair.ReaderSid("S-1-5-21-01-2-3-4","S-1-5-21-1-2-3-9"),"NONCANONICAL_READER");
  Check(!GoriqSourcePrivateAclRepair.ReaderSid("S-1-5-21-1-2-3-9","S-1-5-21-1-2-3-9"),"SELF_READER");
  Check(GoriqSourcePrivateAclRepair.ReaderSid("S-1-5-21-1-2-3-4","S-1-5-21-1-2-3-9"),"CANONICAL_READER");
  foreach(string name in new[]{"compass.sqlite","compass.sqlite-wal","compass.sqlite-shm","compass.sqlite-journal","self-development"})Check(GoriqSourcePrivateAclRepair.AllowedLeaf(false,name),"ROOT_ALLOWED_"+name);
  foreach(string name in new[]{"other.db","compass.sqlite:evil","jobs.json","..","self-development.exe"})Check(!GoriqSourcePrivateAclRepair.AllowedLeaf(false,name),"ROOT_DENY_"+name);
  Check(GoriqSourcePrivateAclRepair.AllowedLeaf(true,"jobs.json")&&GoriqSourcePrivateAclRepair.AllowedLeaf(true,"change-sets.json")&&!GoriqSourcePrivateAclRepair.AllowedLeaf(true,"nested"),"SIDECAR_NAMES");
  Check(GoriqSourcePrivateAclRepair.TrustedFullControl(2032127,3,true)&&GoriqSourcePrivateAclRepair.TrustedFullControl(2032127,19,true),"DIRECTORY_FULL_PROPAGATES");
  foreach(int flags in new[]{0,1,2,8,11,16,17,18,31})Check(!GoriqSourcePrivateAclRepair.TrustedFullControl(2032127,flags,true),"DIRECTORY_NONPROPAGATING_FULL_REFUSED_"+flags);
  Check(GoriqSourcePrivateAclRepair.TrustedFullControl(2032127,0,false)&&GoriqSourcePrivateAclRepair.TrustedFullControl(2032127,16,false)&&!GoriqSourcePrivateAclRepair.TrustedFullControl(1179817,16,false),"FILE_EFFECTIVE_FULL_CONTROL");
  var ok=new Fake();var plan=Fixture(ok);var result=GoriqSourcePrivateAclRepair.Transact(plan,ok,false);Check(result.Status=="PLANNED"&&ok.Claims==0&&!ok.Baseline&&ok.Writes==0,"PLAN_INERT");
  result=GoriqSourcePrivateAclRepair.Transact(plan,ok,true);Check(result.Status=="APPLIED"&&ok.Writes==3&&ok.Restores==0,"APPLY_SUCCESS");Check(ok.Events.IndexOf("BASELINE")<ok.Events.IndexOf("INTENT_SOURCE")&&ok.Events.IndexOf("INTENT_SOURCE")<ok.Events.IndexOf("WRITE_SOURCE_SOURCE_AFTER"),"DURABLE_ORDER");
  result=GoriqSourcePrivateAclRepair.Transact(plan,ok,true);Check(result.Status=="REFUSED"&&result.Reason=="SCOPE_CONSUMED"&&ok.Writes==3,"ONE_SCOPE_REPLAY");
  var pre=new Fake{FailIntent=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(pre),pre,true);Check(pre.Claimed&&pre.Writes==0&&result.Status=="REFUSED","INTENT_JOURNAL_BEFORE_WRITE");
  var fail=new Fake{FailSet=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(fail),fail,true);Check(result.Status=="ROLLED_BACK"&&fail.Writes==2&&fail.Restores==2,"PARTIAL_ROLLBACK");Check(fail.Events.IndexOf("WRITE_SOURCE_SOURCE_BEFORE")<fail.Events.IndexOf("WRITE_SIDECAR_SIDECAR_BEFORE"),"PARENT_FIRST_ROLLBACK");
  var expiry=new Fake{ExpiryAfterFirst=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(expiry),expiry,true);Check(result.Status=="ROLLED_BACK"&&expiry.Writes==1&&expiry.Restores==1,"EXPIRY_PREVENTS_NEXT_WRITE_ROLLBACK_ALLOWED");
  var stale=new Fake();var stalePlan=Fixture(stale);stale.Values["SOURCE"]=new GoriqSourcePrivateAclRepair.Snapshot{Key="CONCURRENT"};result=GoriqSourcePrivateAclRepair.Transact(stalePlan,stale,true);Check(stale.Writes==0&&result.Reason=="DESCRIPTOR_DRIFT","CONCURRENT_BEFORE_WRITE");
  var broken=new Fake{FailSet=true,FailRollback=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(broken),broken,true);Check(result.Status=="INCOMPLETE"&&result.ManualRecovery,"ROLLBACK_FAILURE_VISIBLE");
  var drift=new Fake{Drift=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(drift),drift,true);Check(drift.Writes==0&&result.Reason=="IDENTITY_DRIFT","REPLACED_OBJECT_NO_WRITE");
  var extra=new Fake{Extra=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(extra),extra,true);Check(extra.Writes==0&&result.Reason=="INVENTORY_DRIFT","UNKNOWN_CHILD_NO_WRITE");
  var post=new Fake{FailAfterJournal=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(post),post,true);Check(result.Status=="ROLLED_BACK"&&post.Restores==1,"POSTWRITE_JOURNAL_ERROR_ROLLS_BACK");
  var immediateExpiry=new Fake{ExpireInIntent=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(immediateExpiry),immediateExpiry,true);Check(immediateExpiry.Writes==0&&result.Reason=="APPROVAL_EXPIRED","EXPIRY_IMMEDIATELY_BEFORE_SET");
  var untouched=new Fake{FailSet=true,ChangeUntouchedOnFailure=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(untouched),untouched,true);Check(result.Status=="INCOMPLETE"&&result.ManualRecovery&&untouched.Restores==0,"UNTOUCHED_DRIFT_STOPS_ROLLBACK");
  var untouchedEarly=new Fake{ChangeUntouchedAfterFirst=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(untouchedEarly),untouchedEarly,true);Check(result.Status=="INCOMPLETE"&&untouchedEarly.Restores==0,"UNATTEMPTED_DRIFT_STOPS_ROLLBACK");
  var newChild=new Fake{NewChildAfterFirst=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(newChild),newChild,true);Check(result.Status=="INCOMPLETE"&&result.ManualRecovery&&newChild.Restores==0&&!result.GlobalRestoreComplete,"NEW_CHILD_STOPS_ROLLBACK");
  var refreshed=new Fake{RefreshPlanHash=true};result=GoriqSourcePrivateAclRepair.Transact(Fixture(refreshed),refreshed,true);Check(result.PlanHash==new string('c',64),"ACTUAL_FROZEN_PLAN_HASH_REPORTED");
  var noop=new Fake();var noopPlan=Fixture(noop);noopPlan.Items[1].After=noopPlan.Items[1].Before;result=GoriqSourcePrivateAclRepair.Transact(noopPlan,noop,true);Check(result.Status=="APPLIED"&&noop.Writes==2,"ALREADY_PRIVATE_CHILD_NOT_WRITTEN");
  var closeFailure=new Fake{FailDispose=true};closeFailure.PreflightPlan=Fixture(closeFailure);result=GoriqSourcePrivateAclRepair.ExecuteStore(true,delegate{return closeFailure;});Check(result.Status=="INCOMPLETE"&&result.Reason=="FINALIZATION_FAILED"&&result.ManualRecovery&&!result.GlobalRestoreComplete&&result.Changed==3&&result.Restored==0&&result.Planned==3&&result.BackupId=="1219-source-acl-42-1"&&result.PlanHash==new string('a',64)&&result.ImplementationHash==new string('b',64),"FINALIZATION_PRESERVES_APPLIED_HISTORY");
  var restoredCloseFailure=new Fake{FailSet=true,FailDispose=true};restoredCloseFailure.PreflightPlan=Fixture(restoredCloseFailure);result=GoriqSourcePrivateAclRepair.ExecuteStore(true,delegate{return restoredCloseFailure;});Check(result.Status=="INCOMPLETE"&&result.ManualRecovery&&result.Changed==2&&result.Restored==2&&!result.GlobalRestoreComplete&&result.BackupId=="1219-source-acl-42-1","FINALIZATION_PRESERVES_ROLLBACK_HISTORY");
  var uncertainCloseFailure=new Fake{UnattributedOnFirst=true,FailDispose=true};uncertainCloseFailure.PreflightPlan=Fixture(uncertainCloseFailure);result=GoriqSourcePrivateAclRepair.ExecuteStore(true,delegate{return uncertainCloseFailure;});Check(result.Status=="INCOMPLETE"&&result.ManualRecovery&&result.Changed==0&&result.Planned==3&&result.BackupId=="1219-source-acl-42-1","FINALIZATION_PRESERVES_UNATTRIBUTED_WRITE_HISTORY");
  var cleanClose=new Fake();cleanClose.PreflightPlan=Fixture(cleanClose);result=GoriqSourcePrivateAclRepair.ExecuteStore(true,delegate{return cleanClose;});Check(result.Status=="APPLIED"&&result.Changed==3&&!result.ManualRecovery,"CLEAN_FINALIZATION_PRESERVES_SUCCESS");
  result=GoriqSourcePrivateAclRepair.ExecuteStore(true,delegate{throw new GoriqSourcePrivateAclRepair.Refusal("CURRENT_IDENTITY");});Check(result.Status=="REFUSED"&&result.Changed==0&&result.Reason=="CURRENT_IDENTITY"&&!result.ManualRecovery,"CONSTRUCTOR_FAILURE_IS_READONLY_REFUSAL");
  string json=result.Json();Check(!json.Contains("S-1-")&&!json.Contains("\\")&&json.Contains("\"consistency\":\"LIVE_SAMPLED\"")&&json.Contains("\"originalDataPreservationVerified\":false"),"SANITIZED_BOUNDED_RESULT");
  if(Environment.OSVersion.Platform!=PlatformID.Win32NT){string refused=GoriqSourcePrivateAclRepair.Execute(true,"42","1",GoriqSourcePrivateAclRepair.ScopeHash);Check(refused.Contains("WINDOWS_REQUIRED"),"NONWINDOWS_INERT");}
 }
 static RawSecurityDescriptor Descriptor(string user,string reader,bool directory,bool root,bool protect){
  var acl=new RawAcl(2,4);AceFlags flags=directory?(AceFlags)19:(AceFlags)16;
  foreach(string sid in new[]{user,"S-1-5-18","S-1-5-32-544"})acl.InsertAce(acl.Count,new CommonAce(flags,AceQualifier.AccessAllowed,2032127,new SecurityIdentifier(sid),false,null));
  if(reader!=null)acl.InsertAce(acl.Count,new CommonAce(flags,AceQualifier.AccessAllowed,1179817,new SecurityIdentifier(reader),false,null));
  return new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent|ControlFlags.SelfRelative|ControlFlags.DiscretionaryAclAutoInherited|(protect?ControlFlags.DiscretionaryAclProtected:0),new SecurityIdentifier(user),new SecurityIdentifier(user),null,acl);
 }
 static void Planner(){
  string user="S-1-5-21-1-2-3-1001",reader="S-1-5-21-1-2-3-1002";
  var root=Descriptor(user,reader,true,true,false);var before=GoriqSourcePrivateAclRepair.FromDescriptor(root);var after=GoriqSourcePrivateAclRepair.BuildAfter(before,user,reader,true,true,true);
  Check(after.Protected&&after.Descriptor.DiscretionaryAcl.Count==3,"ROOT_PRIVATE_BOUNDARY");foreach(GenericAce ace in after.Descriptor.DiscretionaryAcl)Check((int)ace.AceFlags==3,"ROOT_TRUSTED_INHERITED_TO_EXPLICIT");
  Check(after.Descriptor.Owner.Value==user&&after.Descriptor.Group.Value==user&&root.DiscretionaryAcl.Count==4,"OWNER_GROUP_AND_INPUT_PRESERVED");
  foreach(bool protect in new[]{true,false}){var child=GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(Descriptor(user,reader,false,false,protect)),user,reader,false,false,false);Check(child.Protected==protect&&child.Descriptor.DiscretionaryAcl.Count==3,"CHILD_PROTECTION_PRESERVED");foreach(GenericAce ace in child.Descriptor.DiscretionaryAcl)Check((int)ace.AceFlags==16,"CHILD_INHERITED_FLAG_PRESERVED");}
  Check(GoriqSourcePrivateAclRepair.SelectReader(before,user)==reader,"UNIQUE_READER_SELECTED");
  var defaulted=Descriptor(user,reader,true,true,false);defaulted.SetFlags(defaulted.ControlFlags|ControlFlags.OwnerDefaulted);Check(!GoriqSourcePrivateAclRepair.Same(before,GoriqSourcePrivateAclRepair.FromDescriptor(defaulted)),"CONTROL_DEFAULTED_DRIFT_OBSERVED");
  var unsupported=Descriptor(user,reader,true,true,false);unsupported.SetFlags(unsupported.ControlFlags|ControlFlags.DiscretionaryAclAutoInheritRequired);Refuses(delegate{GoriqSourcePrivateAclRepair.FromDescriptor(unsupported);},"DESCRIPTOR_FLAGS","UNSUPPORTED_CONTROL_FLAG");
  var ambiguous=Descriptor(user,reader,true,true,false);ambiguous.DiscretionaryAcl.InsertAce(4,new CommonAce((AceFlags)19,AceQualifier.AccessAllowed,1179817,new SecurityIdentifier("S-1-5-21-1-2-3-1003"),false,null));Refuses(delegate{GoriqSourcePrivateAclRepair.SelectReader(GoriqSourcePrivateAclRepair.FromDescriptor(ambiguous),user);},"READER_AMBIGUOUS","AMBIGUOUS_READER");
  foreach(int flags in new[]{0,1,2,3,17,18,20,23,27,31,80,144}){var invalid=Descriptor(user,null,false,false,false);invalid.DiscretionaryAcl.InsertAce(3,new CommonAce((AceFlags)flags,AceQualifier.AccessAllowed,1179817,new SecurityIdentifier(reader),false,null));Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(invalid),user,reader,false,false,true);},"ACE_SHAPE","FILE_READER_FLAG_"+flags);}
  foreach(int mask in new[]{1,1179816,1179819,2032127,unchecked((int)0x80000000),0x2000000}){var invalid=Descriptor(user,null,false,false,false);invalid.DiscretionaryAcl.InsertAce(3,new CommonAce((AceFlags)16,AceQualifier.AccessAllowed,mask,new SecurityIdentifier(reader),false,null));Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(invalid),user,reader,false,false,true);},"READER_GRANT","READER_MASK_"+mask);}
  var denied=Descriptor(user,null,false,false,false);denied.DiscretionaryAcl.InsertAce(3,new CommonAce((AceFlags)16,AceQualifier.AccessDenied,1,new SecurityIdentifier(reader),false,null));Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(denied),user,reader,false,false,false);},"ACE_SHAPE","DENY_UNSUPPORTED");
  var owner=Descriptor("S-1-5-18",reader,true,true,false);Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(owner),user,reader,true,true,true);},"SOURCE_OWNER","NONCURRENT_OWNER");
  foreach(int flags in new[]{0,16}){var side=Descriptor(user,reader,true,false,false);for(int index=0;index<3;index++)side.DiscretionaryAcl[index].AceFlags=(AceFlags)flags;Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(side),user,reader,true,false,true);},"TRUSTED_GRANTS","SIDECAR_FUTURE_DEFAULT_REQUIRED_"+flags);}
  var weak=Descriptor(user,reader,true,true,false);weak.DiscretionaryAcl.RemoveAce(0);Refuses(delegate{GoriqSourcePrivateAclRepair.BuildAfter(GoriqSourcePrivateAclRepair.FromDescriptor(weak),user,reader,true,true,true);},"TRUSTED_GRANTS","FULL_CONTROL_REQUIRED");
 }
 [StructLayout(LayoutKind.Sequential)] struct FixtureAttributes{public int Length;public IntPtr Descriptor;public int Inherit;}
 [DllImport("kernel32.dll",EntryPoint="CreateDirectoryW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern bool FixtureDirectory(string path,ref FixtureAttributes attributes);
 [DllImport("kernel32.dll",EntryPoint="CreateFileW",CharSet=CharSet.Unicode,ExactSpelling=true,SetLastError=true)] static extern SafeFileHandle FixtureFile(string path,uint access,uint share,ref FixtureAttributes attributes,uint mode,uint flags,IntPtr template);
 static void OwnedInheriting(string path,bool directory,string user){
  var sd=new RawSecurityDescriptor(ControlFlags.SelfRelative,new SecurityIdentifier(user),null,null,null);byte[] bytes=new byte[sd.BinaryLength];sd.GetBinaryForm(bytes,0);GCHandle pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);
  try{var attributes=new FixtureAttributes{Length=Marshal.SizeOf(typeof(FixtureAttributes)),Descriptor=pin.AddrOfPinnedObject()};if(directory)Check(FixtureDirectory(path,ref attributes),"FIXTURE_CREATE_OWNED_DIRECTORY");else using(var handle=FixtureFile(path,0xC0020080,7,ref attributes,1,0x02200000,IntPtr.Zero)){Check(handle!=null&&!handle.IsInvalid,"FIXTURE_CREATE_OWNED_FILE");}}
  finally{pin.Free();}
 }
 static bool FixtureAclSame(GoriqSourcePrivateAclRepair.Snapshot first,GoriqSourcePrivateAclRepair.Snapshot second){
  byte[] a=new byte[first.Descriptor.DiscretionaryAcl.BinaryLength],b=new byte[second.Descriptor.DiscretionaryAcl.BinaryLength];first.Descriptor.DiscretionaryAcl.GetBinaryForm(a,0);second.Descriptor.DiscretionaryAcl.GetBinaryForm(b,0);return GoriqSourcePrivateAclRepair.Equal(a,b);
 }
 static void FixtureParentUnchanged(GoriqSourcePrivateAclRepair.Item parent,GoriqSourcePrivateAclRepair.Snapshot baseline,string phase){
  var live=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(parent);bool same=GoriqSourcePrivateAclRepair.Same(live,baseline);
  if(!same)Console.WriteLine("SOURCE_PRIVATE_REPAIR_FIXTURE_PARENT_DRIFT phase="+phase+" expectedControl="+(int)baseline.Descriptor.ControlFlags+" observedControl="+(int)live.Descriptor.ControlFlags+" ownerEqual="+baseline.Descriptor.Owner.Equals(live.Descriptor.Owner)+" groupEqual="+baseline.Descriptor.Group.Equals(live.Descriptor.Group)+" aclEqual="+FixtureAclSame(baseline,live));
  Check(same,"NATIVE_PARENT_UNCHANGED_"+phase);
 }
 static void Native(){
  string user;using(var identity=WindowsIdentity.GetCurrent()){user=identity.User.Value;Check(!identity.IsSystem,"FIXTURE_NON_SYSTEM");}
  string root=Path.Combine(Path.GetTempPath(),"goriq-acl-transaction-"+Guid.NewGuid().ToString("N"));string reader="S-1-5-21-4000000001-4000000002-4000000003-59999";
  var items=new List<GoriqSourcePrivateAclRepair.Item>();
  try{
   GoriqSourcePrivateAclRepair.NativeStore.CreatePrivateDirectory(root,user);var outer=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(root,true,true);items.Add(outer);
   using(var readOnly=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(root,true,false).Handle){var readItem=new GoriqSourcePrivateAclRepair.Item{Path=root,Directory=true,Handle=readOnly};Refuses(delegate{GoriqSourcePrivateAclRepair.NativeStore.WriteNative(readItem,GoriqSourcePrivateAclRepair.NativeStore.ReadNative(readItem));},"WRITE_SCOPE","NATIVE_NON_MAXIMUM_HANDLE_REFUSED");}
   Refuses(delegate{GoriqSourcePrivateAclRepair.NativeStore.OpenNative(Path.Combine(root,".."),true,true);},"CANONICAL_PATH","NATIVE_DOT_PATH_REFUSED");
   var original=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(outer);var extended=new RawAcl(2,4);foreach(GenericAce ace in original.Descriptor.DiscretionaryAcl)extended.InsertAce(extended.Count,ace);extended.InsertAce(extended.Count,new CommonAce((AceFlags)3,AceQualifier.AccessAllowed,1179817,new SecurityIdentifier(reader),false,null));
   var outerRead=GoriqSourcePrivateAclRepair.FromDescriptor(new RawSecurityDescriptor(original.Descriptor.ControlFlags,original.Descriptor.Owner,original.Descriptor.Group,null,extended));GoriqSourcePrivateAclRepair.NativeStore.WriteNative(outer,outerRead);
   // A setup write may normalize SE_DACL_AUTO_INHERITED. Record the actual
   // completed setup state, as the existing native boundary proof does.
   var outerBaseline=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(outer);int setupControlDifference=(int)(outerRead.Descriptor.ControlFlags^outerBaseline.Descriptor.ControlFlags);
   Console.WriteLine("SOURCE_PRIVATE_REPAIR_FIXTURE_PARENT_SETUP intendedControl="+(int)outerRead.Descriptor.ControlFlags+" observedControl="+(int)outerBaseline.Descriptor.ControlFlags+" controlXor="+setupControlDifference+" ownerEqual="+outerRead.Descriptor.Owner.Equals(outerBaseline.Descriptor.Owner)+" groupEqual="+outerRead.Descriptor.Group.Equals(outerBaseline.Descriptor.Group)+" aclEqual="+FixtureAclSame(outerRead,outerBaseline));
   Check(outerRead.Descriptor.Owner.Equals(outerBaseline.Descriptor.Owner)&&outerRead.Descriptor.Group.Equals(outerBaseline.Descriptor.Group),"NATIVE_PARENT_SETUP_OWNER_GROUP");
   Check(FixtureAclSame(outerRead,outerBaseline),"NATIVE_PARENT_SETUP_EXACT_DACL");Check((setupControlDifference&~(int)ControlFlags.DiscretionaryAclAutoInherited)==0&&outerBaseline.Protected,"NATIVE_PARENT_SETUP_CONTROL");
   string source=Path.Combine(root,"Source");OwnedInheriting(source,true,user);var sourceItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(source,true,true);sourceItem.Root=true;items.Add(sourceItem);
   string db=Path.Combine(source,"compass.sqlite");OwnedInheriting(db,false,user);var dbItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(db,false,true);items.Add(dbItem);
   string sidePath=Path.Combine(source,"self-development");OwnedInheriting(sidePath,true,user);var sideItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(sidePath,true,true);items.Add(sideItem);string jobsPath=Path.Combine(sidePath,"jobs.json");OwnedInheriting(jobsPath,false,user);var jobsItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(jobsPath,false,true);items.Add(jobsItem);var sideBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sideItem);var jobsBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(jobsItem);var sideAfter=GoriqSourcePrivateAclRepair.BuildAfter(sideBefore,user,reader,true,false,true);
   var sourceBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sourceItem);var dbBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(dbItem);var sourceAfter=GoriqSourcePrivateAclRepair.BuildAfter(sourceBefore,user,reader,true,true,true);var dbAfter=GoriqSourcePrivateAclRepair.BuildAfter(dbBefore,user,reader,false,false,true);
   GoriqSourcePrivateAclRepair.NativeStore.WriteNative(sourceItem,sourceAfter);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sourceItem),sourceAfter),"NATIVE_ROOT_EXACT_AFTER");Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(dbItem),dbBefore),"NATIVE_NO_EXISTING_CHILD_PROPAGATION");
   FixtureParentUnchanged(outer,outerBaseline,"SOURCE_CHANGE");
   string future=Path.Combine(source,"future.txt");OwnedInheriting(future,false,user);var futureItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(future,false,true);items.Add(futureItem);var futureBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(futureItem);Check(futureBefore.Descriptor.DiscretionaryAcl.Count==3&&!futureBefore.Protected,"NATIVE_FUTURE_PRIVATE_DEFAULT");
   FixtureParentUnchanged(outer,outerBaseline,"SOURCE_FUTURE");
   GoriqSourcePrivateAclRepair.NativeStore.WriteNative(sideItem,sideAfter);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sideItem),sideAfter)&&!sideAfter.Protected,"NATIVE_SIDECAR_PROTECTION_PRESERVED");Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(jobsItem),jobsBefore),"NATIVE_SIDECAR_NO_EXISTING_CHILD_PROPAGATION");string sideFuture=Path.Combine(sidePath,"future.txt");OwnedInheriting(sideFuture,false,user);var sideFutureItem=GoriqSourcePrivateAclRepair.NativeStore.OpenNative(sideFuture,false,true);items.Add(sideFutureItem);var sideFutureBefore=GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sideFutureItem);Check(sideFutureBefore.Descriptor.DiscretionaryAcl.Count==3&&!sideFutureBefore.Protected,"NATIVE_SIDECAR_FUTURE_PRIVATE_DEFAULT");
   FixtureParentUnchanged(outer,outerBaseline,"SIDECAR_AND_FUTURE");
   GoriqSourcePrivateAclRepair.NativeStore.WriteNative(dbItem,dbAfter);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(dbItem),dbAfter),"NATIVE_FILE_EXACT_AFTER");
   FixtureParentUnchanged(outer,outerBaseline,"FILE_CHANGE");
   GoriqSourcePrivateAclRepair.NativeStore.WriteNative(sourceItem,sourceBefore);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sourceItem),sourceBefore),"NATIVE_PARENT_EXACT_ROLLBACK");GoriqSourcePrivateAclRepair.NativeStore.WriteNative(sideItem,sideBefore);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sideItem),sideBefore),"NATIVE_SIDECAR_EXACT_ROLLBACK");Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(sideFutureItem),sideFutureBefore),"NATIVE_SIDECAR_FUTURE_UNCHANGED_ON_ROLLBACK");GoriqSourcePrivateAclRepair.NativeStore.WriteNative(dbItem,dbBefore);Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(dbItem),dbBefore),"NATIVE_CHILD_EXACT_ROLLBACK");
   Check(GoriqSourcePrivateAclRepair.Same(GoriqSourcePrivateAclRepair.NativeStore.ReadNative(futureItem),futureBefore),"NATIVE_FUTURE_RESTORE_INCOMPLETE");FixtureParentUnchanged(outer,outerBaseline,"FINAL");
   byte[] plain=Encoding.UTF8.GetBytes("new fixture baseline");Check(GoriqSourcePrivateAclRepair.Equal(plain,GoriqSourcePrivateAclRepair.NativeStore.Unprotect(GoriqSourcePrivateAclRepair.NativeStore.Protect(plain))),"NATIVE_CURRENTUSER_DPAPI_READBACK");
  }finally{foreach(var item in items)item.Handle.Dispose();if(Directory.Exists(root)){string source=Path.Combine(root,"Source");foreach(string name in new[]{"compass.sqlite","future.txt"})if(File.Exists(Path.Combine(source,name)))File.Delete(Path.Combine(source,name));string side=Path.Combine(source,"self-development");foreach(string name in new[]{"jobs.json","future.txt"})if(File.Exists(Path.Combine(side,name)))File.Delete(Path.Combine(side,name));if(Directory.Exists(side))Directory.Delete(side,false);if(Directory.Exists(source))Directory.Delete(source,false);Directory.Delete(root,false);}}
 }
 public static int Run(bool windows){checks=0;Portable();JournalRecords();if(windows){Planner();Native();}return checks;}
}
'@
if($PSVersionTable.PSVersion.Major -eq 5){$null=Add-Type -TypeDefinition $source -Language CSharp}
else{$null=Add-Type -TypeDefinition $source -Language CSharp -CompilerOptions '/langversion:5'}
$checks=[GoriqSourcePrivateRepairTests]::Run((-not $CompileOnly)-and([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT))
Write-Output ('SOURCE_PRIVATE_REPAIR_PORTABLE_PASS='+$checks)
if($CompileOnly){Write-Output 'SOURCE_PRIVATE_REPAIR_COMPILE_PASS=1'}
elseif([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){Write-Output 'SOURCE_PRIVATE_REPAIR_WINDOWS_PASS=1'}
else{throw 'SOURCE_PRIVATE_REPAIR_WINDOWS_REQUIRED'}

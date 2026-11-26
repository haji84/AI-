"""Fixed two-leaf descriptor worker for the approved Issue1219 repair.

Only a trusted parent entry supplies requests on a private pipe. The production
entry is Darwin-only; importing this core has no I/O. No DB contents leave the
worker, no pathname chmod, and no existing file/directory deletion or recreation.
fchmod pins identity, not an atomic CAS over every fact: recheck synchronously
before the syscall and verify afterward; uncertainty never authorizes rollback.
"""
import copy
import ctypes
import hashlib
import json
import os
import re
import stat
import sys
import time

LABELS = ('owner-config-file', 'mac-canonical-repo-default')
MAX_BYTES = 64 * 1024 * 1024
MAX_FRAME = 256 * 1024
HASH = re.compile(r'^[a-f0-9]{64}$')
SHA = re.compile(r'^[a-f0-9]{40}$')
SCOPE_KEYS = {'sourceRevision','artifactDigest','hostId','ownerUid','expiresAt'}
PHASES = {'PLANNED','BASELINE','MODE_INTENT','MODE_APPLIED','APPLIED',
          'ROLLBACK_INTENT','MODE_RESTORED'}


class Refusal(Exception):
    """Closed reason only; private OS exception text never crosses the pipe."""


def require(condition, reason='NATIVE_PRECONDITION_REFUSED'):
    if not condition:
        raise Refusal(reason)


def signature(value):
    return (value.st_dev,value.st_ino,value.st_uid,value.st_gid,value.st_mode,
            value.st_nlink,value.st_size,value.st_mtime_ns,value.st_ctime_ns)


def identity(value):
    return value.st_dev,value.st_ino


def matches_metadata(value, expected):
    return (str(value.st_dev),str(value.st_ino),value.st_uid,value.st_gid,
            stat.S_IMODE(value.st_mode),value.st_nlink,value.st_size,
            str(value.st_mtime_ns),str(value.st_ctime_ns)) == (
                expected['dev'],expected['ino'],expected['ownerUid'],expected['groupId'],
                expected['mode'],expected['nlink'],expected['sizeBytes'],
                expected['mtimeNs'],expected['ctimeNs'])


def encoded(value):
    return json.dumps(value,ensure_ascii=True,separators=(',',':'),sort_keys=True).encode('ascii')


def unique(pairs):
    result={}
    for key,value in pairs:
        require(key not in result,'DUPLICATE_JSON_KEY')
        result[key]=value
    return result


class DarwinMetadata:
    """SDK-built read-only functions, with owned ABI-compatible native objects."""
    def __init__(self, library):
        require(sys.platform=='darwin' and os.getuid()>0 and os.geteuid()==os.getuid(),
                'NATIVE_CONTEXT_REJECTED')
        self.lib=ctypes.CDLL(library,use_errno=True)
        for name in ('g1_fd_acl','g1_fd_alias'):
            fn=getattr(self.lib,name);fn.argtypes=[ctypes.c_int];fn.restype=ctypes.c_int
        self.lib.g1_fd_path.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong]
        self.lib.g1_fd_path.restype=ctypes.c_int

    def facts(self, fd, _path):
        buffer=ctypes.create_string_buffer(4096)
        require(self.lib.g1_fd_path(fd,buffer,len(buffer))==0,'NATIVE_PATH_UNAVAILABLE')
        acl=self.lib.g1_fd_acl(fd);alias=self.lib.g1_fd_alias(fd)
        value=os.fstat(fd)
        require(acl in (0,1,2) and alias in (0,1) and hasattr(value,'st_flags'),
                'NATIVE_METADATA_UNAVAILABLE')
        return {'path':os.fsdecode(buffer.value),'acl':acl,'alias':bool(alias),'flags':value.st_flags}


class NativeSession:
    """Retained-fd implementation; injected metadata is a code port, not JSON."""
    def __init__(self, *, scope, candidates, home, approval_id, session_id,
                 metadata, now=lambda:int(time.time()*1000)):
        require(type(scope) is dict and set(scope)==SCOPE_KEYS,'NATIVE_SCOPE_REFUSED')
        require(type(scope['ownerUid']) is int and scope['ownerUid']==os.getuid() and
                type(scope['expiresAt']) is int and isinstance(scope['hostId'],str) and
                0<len(scope['hostId'])<=128 and SHA.fullmatch(scope['sourceRevision']) and
                HASH.fullmatch(scope['artifactDigest']),'NATIVE_SCOPE_REFUSED')
        require(type(candidates) is list and len(candidates)==2 and
                [v.get('label') for v in candidates]==list(LABELS) and
                all(set(v)=={'label','path'} for v in candidates),'NATIVE_TARGETS_REFUSED')
        require(isinstance(approval_id,str) and HASH.fullmatch(approval_id) and
                isinstance(session_id,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}',session_id),
                'NATIVE_SESSION_REFUSED')
        require(os.path.isabs(home) and os.path.normpath(home)==home and
                os.path.realpath(home)==home,'NATIVE_HOME_REFUSED')
        self.scope=copy.deepcopy(scope);self.home=home;self.metadata=metadata;self.now=now
        self.approval_id=approval_id;self.session_id=session_id
        self.paths={v['label']:v['path'] for v in candidates}
        for path in self.paths.values():
            require(isinstance(path,str) and 0<len(path)<=2048 and '\0' not in path and
                    os.path.isabs(path) and os.path.normpath(path)==path and
                    os.path.commonpath([home,path])==home and path!=home,'NATIVE_TARGETS_REFUSED')
        self.descriptors=set();self.directories={};self.targets={};self.by_label={}
        self.journal_fd=None;self.record=None;self.planned=None;self.claimed=False
        self.closed=False;self.sequence=0;self.effect_count=0;self.confirmed={};self.restored=set()
        self.attempted=set();self.rollback_attempted=set();self.baseline_saved=False
        self.deadline()

    def deadline(self):
        current=self.now()
        require(type(current) is int and 0<=current<self.scope['expiresAt'] and
                self.scope['expiresAt']-current<=30*60*1000,'NATIVE_PERMIT_EXPIRED')

    def live(self):
        require(not self.closed,'NATIVE_SESSION_CLOSED');self.deadline()

    def keep(self, fd):
        self.descriptors.add(fd);return fd

    def drop(self, fd):
        if fd in self.descriptors:
            self.descriptors.remove(fd)
            os.close(fd)

    def open_descriptors(self):
        return tuple(self.descriptors)

    def directory_guard(self, fd, path):
        info=os.fstat(fd);extra=self.metadata.facts(fd,path)
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0,self.scope['ownerUid']) and
                not info.st_mode&0o022 and extra['path']==path and
                extra['acl'] in (0,1) and extra['alias'] is False,'NATIVE_PARENT_REFUSED')
        return info

    def directory(self, path):
        if path in self.directories:
            value=self.directories[path]
            self.directory_guard(value['fd'],path)
            return value['fd']
        if path=='/':
            fd=self.keep(os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
            parent=None;name=None
        else:
            parent_path,name=os.path.split(path)
            parent=self.directory(parent_path)
            try:
                fd=self.keep(os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent))
            except OSError:
                raise Refusal('NATIVE_PARENT_REFUSED') from None
        try:
            info=self.directory_guard(fd,path)
            if parent is not None:
                require(identity(info)==identity(os.stat(name,dir_fd=parent,follow_symlinks=False)),
                        'NATIVE_PARENT_CHANGED')
            self.directories[path]={'fd':fd,'parent':parent,'name':name,'identity':identity(info)}
            return fd
        except Exception:
            self.drop(fd);raise

    def parents_current(self, path):
        parent_path=os.path.dirname(path)
        while True:
            held=self.directories[parent_path]
            info=self.directory_guard(held['fd'],parent_path)
            require(identity(info)==held['identity'],'NATIVE_PARENT_CHANGED')
            if held['parent'] is not None:
                entry=os.stat(held['name'],dir_fd=held['parent'],follow_symlinks=False)
                require(stat.S_ISDIR(entry.st_mode) and identity(entry)==identity(info),
                        'NATIVE_PARENT_CHANGED')
            if parent_path=='/':break
            parent_path=os.path.dirname(parent_path)

    def leaf_guard(self, target):
        fd=target['fd'];path=target['path'];info=os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid==self.scope['ownerUid'] and
                info.st_nlink==1 and 0<info.st_size<=MAX_BYTES and
                not stat.S_IMODE(info.st_mode)&0o7000,'NATIVE_LEAF_REFUSED')
        entry=os.stat(target['name'],dir_fd=target['parent'],follow_symlinks=False)
        require(stat.S_ISREG(entry.st_mode) and signature(entry)==signature(info),
                'NATIVE_PATH_CHANGED')
        extra=self.metadata.facts(fd,path)
        require(extra['path']==path and os.path.realpath(path)==path and extra['acl']==0 and
                extra['flags']==0 and extra['alias'] is False,'NATIVE_METADATA_REFUSED')
        return info

    def snapshot(self, target, label=None):
        self.live();self.parents_current(target['path'])
        before=self.leaf_guard(target)
        hashed=hashlib.sha256();offset=0
        while offset<=MAX_BYTES:
            raw=os.pread(target['fd'],min(65536,MAX_BYTES+1-offset),offset)
            if not raw:break
            hashed.update(raw);offset+=len(raw)
        require(offset==before.st_size and offset<=MAX_BYTES,'NATIVE_BYTES_CHANGED')
        after=self.leaf_guard(target);self.parents_current(target['path']);self.deadline()
        require(signature(before)==signature(after),'NATIVE_FACTS_CHANGED')
        return dict(label=label or target['label'],path=target['path'],hostId=self.scope['hostId'],
                    ownerUid=after.st_uid,groupId=after.st_gid,dev=str(after.st_dev),ino=str(after.st_ino),
                    kind='file',nlink=after.st_nlink,sizeBytes=after.st_size,mode=stat.S_IMODE(after.st_mode),
                    sha256=hashed.hexdigest(),mtimeNs=str(after.st_mtime_ns),ctimeNs=str(after.st_ctime_ns),
                    canonical=True,parentsSafe=True,pathBound=True,withinOwnerHome=True,
                    symlink=False,alias=False,aclEmpty=True,flags=0)

    def capture(self, label):
        self.live();require(label in LABELS,'NATIVE_LABEL_REFUSED')
        if label in self.by_label:
            ident=self.by_label[label]
            return {'id':ident,'facts':self.snapshot(self.targets[ident],label)}
        path=self.paths[label];parent_path,name=os.path.split(path)
        parent=self.directory(parent_path)
        try:
            fd=self.keep(os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent))
        except OSError:
            raise Refusal('NATIVE_LEAF_REFUSED') from None
        target={'fd':fd,'parent':parent,'path':path,'name':name,'label':label}
        try:
            facts=self.snapshot(target,label)
            existing=next((key for key,value in self.targets.items()
                           if identity(os.fstat(value['fd']))==identity(os.fstat(fd))),None)
            if existing is not None:
                require(self.targets[existing]['path']==path,'NATIVE_IDENTITY_AMBIGUOUS')
                self.drop(fd);ident=existing
            else:
                ident=str(len(self.targets)+1);self.targets[ident]=target
            self.by_label[label]=ident
            return {'id':ident,'facts':facts}
        except Exception:
            self.drop(fd);raise

    def inspect(self, ident):
        self.live();require(ident in self.targets,'NATIVE_HANDLE_REFUSED')
        return self.snapshot(self.targets[ident])

    def ensure_journal(self):
        if self.journal_fd is not None:
            self.private_journal_guard();return
        home_fd=self.directory(self.home)
        name='.goriq-g1-mode-repair-1219'
        try:
            os.mkdir(name,0o700,dir_fd=home_fd)
            os.fsync(home_fd)
        except FileExistsError:
            pass
        self.journal_path=os.path.join(self.home,name)
        self.journal_fd=self.directory(self.journal_path)
        self.private_journal_guard()

    def private_journal_guard(self):
        info=os.fstat(self.journal_fd)
        require(info.st_uid==self.scope['ownerUid'] and stat.S_IMODE(info.st_mode)==0o700,
                'NATIVE_JOURNAL_REFUSED')
        self.parents_current(os.path.join(self.journal_path,'entry'))
        require(self.metadata.facts(self.journal_fd,self.journal_path)['acl']==0,
                'NATIVE_JOURNAL_REFUSED')

    def save(self, name, value):
        self.live();self.ensure_journal();raw=encoded(value)
        require(len(raw)<=MAX_FRAME,'NATIVE_JOURNAL_BOUND')
        fd=None
        try:
            fd=self.keep(os.open(name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,
                                 dir_fd=self.journal_fd))
            info=os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid==self.scope['ownerUid'] and
                    info.st_nlink==1 and stat.S_IMODE(info.st_mode)==0o600,
                    'NATIVE_JOURNAL_REFUSED')
            offset=0
            while offset<len(raw):
                count=os.write(fd,raw[offset:]);require(count>0,'NATIVE_JOURNAL_UNCONFIRMED');offset+=count
            os.fsync(fd);os.fsync(self.journal_fd)
            check=os.stat(name,dir_fd=self.journal_fd,follow_symlinks=False)
            detail=self.metadata.facts(fd,os.path.join(self.journal_path,name))
            require(identity(check)==identity(os.fstat(fd)) and check.st_size==len(raw) and
                    check.st_uid==self.scope['ownerUid'] and check.st_nlink==1 and
                    stat.S_IMODE(check.st_mode)==0o600 and
                    detail=={'path':os.path.join(self.journal_path,name),'acl':0,'alias':False,'flags':0} and
                    os.pread(fd,len(raw)+1,0)==raw,
                    'NATIVE_JOURNAL_UNCONFIRMED')
            self.private_journal_guard();self.deadline()
        except FileExistsError:
            raise Refusal('NATIVE_REPLAY_REFUSED') from None
        finally:
            if fd is not None:self.drop(fd)

    def retain_journal(self, record):
        self.live()
        require(type(record) is dict and set(record)=={'phase','scope','binding','targets'} and
                record['phase'] in PHASES and record['scope']==self.scope and
                isinstance(record['targets'],list) and 1<=len(record['targets'])<=2,
                'NATIVE_JOURNAL_REFUSED')
        record=copy.deepcopy(record)
        if record['phase']=='PLANNED':
            require(self.planned is None and not self.claimed,'NATIVE_PLAN_REPLAY')
            require(len(self.by_label)==2,'NATIVE_CAPTURE_INCOMPLETE')
            for row in record['targets']:
                require(set(row)=={'before','current','targetMode','confirmed','restored'} and
                        row['before']==row['current'] and row['targetMode']==row['before']['mode']&0o700 and
                        row['confirmed'] is False and row['restored'] is False,'NATIVE_PLAN_REFUSED')
            observed=[self.inspect(key) for key in self.targets]
            require([row['before'] for row in record['targets']]==observed,'NATIVE_PLAN_FACTS_MISMATCH')
            binding=record['binding']
            require(type(binding) is dict and set(binding)==SCOPE_KEYS|{'proposalDigest','factsDigest',
                    'operation','permissionChange','risk','requiresHumanApproval'} and
                    all(binding[key]==self.scope[key] for key in SCOPE_KEYS) and
                    HASH.fullmatch(binding['proposalDigest']) and HASH.fullmatch(binding['factsDigest']) and
                    binding['operation']=='compass-mode-narrowing' and binding['permissionChange'] is True and
                    binding['risk']=='HIGH' and binding['requiresHumanApproval'] is True,
                    'NATIVE_BINDING_REFUSED')
        else:
            require(self.planned is not None and record['binding']==self.planned['binding'] and
                    self.claimed,'NATIVE_JOURNAL_UNAUTHORIZED')
            require(record['phase']=='BASELINE' or self.baseline_saved,'NATIVE_BASELINE_REQUIRED')
            require([row.get('before') for row in record['targets']]==
                    [row['before'] for row in self.planned['targets']],'NATIVE_BASELINE_CHANGED')
        self.sequence+=1
        # Random suffix gives each retained observation its own immutable file;
        # approval claim below is deliberately fixed across runs and sessions.
        suffix=os.urandom(12).hex()
        name=f'journal-{self.session_id}-{self.sequence:03d}-{suffix}.json'
        self.save(name,{'version':1,'issue':1219,'approvalId':self.approval_id,
                        'sessionId':self.session_id,'record':record})
        self.record=record
        if record['phase']=='PLANNED':self.planned=record
        if record['phase']=='BASELINE':self.baseline_saved=True
        return True

    def claim(self, binding):
        self.live()
        require(not self.claimed and self.planned is not None and binding==self.planned['binding'],
                'NATIVE_CLAIM_REFUSED')
        require([self.inspect(key) for key in self.targets]==
                [row['before'] for row in self.planned['targets']],'NATIVE_FACTS_CHANGED')
        self.save('claim-'+self.approval_id+'.json',{'version':1,'issue':1219,
                  'approvalId':self.approval_id,'sessionId':self.session_id,'binding':binding})
        self.claimed=True
        return True

    def set_mode(self, ident, expected, mode):
        self.live();require(self.claimed and ident in self.targets and type(mode) is int and
                            self.record is not None,'NATIVE_MODE_UNAUTHORIZED')
        target=self.targets[ident]
        before=next((row['before'] for row in self.planned['targets']
                     if row['before']['path']==target['path']),None)
        require(before is not None,'NATIVE_TARGET_REFUSED')
        phase=self.record['phase']
        if phase=='MODE_INTENT':
            require(ident not in self.attempted and ident not in self.confirmed and ident not in self.restored and
                    mode==before['mode']&0o700 and expected==before,'NATIVE_MODE_REFUSED')
        elif phase=='ROLLBACK_INTENT':
            require(ident in self.confirmed and ident not in self.restored and ident not in self.rollback_attempted and
                    mode==before['mode'] and expected==self.confirmed[ident],
                    'NATIVE_ROLLBACK_REFUSED')
        else:
            raise Refusal('NATIVE_INTENT_REQUIRED')
        require(self.inspect(ident)==expected,'NATIVE_FACTS_CHANGED')
        self.private_journal_guard()
        # This is synchronous within one native worker. fchmod acts on this
        # held fd, never a reopened path. The OS offers no all-facts CAS.
        require(matches_metadata(self.leaf_guard(target),expected),
                'NATIVE_FACTS_CHANGED')
        # leaf_guard also queries ACL/path/flags after its initial fstat. Fence
        # changes observed during those calls with a new descriptor stat.
        require(matches_metadata(os.fstat(target['fd']),expected),'NATIVE_FACTS_CHANGED')
        self.deadline()
        if phase=='MODE_INTENT':self.attempted.add(ident)
        else:self.rollback_attempted.add(ident)
        self.effect_count+=1
        os.fchmod(target['fd'],mode)
        after=self.inspect(ident)
        immutable={key:value for key,value in expected.items() if key not in ('mode','ctimeNs')}
        require({key:value for key,value in after.items() if key not in ('mode','ctimeNs')}==immutable and
                after['mode']==mode,'NATIVE_MODE_OUTCOME_UNCONFIRMED')
        if phase=='MODE_INTENT':self.confirmed[ident]=after
        else:self.restored.add(ident)
        return ident

    def close(self):
        self.closed=True
        for fd in tuple(self.descriptors):
            try:self.drop(fd)
            except OSError:pass


def dispatch(session, command):
    require(type(command) is dict and type(command.get('id')) is int and
            isinstance(command.get('cmd'),str),'NATIVE_REQUEST_REFUSED')
    kind=command['cmd']
    keys={'capture':{'label'},'inspect':{'handle'},'journal':{'record'},'claim':{'binding'},
          'mode':{'handle','expected','mode'},'close':set()}
    require(kind in keys and set(command)==keys[kind]|{'id','cmd'},'NATIVE_REQUEST_REFUSED')
    if kind=='capture':return session.capture(command['label'])
    if kind=='inspect':return session.inspect(command['handle'])
    if kind=='journal':return session.retain_journal(command['record'])
    if kind=='claim':return session.claim(command['binding'])
    if kind=='mode':return session.set_mode(command['handle'],command['expected'],command['mode'])
    session.close();return True


def main():
    session=None
    try:
        require(sys.platform=='darwin' and len(sys.argv)==2 and os.getuid()>0 and
                os.getuid()==os.geteuid(),'NATIVE_CONTEXT_REJECTED')
        metadata=DarwinMetadata(sys.argv[1])
        raw=sys.stdin.buffer.readline(MAX_FRAME+1)
        require(0<len(raw)<=MAX_FRAME and raw.endswith(b'\n'),'NATIVE_FRAME_REFUSED')
        request=json.loads(raw,object_pairs_hook=unique)
        require(type(request) is dict and set(request)=={'scope','candidates','approvalId','sessionId'},
                'NATIVE_INIT_REFUSED')
        import pwd
        home=pwd.getpwuid(os.getuid()).pw_dir
        session=NativeSession(scope=request['scope'],candidates=request['candidates'],home=home,
                              approval_id=request['approvalId'],session_id=request['sessionId'],metadata=metadata)
        print(json.dumps({'id':0,'ok':True,'value':True}),flush=True)
        previous=0
        for _ in range(128):
            raw=sys.stdin.buffer.readline(MAX_FRAME+1)
            if not raw:break
            require(len(raw)<=MAX_FRAME and raw.endswith(b'\n'),'NATIVE_FRAME_REFUSED')
            command=json.loads(raw,object_pairs_hook=unique)
            require(type(command.get('id')) is int and command['id']==previous+1,'NATIVE_SEQUENCE_REFUSED')
            previous=command['id']
            try:
                value=dispatch(session,command)
                print(json.dumps({'id':previous,'ok':True,'value':value}),flush=True)
            except Refusal as error:
                print(json.dumps({'id':previous,'ok':False,'reason':str(error)}),flush=True)
            except Exception:
                print(json.dumps({'id':previous,'ok':False,'reason':'NATIVE_OPERATION_UNAVAILABLE'}),flush=True)
            if command.get('cmd')=='close':break
    except Exception:
        # No raw errors, filenames, raw metadata or DB bytes on stderr/stdout.
        print(json.dumps({'id':0,'ok':False,'reason':'NATIVE_ENTRY_REFUSED'}),flush=True)
        return 1
    finally:
        if session:session.close()
    return 0


if __name__=='__main__':
    sys.exit(main())

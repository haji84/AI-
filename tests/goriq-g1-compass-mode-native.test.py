"""Actual POSIX effects on disposable fixtures; Darwin metadata is not claimed."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/goriq-g1-compass-mode-native.py'
spec = importlib.util.spec_from_file_location('mode_native', SOURCE)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
LABELS = ('owner-config-file', 'mac-canonical-repo-default')


class FixtureMetadata:
    """Only native Darwin ACL/F_GETPATH/flags calls are replaced in POSIX tests."""
    def __init__(self):
        self.paths = {}
        self.acl = {}
        self.flags = {}
        self.aliases = set()

    def facts(self, fd, path):
        item = os.fstat(fd)
        key = (item.st_dev, item.st_ino)
        return {'path': self.paths.get(key, os.path.realpath(path)),
                'acl': self.acl.get(key, 0), 'flags': self.flags.get(key, 0),
                'alias': key in self.aliases}


class ModeNativeTests(unittest.TestCase):
    def setUp(self):
        # The transient workspace can have writable ancestry. Use an owned home
        # fixture; never relax the actual parent guard to make a fixture pass.
        self.tmp = tempfile.TemporaryDirectory(prefix='.g1-native-fixture-', dir=Path.home())
        self.home = Path(self.tmp.name)
        os.chmod(self.home, 0o700)
        self.clock = 1000
        self.meta = FixtureMetadata()
        self.paths = [self.home / 'compass-a.db', self.home / 'compass-b.db']
        for path, mode in zip(self.paths, (0o640, 0o744)):
            path.write_bytes(b'private inert fixture; never an original DB')
            os.chmod(path, mode)
        self.scope = dict(sourceRevision='a'*40, artifactDigest='b'*64, hostId='fixture',
                          ownerUid=os.getuid(), expiresAt=31000)
        self.session = None

    def tearDown(self):
        if self.session:
            self.session.close()
        self.tmp.cleanup()

    def start(self, paths=None, approval='c'*64):
        self.session = native.NativeSession(
            scope=self.scope, candidates=[{'label': label, 'path': str(path)}
                for label, path in zip(LABELS, paths or self.paths)],
            home=str(self.home), approval_id=approval, session_id='fixture-run-1',
            metadata=self.meta, now=lambda: self.clock)
        return self.session

    def plan(self, session):
        captured = [session.capture(label) for label in LABELS]
        targets = []
        for value in captured:
            if any(target['before']['ino'] == value['facts']['ino'] for target in targets):
                continue
            facts = value['facts']
            targets.append(dict(before=facts, current=facts, targetMode=facts['mode'] & 0o700,
                                confirmed=False, restored=False))
        binding = dict(self.scope, proposalDigest='d'*64, factsDigest='e'*64,
                       operation='compass-mode-narrowing', permissionChange=True,
                       risk='HIGH', requiresHumanApproval=True)
        record = dict(phase='PLANNED', scope=self.scope, binding=binding, targets=targets)
        session.retain_journal(record)
        return captured, binding, record

    def claim(self, session):
        captured, binding, record = self.plan(session)
        session.claim(binding)
        session.retain_journal({**record, 'phase':'BASELINE'})
        session.retain_journal({**record, 'phase':'MODE_INTENT'})
        return captured, binding, record

    def test_owner_bits_bytes_identity_and_exact_post_facts_preserved(self):
        session = self.start()
        captures, _, _ = self.claim(session)
        for item, expected_mode in zip(captures, (0o600, 0o700)):
            before = item['facts']
            self.assertEqual(session.set_mode(item['id'], before, expected_mode), item['id'])
            after = session.inspect(item['id'])
            self.assertEqual(after['mode'], expected_mode)
            for key in ('ownerUid','groupId','dev','ino','sizeBytes','mtimeNs','sha256'):
                self.assertEqual(after[key], before[key], key)
        journal = self.home / '.goriq-g1-mode-repair-1219'
        self.assertEqual(stat.S_IMODE(journal.stat().st_mode), 0o700)
        files = list(journal.rglob('*.json'))
        self.assertGreaterEqual(len(files), 4)
        for path in files:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            json.loads(path.read_text())

    def test_no_claim_or_missing_intent_has_zero_mode_effects(self):
        session = self.start()
        captures, binding, _ = self.plan(session)
        with self.assertRaises(native.Refusal):
            session.set_mode(captures[0]['id'],captures[0]['facts'],0o600)
        session.claim(binding)
        with self.assertRaises(native.Refusal):
            session.set_mode(captures[0]['id'],captures[0]['facts'],0o600)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o640)

    def test_replay_claim_is_persisted_across_new_sessions(self):
        session = self.start()
        _, binding, _ = self.plan(session)
        session.claim(binding)
        session.close()
        session = self.start()
        _, binding, _ = self.plan(session)
        with self.assertRaises(native.Refusal):
            session.claim(binding)

    def test_binding_mismatch_does_not_claim(self):
        session = self.start()
        _, binding, _ = self.plan(session)
        with self.assertRaises(native.Refusal):
            session.claim({**binding,'artifactDigest':'f'*64})
        session.claim(binding)

    def test_same_inode_same_path_is_opened_once(self):
        session = self.start(paths=[self.paths[0],self.paths[0]])
        first = session.capture(LABELS[0]); second = session.capture(LABELS[1])
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(first['facts']['sha256'],second['facts']['sha256'])

    def test_symlink_hardlink_empty_special_bits_and_unsafe_parent_rejected(self):
        for kind in ('symlink','hardlink','empty','special','parent'):
            with self.subTest(kind=kind):
                original = self.paths[0].read_bytes()
                alias = self.home / ('alias-'+kind)
                if kind=='symlink':
                    alias.symlink_to(self.paths[0]); paths=[alias,self.paths[1]]
                elif kind=='hardlink':
                    os.link(self.paths[0],alias); paths=self.paths
                elif kind=='empty':
                    self.paths[0].write_bytes(b''); paths=self.paths
                elif kind=='special':
                    os.chmod(self.paths[0],0o4640); paths=self.paths
                else:
                    os.chmod(self.home,0o770); paths=self.paths
                try:
                    session = self.start(paths=paths)
                    with self.assertRaises(native.Refusal):
                        session.capture(LABELS[0])
                except native.Refusal:
                    pass
                finally:
                    if self.session:self.session.close();self.session=None
                    if alias.exists() or alias.is_symlink():alias.unlink()
                    os.chmod(self.home,0o700)
                    self.paths[0].write_bytes(original);os.chmod(self.paths[0],0o640)

    def test_native_acl_flags_alias_and_descriptor_path_mismatch_rejected(self):
        info=self.paths[0].stat(); key=(info.st_dev,info.st_ino)
        for field in ('acl','flags','alias','path'):
            with self.subTest(field=field):
                if field=='acl':self.meta.acl[key]=2
                elif field=='flags':self.meta.flags[key]=1
                elif field=='alias':self.meta.aliases.add(key)
                else:self.meta.paths[key]=str(self.paths[1])
                session=self.start()
                with self.assertRaises(native.Refusal):session.capture(LABELS[0])
                session.close();self.session=None
                self.meta=FixtureMetadata()

    def test_byte_owner_mode_and_replaced_inode_drift_refused(self):
        for drift in ('bytes','mode','replaced'):
            with self.subTest(drift=drift):
                session=self.start(approval=hashlib.sha256(drift.encode()).hexdigest())
                captured,_,_=self.claim(session)
                before=captured[0]['facts']
                if drift=='bytes':self.paths[0].write_bytes(b'different private bytes')
                elif drift=='mode':os.chmod(self.paths[0],0o600)
                else:
                    self.paths[0].rename(self.home / ('old-'+drift));self.paths[0].write_bytes(b'replacement')
                current_mode=stat.S_IMODE(self.paths[0].stat().st_mode)
                with self.assertRaises(native.Refusal):session.set_mode(captured[0]['id'],before,0o600)
                self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),current_mode)
                session.close();self.session=None
                self.paths[0].write_bytes(b'private inert fixture; never an original DB');os.chmod(self.paths[0],0o640)

    def test_expiry_at_native_effect_has_zero_writes(self):
        session=self.start();captured,_,_=self.claim(session)
        original=self.meta.facts
        def expire(fd,path):
            result=original(fd,path)
            self.clock=31000
            return result
        self.meta.facts=expire
        with self.assertRaises(native.Refusal):session.set_mode(captured[0]['id'],captured[0]['facts'],0o600)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o640)

    def test_last_native_metadata_boundary_drift_does_not_get_overwritten(self):
        session=self.start();captured,_,_=self.claim(session)
        original=session.private_journal_guard
        def change_after_full_hash():
            original()
            os.chmod(self.paths[0],0o660)
        session.private_journal_guard=change_after_full_hash
        with self.assertRaises(native.Refusal):session.set_mode(captured[0]['id'],captured[0]['facts'],0o600)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o660)

    def test_final_metadata_query_cannot_hide_mode_change_after_its_initial_fstat(self):
        session=self.start();captured,_,_=self.claim(session)
        original_guard=session.private_journal_guard;original_facts=self.meta.facts
        armed=False
        def arm_after_journal_check():
            nonlocal armed
            original_guard();armed=True
        def change_during_metadata(fd,path):
            result=original_facts(fd,path)
            if armed and path==str(self.paths[0]):os.chmod(self.paths[0],0o660)
            return result
        session.private_journal_guard=arm_after_journal_check
        self.meta.facts=change_during_metadata
        with self.assertRaises(native.Refusal):session.set_mode(captured[0]['id'],captured[0]['facts'],0o600)
        self.assertEqual(session.effect_count,0)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o660)

    def test_uncertain_native_call_is_never_retried(self):
        session=self.start();captured,_,_=self.claim(session)
        original=native.os.fchmod;calls=[]
        def unavailable(fd,mode):
            calls.append((fd,mode));raise OSError('private OS failure')
        native.os.fchmod=unavailable
        try:
            with self.assertRaises(OSError):session.set_mode(captured[0]['id'],captured[0]['facts'],0o600)
            with self.assertRaises(native.Refusal):session.set_mode(captured[0]['id'],captured[0]['facts'],0o600)
        finally:native.os.fchmod=original
        self.assertEqual(len(calls),1)

    def test_rollback_only_exact_confirmed_mode_on_same_identity(self):
        session=self.start();captured,_,record=self.claim(session)
        first=captured[0]
        session.set_mode(first['id'],first['facts'],0o600)
        after=session.inspect(first['id'])
        rollback=copy.deepcopy(record);rollback['phase']='ROLLBACK_INTENT'
        rollback['targets'][0]['current']=after;rollback['targets'][0]['confirmed']=True
        session.retain_journal(rollback)
        session.set_mode(first['id'],after,0o640)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o640)
        with self.assertRaises(native.Refusal):session.set_mode(first['id'],after,0o640)

    def test_close_closes_all_descriptors_even_after_capture_refusal(self):
        session=self.start();session.capture(LABELS[0])
        fds=list(session.open_descriptors())
        self.assertGreater(len(fds),0)
        session.close();session.close()
        for fd in fds:
            with self.assertRaises(OSError):os.fstat(fd)
        with self.assertRaises(native.Refusal):session.capture(LABELS[1])

    def test_unknown_target_outside_home_and_journal_symlink_refused(self):
        session=self.start()
        with self.assertRaises(native.Refusal):session.capture('third-target')
        session.close();self.session=None
        with self.assertRaises(native.Refusal):self.start(paths=[Path.home() / 'outside-compass.db',self.paths[1]])
        root=self.home / '.goriq-g1-mode-repair-1219'
        root.symlink_to(self.paths[0])
        session=self.start()
        with self.assertRaises(native.Refusal):self.plan(session)

    def test_planned_private_snapshot_precedes_claim_and_fake_journal_cannot_expand_targets(self):
        session=self.start()
        with self.assertRaises(native.Refusal):session.claim({'approved':True})
        _,binding,record=self.plan(session)
        session.claim(binding)
        forged=copy.deepcopy(record);forged['phase']='MODE_INTENT'
        with self.assertRaises(native.Refusal):session.retain_journal(forged)
        session.retain_journal({**record,'phase':'BASELINE'})
        forged['targets'][0]['before']['path']=str(self.home/'third.db')
        with self.assertRaises(native.Refusal):session.retain_journal(forged)
        self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o640)

    def test_concurrent_claim_and_durable_failure_never_retry_permission_call(self):
        session=self.start();captures,binding,record=self.plan(session)
        second=native.NativeSession(scope=self.scope,candidates=[{'label':label,'path':str(path)}
                    for label,path in zip(LABELS,self.paths)],home=str(self.home),approval_id='c'*64,
                    session_id='fixture-run-2',metadata=self.meta,now=lambda:self.clock)
        try:
            _,other_binding,_=self.plan(second)
            session.claim(binding)
            with self.assertRaises(native.Refusal):second.claim(other_binding)
            session.retain_journal({**record,'phase':'BASELINE'})
            original=native.os.fsync
            def fail_sync(_):raise OSError('private journal fsync error')
            native.os.fsync=fail_sync
            try:
                with self.assertRaises(OSError):session.retain_journal({**record,'phase':'MODE_INTENT'})
            finally:native.os.fsync=original
            with self.assertRaises(native.Refusal):session.set_mode(captures[0]['id'],captures[0]['facts'],0o600)
            self.assertEqual(stat.S_IMODE(self.paths[0].stat().st_mode),0o640)
        finally:second.close()


if __name__=='__main__':
    unittest.main(verbosity=2)

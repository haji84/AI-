import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts' / 'ai09-readonly-evidence-collect.py'
assert SOURCE.is_file(), 'Missing fixed read-only evidence collector'
spec = importlib.util.spec_from_file_location('collector', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NONCE = 'a' * 32
PUBLIC = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILryvuH/6LTW0dNGQaj2LW3I7dYDZw8lpIdqHEh6xCDp root@848484\n'


class Inventory:
    def identity(self):
        return 0, '848484', '00:15:5d:dc:2c:00', ['172.27.140.254/20']

    def public_key(self):
        return PUBLIC

    def inventory(self):
        return {'writesPerformed': False, 'observationsIncomplete': []}


class Fake:
    def __init__(self):
        self.time = dt.datetime(2026, 10, 21, 8, 0, tzinfo=dt.timezone.utc)
        self.auth = b'PUBLIC_AUTHORIZED_KEY_FIXTURE_NOT_A_SECRET\n'
        self.receipt = {
            'version': 1, 'issue': 1219, 'status': 'APPLIED', 'runId': m.RUN,
            'authorizationRef': m.REFERENCE, 'planSha256': m.PLAN_SHA,
            'executorSha256': m.EXECUTOR_SHA, 'expiresAt': m.EXPIRY,
            'publicKeyFingerprint': m.CLIENT_FINGERPRINT,
            'authorizedKeysSha256': hashlib.sha256(self.auth).hexdigest(),
            'observedAt': '2026-10-21T02:04:00Z', 'access': 'ordinary-ai09-command-access',
            'authenticatedConnectionVerified': False, 'automaticKeyRollbackSupported': False,
            'existingSessionsTerminatedByExpiry': False, 'physicalE2EVerified': False}
        self.files = {m.INSPECTOR: (ROOT / 'scripts/ai09-first-access-inspect.py').read_bytes(),
                      m.APPLIED: None, m.AUTH: self.auth}
        self.metadata = {p: {'uid': 1000 if p == m.AUTH else 0,
                            'gid': 1000 if p == m.AUTH else 0,
                            'mode': 0o600, 'nlink': 1, 'regularFile': True,
                            'ancestorsSafe': True} for p in self.files}
        self.disk = {'name': 'sdb', 'path': '/dev/sdb', 'type': 'disk',
                     'label': None, 'uuid': None, 'fstype': None, 'mountpoints': [None],
                     'children': [{'name': 'sdb1', 'path': '/dev/sdb1', 'type': 'part',
                                   'label': 'A09', 'uuid': '02FC-FB01', 'fstype': 'vfat',
                                   'mountpoints': [None]}]}
        self.calls = []
        self.incomplete = []
        self.drift = False

    def now(self):
        return self.time

    def root(self):
        self.calls.append('root')
        return 0

    def read_file(self, path):
        self.calls.append(path)
        raw = self.files[path]
        if path == m.APPLIED and raw is None:
            raw = json.dumps(self.receipt).encode()
        return raw, dict(self.metadata[path], sizeBytes=len(raw))

    def baseline(self, inspector, nonce):
        self.calls.append('baseline')
        result = inspector['inspect'](Inventory(), nonce)
        result['observedAt'] = self.time.isoformat()
        result['inventory']['observationsIncomplete'] = self.incomplete
        return result

    def lsblk(self):
        self.calls.append('lsblk')
        return {'blockdevices': [copy.deepcopy(self.disk)]}

    def revalidate(self):
        if self.drift:
            raise ValueError('PUBLIC_PATH_CHANGED')


class CollectorTests(unittest.TestCase):
    def test_complete_observation_is_unsigned_and_not_activation_or_ssh(self):
        f = Fake(); result = m.collect(f, NONCE)
        self.assertEqual(result['status'], 'READONLY_EVIDENCE_COLLECTED')
        self.assertEqual(result['nonce'], NONCE)
        self.assertEqual(result['evidenceClass'], 'UNSIGNED_GUEST_OBSERVATION')
        self.assertTrue(result['authorizedKeys']['matchesEnrollment'])
        for key in ['mutationsPerformed', 'activationReady', 'authenticatedConnectionVerified',
                    'physicalE2EVerified', 'independentVerifierVerified']:
            self.assertIs(result[key], False)
        serialized = m.encode(result)
        self.assertNotIn(f.auth.strip(), serialized)
        self.assertNotIn(b'PUBLIC_AUTHORIZED_KEY_FIXTURE', serialized)

    def test_nonce_and_root_refuse_before_file_read(self):
        f = Fake(); self.assertEqual(m.collect(f, ';id')['code'], 'NONCE_INVALID')
        self.assertEqual(f.calls, [])
        f.root = lambda: 1000
        self.assertEqual(m.collect(f, NONCE)['code'], 'ROOT_REQUIRED')
        self.assertEqual(f.calls, [])

    def test_native_path_whitelist_refuses_before_any_open(self):
        native = object.__new__(m.NativeSystem)
        with patch.object(m.os, 'open', side_effect=AssertionError('no filesystem read')):
            for path in ['/etc/shadow', '/root/.ssh/id_ed25519', m.INSPECTOR + '/../inspect.py',
                         '/home/ai09/.ssh/authorized_keys.extra']:
                with self.assertRaisesRegex(ValueError, 'PUBLIC_PATH_REFUSED'):
                    native.read_file(path)

    def test_nonallowlisted_receipt_content_never_escapes_into_output(self):
        f = Fake(); f.receipt['password'] = 'UNTRUSTED_RECEIPT_PRIVATE_FIXTURE'
        result = m.collect(f, NONCE)
        self.assertEqual(result['code'], 'ENROLLMENT_MISMATCH')
        self.assertNotIn(b'UNTRUSTED_RECEIPT_PRIVATE_FIXTURE', m.encode(result))

    def test_changed_inspector_is_never_loaded(self):
        f = Fake(); f.files[m.INSPECTOR] += b'\n# drift'
        with patch.object(m, 'load_inspector', side_effect=AssertionError('must not load')):
            result = m.collect(f, NONCE)
        self.assertEqual(result['code'], 'INSPECTOR_HASH_MISMATCH')
        self.assertNotIn('baseline', f.calls)

    def test_metadata_symlink_hardlink_owner_writer_and_size_refuse(self):
        for path in [m.INSPECTOR, m.APPLIED, m.AUTH]:
            for field, value in [('regularFile', False), ('nlink', 2), ('uid', 99),
                                 ('gid', 99), ('mode', 0o620), ('ancestorsSafe', False)]:
                with self.subTest(path=path, field=field):
                    f = Fake(); f.metadata[path][field] = value
                    self.assertEqual(m.collect(f, NONCE)['status'], 'BLOCKED')
        f = Fake(); f.files[m.INSPECTOR] = b'x' * (m.FILE_LIMIT + 1)
        self.assertEqual(m.collect(f, NONCE)['code'], 'PUBLIC_FILE_BOUND')

    def test_original_applied_invariants_cannot_be_relabelled(self):
        for field, value in [('runId', 'b'*32), ('authorizationRef', 'new-grant'),
                             ('planSha256', 'b'*64), ('executorSha256', 'b'*64),
                             ('publicKeyFingerprint', 'other'), ('expiresAt', '2027-01-01T00:00:00Z'),
                             ('status', 'PREPARED'), ('issue', True),
                             ('authenticatedConnectionVerified', True), ('physicalE2EVerified', True)]:
            with self.subTest(field=field):
                f = Fake(); f.receipt[field] = value
                self.assertEqual(m.collect(f, NONCE)['code'], 'ENROLLMENT_MISMATCH')
        f = Fake(); f.files[m.APPLIED] = b'{"version":1,"version":1}'
        self.assertEqual(m.collect(f, NONCE)['code'], 'JSON_DUPLICATE_KEY')

    def test_expired_enrollment_stays_blocked_but_observations_remain(self):
        f = Fake(); f.time = dt.datetime(2026, 10, 21, 9, tzinfo=dt.timezone.utc)
        result = m.collect(f, NONCE)
        self.assertEqual(result['code'], 'ENROLLMENT_EXPIRED')
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertEqual(result['enrollment']['expiresAt'], m.EXPIRY)
        self.assertTrue(result['unmount']['wholeDeviceUnmountObserved'])

    def test_authorized_hash_drift_and_path_replacement_refuse(self):
        f = Fake(); f.files[m.AUTH] += b'drift'
        self.assertEqual(m.collect(f, NONCE)['code'], 'AUTHORIZED_KEY_DRIFT')
        f = Fake(); f.drift = True
        self.assertEqual(m.collect(f, NONCE)['code'], 'PUBLIC_PATH_CHANGED')

    def test_wrong_root_baseline_identity_nonce_or_freshness_refuses(self):
        for key, value in [('effectiveUid', 1000), ('nonce', 'b'*32), ('hostname', 'other'),
                           ('mac', 'other'), ('addresses', []), ('hostKeyFingerprint', 'other'),
                           ('observedAt', '2026-10-20T01:00:00Z'), ('mutationsPerformed', True)]:
            f = Fake(); original = f.baseline
            f.baseline = lambda inspector, nonce, k=key, v=value: dict(original(inspector, nonce), **{k: v})
            self.assertEqual(m.collect(f, NONCE)['code'], 'ROOT_BASELINE_MISMATCH')

    def test_inventory_incomplete_is_not_success(self):
        f = Fake(); f.incomplete = ['sshPolicy']
        self.assertEqual(m.collect(f, NONCE)['status'], 'INCOMPLETE')

    def test_whole_device_and_any_child_mount_or_wrong_media_refuses(self):
        variants = [lambda d: d.update(mountpoints=['/mnt']),
                    lambda d: d['children'][0].update(mountpoints=['/mnt']),
                    lambda d: d['children'].append(dict(d['children'][0], path='/dev/sdb2', uuid=None,
                                                        label=None, mountpoints=['/elsewhere'])),
                    lambda d: d['children'][0].update(uuid='WRONG'),
                    lambda d: d['children'][0].update(fstype='ext4'),
                    lambda d: d['children'].append(dict(d['children'][0], path='/dev/sdb2'))]
        for change in variants:
            f = Fake(); change(f.disk)
            self.assertEqual(m.collect(f, NONCE)['status'], 'BLOCKED')

    def test_output_bound_has_only_safe_blocked_envelope(self):
        f = Fake(); original = f.baseline
        f.baseline = lambda i, n: dict(original(i, n), inventory={'writesPerformed': False,
            'observationsIncomplete': [], 'oversized': 'x' * (m.OUTPUT_LIMIT + 1)})
        value = m.encode(m.collect(f, NONCE))
        self.assertLessEqual(len(value), m.OUTPUT_LIMIT)
        self.assertEqual(json.loads(value)['code'], 'COLLECTOR_OUTPUT_BOUND')

    def test_directory_metadata_refuses_alias_untrusted_or_writable_ancestors(self):
        good = dict(mode=stat.S_IFDIR | 0o755, uid=0, gid=0)
        m.check_directory(good, '/run')
        for changes in [dict(mode=stat.S_IFLNK | 0o777), dict(mode=stat.S_IFDIR | 0o777),
                        dict(uid=1000), dict(gid=1000)]:
            with self.assertRaises(ValueError):
                m.check_directory(dict(good, **changes), '/run')

    @unittest.skipUnless(os.name == 'posix' and os.open in os.supports_dir_fd,
                         'POSIX dirfd/O_NOFOLLOW primitives require Linux CI')
    def test_real_linux_leaf_rejects_symlink_hardlink_and_reads_same_checked_fd(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory); (p/'public').write_bytes(b'PUBLIC_FIXTURE'); (p/'public').chmod(0o600)
            (p/'alias').symlink_to(p/'public'); os.link(p/'public', p/'hard')
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaises(OSError):
                    m.open_leaf(fd, 'alias', os.getuid(), os.getgid())
                with self.assertRaisesRegex(ValueError, 'PUBLIC_FILE_METADATA'):
                    m.open_leaf(fd, 'hard', os.getuid(), os.getgid())
                (p/'single').write_bytes(b'EXACT_CHECKED_BYTES'); (p/'single').chmod(0o600)
                handle, data, metadata = m.open_leaf(fd, 'single', os.getuid(), os.getgid())
                try:
                    self.assertEqual(data, b'EXACT_CHECKED_BYTES')
                    self.assertEqual(os.fstat(handle).st_ino, os.stat(p/'single').st_ino)
                    self.assertEqual(metadata['nlink'], 1)
                    competing = os.open(p/'single', os.O_RDONLY)
                    try:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    finally:
                        os.close(competing)
                    native = object.__new__(m.NativeSystem)
                    native.bindings = [(fd, 'single', handle, True, m.file_signature(os.fstat(handle)))]
                    native.revalidate()
                    (p/'replacement').write_bytes(b'CHANGED_BYTES')
                    os.replace(p/'replacement', p/'single')
                    with self.assertRaisesRegex(ValueError, 'PUBLIC_PATH_CHANGED'):
                        native.revalidate()
                finally:
                    os.close(handle)
            finally:
                os.close(fd)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Fixed Issue1219 guest observation; preparation, never activation authority.

Requires separately admitted Linux root execution with Python -I -B. Reads only
fixed public evidence, reuses the immutable hash-pinned inspector, never writes,
installs, reads private keys, changes configuration, or opens a network channel.
"""
from contextlib import ExitStack
import datetime as dt
import hashlib
import json
import os
import re
import stat
import sys
import time

RUN = '028cc365d24b48d3a8ddfbbe07d0ac95'
INSPECTOR = '/run/ai09-1219-' + RUN + '/inspect.py'
APPLIED = '/var/lib/goriq-ai09-access-1219/' + RUN + '/applied.json'
AUTH = '/home/ai09/.ssh/authorized_keys'
INSPECTOR_SHA = 'dee4d8d046995431546639e87303cf42b5f96c3cf8b48ec56981851c5688cdc1'
EXECUTOR_SHA = 'b35dcbb57bcd134937c0ba6b8419d0aa846ba5d3ddaac638f43896842a287be2'
PLAN_SHA = 'b6bd7ce1d1af4105b95b27e1b25fa4a846c7b011fee5beabad0550bca8300ab0'
REFERENCE = 'owner-1219-ai09-empty-mbr-resume-20261021'
EXPIRY = '2026-10-21T09:00:00.000Z'
CLIENT_FINGERPRINT = 'SHA256:szU/QYKAFv4o6/2o2zAn7FNj0YcrjJVZz2zm62wzz4E'
HOST_FINGERPRINT = 'SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA'
FILE_LIMIT = 131072
OUTPUT_LIMIT = 131072
FILES = {INSPECTOR: (0, 0), APPLIED: (0, 0), AUTH: (1000, 1000)}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def timestamp(value):
    require(isinstance(value, str), 'TIMESTAMP_INVALID')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None and parsed.utcoffset() == dt.timedelta(0), 'TIMESTAMP_INVALID')
    return parsed


def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'JSON_DUPLICATE_KEY')
            value[key] = item
        return value
    require(len(raw) <= FILE_LIMIT, 'PUBLIC_FILE_BOUND')
    return json.loads(raw, object_pairs_hook=unique)


def validate_file(raw, metadata, path):
    require(path in FILES and isinstance(raw, bytes) and 0 < len(raw) <= FILE_LIMIT,
            'PUBLIC_FILE_BOUND')
    uid, gid = FILES[path]
    require(all(type(metadata.get(k)) is int for k in ('uid', 'gid', 'mode', 'nlink', 'sizeBytes'))
            and metadata['uid'] == uid and metadata['gid'] == gid
            and metadata['mode'] == 0o600 and metadata['nlink'] == 1
            and metadata['sizeBytes'] == len(raw) and metadata.get('regularFile') is True
            and metadata.get('ancestorsSafe') is True, 'PUBLIC_FILE_METADATA')


def check_directory(info, path):
    owner = 1000 if path in ('/home/ai09', '/home/ai09/.ssh') else 0
    require(stat.S_ISDIR(info['mode']) and info['uid'] == owner and info['gid'] == owner
            and not (info['mode'] & 0o022), 'PUBLIC_ANCESTOR_UNSAFE')
    if path == '/home/ai09/.ssh':
        require(stat.S_IMODE(info['mode']) == 0o700, 'PUBLIC_ANCESTOR_UNSAFE')


def file_signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def open_leaf(parent, name, uid, gid):
    """Internal fd primitive; the native caller supplies only FILES leaf names."""
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        before = os.fstat(handle)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                and before.st_uid == uid and before.st_gid == gid
                and stat.S_IMODE(before.st_mode) == 0o600, 'PUBLIC_FILE_METADATA')
        require(0 < before.st_size <= FILE_LIMIT, 'PUBLIC_FILE_BOUND')
        import fcntl
        # Shared advisory lock stays on this checked fd through final revalidation.
        # Signature/path checks also detect writers that do not honor flock.
        fcntl.flock(handle, fcntl.LOCK_SH | fcntl.LOCK_NB)
        parts = []; remaining = FILE_LIMIT + 1
        while remaining:
            part = os.read(handle, min(16384, remaining))
            if not part:
                break
            parts.append(part); remaining -= len(part)
        raw = b''.join(parts)
        require(len(raw) == before.st_size and len(raw) <= FILE_LIMIT, 'PUBLIC_FILE_BOUND')
        require(file_signature(before) == file_signature(os.fstat(handle))
                == file_signature(os.stat(name, dir_fd=parent, follow_symlinks=False)),
                'PUBLIC_PATH_CHANGED')
        metadata = dict(uid=before.st_uid, gid=before.st_gid, mode=stat.S_IMODE(before.st_mode),
                        nlink=before.st_nlink, regularFile=True, sizeBytes=len(raw), ancestorsSafe=True)
        return handle, raw, metadata
    except BaseException:
        os.close(handle)
        raise


def load_inspector(raw):
    # No import/compile/exec from the guest source happens before the exact pin.
    require(sha(raw) == INSPECTOR_SHA, 'INSPECTOR_HASH_MISMATCH')
    namespace = {'__name__': '_ai09_pinned_readonly_inspector', '__file__': INSPECTOR}
    exec(compile(raw, INSPECTOR, 'exec'), namespace)
    return namespace


def validate_enrollment(value):
    expected = dict(version=1, issue=1219, status='APPLIED', runId=RUN,
                    authorizationRef=REFERENCE, planSha256=PLAN_SHA, executorSha256=EXECUTOR_SHA,
                    publicKeyFingerprint=CLIENT_FINGERPRINT, access='ordinary-ai09-command-access',
                    authenticatedConnectionVerified=False, physicalE2EVerified=False,
                    automaticKeyRollbackSupported=False, existingSessionsTerminatedByExpiry=False)
    require(isinstance(value, dict) and set(value) == set(expected) | {
        'expiresAt', 'authorizedKeysSha256', 'observedAt'}, 'ENROLLMENT_MISMATCH')
    require(all(type(value[k]) is type(v) and value[k] == v for k, v in expected.items()),
            'ENROLLMENT_MISMATCH')
    require(timestamp(value['expiresAt']) == timestamp(EXPIRY)
            and isinstance(value['authorizedKeysSha256'], str)
            and re.fullmatch('[a-f0-9]{64}', value['authorizedKeysSha256'])
            and timestamp(value['observedAt']) < timestamp(EXPIRY), 'ENROLLMENT_MISMATCH')


def validate_baseline(value, nonce, now):
    expected = dict(version=1, issue=1219, status='AUTHENTICATED_ROOT_BASELINE', nonce=nonce,
                    effectiveUid=0, hostname='848484', mac='00:15:5d:dc:2c:00',
                    addresses=['172.27.140.254/20'], hostKeyFingerprint=HOST_FINGERPRINT,
                    mutationsPerformed=False, activationReady=False, physicalE2EVerified=False)
    require(isinstance(value, dict) and all(type(value.get(k)) is type(v) and value[k] == v
            for k, v in expected.items()), 'ROOT_BASELINE_MISMATCH')
    require(-60 <= (now - timestamp(value['observedAt'])).total_seconds() <= 900
            and value['inventory'].get('writesPerformed') is False
            and isinstance(value['inventory'].get('observationsIncomplete'), list),
            'ROOT_BASELINE_MISMATCH')


def unmount_observation(value, now):
    require(isinstance(value, dict) and isinstance(value.get('blockdevices'), list), 'MEDIA_INVENTORY_INVALID')
    roots = []; matches = []; paths = set(); count = 0

    def walk(node, root, depth):
        nonlocal count
        count += 1
        require(count <= 128 and depth <= 8 and isinstance(node, dict), 'MEDIA_INVENTORY_BOUND')
        path = node.get('path')
        require(isinstance(path, str) and re.fullmatch('/dev/[A-Za-z0-9._/-]{1,120}', path)
                and path not in paths, 'MEDIA_INVENTORY_INVALID')
        paths.add(path)
        points = node.get('mountpoints')
        require(isinstance(points, list) and all(p is None or isinstance(p, str) for p in points),
                'MEDIA_INVENTORY_INVALID')
        if node.get('uuid') == '02FC-FB01' or node.get('label') == 'A09':
            require(node.get('uuid') == '02FC-FB01' and node.get('label') == 'A09'
                    and node.get('fstype') == 'vfat', 'OWNED_MEDIA_MISMATCH')
            matches.append((node, root))
        children = node.get('children', [])
        require(isinstance(children, list), 'MEDIA_INVENTORY_INVALID')
        rows = [node]
        for child in children:
            rows.extend(walk(child, root, depth + 1))
        return rows

    for root in value['blockdevices']:
        rows = walk(root, root, 0); roots.append((root, rows))
    require(len(matches) == 1 and matches[0][1].get('type') == 'disk', 'OWNED_MEDIA_MISMATCH')
    media, disk = matches[0]
    rows = next(rows for root, rows in roots if root is disk)
    require(all(not p for node in rows for p in node['mountpoints']), 'WHOLE_DEVICE_MOUNTED')
    return dict(volumeLabel='A09', mediaFilesystemUuid='02FC-FB01', device=disk['path'],
                filesystemDevice=media['path'], wholeDeviceUnmountObserved=True,
                recordedAt=now.isoformat())


def envelope(nonce):
    return dict(version=1, issue=1219, nonce=nonce if isinstance(nonce, str)
                and re.fullmatch('[a-f0-9]{32}', nonce) else None, status='BLOCKED',
                evidenceClass='UNSIGNED_GUEST_OBSERVATION', mutationsPerformed=False,
                activationReady=False, authenticatedConnectionVerified=False,
                physicalE2EVerified=False, independentVerifierVerified=False)


def collect(system, nonce):
    result = envelope(nonce); deadline = time.monotonic() + 45
    try:
        require(result['nonce'] is not None, 'NONCE_INVALID')
        require(system.root() == 0, 'ROOT_REQUIRED')
        def read(path):
            require(time.monotonic() < deadline, 'COLLECTOR_DEADLINE')
            raw, metadata = system.read_file(path); validate_file(raw, metadata, path)
            return raw, dict(metadata, path=path, sha256=sha(raw))
        raw, result['rootSource'] = read(INSPECTOR)
        require(sha(raw) == INSPECTOR_SHA, 'INSPECTOR_HASH_MISMATCH')
        inspector = load_inspector(raw)
        raw, result['appliedSource'] = read(APPLIED)
        enrollment = decode(raw); validate_enrollment(enrollment)
        # Only the allowlisted public receipt fields, never raw file/key content.
        result['enrollment'] = enrollment
        authorized, metadata = read(AUTH)
        require(sha(authorized) == enrollment['authorizedKeysSha256'], 'AUTHORIZED_KEY_DRIFT')
        result['authorizedKeys'] = dict(metadata, matchesEnrollment=True, metadataVerified=True)
        baseline = system.baseline(inspector, nonce)
        validate_baseline(baseline, nonce, system.now()); result['rootBaseline'] = baseline
        require(time.monotonic() < deadline, 'COLLECTOR_DEADLINE')
        result['unmount'] = unmount_observation(system.lsblk(), system.now())
        system.revalidate()
        now = system.now()
        require(time.monotonic() < deadline, 'COLLECTOR_DEADLINE')
        require(timestamp(enrollment['observedAt']) <= now + dt.timedelta(seconds=60), 'ENROLLMENT_MISMATCH')
        result['observedAt'] = now.isoformat()
        if now >= timestamp(enrollment['expiresAt']):
            result['code'] = 'ENROLLMENT_EXPIRED'
        elif baseline['inventory']['observationsIncomplete']:
            result.update(status='INCOMPLETE', code='INVENTORY_INCOMPLETE')
        else:
            result['status'] = 'READONLY_EVIDENCE_COLLECTED'
    except Exception as error:
        code = str(error)
        result.update(status='BLOCKED', code=code if re.fullmatch('[A-Z][A-Z0-9_]{1,80}', code)
                      else 'EVIDENCE_COLLECTION_FAILED')
    return result


def encode(result):
    raw = json.dumps(result, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    if len(raw) + 1 > OUTPUT_LIMIT:
        blocked = envelope(result.get('nonce')); blocked['code'] = 'COLLECTOR_OUTPUT_BOUND'
        raw = json.dumps(blocked, sort_keys=True, separators=(',', ':')).encode('ascii')
    return raw + b'\n'


class NativeSystem:
    def __init__(self):
        require(os.name == 'posix' and hasattr(os, 'geteuid'), 'LINUX_REQUIRED')
        require(os.geteuid() == 0, 'ROOT_REQUIRED')
        require(sys.flags.isolated and sys.dont_write_bytecode, 'ISOLATED_NO_BYTECODE_REQUIRED')
        self.stack = ExitStack(); self.bindings = []; self.inspector = None

    @staticmethod
    def now():
        return dt.datetime.now(dt.timezone.utc)

    @staticmethod
    def root():
        return os.geteuid()

    def keep(self, handle):
        self.stack.callback(os.close, handle)
        return handle

    def read_file(self, path):
        require(path in FILES, 'PUBLIC_PATH_REFUSED')
        parent = self.keep(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        root = os.fstat(parent)
        check_directory(dict(mode=root.st_mode, uid=root.st_uid, gid=root.st_gid), '/')
        current = ''
        parts = path.split('/')[1:]
        for part in parts[:-1]:
            current += '/' + part
            handle = self.keep(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                       dir_fd=parent))
            info = os.fstat(handle)
            check_directory(dict(mode=info.st_mode, uid=info.st_uid, gid=info.st_gid), current)
            self.bindings.append((parent, part, handle, False, file_signature(info)[:6]))
            parent = handle
        handle, raw, metadata = open_leaf(parent, parts[-1], *FILES[path])
        self.keep(handle)
        self.bindings.append((parent, parts[-1], handle, True, file_signature(os.fstat(handle))))
        return raw, metadata

    def baseline(self, inspector, nonce):
        self.inspector = inspector
        return inspector['inspect'](inspector['NativeSystem'](), nonce)

    def lsblk(self):
        return decode(self.inspector['NativeSystem'].command([
            '/usr/bin/lsblk', '--json', '--bytes', '--output',
            'NAME,PATH,TYPE,PKNAME,LABEL,UUID,FSTYPE,MOUNTPOINTS']).encode())

    def revalidate(self):
        for parent, name, handle, regular, expected in self.bindings:
            opened = file_signature(os.fstat(handle))
            named = file_signature(os.stat(name, dir_fd=parent, follow_symlinks=False))
            if not regular:
                opened = opened[:6]; named = named[:6]
            require(opened == named == expected, 'PUBLIC_PATH_CHANGED')


def main():
    nonce = sys.argv[1] if len(sys.argv) == 2 else None
    system = None
    try:
        require(isinstance(nonce, str) and re.fullmatch('[a-f0-9]{32}', nonce), 'NONCE_INVALID')
        system = NativeSystem()
        result = collect(system, nonce)
    except Exception as error:
        result = envelope(nonce); code = str(error)
        result['code'] = code if re.fullmatch('[A-Z][A-Z0-9_]{1,80}', code) else 'EVIDENCE_COLLECTION_FAILED'
    finally:
        if system is not None:
            system.stack.close()
    output = encode(result)
    sys.stdout.buffer.write(output); sys.stdout.buffer.flush()
    return 0 if json.loads(output)['status'] == 'READONLY_EVIDENCE_COLLECTED' else 1


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Issue1219: explicitly approved, local-sudo enrollment of one ordinary ai09 key.

This grants ordinary ai09 command access, including its existing bash startup
behavior. It is NOT a forced-command boundary or an independent-verifier grant.
No password/private-key read, account/config/service change, install or network.
The independently approved launcher supplies the exact plan SHA and approval ref.
Registration appends once; concurrent owner writes are never replaced. Automatic
key-file rollback is unsupported: retain evidence and reconcile manually. Expiry
limits new authentications, not already-established sessions.
"""
import base64
from contextlib import contextmanager
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

HOME = "/home/ai09"
SSH = HOME + "/.ssh"
AUTH = SSH + "/authorized_keys"
JOURNALS = "/var/lib/goriq-ai09-access-1219"
HOST = "172.27.128.1"
GUEST = "172.27.140.254"
HOST_FINGERPRINT = "SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA"
LIMIT = 131072
PLAN_FIELDS = {"version", "issue", "runId", "authorizationRef", "expiresAt",
               "publicKey", "executorSha256"}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")


def decode_json(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, "JSON_DUPLICATE_KEY")
            result[key] = item
        return result
    require(len(value) <= LIMIT, "FILE_BOUND")
    return json.loads(value.decode("utf8"), object_pairs_hook=unique)


def timestamp(value):
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def public_fingerprint(value):
    require(isinstance(value, str) and re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]+={0,2}", value),
            "PUBLIC_KEY_INVALID")
    blob = base64.b64decode(value.split()[1], validate=True)
    require(len(blob) == 51 and blob[:19] == b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"
            and base64.b64encode(blob).decode() == value.split()[1], "PUBLIC_KEY_INVALID")
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def validate_plan(raw, expected_sha, authorization_ref, now):
    require(isinstance(expected_sha, str) and re.fullmatch("[a-f0-9]{64}", expected_sha)
            and digest(raw) == expected_sha, "PLAN_HASH_MISMATCH")
    plan = decode_json(raw)
    require(isinstance(plan, dict) and set(plan) == PLAN_FIELDS
            and type(plan["version"]) is int and plan["version"] == 1
            and type(plan["issue"]) is int and plan["issue"] == 1219, "PLAN_SCHEMA_INVALID")
    require(isinstance(plan["runId"], str) and re.fullmatch("[a-f0-9]{32}", plan["runId"]), "RUN_ID_INVALID")
    require(isinstance(plan["authorizationRef"], str)
            and re.fullmatch("[A-Za-z0-9._:-]{1,128}", plan["authorizationRef"])
            and authorization_ref == plan["authorizationRef"], "AUTHORIZATION_MISMATCH")
    expiry = plan["expiresAt"]
    require(isinstance(expiry, str)
            and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z", expiry), "LEASE_INVALID")
    deadline = dt.datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    require(0 < (deadline - now).total_seconds() <= 86400, "LEASE_INVALID")
    require(plan["executorSha256"] == digest(Path(__file__).read_bytes()), "EXECUTOR_HASH_MISMATCH")
    public_fingerprint(plan["publicKey"])
    return plan, deadline


def validate_baseline(value):
    require(value.get("effectiveUid") == 0, "ROOT_REQUIRED")
    require(value.get("hostname") == "848484" and value.get("mac") == "00:15:5d:dc:2c:00"
            and value.get("addresses") == [GUEST + "/20"], "GUEST_IDENTITY_MISMATCH")
    require(value.get("hostKeyFingerprint") == HOST_FINGERPRINT, "HOST_KEY_MISMATCH")
    require(value.get("account") == {"name": "ai09", "uid": 1000, "gid": 1000,
                                    "home": HOME, "shell": "/bin/bash"}, "ACCOUNT_MISMATCH")
    require(value.get("accountUnlocked") is True and value.get("accountUnexpired") is True,
            "ACCOUNT_LOCKED_OR_EXPIRED")
    policy = value.get("policy", {})
    require(policy.get("pubkeyauthentication") == "yes" and policy.get("strictmodes") == "yes"
            and policy.get("authorizedkeyscommand") == "none"
            and policy.get("authenticationmethods") in ("any", "publickey")
            and policy.get("forcecommand") == "none", "SSH_POLICY_UNSUPPORTED")
    paths = policy.get("authorizedkeysfile", "").split()
    aliases = {".ssh/authorized_keys": AUTH, "%h/.ssh/authorized_keys": AUTH, AUTH: AUTH,
               ".ssh/authorized_keys2": SSH + "/authorized_keys2",
               "%h/.ssh/authorized_keys2": SSH + "/authorized_keys2",
               SSH + "/authorized_keys2": SSH + "/authorized_keys2"}
    require(1 <= len(paths) <= 2 and all(item in aliases for item in paths), "SSH_POLICY_UNSUPPORTED")
    sources = [aliases[item] for item in paths]
    require(AUTH in sources and len(set(sources)) == len(sources), "SSH_POLICY_UNSUPPORTED")
    return sources


class NativeSystem:
    """CLI always uses fixed Linux root. Tests supply a filesystem/observation adapter."""
    def __init__(self):
        self.root = Path("/")

    def now(self):
        return dt.datetime.now(dt.timezone.utc)

    def path(self, name):
        require(isinstance(name, str) and name.startswith("/") and
                not any(part in (".", "..") for part in name.split("/")), "PATH_INVALID")
        return self.root / name.lstrip("/")

    def metadata(self, path, info):
        return {"uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode)}

    def set_metadata(self, path, metadata):
        os.chown(path, metadata["uid"], metadata["gid"], follow_symlinks=False)
        os.chmod(path, metadata["mode"], follow_symlinks=False)

    def set_fd_metadata(self, fd, path, metadata):
        os.fchown(fd, metadata["uid"], metadata["gid"])
        os.fchmod(fd, metadata["mode"])

    def validate_info(self, path, info, directory=False):
        relative = "/" + path.relative_to(self.root).as_posix()
        allowed = (0, 1000) if relative == HOME or relative.startswith(HOME + "/") else (0,)
        metadata = self.metadata(path, info)
        require(not stat.S_ISLNK(info.st_mode)
                and (stat.S_ISDIR(info.st_mode) if directory else
                     stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT)
                and metadata["uid"] in allowed and metadata["mode"] & 0o022 == 0, "PATH_UNSAFE")
        return metadata

    @contextmanager
    def parent(self, name):
        """Pin every ancestor with no-follow dirfds on Linux, including user-owned home."""
        path = self.path(name)
        current = self.root
        fd = None
        try:
            if os.name == "posix":
                fd = os.open(current, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                self.validate_info(current, os.fstat(fd), True)
                for part in path.parent.relative_to(self.root).parts:
                    current /= part
                    next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = next_fd
                    self.validate_info(current, os.fstat(fd), True)
            else:
                # Used only by fixture adapters; native observation rejects non-Linux.
                self.validate_info(current, current.lstat(), True)
                for part in path.parent.relative_to(self.root).parts:
                    current /= part
                    self.validate_info(current, current.lstat(), True)
            yield path, fd
        finally:
            if fd is not None:
                os.close(fd)

    def snapshot(self, name):
        path = self.path(name)
        # Missing .ssh is supported; its existing home ancestors must still be safe.
        if name.startswith(SSH + "/") and not self.path(SSH).exists() and not self.path(SSH).is_symlink():
            self.snapshot(SSH)
            return None
        with self.parent(name) as (_, parent_fd):
            options = {"dir_fd": parent_fd} if parent_fd is not None else {}
            target = path.name if parent_fd is not None else path
            try:
                info = os.stat(target, follow_symlinks=False, **options)
            except FileNotFoundError:
                return None
            directory = stat.S_ISDIR(info.st_mode)
            metadata = self.validate_info(path, info, directory)
            if directory:
                return {"type": "directory", "metadata": metadata, "identity": [info.st_dev, info.st_ino]}
            fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), **options)
            with os.fdopen(fd, "rb") as stream:
                opened = os.fstat(stream.fileno())
                require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), "STATE_DRIFT")
                self.validate_info(path, opened)
                data = stream.read(LIMIT + 1)
                after = os.fstat(stream.fileno())
            require(len(data) <= LIMIT and (after.st_size, after.st_mtime_ns, after.st_nlink)
                    == (info.st_size, info.st_mtime_ns, info.st_nlink), "STATE_DRIFT")
            return {"type": "file", "metadata": metadata, "sha256": digest(data),
                    "bytes": base64.b64encode(data).decode()}

    def read(self, name):
        value = self.snapshot(name)
        require(value is not None and value["type"] == "file", "FILE_MISSING")
        return base64.b64decode(value["bytes"], validate=True)

    def sync_directory(self, path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def mkdir(self, name, metadata):
        with self.parent(name) as (path, parent_fd):
            if parent_fd is None:
                os.mkdir(path, 0o700)
                self.set_metadata(path, metadata)
                self.sync_directory(path.parent)
            else:
                os.mkdir(path.name, 0o700, dir_fd=parent_fd)
                fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
                try:
                    self.set_fd_metadata(fd, path, metadata)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                os.fsync(parent_fd)
        return self.snapshot(name)

    def write_new(self, name, data):
        require(len(data) <= LIMIT, "FILE_BOUND")
        with self.parent(name) as (path, parent_fd):
            options = {"dir_fd": parent_fd} if parent_fd is not None else {}
            fd = os.open(path.name if parent_fd is not None else path,
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, **options)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            self.set_metadata(path, {"uid": 0, "gid": 0, "mode": 0o600})
            self.sync_directory(path.parent)

    def append_auth(self, expected, desired):
        """One O_APPEND write, or exclusive creation; never replace/unlink user state."""
        require(self.snapshot(AUTH) == expected, "STATE_DRIFT")
        original = b"" if expected is None else base64.b64decode(expected["bytes"], validate=True)
        wanted = base64.b64decode(desired["bytes"], validate=True)
        require(wanted.startswith(original) and len(wanted) > len(original), "APPEND_CONTRACT_INVALID")
        tail = wanted[len(original):]
        with self.parent(AUTH) as (path, parent_fd):
            options = {"dir_fd": parent_fd} if parent_fd is not None else {}
            target = path.name if parent_fd is not None else path
            flags = (os.O_RDWR | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
                     | getattr(os, "O_BINARY", 0))
            if expected is None:
                flags |= os.O_CREAT | os.O_EXCL
            fd = os.open(target, flags, 0o600, **options)
            try:
                if expected is None:
                    if os.name == "posix":
                        self.set_fd_metadata(fd, path, desired["metadata"])
                    else:
                        self.set_metadata(path, desired["metadata"])
                info = os.fstat(fd)
                require(self.validate_info(path, info) == desired["metadata"], "STATE_DRIFT")
                current = os.read(fd, LIMIT + 1)
                require(current == original, "STATE_DRIFT")
                named = os.stat(target, follow_symlinks=False, **options)
                require((named.st_dev, named.st_ino) == (info.st_dev, info.st_ino), "STATE_DRIFT")
                # Recheck the rooted pathname, not just the pinned directory handle.
                rooted = path.lstat()
                require((rooted.st_dev, rooted.st_ino) == (info.st_dev, info.st_ino), "STATE_DRIFT")
                if expected is not None:
                    require(self.snapshot(AUTH) == expected, "STATE_DRIFT")
                # A concurrent append here remains before our tail. The exact
                # postimage check then refuses APPLIED rather than losing bytes.
                written = os.write(fd, tail)
                os.fsync(fd)
                require(written == len(tail), "APPEND_INCOMPLETE")
                os.lseek(fd, 0, os.SEEK_SET)
                require(os.read(fd, LIMIT + 1) == wanted, "POST_WRITE_MISMATCH")
                final = os.fstat(fd)
                require(self.validate_info(path, final) == desired["metadata"], "POST_WRITE_MISMATCH")
                rooted = path.lstat()
                require((rooted.st_dev, rooted.st_ino) == (final.st_dev, final.st_ino), "POST_WRITE_MISMATCH")
                require(self.snapshot(AUTH) == desired, "POST_WRITE_MISMATCH")
                if expected is None and parent_fd is not None:
                    os.fsync(parent_fd)
            finally:
                os.close(fd)

    def command(self, arguments):
        require(sys.platform == "linux" and self.root == Path("/") and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
        process = subprocess.Popen(arguments, cwd="/", stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"},
                                   start_new_session=True)
        output = bytearray()
        completed = False
        try:
            os.set_blocking(process.stdout.fileno(), False)
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 5
                while selector.get_map():
                    require(time.monotonic() < deadline, "OBSERVATION_TIMEOUT")
                    for key, _ in selector.select(0.1):
                        block = os.read(key.fd, 4096)
                        if not block:
                            selector.unregister(key.fileobj)
                        else:
                            output.extend(block)
                            require(len(output) <= LIMIT, "OBSERVATION_BOUND")
            require(process.wait(timeout=1) == 0, "OBSERVATION_FAILED")
            completed = True
            return output.decode("utf8").strip()
        finally:
            if not completed or process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=1)
            process.stdout.close()

    def observe(self):
        require(sys.platform == "linux" and self.root == Path("/") and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
        hostname = self.command(["/usr/bin/hostname"])
        # sysfs is kernel-owned; no arbitrary interface or path is accepted.
        with open("/sys/class/net/eth0/address", "r", encoding="ascii") as stream:
            mac = stream.read(64).strip()
        rows = json.loads(self.command(["/usr/sbin/ip", "-j", "-4", "address", "show", "dev", "eth0"]))
        require(len(rows) == 1 and rows[0].get("ifname") == "eth0", "GUEST_IDENTITY_MISMATCH")
        addresses = sorted(item["local"] + "/" + str(item["prefixlen"])
                           for item in rows[0]["addr_info"] if item.get("scope") == "global")
        host_key = self.read("/etc/ssh/ssh_host_ed25519_key.pub").decode().strip().split()
        require(len(host_key) in (2, 3), "PUBLIC_KEY_INVALID")
        host_fingerprint = public_fingerprint(" ".join(host_key[:2]))
        passwd = self.read("/etc/passwd").decode()
        accounts = [line for line in passwd.splitlines() if line.startswith("ai09:")]
        require(len(accounts) == 1 and self.command(["/usr/bin/getent", "passwd", "ai09"]) == accounts[0],
                "LOCAL_ACCOUNT_REQUIRED")
        fields = accounts[0].split(":")
        require(len(fields) == 7 and fields[1] == "x", "ACCOUNT_MISMATCH")
        account = {"name": fields[0], "uid": int(fields[2]), "gid": int(fields[3]),
                   "home": fields[5], "shell": fields[6]}
        # These utilities report status/dates only. Never read or emit shadow hashes.
        status = self.command(["/usr/bin/passwd", "-S", "ai09"]).split()
        require(len(status) == 7 and status[0] == "ai09", "ACCOUNT_STATUS_UNAVAILABLE")
        aging = self.command(["/usr/bin/chage", "-l", "-i", "ai09"])
        dates = {}
        for line in aging.splitlines():
            key, sep, value = line.partition(":")
            require(sep and key.strip() not in dates, "ACCOUNT_STATUS_UNAVAILABLE")
            dates[key.strip()] = value.strip()
        unexpired = True
        for key in ("Password expires", "Password inactive", "Account expires"):
            value = dates.get(key, "")
            if value != "never":
                require(re.fullmatch(r"\d{4}-\d\d-\d\d", value), "ACCOUNT_STATUS_UNAVAILABLE")
                unexpired = unexpired and dt.date.fromisoformat(value) > self.now().date()
        output = self.command(["/usr/sbin/sshd", "-G", "-T", "-C",
                               "user=ai09,addr=" + HOST + ",laddr=" + GUEST + ",lport=22"])
        selected = {"pubkeyauthentication", "strictmodes", "authorizedkeysfile",
                    "authorizedkeyscommand", "authenticationmethods", "forcecommand"}
        policy = {}
        for line in output.splitlines():
            key, _, value = line.partition(" ")
            if key in selected:
                require(key not in policy, "SSH_POLICY_UNSUPPORTED")
                policy[key] = value
        return {"effectiveUid": 0, "hostname": hostname, "mac": mac, "addresses": addresses,
                "hostKeyFingerprint": host_fingerprint, "account": account,
                "accountUnlocked": status[1] == "P", "accountUnexpired": unexpired,
                "policy": policy, "passwdSha256": digest(passwd.encode()),
                "agingSha256": digest(aging.encode())}


def snapshot_sources(system, sources, key, run_id):
    result = {}
    for name in sources:
        value = system.snapshot(name)
        result[name] = value
        if value is None:
            continue
        require(value["type"] == "file", "PATH_UNSAFE")
        data = base64.b64decode(value["bytes"], validate=True)
        require(key.split()[1].encode() not in data and
                ("goriq-ai09-1219-" + run_id).encode() not in data, "DUPLICATE_KEY")
    return result


def record(system, directory, name, value):
    system.write_new(directory + "/" + name + ".json", canonical(value))


def apply(system, raw, expected_sha, authorization_ref):
    plan, deadline = validate_plan(raw, expected_sha, authorization_ref, system.now())
    baseline = system.observe()
    sources = validate_baseline(baseline)
    before_ssh = system.snapshot(SSH)
    require(before_ssh is None or before_ssh["type"] == "directory", "PATH_UNSAFE")
    before = snapshot_sources(system, sources, plan["publicKey"], plan["runId"])
    original = before[AUTH]
    data = b"" if original is None else base64.b64decode(original["bytes"], validate=True)
    line = ('restrict,from="' + HOST + '",expiry-time="' + deadline.strftime("%Y%m%d%H%M%SZ") +
            '" ' + plan["publicKey"] + " goriq-ai09-1219-" + plan["runId"] + "\n").encode()
    after_bytes = data + (b"\n" if data and not data.endswith(b"\n") else b"") + line
    require(len(after_bytes) <= LIMIT, "FILE_BOUND")
    desired = {"type": "file", "metadata": original["metadata"] if original else
               {"uid": 1000, "gid": 1000, "mode": 0o600},
               "sha256": digest(after_bytes), "bytes": base64.b64encode(after_bytes).decode()}
    if system.snapshot(JOURNALS) is None:
        system.mkdir(JOURNALS, {"uid": 0, "gid": 0, "mode": 0o700})
    require(system.snapshot(JOURNALS)["metadata"] == {"uid": 0, "gid": 0, "mode": 0o700}, "JOURNAL_UNSAFE")
    directory = JOURNALS + "/" + plan["runId"]
    system.mkdir(directory, {"uid": 0, "gid": 0, "mode": 0o700})  # exclusive nonce, never replay
    journal = {"version": 1, "issue": 1219, "plan": plan, "planSha256": expected_sha,
               "baseline": baseline, "beforeSources": before, "beforeSsh": before_ssh,
               "afterAuth": desired, "createdAt": timestamp(system.now())}
    record(system, directory, "journal", journal)
    try:
        validate_plan(raw, expected_sha, authorization_ref, system.now())
        require(system.observe() == baseline and system.snapshot(SSH) == before_ssh
                and all(system.snapshot(name) == value for name, value in before.items()), "STATE_DRIFT")
        if before_ssh is None:
            created = system.mkdir(SSH, {"uid": 1000, "gid": 1000, "mode": 0o700})
            record(system, directory, "created-ssh", created)
        validate_plan(raw, expected_sha, authorization_ref, system.now())
        system.append_auth(original, desired)
        require(system.observe() == baseline, "POST_BASELINE_MISMATCH")
        validate_plan(raw, expected_sha, authorization_ref, system.now())
        receipt = {"version": 1, "issue": 1219, "status": "APPLIED", "runId": plan["runId"],
                   "authorizationRef": authorization_ref, "planSha256": expected_sha,
                   "executorSha256": plan["executorSha256"], "expiresAt": plan["expiresAt"],
                   "publicKeyFingerprint": public_fingerprint(plan["publicKey"]),
                   "authorizedKeysSha256": desired["sha256"], "observedAt": timestamp(system.now()),
                   "access": "ordinary-ai09-command-access", "authenticatedConnectionVerified": False,
                   "automaticKeyRollbackSupported": False,
                   "existingSessionsTerminatedByExpiry": False,
                   "physicalE2EVerified": False}
        record(system, directory, "applied", receipt)
        return receipt
    except Exception:
        # Deliberately do not silently undo a mutation after another state drifts.
        record(system, directory, "failure", {"status": "RECONCILIATION_REQUIRED",
               "observedAt": timestamp(system.now()), "authorizedKeysMayHaveChanged": True})
        raise


def rollback(system, run_id, authorization_ref):
    require(isinstance(run_id, str) and re.fullmatch("[a-f0-9]{32}", run_id), "RUN_ID_INVALID")
    baseline = system.observe()
    # This is a nonmutating reconciliation request, never a claim of revocation.
    require(baseline.get("effectiveUid") == 0 and baseline.get("hostname") == "848484"
            and baseline.get("mac") == "00:15:5d:dc:2c:00"
            and baseline.get("addresses") == [GUEST + "/20"]
            and baseline.get("hostKeyFingerprint") == HOST_FINGERPRINT, "GUEST_IDENTITY_MISMATCH")
    directory = JOURNALS + "/" + run_id
    for name in (JOURNALS, directory):
        value = system.snapshot(name)
        require(value is not None and value["type"] == "directory"
                and value["metadata"] == {"uid": 0, "gid": 0, "mode": 0o700}, "JOURNAL_UNSAFE")
    require(system.snapshot(directory + "/journal.json")["metadata"]
            == {"uid": 0, "gid": 0, "mode": 0o600}, "JOURNAL_UNSAFE")
    journal = decode_json(system.read(directory + "/journal.json"))
    require(journal["version"] == 1 and journal["issue"] == 1219
            and journal["plan"]["runId"] == run_id
            and journal["plan"]["authorizationRef"] == authorization_ref, "AUTHORIZATION_MISMATCH")
    require(baseline["account"] == journal["baseline"]["account"], "ACCOUNT_MISMATCH")
    # User-owned authorized_keys has no supported exact compare-and-swap. Even
    # apparently matching bytes cannot authorize replacement/removal after a
    # subsequent concurrent write. Do not attempt any automatic restoration.
    receipt = {"version": 1, "issue": 1219, "status": "MANUAL_RECONCILIATION_REQUIRED", "runId": run_id,
               "authorizationRef": authorization_ref, "observedAt": timestamp(system.now()),
               "authorizedKeysRestored": False, "authorizedKeysWritten": False,
               "authenticatedConnectionVerified": False, "physicalE2EVerified": False}
    if system.snapshot(directory + "/rollback-refused.json") is None:
        record(system, directory, "rollback-refused", receipt)
    raise ValueError("MANUAL_RECONCILIATION_REQUIRED")


def main():
    try:
        require(sys.platform == "linux" and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
        args = sys.argv[1:]
        system = NativeSystem()
        if len(args) == 4 and args[0] == "apply":
            path = Path(args[1])
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT, "PLAN_FILE_INVALID")
            with path.open("rb") as stream:
                raw = stream.read(LIMIT + 1)
            result = apply(system, raw, args[2], args[3])
        elif len(args) == 3 and args[0] == "rollback":
            result = rollback(system, args[1], args[2])
        else:
            raise ValueError("ARGUMENTS_INVALID")
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except Exception as error:
        code = str(error)
        if not re.fullmatch("[A-Z][A-Z0-9_]{1,80}", code):
            code = "ENROLLMENT_REFUSED"
        print(json.dumps({"version": 1, "issue": 1219, "status": "BLOCKED", "code": code,
                          "stateUnchangedVerified": False,
                          "authenticatedConnectionVerified": False, "physicalE2EVerified": False}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

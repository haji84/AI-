"""Filesystem adapter tests only; no guest, SSH, credentials or native PASS."""
import base64
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

SOURCE = Path("scripts/ai09-owner-key-enroll.py")
NOW = dt.datetime(2026, 10, 20, 4, tzinfo=dt.timezone.utc)
PUBLIC = "ssh-ed25519 " + base64.b64encode(
    b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + bytes(range(32))).decode()
REF = "owner-1219-fixture-approved"
RUN = "1234567890abcdef1234567890abcdef"
ORIGINAL = b"# retained existing line\r\nssh-rsa AAAATEST existing-owner\n"


class Enrollment(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SOURCE.is_file(), "bounded ordinary-account enrollment helper is missing")
        spec = importlib.util.spec_from_file_location("owner_key_enroll", SOURCE)
        self.g = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.g)
        self.temp = tempfile.TemporaryDirectory(prefix="ai09-enroll-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("home/ai09/.ssh", "var/lib"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        (self.root / "home/ai09/.ssh/authorized_keys").write_bytes(ORIGINAL)
        g = self.g

        class Fixture(g.NativeSystem):
            def __init__(fixture):
                super().__init__()
                fixture.root = self.root
                fixture.clock = NOW
                fixture.modes = {}
                fixture.observation = {
                    "effectiveUid": 0, "hostname": "848484",
                    "mac": "00:15:5d:dc:2c:00", "addresses": ["172.27.140.254/20"],
                    "hostKeyFingerprint": "SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA",
                    "account": {"name": "ai09", "uid": 1000, "gid": 1000,
                                "home": "/home/ai09", "shell": "/bin/bash"},
                    "accountUnlocked": True, "accountUnexpired": True,
                    "policy": {"pubkeyauthentication": "yes", "strictmodes": "yes",
                               "authorizedkeysfile": ".ssh/authorized_keys .ssh/authorized_keys2",
                               "authorizedkeyscommand": "none", "authenticationmethods": "any",
                               "forcecommand": "none"},
                }
                fixture.observations = 0
                fixture.drift_on_observation = None

            def now(fixture):
                return fixture.clock

            def observe(fixture):
                fixture.observations += 1
                if fixture.drift_on_observation == fixture.observations:
                    fixture.path(g.AUTH).write_bytes(b"concurrent owner update\n")
                return copy.deepcopy(fixture.observation)

            def metadata(fixture, path, info):
                name = "/" + path.relative_to(fixture.root).as_posix()
                uid = 1000 if name.startswith("/home/ai09") else 0
                mode = 0o755 if stat.S_ISDIR(info.st_mode) else 0o640
                if os.name == "posix":
                    mode = stat.S_IMODE(info.st_mode)
                if name.startswith(g.JOURNALS):
                    uid, mode = 0, 0o700 if stat.S_ISDIR(info.st_mode) else 0o600
                return fixture.modes.get(name, {"uid": uid, "gid": uid, "mode": mode})

            def set_metadata(fixture, path, metadata):
                name = "/" + path.relative_to(fixture.root).as_posix()
                fixture.modes[name] = dict(metadata)

            def set_fd_metadata(fixture, fd, path, metadata):
                # Tests never chown to a real account or require root.
                os.fchmod(fd, metadata["mode"])
                fixture.set_metadata(path, metadata)

            def sync_directory(fixture, path):
                pass

        self.system = Fixture()
        self.plan = {"version": 1, "issue": 1219, "runId": RUN,
                     "authorizationRef": REF, "expiresAt": "2026-10-20T05:00:00Z",
                     "publicKey": PUBLIC, "executorSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest()}

    def encoded(self, plan=None):
        raw = json.dumps(plan or self.plan, separators=(",", ":")).encode()
        return raw, hashlib.sha256(raw).hexdigest()

    def apply(self, plan=None, sha=None, ref=REF):
        raw, expected = self.encoded(plan)
        return self.g.apply(self.system, raw, sha or expected, ref)

    def test_appends_one_key_preserves_metadata_and_refuses_unsafe_automatic_restore(self):
        before = self.system.snapshot(self.g.AUTH)
        result = self.apply()
        expected = (ORIGINAL + b'restrict,from="172.27.128.1",expiry-time="20261020050000Z" '
                    + PUBLIC.encode() + b" goriq-ai09-1219-" + RUN.encode() + b"\n")
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), expected)
        self.assertEqual(self.system.snapshot(self.g.AUTH)["metadata"], before["metadata"])
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual(result["access"], "ordinary-ai09-command-access")
        self.assertFalse(result["authenticatedConnectionVerified"])
        self.assertFalse(result["physicalE2EVerified"])
        self.assertTrue(self.system.path(self.g.JOURNALS + "/" + RUN + "/journal.json").is_file())
        with self.assertRaisesRegex(ValueError, "MANUAL_RECONCILIATION_REQUIRED"):
            self.g.rollback(self.system, RUN, REF)
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), expected)
        refused = json.loads(self.system.path(self.g.JOURNALS + "/" + RUN + "/rollback-refused.json").read_bytes())
        self.assertFalse(refused["authorizedKeysRestored"])
        self.assertFalse(refused["authorizedKeysWritten"])
        self.assertTrue(self.system.path(self.g.JOURNALS + "/" + RUN + "/journal.json").is_file())

    def test_missing_directory_and_file_created_with_exact_owner_modes(self):
        self.system.path(self.g.AUTH).unlink()
        self.system.path(self.g.SSH).rmdir()
        self.apply()
        self.assertEqual(self.system.snapshot(self.g.AUTH)["metadata"], {"uid": 1000, "gid": 1000, "mode": 0o600})
        self.assertEqual(self.system.snapshot(self.g.SSH)["metadata"], {"uid": 1000, "gid": 1000, "mode": 0o700})
        before_rollback = self.system.snapshot(self.g.AUTH)
        with self.assertRaisesRegex(ValueError, "MANUAL_RECONCILIATION_REQUIRED"):
            self.g.rollback(self.system, RUN, REF)
        self.assertEqual(self.system.snapshot(self.g.AUTH), before_rollback)
        # Automatic rollback never deletes any authorized_keys or evidence.
        self.assertTrue(self.system.path(self.g.JOURNALS + "/" + RUN).is_dir())

    def test_rejects_wrong_pin_authorization_executor_unknown_fields_and_lease(self):
        variants = [{"executorSha256": "0" * 64}, {"extra": True},
                    {"expiresAt": "2026-10-20T03:00:00Z"}, {"expiresAt": "2026-10-22T04:00:00Z"},
                    {"publicKey": PUBLIC + " injected-comment"}, {"runId": "../escape"}]
        for change in variants:
            with self.subTest(change=change):
                plan = {**self.plan, **change}
                with self.assertRaises(ValueError):
                    self.apply(plan)
        for kwargs in ({"sha": "0" * 64}, {"ref": "wrong-approval"}):
            with self.assertRaises(ValueError):
                self.apply(**kwargs)
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), ORIGINAL)
        self.assertFalse(self.system.path(self.g.JOURNALS).exists())

    def test_rejects_identity_locked_expired_account_and_unsupported_policy_before_write(self):
        original = copy.deepcopy(self.system.observation)
        variants = [{"effectiveUid": 1000}, {"hostname": "different"},
                    {"mac": "00:15:5d:00:00:00"}, {"addresses": ["172.27.140.253/20"]},
                    {"hostKeyFingerprint": "SHA256:wrong"}, {"accountUnlocked": False},
                    {"accountUnexpired": False},
                    {"account": {**original["account"], "shell": "/bin/dash"}},
                    {"policy": {**original["policy"], "pubkeyauthentication": "no"}},
                    {"policy": {**original["policy"], "authorizedkeysfile": "/tmp/keys"}},
                    {"policy": {**original["policy"], "authenticationmethods": "publickey,password"}}]
        for change in variants:
            self.system.observation = {**original, **change}
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.apply()
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), ORIGINAL)
        self.assertFalse(self.system.path(self.g.JOURNALS).exists())

    def test_rejects_duplicate_key_in_secondary_authorized_source(self):
        other = self.system.path(self.g.SSH + "/authorized_keys2")
        other.write_text('from="172.27.128.1" ' + PUBLIC + " already-present\n")
        with self.assertRaisesRegex(ValueError, "DUPLICATE_KEY"):
            self.apply()
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), ORIGINAL)

    def test_rejects_hardlink_and_unsafe_ancestor(self):
        other = self.root / "same-inode"
        os.link(self.system.path(self.g.AUTH), other)
        with self.assertRaisesRegex(ValueError, "PATH_UNSAFE"):
            self.apply()
        other.unlink()
        self.system.modes["/home/ai09"] = {"uid": 1000, "gid": 1000, "mode": 0o777}
        with self.assertRaisesRegex(ValueError, "PATH_UNSAFE"):
            self.apply()
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), ORIGINAL)

    def test_rejects_symlink_without_following_it(self):
        target = self.root / "outside"
        target.write_bytes(b"do not modify")
        self.system.path(self.g.AUTH).unlink()
        try:
            self.system.path(self.g.AUTH).symlink_to(target)
        except OSError as error:
            self.skipTest("Windows symlink privilege unavailable: " + str(error.winerror))
        with self.assertRaisesRegex(ValueError, "PATH_UNSAFE"):
            self.apply()
        self.assertEqual(target.read_bytes(), b"do not modify")

    def test_refuses_concurrent_edit_and_retains_before_image_journal(self):
        self.system.drift_on_observation = 2
        with self.assertRaisesRegex(ValueError, "STATE_DRIFT"):
            self.apply()
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), b"concurrent owner update\n")
        self.assertTrue(self.system.path(self.g.JOURNALS + "/" + RUN + "/journal.json").is_file())

    def test_refuses_duplicate_run_and_rollback_of_concurrent_owner_edit(self):
        self.apply()
        with self.assertRaises(ValueError):
            self.apply()
        changed = self.system.path(self.g.AUTH).read_bytes() + b"# owner concurrent edit\n"
        self.system.path(self.g.AUTH).write_bytes(changed)
        with self.assertRaisesRegex(ValueError, "MANUAL_RECONCILIATION_REQUIRED"):
            self.g.rollback(self.system, RUN, REF)
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), changed)

    def test_expired_plan_rollback_remains_nonmutating_and_wrong_ref_is_refused(self):
        self.apply()
        enrolled = self.system.snapshot(self.g.AUTH)
        self.system.clock = NOW + dt.timedelta(days=2)
        with self.assertRaisesRegex(ValueError, "AUTHORIZATION"):
            self.g.rollback(self.system, RUN, "wrong")
        with self.assertRaisesRegex(ValueError, "MANUAL_RECONCILIATION_REQUIRED"):
            self.g.rollback(self.system, RUN, REF)
        self.assertEqual(self.system.snapshot(self.g.AUTH), enrolled)

    def test_apply_failure_preserves_journal_and_does_not_claim_rollback_restoration(self):
        original_observe = self.system.observe
        def observe():
            result = original_observe()
            if self.system.observations >= 3:
                result["accountUnlocked"] = False
            return result
        self.system.observe = observe
        with self.assertRaisesRegex(ValueError, "POST_BASELINE_MISMATCH"):
            self.apply()
        self.assertIn(PUBLIC.encode(), self.system.path(self.g.AUTH).read_bytes())
        failure = json.loads(self.system.path(self.g.JOURNALS + "/" + RUN + "/failure.json").read_bytes())
        self.assertTrue(failure["authorizedKeysMayHaveChanged"])
        enrolled = self.system.snapshot(self.g.AUTH)
        with self.assertRaisesRegex(ValueError, "MANUAL_RECONCILIATION_REQUIRED"):
            self.g.rollback(self.system, RUN, REF)
        self.assertEqual(self.system.snapshot(self.g.AUTH), enrolled)

    def test_owner_append_at_last_write_boundary_is_preserved_and_never_reports_applied(self):
        owner_bytes = b"# concurrent owner update must survive\n"
        original_write, original_replace = self.g.os.write, self.g.os.replace
        injected = []
        def inject():
            if not injected:
                with self.system.path(self.g.AUTH).open("ab") as stream:
                    stream.write(owner_bytes)
                injected.append(True)
        def racing_write(fd, data):
            inject()
            return original_write(fd, data)
        def racing_replace(*args, **kwargs):
            # Reproduces the reviewed bug in the original replace implementation.
            inject()
            return original_replace(*args, **kwargs)
        result, failure = None, None
        with patch.object(self.g.os, "write", racing_write), patch.object(self.g.os, "replace", racing_replace):
            try:
                result = self.apply()
            except ValueError as error:
                failure = str(error)
        self.assertTrue(injected, "fixture must reach the actual final mutation boundary")
        actual = self.system.path(self.g.AUTH).read_bytes()
        self.assertIn(owner_bytes, actual, "concurrent owner bytes must not be replaced")
        self.assertTrue(actual.startswith(ORIGINAL + owner_bytes))
        self.assertIsNone(result, "uncertain concurrent result must not be APPLIED")
        self.assertEqual(failure, "POST_WRITE_MISMATCH")
        self.assertFalse(self.system.path(self.g.JOURNALS + "/" + RUN + "/applied.json").exists())
        self.assertTrue(self.system.path(self.g.JOURNALS + "/" + RUN + "/failure.json").is_file())

    def test_racing_creation_of_new_auth_file_is_never_overwritten(self):
        self.system.path(self.g.AUTH).unlink()
        original_open, original_replace = self.g.os.open, self.g.os.replace
        owner_bytes = b"# owner created this file concurrently\n"
        injected = []
        def inject():
            if not injected:
                self.system.path(self.g.AUTH).write_bytes(owner_bytes)
                injected.append(True)
        def racing_open(path, flags, *args, **kwargs):
            if Path(path).name == "authorized_keys" and flags & os.O_CREAT:
                inject()
            return original_open(path, flags, *args, **kwargs)
        def racing_replace(*args, **kwargs):
            inject()
            return original_replace(*args, **kwargs)
        with patch.object(self.g.os, "open", racing_open), patch.object(self.g.os, "replace", racing_replace):
            try:
                self.apply()
            except (ValueError, OSError):
                pass
        self.assertTrue(injected)
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), owner_bytes)
        self.assertFalse(self.system.path(self.g.JOURNALS + "/" + RUN + "/applied.json").exists())

    def test_leader_clock_expiry_before_mutation_keeps_key_absent(self):
        original_observe = self.system.observe
        def observe():
            result = original_observe()
            if self.system.observations == 2:
                self.system.clock += dt.timedelta(hours=2)
            return result
        self.system.observe = observe
        with self.assertRaisesRegex(ValueError, "LEASE_INVALID"):
            self.apply()
        self.assertEqual(self.system.path(self.g.AUTH).read_bytes(), ORIGINAL)

    def test_rollback_checks_root_journal_mode_before_trusting_backup(self):
        self.apply()
        self.system.modes[self.g.JOURNALS + "/" + RUN] = {"uid": 0, "gid": 0, "mode": 0o755}
        with self.assertRaisesRegex(ValueError, "JOURNAL_UNSAFE"):
            self.g.rollback(self.system, RUN, REF)
        self.assertIn(PUBLIC.encode(), self.system.path(self.g.AUTH).read_bytes())

    def test_native_status_parser_uses_only_public_status_commands_and_supports_socket_activation(self):
        g = self.g
        # Adapter replaces only OS observation boundaries; production parser runs.
        native = g.NativeSystem()
        native.now = lambda: NOW
        commands = []
        host_public = "ssh-ed25519 " + base64.b64encode(
            b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + bytes(range(1, 33))).decode()
        def read(name):
            return {
                "/etc/passwd": b"root:x:0:0:root:/root:/bin/bash\nai09:x:1000:1000::/home/ai09:/bin/bash\n",
                "/etc/ssh/ssh_host_ed25519_key.pub": (host_public + " host\n").encode(),
            }[name]
        def command(args):
            commands.append(args)
            if args == ["/usr/bin/hostname"]:
                return "848484"
            if args == ["/usr/sbin/ip", "-j", "-4", "address", "show", "dev", "eth0"]:
                return '[{"ifname":"eth0","addr_info":[{"local":"172.27.140.254","prefixlen":20,"scope":"global"}]}]'
            if args == ["/usr/bin/getent", "passwd", "ai09"]:
                return "ai09:x:1000:1000::/home/ai09:/bin/bash"
            if args == ["/usr/bin/passwd", "-S", "ai09"]:
                return "ai09 P 2026-01-01 0 99999 7 -1"
            if args == ["/usr/bin/chage", "-l", "-i", "ai09"]:
                return "Last password change : 2026-01-01\nPassword expires : never\nPassword inactive : never\nAccount expires : never"
            if args == ["/usr/sbin/sshd", "-G", "-T", "-C",
                        "user=ai09,addr=172.27.128.1,laddr=172.27.140.254,lport=22"]:
                return "\n".join(key + " " + value for key, value in self.system.observation["policy"].items())
            self.fail("unexpected native command: " + str(args))
        native.read, native.command = read, command
        import io
        def public_open(name, *args, **kwargs):
            self.assertEqual(name, "/sys/class/net/eth0/address")
            return io.StringIO("00:15:5d:dc:2c:00\n")
        with patch.object(g.sys, "platform", "linux"), patch.object(g.os, "geteuid", return_value=0, create=True), patch("builtins.open", public_open):
            observed = native.observe()
        self.assertTrue(observed["accountUnlocked"])
        self.assertTrue(observed["accountUnexpired"])
        self.assertEqual(observed["account"]["shell"], "/bin/bash")
        self.assertEqual(len(commands), 6)


if __name__ == "__main__":
    unittest.main()

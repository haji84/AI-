import importlib.util
import pathlib
import base64
import copy
import hashlib
import json
import tempfile
import time
import unittest
import os
from unittest.mock import patch

SOURCE = pathlib.Path("scripts/ai09-access-guest.py")


def load():
    spec = importlib.util.spec_from_file_location("ai09_access_guest", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Availability(unittest.TestCase):
    def test_guest_executor_supplies_read_only_and_scoped_mutation_entrypoints(self):
        source = pathlib.Path("scripts/ai09-access-guest.py")
        self.assertTrue(source.is_file(), "bounded guest activation executor is missing")
        spec = importlib.util.spec_from_file_location("ai09_access_guest", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(callable(module.inspect_guest))
        self.assertTrue(callable(module.apply_guest))
        self.assertTrue(callable(module.rollback_guest))


class Activation(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SOURCE.exists(), "bounded guest activation executor is missing")
        self.g = load()
        self.temp = tempfile.TemporaryDirectory(prefix="ai09-guest-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        for path in ["etc/ssh", "root", "usr/local/libexec"]:
            (self.root / path).mkdir(parents=True, exist_ok=True)
        self.original = b"Port 22\nUsePAM yes\n"
        (self.root / "etc/ssh/sshd_config").write_bytes(self.original)
        (self.root / "etc/passwd").write_text("root:x:0:0:root:/root:/bin/bash\nai09:x:1000:1000::/home/ai09:/bin/dash\nother:x:1001:1001::/home/other:/bin/bash\n")
        g, root = self.g, self.root

        class Fixture(g.GuestSystem):
            def __init__(self):
                super().__init__(root, enforce_owner=False)
                self.reloads = 0
                self.fail_reload = False
                self.policy_drift = False
                self.active_connections = False
                self.observations = 0
                self.shell_drift_at = None
                self.clock_jump_at = None
                self.clock_value = time.time()

            def observe(self, host, guest):
                self.observations += 1
                if self.observations == self.shell_drift_at:
                    self.set_shell("/bin/bash")
                if self.observations == self.clock_jump_at:
                    self.clock_value += 7200
                account = self.account()
                changed = b"# GORIQ AI09 BEGIN" in self.read("/etc/ssh/sshd_config")
                return {
                    "hostname": "848484", "nicMac": "00:15:5d:dc:2c:00", "guestAddress": guest,
                    "account": account, "accountSha256": g.digest(g.canonical(account)),
                    "publicHostKey": "ssh-ed25519 " + base64.b64encode(b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" + bytes(range(32))).decode(),
                    "sshActive": True, "dashTrusted": True,
                    "configSha256": g.digest(self.read("/etc/ssh/sshd_config")),
                    "includedConfigSha256": "a" * 64,
                    "authorizedSources": {"paths": {}, "fingerprints": []},
                    "policy": {"authorizedKeysFile": (g.AUTH + " " if changed else "") + ".ssh/authorized_keys .ssh/authorized_keys2",
                               "stableSha256": ("c" if changed and self.policy_drift else "b") * 64,
                               "outsideSha256": "d" * 64, "otherUserSha256": "e" * 64,
                               "safe": True},
                }

            def account(self):
                records = self.read("/etc/passwd").decode().splitlines()
                selected = [line.split(":") for line in records if line.startswith("ai09:")]
                if len(selected) != 1:
                    raise ValueError("LOCAL_ACCOUNT_REQUIRED")
                fields = selected[0]
                return {"uid": int(fields[2]), "gid": int(fields[3]), "home": fields[5], "shell": fields[6]}

            def set_shell(self, shell):
                rows = self.read("/etc/passwd").decode().splitlines()
                self.path("/etc/passwd").write_text("\n".join(":".join(row.split(":")[:-1] + [shell]) if row.startswith("ai09:") else row for row in rows) + "\n")

            def validate_sshd(self, candidate=None):
                return None

            def no_connections(self):
                g.require(not self.active_connections, "SHELL_RESTORE_CONNECTIONS_ACTIVE")

            def reload(self, before_signal=None):
                if before_signal:
                    before_signal()
                self.reloads += 1
                if self.fail_reload:
                    self.fail_reload = False
                    raise ValueError("RELOAD_FAILED")

        self.system = Fixture()
        self.host, self.guest = "172.27.128.1", "172.27.140.2"
        self.gate = pathlib.Path("scripts/ai09-baseline-command-gate.sh").read_bytes().replace(b"\r\n", b"\n")
        self.observed = self.g.inspect_guest(self.system, self.host, self.guest)
        self.plan = {
            "version": 1, "issue": 1219, "hostAddress": self.host, "guestAddress": self.guest,
            "expectedHostname": "848484", "nicMac": "00:15:5d:dc:2c:00",
            "publicKey": self.observed["baseline"]["publicHostKey"],
            "gateSha256": self.g.digest(self.gate), "executorSha256": self.g.digest(SOURCE.read_bytes()),
            "baselineSha256": self.observed["baselineSha256"], "baselineObservedAt": self.observed["observedAt"],
            "expiresAt": self.g.timestamp(time.time() + 3600), "shellPolicy": "use-existing-dash",
            "authorizationRef": "owner-fixture-reference", "approvedActions": ["install-ai09-fixed-ssh-access"],
        }
        self.journal = self.root / "root/journal.jsonl"

    def apply(self, plan=None):
        plan = plan or self.plan
        raw = self.g.canonical(plan)
        return self.g.apply_guest(self.system, raw, self.g.digest(raw), self.gate, self.journal)

    def test_inspect_is_read_only_and_binds_identity(self):
        self.assertEqual(self.observed["status"], "OBSERVED")
        self.assertEqual(self.system.reloads, 0)
        self.assertFalse(self.system.path(self.g.MANAGED).exists())
        self.assertEqual(self.system.read("/etc/ssh/sshd_config"), self.original)

    def test_apply_restricts_key_and_preserves_original_paths_then_rollback_restores(self):
        result = self.apply()
        self.assertEqual(result["status"], "APPLIED")
        key = self.system.read(self.g.AUTH).decode()
        self.assertIn('restrict,from="172.27.128.1/32",expiry-time="', key)
        self.assertIn('command="/etc/ssh/goriq-ai09-baseline/gate.sh"', key)
        self.assertEqual(self.system.read(self.g.BASELINE), self.gate)
        self.assertIn(b'/usr/bin/date -u +%s', self.system.read(self.g.GATE))
        self.assertIn(b'exec /usr/bin/env -i', self.system.read(self.g.GATE))
        self.assertTrue(self.system.read("/etc/ssh/sshd_config").startswith(self.original))
        self.assertIn(b"AuthorizedKeysFile /etc/ssh/goriq-ai09-baseline/authorized_keys .ssh/authorized_keys .ssh/authorized_keys2", self.system.read("/etc/ssh/sshd_config"))
        restored = self.g.rollback_guest(self.system, self.journal)
        self.assertEqual(restored["status"], "ROLLED_BACK")
        self.assertEqual(self.system.read("/etc/ssh/sshd_config"), self.original)
        self.assertFalse(self.system.path(self.g.MANAGED).exists())
        self.assertTrue(self.journal.exists())

    def test_wrong_scope_pin_expiry_or_approval_cannot_write(self):
        for field, value in [("issue", 2), ("hostAddress", "0.0.0.0"), ("guestAddress", self.host),
                             ("expiresAt", "2000-01-01T00:00:00.000Z"), ("approvedActions", []),
                             ("gateSha256", "0" * 64), ("executorSha256", "0" * 64),
                             ("publicKey", "ssh-ed25519 bad\ncommand=anything")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                p = copy.deepcopy(self.plan); p[field] = value; self.apply(p)
            self.assertFalse(self.journal.exists())
        with self.assertRaises(ValueError):
            self.g.apply_guest(self.system, self.g.canonical(self.plan), "0" * 64, self.gate, self.journal)

    def test_baseline_drift_or_preexisting_destination_refuses_before_mutation(self):
        self.system.path("/etc/ssh/sshd_config").write_bytes(self.original + b"# changed\n")
        with self.assertRaisesRegex(ValueError, "BASELINE"):
            self.apply()
        self.assertFalse(self.journal.exists())
        self.system.path("/etc/ssh/sshd_config").write_bytes(self.original)
        self.system.path(self.g.MANAGED).mkdir()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertFalse(self.journal.exists())

    def test_explicit_shell_change_is_separately_scoped_and_reversible(self):
        self.system.set_shell("/bin/bash")
        self.plan["baselineSha256"] = self.g.inspect_guest(self.system, self.host, self.guest)["baselineSha256"]
        with self.assertRaisesRegex(ValueError, "SHELL"):
            self.apply()
        self.plan["shellPolicy"] = "switch-bash-to-dash"
        with self.assertRaisesRegex(ValueError, "APPROVAL"):
            self.apply()
        self.plan["approvedActions"].append("change-ai09-login-shell")
        self.apply()
        self.assertEqual(self.system.account()["shell"], "/bin/dash")
        self.g.rollback_guest(self.system, self.journal)
        self.assertEqual(self.system.account()["shell"], "/bin/bash")

    def test_failed_policy_or_reload_restores_only_own_additions(self):
        for failure in ["policy_drift", "fail_reload"]:
            with self.subTest(failure=failure):
                setattr(self.system, failure, True)
                with self.assertRaises(ValueError):
                    self.apply()
                self.assertEqual(self.system.read("/etc/ssh/sshd_config"), self.original)
                self.assertFalse(self.system.path(self.g.MANAGED).exists())
                self.assertIn("ROLLED_BACK", self.journal.read_text())
                self.journal = self.root / "root/second.jsonl"
                setattr(self.system, failure, False)

    def test_rollback_does_not_overwrite_concurrent_config_or_managed_file(self):
        self.apply()
        modified = self.system.read("/etc/ssh/sshd_config") + b"# administrator change\n"
        self.system.path("/etc/ssh/sshd_config").write_bytes(modified)
        with self.assertRaisesRegex(ValueError, "DRIFT"):
            self.g.rollback_guest(self.system, self.journal)
        self.assertEqual(self.system.read("/etc/ssh/sshd_config"), modified)
        self.assertEqual(self.system.read(self.g.GATE), self.g.REVOKED)

    def test_active_connections_defer_shell_restoration_after_gate_revocation(self):
        self.system.set_shell("/bin/bash")
        self.plan["baselineSha256"] = self.g.inspect_guest(self.system, self.host, self.guest)["baselineSha256"]
        self.plan["shellPolicy"] = "switch-bash-to-dash"
        self.plan["approvedActions"].append("change-ai09-login-shell")
        self.apply()
        self.system.active_connections = True
        with self.assertRaisesRegex(ValueError, "CONNECTIONS_ACTIVE"):
            self.g.rollback_guest(self.system, self.journal)
        self.assertEqual(self.system.account()["shell"], "/bin/dash")
        self.assertEqual(self.system.read(self.g.GATE), self.g.REVOKED)
        self.system.active_connections = False
        self.g.rollback_guest(self.system, self.journal)
        self.assertEqual(self.system.account()["shell"], "/bin/bash")

    def test_native_policy_preserves_repeated_fields_and_rejects_ambiguous_scalar(self):
        policy = self.g.parse_effective_policy("hostkey /etc/ssh/key1\nhostkey /etc/ssh/key2\nacceptenv LANG\nacceptenv LC_*\nport 22\n")
        self.assertEqual(policy["hostkey"], ["/etc/ssh/key1", "/etc/ssh/key2"])
        self.assertEqual(policy["acceptenv"], "LANG LC_*")
        with self.assertRaisesRegex(ValueError, "DUPLICATE"):
            self.g.parse_effective_policy("permituserenvironment no\npermituserenvironment yes\n")

    def test_shell_change_between_baseline_and_reload_cannot_return_applied(self):
        self.system.shell_drift_at = self.system.observations + 3
        with self.assertRaisesRegex(ValueError, "APPLY_FAILED"):
            self.apply()
        self.assertNotIn('"status":"APPLIED"', self.journal.read_text())
        self.assertEqual(self.system.account()["shell"], "/bin/bash")

    @unittest.skipIf(os.name == "nt", "POSIX permission assertion")
    def test_restrictive_root_umask_still_allows_sshd_to_read_public_authority(self):
        mask = os.umask(0o077)
        try:
            self.apply()
        finally:
            os.umask(mask)
        self.assertEqual(self.system.path(self.g.MANAGED).stat().st_mode & 0o777, 0o755)
        self.assertEqual(self.system.path(self.g.AUTH).stat().st_mode & 0o777, 0o644)

    def test_include_inventory_rejects_tabs_and_untracked_paths(self):
        self.g.validate_includes(b"Include\t/etc/ssh/sshd_config.d/*.conf\n")
        for content in [b"Include\t/home/ai09/custom.conf\n", b"include=/home/ai09/custom.conf\n", b"Include /etc/ssh/sshd_config.d/*.conf /other\n"]:
            with self.assertRaisesRegex(ValueError, "INCLUDE"):
                self.g.validate_includes(content)

    def test_service_contract_rejects_options_wrong_listener_or_changed_pid(self):
        props = {
            "MainPID": "123", "ExecStart": "{ path=/usr/sbin/sshd ; argv[]=/usr/sbin/sshd -D $SSHD_OPTS ; ignore_errors=no ; }",
            "Environment": "", "EnvironmentFiles": "/etc/default/ssh (ignore_errors=yes)", "PassEnvironment": "",
            "RootDirectory": "", "RootImage": "", "User": "", "Group": "", "NeedDaemonReload": "no",
        }
        listener = 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=123,fd=3),("systemd",pid=1,fd=99))'
        kwargs = dict(properties=props, defaults=b'SSHD_OPTS=""\n', process_environment=b'LANG=C\x00',
                      process_args=b'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups\x00',
                      executable="/usr/sbin/sshd", listeners=listener, final_pid="123", guest=self.guest)
        self.g.validate_service_contract(**kwargs)
        for key, value in [("defaults", b'SSHD_OPTS="-f /other"\n'), ("process_environment", b'SSHD_OPTS=-o PermitUserEnvironment=yes\x00'),
                           ("process_args", b'/usr/sbin/sshd\x00-D\x00-f\x00/other\x00'), ("listeners", ""),
                           ("listeners", listener.replace("pid=123", "pid=999")), ("final_pid", "999")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.g.validate_service_contract(**{**kwargs, key: value})

    def test_duplicate_apply_cannot_replace_journal_or_owned_files(self):
        self.apply()
        before = self.journal.read_bytes()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.journal.read_bytes(), before)

    def test_interrupted_final_journal_append_is_recovered_but_interior_corruption_is_not(self):
        self.apply()
        complete = self.journal.read_bytes()
        with self.journal.open("ab") as stream:
            stream.write(b'{"status":"interrupted')
        self.g.rollback_guest(self.system, self.journal)
        self.assertIn('"status":"INTERRUPTED_APPEND_RECOVERED"', self.journal.read_text())
        self.assertEqual(self.system.read(self.g.CONFIG), self.original)
        self.journal.write_bytes(complete.split(b"\n", 1)[0] + b'\n{invalid}\n')
        with self.assertRaises(ValueError):
            self.g.rollback_guest(self.system, self.journal)

    def test_existing_public_authority_inventory_detects_same_key(self):
        self.system.path("/etc/ssh/authorized_keys").write_text(self.plan["publicKey"] + " fixture\n")
        inventory = self.system.authorized_sources("/etc/ssh/authorized_keys", self.system.account())
        self.assertIn(self.g.public_key(self.plan["publicKey"]), inventory["fingerprints"])
        real_observe = self.system.observe
        def duplicate(host, guest):
            return {**real_observe(host, guest), "authorizedSources": inventory}
        self.system.observe = duplicate
        self.plan["baselineSha256"] = self.g.inspect_guest(self.system, self.host, self.guest)["baselineSha256"]
        with self.assertRaisesRegex(ValueError, "KEY_ALREADY_AUTHORIZED"):
            self.apply()
        self.assertFalse(self.journal.exists())

    def test_case_insensitive_certificate_authority_options_are_unsupported(self):
        for option in ("cert-authority", "CERT-AUTHORITY", "cert-AUTHORITY"):
            self.system.path("/etc/ssh/authorized_keys").write_text(option + " " + self.plan["publicKey"] + "\n")
            with self.subTest(option=option), self.assertRaisesRegex(ValueError, "KEY_CA_UNSUPPORTED"):
                self.system.authorized_sources("/etc/ssh/authorized_keys", self.system.account())

    def test_expiry_during_candidate_validation_prevents_atomic_config_replace(self):
        self.system.clock_value = time.time()
        def expire(candidate=None):
            self.system.clock_value += 7200
        with patch.object(self.g.time, "time", side_effect=lambda: self.system.clock_value), patch.object(self.system, "validate_sshd", side_effect=expire):
            with self.assertRaises(ValueError):
                self.apply()
        self.assertEqual(self.system.read(self.g.CONFIG), self.original)
        self.assertNotIn('"status":"APPLIED"', self.journal.read_text())

    def test_expiry_during_native_pid_readback_prevents_reload_signal(self):
        native = self.g.GuestSystem(self.root, enforce_owner=False)
        clock = [0]
        def command(args):
            clock[0] = 2
            return "123" if "show" in args else "active"
        with patch.object(native, "command", side_effect=command), patch.object(self.g.os, "readlink", return_value="/usr/sbin/sshd"), patch.object(self.g.os, "kill") as kill, patch.object(self.g.signal, "SIGHUP", 1, create=True):
            with self.assertRaisesRegex(ValueError, "EXPIRED"):
                native.reload(before_signal=lambda: self.g.require(clock[0] < 1, "EXPIRED"))
            kill.assert_not_called()

    def test_expiry_during_readback_cannot_install_shell_or_config(self):
        # Test each blocking read boundary; recovery writes are intentionally valid.
        for boundary in (2, 3):
            with self.subTest(boundary=boundary):
                self.system.set_shell("/bin/bash")
                self.plan["shellPolicy"] = "switch-bash-to-dash"
                self.plan["approvedActions"] = ["install-ai09-fixed-ssh-access", "change-ai09-login-shell"]
                self.plan["baselineSha256"] = self.g.inspect_guest(self.system, self.host, self.guest)["baselineSha256"]
                self.system.clock_value = time.time()
                self.system.clock_jump_at = self.system.observations + boundary
                shell_calls, config_calls = [], []
                set_shell, replace_config = self.system.set_shell, self.system.replace_config
                def track_shell(shell):
                    shell_calls.append((shell, self.system.clock_value)); set_shell(shell)
                def track_config(expected, data, before_replace=None):
                    config_calls.append((data, self.system.clock_value)); replace_config(expected, data, before_replace)
                with patch.object(self.g.time, "time", side_effect=lambda: self.system.clock_value), patch.object(self.system, "set_shell", side_effect=track_shell), patch.object(self.system, "replace_config", side_effect=track_config):
                    with self.assertRaises(ValueError):
                        self.apply()
                expiry = self.g.parse_time(self.plan["expiresAt"])
                self.assertFalse(any(shell == "/bin/dash" and at >= expiry for shell, at in shell_calls))
                self.assertFalse(any(data != self.original and at >= expiry for data, at in config_calls))
                self.journal = self.root / "root/expiry-second.jsonl"


if __name__ == "__main__":
    unittest.main()

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import os
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'scripts' / 'ai09-first-access-inspect.py'
assert SOURCE.is_file(), 'Missing fixed read-only first-access guest inspector'
spec = importlib.util.spec_from_file_location('ai09_first_access_inspect', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PUBLIC = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILryvuH/6LTW0dNGQaj2LW3I7dYDZw8lpIdqHEh6xCDp root@848484\n'
NONCE = 'a' * 32


class FakeSystem:
    def __init__(self):
        self.uid = 0
        self.host = '848484'
        self.addresses = ['172.27.140.254/20']
        self.mac = '00:15:5d:dc:2c:00'
        self.key = PUBLIC
        self.calls = []

    def identity(self):
        return self.uid, self.host, self.mac, self.addresses

    def public_key(self):
        return self.key

    def inventory(self):
        self.calls.append('inventory')
        return {'account': {'name': 'ai09', 'uid': 1000, 'gid': 1000,
                            'home': '/home/ai09', 'shell': '/bin/bash'},
                'sshPolicy': {'passwordauthentication': 'yes'},
                'executables': {'docker': 'missing'},
                'observationsIncomplete': ['docker'], 'writesPerformed': False}


class InspectionTests(unittest.TestCase):
    def test_bound_public_identity_is_observed_without_claiming_installation(self):
        system = FakeSystem()
        result = module.inspect(system, NONCE)
        self.assertEqual(result['status'], 'AUTHENTICATED_ROOT_BASELINE')
        self.assertEqual(result['nonce'], NONCE)
        self.assertEqual(result['hostKeyFingerprint'], module.EXPECTED_HOST_FINGERPRINT)
        self.assertEqual(result['inventory']['account']['shell'], '/bin/bash')
        self.assertFalse(result['activationReady'])
        self.assertFalse(result['physicalE2EVerified'])
        self.assertFalse(result['mutationsPerformed'])
        self.assertEqual(system.calls, ['inventory'])

    def test_invalid_nonce_refuses_before_reading_system(self):
        system = FakeSystem()
        with self.assertRaisesRegex(ValueError, 'NONCE_INVALID'):
            module.inspect(system, 'a;id')
        self.assertEqual(system.calls, [])

    def test_nonroot_refuses_without_inventory(self):
        system = FakeSystem(); system.uid = 1000
        with self.assertRaisesRegex(ValueError, 'ROOT_REQUIRED'):
            module.inspect(system, NONCE)
        self.assertEqual(system.calls, [])

    def test_changed_machine_nic_or_address_refuses_before_inventory(self):
        for field, value in [('host', 'other'), ('mac', '00:15:5d:00:00:00'),
                             ('addresses', ['172.27.140.253/20']),
                             ('addresses', ['172.27.140.254/20', '10.0.0.2/24'])]:
            system = FakeSystem(); setattr(system, field, value)
            with self.assertRaisesRegex(ValueError, 'GUEST_IDENTITY_MISMATCH'):
                module.inspect(system, NONCE)
            self.assertEqual(system.calls, [])

    def test_missing_or_changed_public_key_never_updates_trust(self):
        for key in ['', 'ssh-rsa fake', PUBLIC.replace('CDp', 'CDq')]:
            system = FakeSystem(); system.key = key
            with self.assertRaises(ValueError):
                module.inspect(system, NONCE)
            self.assertEqual(system.calls, [])

    def test_expected_pin_reconstructs_exact_public_key(self):
        blob = base64.b64decode(PUBLIC.split()[1])
        pin = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
        self.assertEqual(pin, module.EXPECTED_HOST_FINGERPRINT)

    def test_serialized_receipt_contains_no_arbitrary_commands_or_secret_fields(self):
        result = json.dumps(module.inspect(FakeSystem(), NONCE))
        self.assertNotIn('privateKey', result)
        self.assertNotIn('passwordValue', result)
        self.assertNotIn('containerInstalled', result)

    def test_ubuntu_os_release_uses_the_fixed_public_target(self):
        class PublicInventory(module.NativeSystem):
            def read(self, path):
                if path == '/usr/lib/os-release':
                    return 'ID=ubuntu\nVERSION_ID="24.04"\n'
                raise ValueError('PUBLIC_FILE_UNAVAILABLE')

            def command(self, arguments):
                if arguments[:3] == ['/usr/bin/getent', 'passwd', 'ai09']:
                    return 'ai09:x:1000:1000:Goriq:/home/ai09:/bin/bash'
                return ''
        self.assertIn('24.04', PublicInventory().inventory()['osRelease'])

    def test_ssh_policy_uses_parse_only_exit_before_host_key_loading(self):
        class ConfigInventory(module.NativeSystem):
            def read(self, path):
                return 'ID=ubuntu\n'

            def command(self, arguments):
                if arguments[0] == '/usr/sbin/sshd':
                    self.policy_arguments = arguments
                    return 'passwordauthentication yes'
                raise ValueError('OBSERVATION_UNAVAILABLE')
        system = ConfigInventory()
        self.assertEqual(system.inventory()['sshPolicy']['passwordauthentication'], 'yes')
        self.assertEqual(system.policy_arguments,
                         ['/usr/sbin/sshd', '-G', '-T', '-C',
                          'user=ai09,addr=172.27.128.1,laddr=172.27.140.254,lport=22'])

    def test_unsupported_parse_only_option_never_falls_back_to_key_loading_mode(self):
        class UnsupportedConfig(module.NativeSystem):
            def __init__(self):
                self.policy_calls = []

            def read(self, path):
                return 'ID=ubuntu\n'

            def command(self, arguments):
                if arguments[0] == '/usr/sbin/sshd':
                    self.policy_calls.append(arguments)
                    if '-G' in arguments:
                        raise ValueError('OBSERVATION_COMMAND_FAILED')
                    return 'passwordauthentication yes'
                raise ValueError('OBSERVATION_UNAVAILABLE')
        system = UnsupportedConfig()
        self.assertEqual(system.inventory()['sshPolicy'], {'status': 'UNAVAILABLE'})
        self.assertEqual(len(system.policy_calls), 1)

    def test_failed_read_cleans_owned_group_even_after_parent_exit(self):
        child = MagicMock(pid=12345)
        child.poll.return_value = 0
        selector = MagicMock()
        selector.__enter__.return_value = selector
        selector.get_map.return_value = {0: True}
        selector.select.side_effect = ValueError('OBSERVATION_TIMEOUT')
        with patch.object(module.subprocess, 'Popen', return_value=child), \
             patch.object(module.os, 'set_blocking'), \
             patch.object(module.selectors, 'DefaultSelector', return_value=selector), \
             patch.object(module.signal, 'SIGKILL', 9, create=True), \
             patch.object(module.os, 'killpg', create=True) as terminate:
            with self.assertRaisesRegex(ValueError, 'OBSERVATION_TIMEOUT'):
                module.NativeSystem.command(['/usr/bin/hostname'])
        terminate.assert_called_once_with(12345, signal.SIGKILL if hasattr(signal, 'SIGKILL') else 9)

    @unittest.skipUnless(os.name == 'posix', 'Actual process-group cleanup requires POSIX')
    def test_parent_exit_with_descendant_stdout_is_cleaned_on_deadline(self):
        with tempfile.TemporaryDirectory(prefix='ai09-inspect-owned-child-') as directory:
            receipt = Path(directory) / 'child.json'
            code = ('import subprocess,sys,json,os; '
                    'p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]); '
                    'open(sys.argv[1],"w").write(json.dumps([p.pid,os.getpid(),os.getpgrp()]))')
            try:
                with self.assertRaisesRegex(ValueError, 'OBSERVATION_TIMEOUT'):
                    module.NativeSystem.command([sys.executable, '-c', code, str(receipt)])
                pid, leader, group = json.loads(receipt.read_text())
                self.assertEqual(group, leader, 'Fixture must own a separate process group')
                alive = True
                for _ in range(20):
                    status = Path('/proc') / str(pid) / 'stat'
                    if not status.exists() or status.read_text().split()[2] == 'Z':
                        alive = False
                        break
                    time.sleep(0.05)
                self.assertFalse(alive, 'Owned descendant survived the observation deadline')
            finally:
                if receipt.exists():
                    pid, leader, group = json.loads(receipt.read_text())
                    try:
                        if group == leader and group != os.getpgrp() and os.getpgid(pid) == group:
                            os.killpg(group, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    @unittest.skipUnless(os.name == 'posix', 'Actual bounded pipe reads require POSIX')
    def test_actual_command_output_bound_refuses(self):
        with self.assertRaisesRegex(ValueError, 'OBSERVATION_OUTPUT_BOUND'):
            module.NativeSystem.command([sys.executable, '-c', 'print("x"*40000)'])


if __name__ == '__main__':
    unittest.main()

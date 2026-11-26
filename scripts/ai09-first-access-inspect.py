#!/usr/bin/env python3
"""Fixed, root-only, read-only first SSH inventory for Issue1219.

No installer, private-key read, arbitrary path/command, network request or write.
Owner authentication is performed by native SSH/sudo, outside this program.
"""
import base64
import datetime
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

EXPECTED_HOST_FINGERPRINT = 'SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA'
HOST = '172.27.128.1'
GUEST = '172.27.140.254'
LIMIT = 32768


def require(condition, code):
    if not condition:
        raise ValueError(code)


def fingerprint(value):
    fields = value.strip().split()
    require(2 <= len(fields) <= 3 and fields[0] == 'ssh-ed25519', 'PUBLIC_KEY_INVALID')
    blob = base64.b64decode(fields[1], validate=True)
    require(len(blob) == 51 and blob[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20',
            'PUBLIC_KEY_INVALID')
    require(base64.b64encode(blob).decode() == fields[1], 'PUBLIC_KEY_INVALID')
    return 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')


def inspect(system, nonce):
    require(isinstance(nonce, str) and re.fullmatch('[a-f0-9]{32}', nonce), 'NONCE_INVALID')
    uid, hostname, mac, addresses = system.identity()
    require(uid == 0, 'ROOT_REQUIRED')
    require(hostname == '848484' and mac == '00:15:5d:dc:2c:00'
            and addresses == [GUEST + '/20'], 'GUEST_IDENTITY_MISMATCH')
    public_fingerprint = fingerprint(system.public_key())
    require(public_fingerprint == EXPECTED_HOST_FINGERPRINT, 'HOST_KEY_MISMATCH')
    inventory = system.inventory()
    require(isinstance(inventory, dict) and inventory.get('writesPerformed') is False,
            'INVENTORY_CONTRACT_INVALID')
    return {'version': 1, 'issue': 1219, 'status': 'AUTHENTICATED_ROOT_BASELINE',
            'nonce': nonce, 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'hostname': hostname, 'mac': mac, 'addresses': addresses, 'effectiveUid': uid,
            'hostKeyFingerprint': public_fingerprint, 'inventory': inventory,
            'mutationsPerformed': False, 'activationReady': False, 'physicalE2EVerified': False}


class NativeSystem:
    @staticmethod
    def read(path):
        # Every call site supplies a fixed public/configuration path, never user input.
        target = Path(path)
        info = target.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_size <= LIMIT, 'PUBLIC_FILE_UNAVAILABLE')
        require(not target.is_symlink(), 'PUBLIC_FILE_UNAVAILABLE')
        with target.open('rb') as stream:
            value = stream.read(LIMIT + 1)
        require(len(value) <= LIMIT, 'PUBLIC_FILE_BOUND')
        return value.decode('utf-8', errors='strict')

    @staticmethod
    def command(arguments):
        process = subprocess.Popen(arguments, cwd='/', env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                                   'LANG': 'C', 'LC_ALL': 'C'}, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        data = bytearray()
        completed = False
        try:
            os.set_blocking(process.stdout.fileno(), False)
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                deadline = time.monotonic() + 3
                while selector.get_map():
                    require(time.monotonic() < deadline, 'OBSERVATION_TIMEOUT')
                    for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                        block = os.read(key.fd, 4096)
                        if not block:
                            selector.unregister(key.fileobj)
                        else:
                            data.extend(block)
                            require(len(data) <= LIMIT, 'OBSERVATION_OUTPUT_BOUND')
                require(process.wait(timeout=0.5) == 0, 'OBSERVATION_COMMAND_FAILED')
            result = data.decode('utf-8', errors='strict').strip()
            completed = True
            return result
        finally:
            # A leader can exit while descendants keep the inherited pipe open.
            # Retire the owned group on failure even when that leader has exited.
            if not completed or process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=1)
            process.stdout.close()

    def identity(self):
        require(os.name == 'posix' and hasattr(os, 'geteuid'), 'LINUX_REQUIRED')
        uid = os.geteuid()
        require(uid == 0, 'ROOT_REQUIRED')
        hostname = self.command(['/usr/bin/hostname'])
        mac = self.read('/sys/class/net/eth0/address').strip()
        rows = json.loads(self.command(['/usr/sbin/ip', '-j', '-4', 'address', 'show', 'dev', 'eth0']))
        require(len(rows) == 1 and rows[0].get('ifname') == 'eth0', 'GUEST_IDENTITY_MISMATCH')
        addresses = sorted(item['local'] + '/' + str(item['prefixlen'])
                           for item in rows[0]['addr_info'] if item.get('scope') == 'global')
        return uid, hostname, mac, addresses

    def public_key(self):
        return self.read('/etc/ssh/ssh_host_ed25519_key.pub')

    def inventory(self):
        result = {'writesPerformed': False, 'observationsIncomplete': [], 'executables': {}}
        def observe(name, function):
            try:
                result[name] = function()
            except (ValueError, OSError, subprocess.SubprocessError, UnicodeError, KeyError):
                result[name] = {'status': 'UNAVAILABLE'}
                result['observationsIncomplete'].append(name)

        def account():
            fields = self.command(['/usr/bin/getent', 'passwd', 'ai09']).split(':')
            require(len(fields) == 7 and fields[0] == 'ai09', 'ACCOUNT_UNAVAILABLE')
            return {'name': fields[0], 'uid': int(fields[2]), 'gid': int(fields[3]),
                    'home': fields[5], 'shell': fields[6]}

        def policy():
            # OpenSSH 9.6 -G exits after config parsing, before private host-key
            # loading. -T alone loads those keys; unsupported -G stays UNAVAILABLE.
            output = self.command(['/usr/sbin/sshd', '-G', '-T', '-C',
                                   'user=ai09,addr=' + HOST + ',laddr=' + GUEST + ',lport=22'])
            allowed = {'passwordauthentication', 'kbdinteractiveauthentication', 'usepam',
                       'pubkeyauthentication', 'authorizedkeysfile', 'authorizedkeyscommand',
                       'trustedusercakeys', 'permituserenvironment', 'permituserrc', 'acceptenv',
                       'forcecommand', 'allowusers', 'denyusers', 'allowgroups', 'denygroups'}
            values = {}
            for line in output.splitlines():
                key, _, value = line.partition(' ')
                if key in allowed:
                    values[key] = value
            return values

        observe('account', account)
        observe('sshPolicy', policy)
        observe('sshUnits', lambda: self.command(['/usr/bin/systemctl', 'show', '--no-pager',
                '-p', 'Id', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'SubState',
                '-p', 'MainPID', '-p', 'ExecStart', 'ssh.socket', 'ssh.service']))
        # Ubuntu's /etc/os-release normally links to this fixed public file.
        observe('osRelease', lambda: self.read('/usr/lib/os-release'))
        observe('architecture', lambda: self.command(['/usr/bin/uname', '-m']))
        for name, path in [('python3', '/usr/bin/python3'), ('node', '/usr/bin/node'),
                           ('docker', '/usr/bin/docker'), ('podman', '/usr/bin/podman')]:
            # Presence is inventory, not a toolchain/daemon trust or capability proof.
            result['executables'][name] = 'present' if Path(path).is_file() else 'missing'
        metadata = {}
        for path in ['/home/ai09', '/home/ai09/.ssh', '/home/ai09/.ssh/authorized_keys',
                     '/home/ai09/.bashrc', '/etc/ssh', '/etc/ssh/sshd_config']:
            try:
                info = Path(path).lstat()
                metadata[path] = {'uid': info.st_uid, 'gid': info.st_gid,
                                  'mode': oct(stat.S_IMODE(info.st_mode)),
                                  'symlink': stat.S_ISLNK(info.st_mode)}
            except OSError:
                metadata[path] = {'status': 'UNAVAILABLE'}
        result['pathMetadata'] = metadata
        return result


def main():
    nonce = sys.argv[1] if len(sys.argv) == 2 else ''
    try:
        result = inspect(NativeSystem(), nonce)
        exit_code = 0
    except Exception as error:
        code = str(error)
        if not re.fullmatch('[A-Z][A-Z0-9_]{1,80}', code):
            code = 'GUEST_INSPECTION_FAILED'
        result = {'version': 1, 'issue': 1219, 'status': 'BLOCKED', 'code': code,
                  'nonce': nonce if re.fullmatch('[a-f0-9]{32}', nonce) else None,
                  'mutationsPerformed': False, 'physicalE2EVerified': False}
        exit_code = 1
    print('AI09_FIRST_ACCESS_BEGIN')
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    print('AI09_FIRST_ACCESS_END', flush=True)
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())

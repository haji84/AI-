#!/usr/bin/env python3
"""Source-only #1219 privileged activation. Default inspection never mutates.

Real execution requires an independently approved, SHA-pinned plan and root.
No private key, package, account creation, network repair or general SSH shell.
"""
import base64
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time

MANAGED = "/etc/ssh/goriq-ai09-baseline"
GATE = MANAGED + "/gate.sh"
BASELINE = MANAGED + "/baseline.sh"
AUTH = MANAGED + "/authorized_keys"
CONFIG = "/etc/ssh/sshd_config"
MAC = "00:15:5d:dc:2c:00"
LIMIT = 131072
REVOKED = b"#!/bin/sh\nexit 64\n"


def require(value, code):
    if not value:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def timestamp(seconds=None):
    return dt.datetime.fromtimestamp(time.time() if seconds is None else seconds, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", value), "TIME_INVALID")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    require(timestamp(parsed) == value, "TIME_INVALID")
    return parsed


def endpoint(value):
    require(isinstance(value, str), "ENDPOINT_INVALID")
    addr = ipaddress.IPv4Address(value)
    require(str(addr) == value and any(addr in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")), "ENDPOINT_INVALID")
    return value


def public_key(value):
    require(isinstance(value, str) and re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/]+={0,2}", value), "PUBLIC_KEY_INVALID")
    blob = base64.b64decode(value.split()[1], validate=True)
    require(len(blob) == 51 and blob[:19] == b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20" and base64.b64encode(blob).decode() == value.split()[1], "PUBLIC_KEY_INVALID")
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def parse_effective_policy(output):
    policy = {}
    for line in output.splitlines():
        key, value = line.split(" ", 1)
        if key in ("hostkey", "hostcertificate", "listenaddress", "port"):
            policy.setdefault(key, []).append(value)
        elif key == "acceptenv":
            policy[key] = (policy.get(key, "") + " " + value).strip()
        else:
            require(key not in policy, "SSHD_POLICY_DUPLICATE")
            policy[key] = value
    return policy


def validate_includes(content):
    for line in content.decode().splitlines():
        # OpenSSH accepts whitespace or '=' separators; refuse forms outside the
        # one inventoried glob rather than accidentally trusting an untracked file.
        tokens = re.split(r"[\s=]+", line.strip())
        if tokens[0].lower() == "include":
            require(len(tokens) == 2 and tokens[1] == "/etc/ssh/sshd_config.d/*.conf", "INCLUDE_UNSUPPORTED")


def validate_service_contract(properties, defaults, process_environment, process_args, executable, listeners, final_pid, guest):
    pid = properties.get("MainPID", "")
    require(pid.isdigit() and int(pid) > 1 and final_pid == pid and executable == "/usr/sbin/sshd", "LISTENER_IDENTITY_UNCONFIRMED")
    for key in ("Environment", "PassEnvironment", "RootDirectory", "RootImage", "User", "Group"):
        require(properties.get(key) == "", "SERVICE_OVERRIDE_UNSUPPORTED")
    require(properties.get("NeedDaemonReload") == "no", "SERVICE_OVERRIDE_UNSUPPORTED")
    require(properties.get("EnvironmentFiles") == "/etc/default/ssh (ignore_errors=yes)", "SERVICE_OVERRIDE_UNSUPPORTED")
    start = properties.get("ExecStart", "")
    require(re.fullmatch(r"\{ path=/usr/sbin/sshd ; argv\[\]=/usr/sbin/sshd -D \$SSHD_OPTS ; ignore_errors=no ; [^{}]*\}", start) is not None, "SERVICE_OVERRIDE_UNSUPPORTED")
    for line in defaults.decode().splitlines():
        line = line.strip()
        require(not line or line.startswith("#") or line in ("SSHD_OPTS=", 'SSHD_OPTS=""', "SSHD_OPTS=''"), "SERVICE_OPTIONS_UNSUPPORTED")
    env = process_environment.split(b"\0")
    require(all(not item.startswith(b"SSHD_OPTS=") or item == b"SSHD_OPTS=" for item in env), "SERVICE_OPTIONS_UNSUPPORTED")
    args = process_args.rstrip(b"\0")
    require(args == b"/usr/sbin/sshd\0-D" or re.fullmatch(rb"sshd: /usr/sbin/sshd -D \[listener\](?: [0-9]+ of [0-9]+-[0-9]+ startups)?[ ]*", args), "SERVICE_OPTIONS_UNSUPPORTED")
    lines = listeners.splitlines()
    require(1 <= len(lines) <= 4, "LISTENER_UNCONFIRMED")
    ipv4_listener = False
    for line in lines:
        fields = line.split()
        require(len(fields) >= 6 and fields[0] == "LISTEN", "LISTENER_UNCONFIRMED")
        local = fields[3]
        require(local in (guest + ":22", "0.0.0.0:22", "[::]:22", "*:22"), "LISTENER_UNCONFIRMED")
        ipv4_listener = ipv4_listener or local in (guest + ":22", "0.0.0.0:22", "*:22")
        owners = re.findall(r'\("([^"]+)",pid=(\d+),fd=\d+\)', line)
        require(("sshd", pid) in owners and all(owner in (("sshd", pid), ("systemd", "1")) for owner in owners), "LISTENER_IDENTITY_UNCONFIRMED")
    require(ipv4_listener, "LISTENER_UNCONFIRMED")
    # Exclude ephemeral PID/fd/title counters from the pinned baseline.
    return digest(canonical({"service": "ssh.service", "argv": "/usr/sbin/sshd -D", "port": 22, "defaultsSha256": digest(defaults)}))


class GuestSystem:
    """The CLI fixes root=/ and ownership enforcement on. Alternate roots are unit-test adapters."""
    def __init__(self, root=Path("/"), enforce_owner=True):
        self.root = Path(root).absolute()
        self.enforce_owner = enforce_owner

    def path(self, name):
        require(name.startswith("/") and ".." not in Path(name).parts, "PATH_INVALID")
        return self.root / name.lstrip("/")

    def safe(self, path, missing=False):
        path = Path(path).absolute()
        require(path.is_relative_to(self.root), "PATH_OUTSIDE_ROOT")
        current = path
        while True:
            try:
                info = current.lstat()
                require(not stat.S_ISLNK(info.st_mode), "PATH_ALIAS")
                require(stat.S_ISDIR(info.st_mode) or (current == path and stat.S_ISREG(info.st_mode) and info.st_nlink == 1), "PATH_TYPE")
                if self.enforce_owner:
                    require(info.st_uid == 0 and info.st_gid == 0 and info.st_mode & 0o022 == 0, "ROOT_CONTROL_REQUIRED")
            except FileNotFoundError:
                require(missing and current == path, "PATH_MISSING")
            if current == self.root:
                break
            current = current.parent
        return path

    def read(self, name):
        path = self.safe(self.path(name))
        require(path.stat().st_size <= LIMIT, "FILE_TOO_LARGE")
        with path.open("rb") as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, "FILE_TOO_LARGE")
        return data

    def write_new(self, name, data, mode=0o644):
        path = self.safe(self.path(name), missing=True)
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode), "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.chmod(path, mode)

    def replace_config(self, expected, data, before_replace=None):
        require(digest(self.read(CONFIG)) == expected, "CONFIG_DRIFT")
        target = self.path(CONFIG)
        mode = stat.S_IMODE(target.stat().st_mode)
        temporary = CONFIG + ".ai09-new"
        self.write_new(temporary, data, mode)
        try:
            self.validate_sshd(self.path(temporary))
            require(digest(self.read(CONFIG)) == expected, "CONFIG_DRIFT")
            if before_replace:
                before_replace()
            os.replace(self.path(temporary), target)
        finally:
            pending = self.path(temporary)
            if pending.exists() and digest(self.read(temporary)) == digest(data):
                pending.unlink()

    def command(self, args):
        require(self.root == Path("/") and sys.platform == "linux" and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
        result = subprocess.run(args, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}, stdin=subprocess.DEVNULL, capture_output=True, timeout=8, check=False)
        require(len(result.stdout) + len(result.stderr) <= LIMIT and result.returncode == 0, "NATIVE_COMMAND_FAILED")
        return result.stdout.decode("utf8", errors="strict").strip()

    def account(self):
        rows = self.read("/etc/passwd").decode().splitlines()
        selected = [row for row in rows if row.startswith("ai09:")]
        require(len(selected) == 1 and self.command(["/usr/bin/getent", "passwd", "ai09"]) == selected[0], "LOCAL_ACCOUNT_REQUIRED")
        fields = selected[0].split(":")
        require(len(fields) == 7 and fields[1] == "x" and fields[2].isdigit() and fields[3].isdigit() and int(fields[2]) > 0 and int(fields[3]) > 0, "ACCOUNT_INVALID")
        return {"uid": int(fields[2]), "gid": int(fields[3]), "home": fields[5], "shell": fields[6]}

    def set_shell(self, shell):
        require(shell in ("/bin/bash", "/bin/dash", "/bin/sh"), "SHELL_INVALID")
        self.command(["/usr/sbin/usermod", "--shell", shell, "ai09"])

    def validate_sshd(self, candidate=None):
        self.command(["/usr/sbin/sshd", "-t", "-f", str(candidate or CONFIG)])

    def reload(self, before_signal=None):
        pid = self.command(["/usr/bin/systemctl", "show", "--value", "--property=MainPID", "ssh.service"])
        require(pid.isdigit() and int(pid) > 1 and os.readlink(f"/proc/{pid}/exe") == "/usr/sbin/sshd", "LISTENER_IDENTITY_UNCONFIRMED")
        # Fixed HUP avoids executing administrator-defined ExecReload commands.
        if before_signal:
            before_signal()
        os.kill(int(pid), signal.SIGHUP)
        require(self.command(["/usr/bin/systemctl", "is-active", "ssh.service"]) == "active", "SSH_NOT_ACTIVE")

    def listener_contract(self, guest):
        names = ["MainPID", "ExecStart", "Environment", "EnvironmentFiles", "PassEnvironment", "RootDirectory", "RootImage", "User", "Group", "NeedDaemonReload"]
        output = self.command(["/usr/bin/systemctl", "show", "--property=" + ",".join(names), "ssh.service"])
        props = dict(line.split("=", 1) for line in output.splitlines())
        require(set(props) == set(names), "SERVICE_PROPERTIES_UNCONFIRMED")
        pid = props["MainPID"]
        require(pid.isdigit() and int(pid) > 1, "LISTENER_IDENTITY_UNCONFIRMED")
        def proc_bytes(name):
            with open(f"/proc/{pid}/{name}", "rb") as stream:
                data = stream.read(LIMIT + 1)
            require(len(data) <= LIMIT, "PROC_OUTPUT_LIMIT")
            return data
        environment, args = proc_bytes("environ"), proc_bytes("cmdline")
        executable = os.readlink(f"/proc/{pid}/exe")
        listeners = self.command(["/usr/bin/ss", "-Hltpn", "sport", "=", ":22"])
        final_pid = self.command(["/usr/bin/systemctl", "show", "--value", "--property=MainPID", "ssh.service"])
        return validate_service_contract(props, self.read("/etc/default/ssh"), environment, args, executable, listeners, final_pid, guest)

    def no_connections(self):
        require(self.command(["/usr/bin/ss", "-Htn", "state", "established", "(", "sport", "=", ":22", ")"]) == "", "SHELL_RESTORE_CONNECTIONS_ACTIVE")

    def authorized_sources(self, keys, account):
        sources = keys.split()
        require(1 <= len(sources) <= 16, "AUTHORIZED_KEYS_UNSUPPORTED")
        paths, fingerprints = {}, set()
        for source in sources:
            if source == AUTH:
                continue
            for token, replacement in (("%h", account["home"]), ("%u", "ai09"), ("%U", str(account["uid"]))):
                source = source.replace(token, replacement)
            require(re.fullmatch(r"[A-Za-z0-9_./-]+", source) and source != "none", "AUTHORIZED_KEYS_UNSUPPORTED")
            name = source if source.startswith("/") else account["home"] + "/" + source
            path = self.path(name)
            if not path.exists():
                existing = path
                while not existing.exists() and not existing.is_symlink():
                    existing = existing.parent
                # A user-writable home could later create an unrestricted duplicate.
                self.safe(existing)
                paths[name] = None
                continue
            contents = self.read(name)
            paths[name] = digest(contents)
            for line in contents.decode().splitlines():
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                require("cert-authority" not in line.lower(), "KEY_CA_UNSUPPORTED")
                for match in re.finditer(r"(?:^|\s)ssh-ed25519[ \t]+([A-Za-z0-9+/]+={0,2})(?:\s|$)", line):
                    fingerprints.add(public_key("ssh-ed25519 " + match[1]))
        return {"paths": paths, "fingerprints": sorted(fingerprints)}

    def observe(self, host, guest):
        require(sys.platform == "linux" and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
        account = self.account()
        require(account["home"].startswith("/home/") and re.fullmatch(r"/[a-zA-Z0-9_/-]+", account["home"]), "ACCOUNT_HOME_UNSUPPORTED")
        hostname = self.command(["/usr/bin/hostname"])
        mac = self.path("/sys/class/net/eth0/address").read_text().strip()
        require(mac == MAC, "NIC_MISMATCH")
        addresses = self.command(["/usr/sbin/ip", "-4", "-o", "address", "show", "dev", "eth0", "scope", "global"])
        require(guest in [line.split()[3].split("/")[0] for line in addresses.splitlines()], "GUEST_ADDRESS_MISMATCH")
        dash = Path("/bin/dash").resolve(strict=True)
        self.safe(dash)
        require(dash.name == "dash" and os.access(dash, os.X_OK), "DASH_UNAVAILABLE")
        if account["shell"] == "/bin/sh":
            require(Path("/bin/sh").resolve(strict=True) == dash, "SHELL_UNSUPPORTED")
        files = {CONFIG: self.read(CONFIG)}
        directory = self.safe(self.path("/etc/ssh/sshd_config.d"))
        children = sorted(directory.glob("*.conf"))
        require(len(children) <= 64, "INCLUDE_LIMIT")
        for child in children:
            files["/etc/ssh/sshd_config.d/" + child.name] = self.read("/etc/ssh/sshd_config.d/" + child.name)
        for content in files.values():
            validate_includes(content)
        self.validate_sshd()

        def effective(user, address):
            output = self.command(["/usr/sbin/sshd", "-T", "-C", f"user={user},host={address},addr={address},laddr={guest},lport=22"])
            return parse_effective_policy(output)

        policy = effective("ai09", host)
        safe = all(policy.get(key) == value for key, value in {
            "permituserenvironment": "no", "forcecommand": "none", "pubkeyauthentication": "yes",
            "chrootdirectory": "none", "authorizedkeyscommand": "none", "usedns": "no",
            "trustedusercakeys": "none",
        }.items()) and policy.get("authenticationmethods") in ("any", "publickey")
        safe = safe and all(item in ("LANG", "LC_*") for item in policy.get("acceptenv", "").split())
        safe = safe and policy.get("port") == ["22"] and "/etc/ssh/ssh_host_ed25519_key" in policy.get("hostkey", [])
        keys = policy.pop("authorizedkeysfile", "")
        public = self.read("/etc/ssh/ssh_host_ed25519_key.pub").decode().split()
        require(len(public) in (2, 3), "HOST_KEY_INVALID")
        pub = " ".join(public[:2]); public_key(pub)
        return {"hostname": hostname, "nicMac": mac, "guestAddress": guest, "account": account,
                "accountSha256": digest(canonical(account)), "publicHostKey": pub,
                "sshActive": self.command(["/usr/bin/systemctl", "is-active", "ssh.service"]) == "active",
                "listenerContractSha256": self.listener_contract(guest),
                "authorizedSources": self.authorized_sources(keys, account),
                "dashTrusted": True, "configSha256": digest(files[CONFIG]),
                "includedConfigSha256": digest(canonical({k: digest(v) for k, v in files.items() if k != CONFIG})),
                "policy": {"authorizedKeysFile": keys, "stableSha256": digest(canonical(policy)),
                           "outsideSha256": digest(canonical(effective("ai09", "127.0.0.1"))),
                           "otherUserSha256": digest(canonical(effective("root", host))), "safe": safe}}


def inspect_guest(system, host, guest):
    endpoint(host); endpoint(guest); require(host != guest, "ENDPOINT_INVALID")
    baseline = system.observe(host, guest)
    require(baseline["nicMac"] == MAC and baseline["guestAddress"] == guest, "IDENTITY_MISMATCH")
    public_key(baseline["publicHostKey"])
    return {"status": "OBSERVED", "observedAt": timestamp(), "baseline": baseline, "baselineSha256": digest(canonical(baseline))}


def append_record(system, journal, value):
    system.safe(journal)
    with journal.open("ab") as stream:
        stream.write(canonical(value) + b"\n"); stream.flush(); os.fsync(stream.fileno())


def validate_plan(raw, expected, gate):
    require(len(raw) <= 16384 and digest(raw) == expected, "PLAN_PIN_MISMATCH")
    plan = json.loads(raw)
    fields = {"version", "issue", "hostAddress", "guestAddress", "expectedHostname", "nicMac", "publicKey", "gateSha256", "executorSha256", "baselineSha256", "baselineObservedAt", "expiresAt", "shellPolicy", "authorizationRef", "approvedActions"}
    require(isinstance(plan, dict) and set(plan) == fields and plan["version"] == 1 and plan["issue"] == 1219, "PLAN_SCOPE_INVALID")
    endpoint(plan["hostAddress"]); endpoint(plan["guestAddress"])
    require(plan["hostAddress"] != plan["guestAddress"] and plan["nicMac"] == MAC, "PLAN_SCOPE_INVALID")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}", plan["expectedHostname"]), "PLAN_SCOPE_INVALID")
    now = time.time(); expiry = parse_time(plan["expiresAt"])
    require(now < expiry <= now + 86400 and 0 <= now - parse_time(plan["baselineObservedAt"]) <= 900, "PLAN_EXPIRED_OR_STALE")
    require(plan["gateSha256"] == digest(gate) and len(gate) <= 16384 and plan["executorSha256"] == digest(Path(__file__).read_bytes()), "TOOL_PIN_MISMATCH")
    require(re.fullmatch(r"[a-f0-9]{64}", plan["baselineSha256"]) and re.fullmatch(r"[A-Za-z0-9:/_.#-]{1,256}", plan["authorizationRef"]), "APPROVAL_REQUIRED")
    require(plan["shellPolicy"] in ("use-existing-dash", "switch-bash-to-dash"), "SHELL_POLICY_INVALID")
    actions = ["install-ai09-fixed-ssh-access"] + (["change-ai09-login-shell"] if plan["shellPolicy"] == "switch-bash-to-dash" else [])
    require(plan["approvedActions"] == actions, "APPROVAL_REQUIRED")
    public_key(plan["publicKey"])
    return plan


def passwd_except_shell(data):
    rows = data.decode().splitlines()
    require(sum(row.startswith("ai09:") for row in rows) == 1, "LOCAL_ACCOUNT_REQUIRED")
    return [row.rsplit(":", 1)[0] + ":<shell>" if row.startswith("ai09:") else row for row in rows]


def require_live_authority(plan):
    now = time.time()
    require(now < parse_time(plan["expiresAt"]) and 0 <= now - parse_time(plan["baselineObservedAt"]) <= 900, "PLAN_EXPIRED_OR_STALE")


def apply_guest(system, raw, expected, gate, journal):
    plan = validate_plan(raw, expected, gate)
    before = inspect_guest(system, plan["hostAddress"], plan["guestAddress"])["baseline"]
    require(digest(canonical(before)) == plan["baselineSha256"], "BASELINE_DRIFT")
    require(before["hostname"] == plan["expectedHostname"] and before["sshActive"] and before["dashTrusted"] and before["policy"]["safe"], "BASELINE_UNSUPPORTED")
    require(public_key(plan["publicKey"]) not in before["authorizedSources"]["fingerprints"], "KEY_ALREADY_AUTHORIZED")
    original_shell = before["account"]["shell"]
    switching = plan["shellPolicy"] == "switch-bash-to-dash"
    require(original_shell == "/bin/bash" if switching else original_shell in ("/bin/dash", "/bin/sh"), "SHELL_POLICY_REQUIRED")
    original_keys = before["policy"]["authorizedKeysFile"]
    require(re.fullmatch(r"[A-Za-z0-9_./% -]{1,1024}", original_keys) and "none" not in original_keys.split() and AUTH not in original_keys.split(), "AUTHORIZED_KEYS_UNSUPPORTED")
    require(not system.path(MANAGED).exists(), "DESTINATION_EXISTS")
    journal = system.safe(Path(journal), missing=True)
    require(not journal.exists(), "JOURNAL_EXISTS")
    original = system.read(CONFIG)
    expiry = int(parse_time(plan["expiresAt"]))
    wrapper = ("#!/bin/sh\nset -eu\n[ \"$(/usr/bin/date -u +%s)\" -lt " + str(expiry) + " ] || exit 64\nexec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C SSH_ORIGINAL_COMMAND=\"${SSH_ORIGINAL_COMMAND-}\" /bin/bash --noprofile --norc " + BASELINE + "\n").encode()
    key = (f'restrict,from="{plan["hostAddress"]}/32",expiry-time="{dt.datetime.fromtimestamp(expiry, dt.timezone.utc).strftime("%Y%m%d%H%M%SZ")}",command="{GATE}" {plan["publicKey"]}\n').encode()
    updated = original + (b"" if original.endswith(b"\n") else b"\n") + (f'# GORIQ AI09 BEGIN {expected}\nMatch User ai09 Address {plan["hostAddress"]}/32\n    AuthorizedKeysFile {AUTH} {original_keys}\n# GORIQ AI09 END\n').encode()
    backup = journal.with_suffix(".original")
    system.safe(backup, missing=True); require(not backup.exists(), "BACKUP_EXISTS")
    if switching:
        system.no_connections()
    record = {"status": "INTENT", "planSha256": expected, "plan": plan, "before": before,
              "configAfterSha256": digest(updated), "backup": str(backup),
              "owned": {GATE: digest(wrapper), BASELINE: digest(gate), AUTH: digest(key)}}
    with os.fdopen(os.open(journal, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(canonical(record) + b"\n"); stream.flush(); os.fsync(stream.fileno())
    try:
        with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
            stream.write(original); stream.flush(); os.fsync(stream.fileno())
        require(digest(canonical(system.observe(plan["hostAddress"], plan["guestAddress"]))) == plan["baselineSha256"], "BASELINE_DRIFT")
        if switching:
            passwd = system.read("/etc/passwd")
            append_record(system, journal, {"status": "SHELL_CHANGE_INTENT"})
            require_live_authority(plan)
            system.set_shell("/bin/dash")
            require(passwd_except_shell(system.read("/etc/passwd")) == passwd_except_shell(passwd) and system.account() == {**before["account"], "shell": "/bin/dash"}, "ACCOUNT_DRIFT")
        require_live_authority(plan)
        system.path(MANAGED).mkdir(mode=0o755)
        os.chmod(system.path(MANAGED), 0o755)
        system.write_new(GATE, wrapper, 0o755); system.write_new(BASELINE, gate, 0o755)
        require_live_authority(plan)
        system.write_new(AUTH, key)
        append_record(system, journal, {"status": "CONFIG_CHANGE_INTENT"})
        fresh = system.observe(plan["hostAddress"], plan["guestAddress"])
        expected_account = {**before["account"], "shell": "/bin/dash"} if switching else before["account"]
        expected_before = {**before, "account": expected_account, "accountSha256": digest(canonical(expected_account))}
        require(fresh == expected_before, "BASELINE_DRIFT")
        require_live_authority(plan)
        system.replace_config(before["configSha256"], updated, before_replace=lambda: require_live_authority(plan))
        after = system.observe(plan["hostAddress"], plan["guestAddress"])
        expected_policy = {**before["policy"], "authorizedKeysFile": AUTH + " " + original_keys}
        expected_after = {**expected_before, "configSha256": digest(updated), "policy": expected_policy}
        require(after == expected_after, "POLICY_DRIFT")
        require_live_authority(plan)
        system.reload(before_signal=lambda: require_live_authority(plan))
        after = system.observe(plan["hostAddress"], plan["guestAddress"])
        require(after == expected_after and time.time() < parse_time(plan["expiresAt"]), "POST_RELOAD_UNCONFIRMED")
        result = {"status": "APPLIED", "planSha256": expected, "hostAddress": plan["hostAddress"], "guestAddress": plan["guestAddress"],
                  "hostname": before["hostname"], "nicMac": MAC, "publicHostKey": before["publicHostKey"],
                  "hostKeyFingerprint": public_key(before["publicHostKey"]), "expiresAt": plan["expiresAt"], "observedAt": timestamp(),
                  "baselineSha256": plan["baselineSha256"], "afterSha256": digest(canonical(after))}
        append_record(system, journal, result)
        return result
    except Exception:
        append_record(system, journal, {"status": "APPLY_FAILED"})
        try:
            rollback_guest(system, journal)
        except Exception:
            append_record(system, journal, {"status": "ROLLBACK_UNCONFIRMED"})
        raise ValueError("APPLY_FAILED_SEE_JOURNAL") from None


def rollback_guest(system, journal):
    journal = system.safe(Path(journal))
    require(journal.stat().st_size <= LIMIT, "JOURNAL_TOO_LARGE")
    journal_bytes = journal.read_bytes()
    boundary = journal_bytes.rfind(b"\n") + 1
    require(boundary > 0, "JOURNAL_INVALID")
    records = [json.loads(line) for line in journal_bytes[:boundary].splitlines()]
    record = records[0]
    require(record["status"] == "INTENT" and record["plan"]["issue"] == 1219 and set(record["owned"]) == {GATE, BASELINE, AUTH}, "JOURNAL_INVALID")
    require(records[-1]["status"] != "ROLLED_BACK", "ALREADY_ROLLED_BACK")
    if boundary != len(journal_bytes):
        # A final unterminated append was never committed. Retain its digest and
        # size; damaged complete/interior records above always refuse recovery.
        require(journal.read_bytes() == journal_bytes, "JOURNAL_DRIFT")
        with journal.open("r+b") as stream:
            stream.truncate(boundary); stream.flush(); os.fsync(stream.fileno())
        append_record(system, journal, {"status": "INTERRUPTED_APPEND_RECOVERED", "discardedBytes": len(journal_bytes) - boundary, "discardedSha256": digest(journal_bytes[boundary:])})
    before, plan = record["before"], record["plan"]
    require(record["backup"] == str(journal.with_suffix(".original")), "BACKUP_INVALID")
    backup = system.safe(Path(record["backup"]))
    require(backup.stat().st_size <= LIMIT, "BACKUP_INVALID")
    original = backup.read_bytes()
    require(digest(original) == before["configSha256"], "BACKUP_INVALID")
    current = digest(system.read(CONFIG))
    for name, sha in record["owned"].items():
        if system.path(name).exists():
            require(digest(system.read(name)) in ([sha, digest(REVOKED)] if name == GATE else [sha]), "OWNED_FILE_DRIFT")
    if system.path(GATE).exists():
        # Revoke future channels before restoring account policy. Existing processes
        # are not claimed terminated; the original baseline verb has its own bound.
        gate_path = system.safe(system.path(GATE))
        with gate_path.open("wb") as stream:
            stream.write(REVOKED); stream.flush(); os.fsync(stream.fileno())
        append_record(system, journal, {"status": "GATE_REVOKED"})
    require(current in (before["configSha256"], record["configAfterSha256"]), "CONFIG_DRIFT")
    if current == record["configAfterSha256"]:
        system.replace_config(current, original)
        system.reload()
    restored = system.observe(plan["hostAddress"], plan["guestAddress"])
    require(restored["policy"] == before["policy"] and restored["includedConfigSha256"] == before["includedConfigSha256"], "RESTORE_POLICY_DRIFT")
    if plan["shellPolicy"] == "switch-bash-to-dash" and system.account()["shell"] != before["account"]["shell"]:
        require(system.account() == {**before["account"], "shell": "/bin/dash"}, "ACCOUNT_DRIFT")
        system.no_connections()
        passwd = system.read("/etc/passwd")
        system.set_shell(before["account"]["shell"])
        require(passwd_except_shell(system.read("/etc/passwd")) == passwd_except_shell(passwd) and system.account() == before["account"], "ACCOUNT_RESTORE_UNCONFIRMED")
    for name, sha in record["owned"].items():
        if system.path(name).exists():
            require(digest(system.read(name)) == (digest(REVOKED) if name == GATE else sha), "OWNED_FILE_DRIFT")
            system.path(name).unlink()
    if system.path(MANAGED).exists():
        system.path(MANAGED).rmdir()
    result = {"status": "ROLLED_BACK", "planSha256": record["planSha256"], "observedAt": timestamp(), "sessionsTerminated": False}
    append_record(system, journal, result)
    return result


def main(args):
    require(sys.platform == "linux" and os.geteuid() == 0, "NATIVE_ROOT_REQUIRED")
    system = GuestSystem()
    if len(args) == 3 and args[0] == "inspect":
        return inspect_guest(system, args[1], args[2])
    if len(args) == 5 and args[0] == "apply":
        plan = system.safe(Path(args[1])); gate = system.safe(Path(args[3]))
        require(plan.stat().st_size <= 16384 and gate.stat().st_size <= 16384, "INPUT_TOO_LARGE")
        return apply_guest(system, plan.read_bytes(), args[2], gate.read_bytes(), Path(args[4]))
    if len(args) == 2 and args[0] == "rollback":
        return rollback_guest(system, Path(args[1]))
    raise ValueError("USAGE_INSPECT_OR_PINNED_APPLY_OR_ROLLBACK_REQUIRED")


if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r"[A-Z0-9_]+", str(exc)) else "OPERATION_UNCONFIRMED"
        print(json.dumps({"status": "BLOCKED", "code": code}))
        sys.exit(1)

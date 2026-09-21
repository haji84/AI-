#!/usr/bin/env bash
set -euo pipefail

TARGET_IP="${1:-192.168.0.169}"
STATE_DIR="${HOME}/Library/Application Support/GAIWorker"
mkdir -p "$STATE_DIR"
STATUS_FILE="$STATE_DIR/zbook-wake-status.json"

python3 - "$TARGET_IP" "$STATUS_FILE" <<'PY'
import json, os, re, socket, subprocess, sys, time

ip = sys.argv[1]
status_path = sys.argv[2]

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

# Best-effort neighbor refresh. Failure is expected if the host is asleep.
run(["ping", "-c", "1", "-W", "1000", ip])

arp = run(["arp", "-n", ip])
text = (arp.stdout or "") + "\n" + (arp.stderr or "")
match = re.search(r"\b([0-9a-fA-F]{1,2}(?::[0-9a-fA-F]{1,2}){5})\b", text)
if not match:
    payload = {
        "ok": False,
        "targetIp": ip,
        "reason": "mac_address_not_found_in_arp_cache",
        "arp": text.strip()[-1200:],
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    with open(status_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(json.dumps(payload, indent=2))
    sys.exit(2)

mac = match.group(1)
parts = mac.split(":")
mac_bytes = bytes(int(p, 16) for p in parts)
packet = b"\xff" * 6 + mac_bytes * 16

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
for port in (9, 7):
    sock.sendto(packet, ("255.255.255.255", port))
sock.close()

payload = {
    "ok": True,
    "targetIp": ip,
    "mac": mac.lower(),
    "sentPorts": [9, 7],
    "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
os.makedirs(os.path.dirname(status_path), exist_ok=True)
with open(status_path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
print(json.dumps(payload, indent=2))
PY

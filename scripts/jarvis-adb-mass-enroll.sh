#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${JARVIS_STATE_ROOT:-$HOME/Library/Application Support/JARVIS}"
ENV_FILE="${JARVIS_ENV_FILE:-$STATE_ROOT/jarvis.env}"
REGISTRY="$STATE_ROOT/adb-fleet.json"
LOCK="$STATE_ROOT/adb-enroll.lock"
MAX_NODES="${JARVIS_ADB_MAX_NODES:-100}"
ENABLE_TCP="${JARVIS_ADB_MASS_ENABLE_TCP:-1}"
ADB_TCP_PORT="${JARVIS_ADB_TCP_PORT:-5555}"
mkdir -p "$STATE_ROOT"
umask 077

if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" >/dev/null 2>&1 || true' EXIT

command -v adb >/dev/null 2>&1 || exit 0
adb start-server >/dev/null 2>&1 || true

[[ -f "$REGISTRY" ]] || printf '{"version":1,"devices":[]}\n' >"$REGISTRY"

private_ipv4() {
  python3 - "$1" <<'PY'
import ipaddress, sys
try:
    ip = ipaddress.ip_address(sys.argv[1])
    print("yes" if ip.version == 4 and (ip.is_private or ip.is_link_local) else "no")
except ValueError:
    print("no")
PY
}

update_registry() {
  local usb_serial="$1" target="$2" ip="$3" model="$4" manufacturer="$5" android_version="$6"
  python3 - "$REGISTRY" "$MAX_NODES" "$usb_serial" "$target" "$ip" "$model" "$manufacturer" "$android_version" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, max_nodes, usb, target, ip, model, manufacturer, android = sys.argv[1:]
max_nodes = int(max_nodes)
try:
    with open(path, encoding="utf-8") as f: data = json.load(f)
except Exception:
    data = {"version": 1, "devices": []}
devices = data.setdefault("devices", [])
record = next((d for d in devices if d.get("usbSerial") == usb), None)
now = datetime.now(timezone.utc).isoformat()
if record is None:
    used = {int(d.get("slot", 0)) for d in devices}
    slot = next((n for n in range(1, max_nodes + 1) if n not in used), None)
    if slot is None:
        raise SystemExit(f"JARVIS ADB fleet is full ({max_nodes} devices)")
    record = {"slot": slot, "deviceNumber": f"{slot:03d}", "usbSerial": usb, "firstRegisteredAt": now}
    devices.append(record)
record.update({
    "adbTarget": target,
    "ip": ip or None,
    "model": model or None,
    "manufacturer": manufacturer or None,
    "androidVersion": android or None,
    "lastSeenAt": now,
    "status": "ready",
})
devices.sort(key=lambda d: int(d.get("slot", 9999)))
fd, tmp = tempfile.mkstemp(prefix="adb-fleet.", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
print(record["deviceNumber"])
PY
}

sync_allowed_serials() {
  local allowed
  allowed="$(python3 - "$REGISTRY" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: data=json.load(f)
print(",".join(d["adbTarget"] for d in data.get("devices", []) if d.get("status") == "ready" and d.get("adbTarget")))
PY
)"
  [[ -f "$ENV_FILE" ]] || touch "$ENV_FILE"
  python3 - "$ENV_FILE" "$allowed" <<'PY'
import os, sys, tempfile
path, value = sys.argv[1:]
key = "JARVIS_REMOTE_ALLOWED_SERIALS"
lines=[]
if os.path.exists(path):
    with open(path, encoding="utf-8") as f: lines=f.read().splitlines()
out=[]; found=False
for line in lines:
    if line.startswith(key+"="):
        out.append(f"{key}={value}"); found=True
    else: out.append(line)
if not found: out.append(f"{key}={value}")
fd,tmp=tempfile.mkstemp(prefix="jarvis-env.",dir=os.path.dirname(path))
with os.fdopen(fd,"w",encoding="utf-8") as f: f.write("\n".join(out)+"\n")
os.chmod(tmp,0o600); os.replace(tmp,path)
PY
}

usb_devices=()
while IFS= read -r serial; do
  [[ -n "$serial" ]] && usb_devices+=("$serial")
done < <(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1}' | sort)

for serial in "${usb_devices[@]}"; do
  model="$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' | head -1 || true)"
  manufacturer="$(adb -s "$serial" shell getprop ro.product.manufacturer 2>/dev/null | tr -d '\r' | head -1 || true)"
  android_version="$(adb -s "$serial" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' | head -1 || true)"
  target="$serial"
  ip=''

  if [[ "$ENABLE_TCP" == "1" ]]; then
    ip="$(adb -s "$serial" shell ip route 2>/dev/null | sed -nE 's/.* src ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -1 | tr -d '\r' || true)"
    if [[ -n "$ip" && "$(private_ipv4 "$ip")" == "yes" ]]; then
      adb -s "$serial" tcpip "$ADB_TCP_PORT" >/dev/null 2>&1 || true
      sleep 1
      if adb connect "$ip:$ADB_TCP_PORT" 2>/dev/null | grep -Eq 'connected to|already connected'; then
        if adb -s "$ip:$ADB_TCP_PORT" get-state 2>/dev/null | grep -q '^device$'; then
          target="$ip:$ADB_TCP_PORT"
        fi
      fi
    fi
  fi

  number="$(update_registry "$serial" "$target" "$ip" "$model" "$manufacturer" "$android_version")"
  printf '[JARVIS ADB] device %s registered: %s (%s) -> %s\n' "$number" "$model" "$serial" "$target"
done

sync_allowed_serials
pkill -f 'scripts/jarvis-remote-gateway.ts' >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/com.aicompany.jarvis-zero-touch" >/dev/null 2>&1 || true

python3 - "$REGISTRY" "$MAX_NODES" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f: data=json.load(f)
capacity=int(sys.argv[2])
ready=[d for d in data.get("devices",[]) if d.get("status")=="ready"]
used={int(d.get("slot",0)) for d in ready}
next_slot=next((n for n in range(1,capacity+1) if n not in used),None)
print(json.dumps({"registered":len(ready),"capacity":capacity,"nextDeviceNumber":f"{next_slot:03d}" if next_slot else None}, ensure_ascii=False))
PY

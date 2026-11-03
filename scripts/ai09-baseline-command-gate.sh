#!/bin/bash
# Source only: activation requires separately approved root-owned forced-command
# installation, a restricted authorization entry and effective sshd policy checks.
# No arguments are interpreted as shell syntax, paths or commands.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
export LANG=C LC_ALL=C
unset BASH_ENV ENV CDPATH
umask 077

refuse() { printf 'AI09_COMMAND_REFUSED\n' >&2; exit 64; }
case "${SSH_ORIGINAL_COMMAND-}" in
  ai09-identity-v1)
    printf 'AI09_IDENTITY_V1\n'; /usr/bin/id; exec /usr/bin/hostname ;;
  ai09-exit7-v1)
    printf 'AI09_STDOUT_V1\n'; printf 'AI09_STDERR_V1\n' >&2; exit 7 ;;
  ai09-timeout-v1)
    printf 'AI09_TIMEOUT_STARTED_V1\n'; exec /usr/bin/sleep 5 ;;
  ai09-baseline-v1) ;;
  *) refuse ;;
esac

# A new empty environment, no startup files, eight-second process-group deadline.
# Fixed source stdin only; the SSH request never becomes an interpreter argument.
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C \
  /usr/bin/timeout -k 1s 8s /bin/bash --noprofile --norc <<'AI09_FIXED_BASELINE'
set -euo pipefail
uid=$(/usr/bin/id -u)
account=$(/usr/bin/id -un)
[[ $uid =~ ^[1-9][0-9]{0,9}$ && $account == ai09 ]] || exit 64
hostname=$(/usr/bin/hostname)
[[ $hostname =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$ ]] || exit 65
mac=$(/usr/bin/cat /sys/class/net/eth0/address)
[[ $mac =~ ^([a-f0-9]{2}:){5}[a-f0-9]{2}$ ]] || exit 65
printf 'AI09_BASELINE_V1\nOBSERVED_AT=%s\nACCOUNT=ai09\nUID=%s\nHOSTNAME=%s\nMAC=%s\n' \
  "$(/usr/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$uid" "$hostname" "$mac"

# At most sixteen address records. Missing tools/addresses refuse identity later.
addresses=$(/usr/bin/timeout -k 0.2s 1s ip -4 -o address show dev eth0 scope global 2>/dev/null | /usr/bin/head -c 4096) || exit 65
count=0
while read -r index device family address remainder; do
  [[ -z ${address-} ]] && continue
  [[ $address =~ ^[0-9.]+/[0-9]+$ ]] || exit 65
  count=$((count + 1)); (( count <= 16 )) || exit 65
  printf 'ADDRESS=%s\n' "$address"
done <<< "$addresses"

unit() {
  local name=$1 label=$2 values load='' active='' sub='' key value
  if ! values=$(/usr/bin/timeout -k 0.2s 1s systemctl show --no-pager -p LoadState -p ActiveState -p SubState "$name" 2>/dev/null | /usr/bin/head -c 1024); then
    printf '%s=unavailable\n' "$label"; return
  fi
  while IFS='=' read -r key value; do
    case "$key" in LoadState) load=$value ;; ActiveState) active=$value ;; SubState) sub=$value ;; *) return 65 ;; esac
  done <<< "$values"
  if [[ $load =~ ^[a-z-]{1,32}$ && $active =~ ^[a-z-]{1,32}$ && $sub =~ ^[a-z-]{1,32}$ ]]; then
    printf '%s=%s,%s,%s\n' "$label" "$load" "$active" "$sub"
  else printf '%s=unavailable\n' "$label"; fi
}
unit ssh.socket SSH_SOCKET
unit ssh.service SSH_SERVICE

for executable in sshd ssh-keygen systemctl ip nft ufw docker podman node python3; do
  if command -v "$executable" >/dev/null 2>&1; then state=present; else state=missing; fi
  printf 'EXECUTABLE=%s,%s\n' "$executable" "$state"
done

# Only explicitly named public files are opened; never private/authentication data.
for public_file in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  [[ ! -L /etc/ssh && ! -L $public_file && -f $public_file && -r $public_file ]] || continue
  fingerprint=$(/usr/bin/timeout -k 0.2s 1s ssh-keygen -E sha256 -lf "$public_file" 2>/dev/null | /usr/bin/head -c 1024) || continue
  read -r bits fp remainder <<< "$fingerprint"
  [[ ${fp-} =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || continue
  case "$public_file" in
    */ssh_host_ed25519_key.pub) algorithm=ssh-ed25519 ;;
    */ssh_host_rsa_key.pub) algorithm=ssh-rsa ;;
    */ssh_host_ecdsa_key.pub)
      case "$bits" in 256|384|521) algorithm="ecdsa-sha2-nistp$bits" ;; *) continue ;; esac ;;
  esac
  printf 'HOST_KEY=%s,%s\n' "$algorithm" "$fp"
done

# The exit status is an observation only. It never means the firewall is disabled.
if ! command -v nft >/dev/null 2>&1; then
  printf 'FIREWALL=executable-missing\n'
elif /usr/bin/timeout -k 0.2s 1s nft list tables >/dev/null 2>&1; then
  printf 'FIREWALL=readable-policy-not-evaluated\n'
else
  printf 'FIREWALL=permission-or-read-unavailable\n'
fi
printf 'END_AI09_BASELINE_V1\n'
AI09_FIXED_BASELINE

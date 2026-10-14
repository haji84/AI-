# AI-09 Ubuntu bootstrap and result bridge

Scope: Issue #1798, Draft PR #1800. Owner authorization is recorded in issue comment 6172897912 and the 2026-10-15 Codex handoff. PR #1799 remains a separate Draft/HOLD; these scripts do not activate its workflow.

## Safety boundary

The first stage creates one **new** 256 MiB FAT32 seed at `C:\GORIQ-AI09\Bootstrap\AI09-SEED.vhdx`, then attaches it at SCSI 0:2 to `GORIQ-AI09-Ubuntu`. An existing seed is a stop condition, never a request to erase or format it. Existing OS disks, checkpoints, Runner/watchdogs, Windows firewall and VM ACLs are unchanged.

Native read-only observation at 2026-10-14T17:40:41Z found the VM running from automatic-checkpoint child `GORIQ-AI09-Ubuntu_C8BCC940-3DC2-4DA8-B311-F82A663F0C3D.avhdx`, whose parent is the expected 40 GiB `GORIQ-AI09-Ubuntu.vhdx`. Both carry DiskIdentifier `9D28872E-0087-4A33-ABFA-AE0DEF1E66B8`. The script checks this exact chain and VM/NIC identity. A later checkpoint change requires fresh diagnosis and review; do not remove a checkpoint to satisfy this guard.

The four observed VM ACLs permit DHCP and otherwise deny inbound/outbound communication. `Get-Ai09AclSha256` computes their canonical digest. A reviewer must compare the rule contents to the owner scope before passing the digest to Execute. A newly observed digest is not automatically an approved baseline.

## Verified delivery

`ai09-fetch-verified-bootstrap.ps1` defaults to `-Mode Verify`: download a fixed GitHub commit, reject redirects and incorrect SHA-256, and save a receipt in a unique temporary directory. It does not invoke the preparation script. Execute also requires `-ExpectedAclSha256 <reviewed digest>` and existing Windows administrator privileges; the loader neither elevates nor changes execution policy.

After download the loader opens a read-only handle that denies other writes/deletes, hashes that final handle, and retains it until the child process exits. The child uses the Windows system PowerShell executable. `stdout.txt`, `stderr.txt` and `receipt.json` retain the exit code, source, hash and timestamps. A child failure is not success. Preserve the run directory as evidence.

The preparation script itself also defaults to Verify. Before Execute it checks VM identity/state, the exact OS disk chain, NIC, reviewed ACL contents, free space, one Listener/no Worker, and the absence of the seed. It rechecks these boundaries before changes. Only the newly created VHD's identity and corresponding non-system RAW disk may be initialized. The host dismount must succeed before guest attachment. A retry stops if the seed exists.

## One manual guest action

There is no authenticated command channel before bootstrap. Do not inject VMConnect keystrokes. After successful seed attachment, use the Ubuntu console once to mount the **recorded seed UUID** at `/mnt`, explicitly invoke `/mnt/bridge.sh`, sync and unmount. Refuse an already occupied `/mnt`. Use the exact UUID and guest-script SHA-256 from the Windows preparation receipt; validate the hash before invocation.

The guest script checks root, hostname, mountpoint, vfat, label, filesystem UUID, partition UUID and run marker before writing results. It checks the expected NIC MAC before changing the ephemeral network configuration. It refuses existing receipt files and existing `10-ai09.network`. It collects SSH-server availability, public host key when present, IPv4, routes and storage; it does not install packages, provision credentials, start SSH or alter Hyper-V ACLs. Missing DHCP is a failure with a recorded exit code, not a completed SSH bridge.

Guest outputs on the seed:

- `ai09-stdout.txt`
- `ai09-stderr.txt`
- `ai09-result.txt`: run ID, UTC timestamp, status and exit code

Confirm the guest has unmounted the seed before detaching that exact path/slot from the VM. Only then may Windows mount the detached seed **read-only** to collect files. Never mount it on Windows while the guest can write it. Match run ID/volume identity to the preparation receipt; keep the original files and hashes.

## Remaining SSH acceptance

Only after the guest receipt proves an IPv4 address, expected MAC and installed SSH server may the approved narrow SSH stage proceed: dedicated key, out-of-band host-key pin, public-key-only non-root access, TCP/22 limited to this Windows host (`172.29.80.1`) and this VM, preserving existing deny rules. If sshd is absent, stop that stage and prepare the smallest separately authorized offline package installation; do not grant broad Internet egress.

The final Windows-side probe must use BatchMode, strict host-key checking, a fixed read-only command set and bounded timeout, storing separate stdout/stderr plus actual exit code and timestamp. Test success, authentication/host-key rejection, nonzero exit and timeout. CI, mocked Hyper-V calls, successful seed creation and DHCP alone are **not** this physical SSH E2E.

## Failure and recovery

Before mutation a failure leaves VM/disks unchanged. After new seed creation a failure preserves that seed for inspection and attempts identity-checked host dismount; it never deletes or retries formatting. If cleanup or attachment status is inconclusive, inspect exact host/guest ownership before touching the seed. An attached seed may be detached only after guest unmount. Do not force detach a mounted guest filesystem.

The guest's new network file is ephemeral under `/run`; existing settings are never overwritten. Failure may leave that newly created file for diagnosis. Any rollback must identify that exact run's file and verify its content before removing it; do not issue broad network resets or reboot the VM to hide a failure. Retain failure stdout/stderr/exit evidence and the original reviewed source.

Required evidence remains latest-head CI, independent technical review (distinct from GitHub account approval), real source/hash delivery, safe physical seed handoff, guest receipt and authenticated Windows command/result round trip. Keep Draft/HOLD until applicable review and approval requirements are fulfilled.

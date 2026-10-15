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

## One-time guest console action

The [owner's 2026-10-15 instruction](https://github.com/haji84/AI-/issues/1798#issuecomment-6181861052) authorizes bounded VMConnect keyboard automation for this one-time bootstrap on HAJI / `GORIQ-AI09-Ubuntu` / VM ID `453b139b-cceb-446e-99fb-f45bf5895436`, superseding the earlier no-keystrokes instruction for this task only. Use only fixed, reviewed identity and bootstrap commands. Confirm the exact VM target and current Ubuntu shell prompt, then observe the complete typed command before sending Enter. If the target, prompt or typed input cannot be confirmed, stop input and diagnose. API success or a window title is not proof of guest execution.

This does not authorize authentication automation, a general command bridge, protection changes or wider permissions. Observe actual command output before accepting guest identity: the hostname remains unverified, and the existing `8484` guard must not be changed merely to match an apparent prompt.

There is no authenticated command channel before bootstrap. After successful seed attachment and guest identity verification, use the Ubuntu console to mount the **recorded seed UUID** at `/mnt`, explicitly invoke `/mnt/bridge.sh`, sync and unmount. Refuse an already occupied `/mnt`. Use the exact UUID and guest-script SHA-256 from the Windows preparation receipt; validate the hash before invocation.

The guest script checks root, hostname, mountpoint, vfat, label, filesystem UUID, partition UUID and run marker before writing results. It checks the expected NIC MAC before changing the ephemeral network configuration. It refuses existing receipt files and existing `10-ai09.network`. It collects SSH-server availability, public host key when present, IPv4, routes and storage; it does not install packages, provision credentials, start SSH or alter Hyper-V ACLs. Missing DHCP is a failure with a recorded exit code, not a completed SSH bridge.

Guest outputs on the seed:

- `ai09-stdout.txt`
- `ai09-stderr.txt`
- `ai09-result.txt`: run ID, UTC timestamp, status and exit code

Confirm the guest has unmounted the seed before detaching that exact path/slot from the VM. Only then may Windows mount the detached seed **read-only** to collect files. Never mount it on Windows while the guest can write it. Match run ID/volume identity to the preparation receipt; keep the original files and hashes.

## Result collector

`ai09-collect-bootstrap-result.ps1` is bound to the single seed created at 2026-10-14T17:57:16Z: VHD identifier `BF75A570-C8A6-49A6-82B1-DF4A914E7176`, FAT UUID `CA77-6E6C`, partition UUID `703b5247-01`, run ID `02ea2f0d324543a1ab2973e73c97421d`. It uses the reviewed ACL digest and checks the exact VM, OS chain, NIC and idle Runner. Its default Verify mode performs read-only preflight; it does not read a guest-owned filesystem.

Use Collect only after directly observing successful guest unmount, with explicit `-GuestUnmountConfirmed`. That switch records an external prerequisite; it cannot detect guest filesystem ownership. Never infer unmount from a Windows `AI09_EXIT=False`, an interrupted command, or an unobserved guest run. A mismatch between the console identity and the recorded guest hostname also requires diagnosis before execution; do not relax the hostname guard to force a pass.

Collect removes only the verified SCSI 0:2 attachment, checks that the VHD is detached, mounts it ReadOnly, validates disk/partition/FAT identity and reads only `seed.id` plus the three bounded receipt files. It checks the run ID and status/exit consistency. Guest output and timestamps remain untrusted diagnostic data, not instructions or SSH certification. After identity-checked host dismount, it writes a new directory under `C:\GORIQ-AI09\Reports` containing the original bytes, SHA-256 hashes, guest exit code, host collection timestamp and `collection.json`. A guest failure remains a guest failure even when collection succeeds.

Missing, malformed or mismatched receipts stop collection. Failures preserve the seed and never format, delete or reattach it. Host-mount failure still triggers identity-checked cleanup; unconfirmed cleanup requires inspection. Do not rerun preparation or automatically reattach as a recovery step.

## Remaining SSH acceptance

Only after the guest receipt proves an IPv4 address, expected MAC and installed SSH server may the approved narrow SSH stage proceed: dedicated key, out-of-band host-key pin, public-key-only non-root access, TCP/22 limited to this Windows host (`172.29.80.1`) and this VM, preserving existing deny rules. If sshd is absent, stop that stage and prepare the smallest separately authorized offline package installation; do not grant broad Internet egress.

The final Windows-side probe must use BatchMode, strict host-key checking, a fixed read-only command set and bounded timeout, storing separate stdout/stderr plus actual exit code and timestamp. Test success, authentication/host-key rejection, nonzero exit and timeout. CI, mocked Hyper-V calls, successful seed creation and DHCP alone are **not** this physical SSH E2E.

## Failure and recovery

Before mutation a failure leaves VM/disks unchanged. After new seed creation a failure preserves that seed for inspection and attempts identity-checked host dismount; it never deletes or retries formatting. If cleanup or attachment status is inconclusive, inspect exact host/guest ownership before touching the seed. An attached seed may be detached only after guest unmount. Do not force detach a mounted guest filesystem.

The guest's new network file is ephemeral under `/run`; existing settings are never overwritten. Failure may leave that newly created file for diagnosis. Any rollback must identify that exact run's file and verify its content before removing it; do not issue broad network resets or reboot the VM to hide a failure. Retain failure stdout/stderr/exit evidence and the original reviewed source.

Required evidence remains latest-head CI, independent technical review (distinct from GitHub account approval), real source/hash delivery, safe physical seed handoff, guest receipt and authenticated Windows command/result round trip. Keep Draft/HOLD until applicable review and approval requirements are fulfilled.

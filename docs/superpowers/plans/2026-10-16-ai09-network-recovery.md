# AI-09 bounded network recovery implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Root owns host staging/collection; the delegated implementer owns the guest script; an independent reviewer operates read-only.

**Goal:** Recover DHCPv4 on the approved Ubuntu VM while preserving the malformed existing file and original failure evidence, then establish the already authorized restricted SSH result channel.

**Architecture:** Deliver one new fixed script through the existing detached seed. Add a new networkd file that matches only eth0 and its observed MAC. Observe actual guest output, safe unmount and read-only collection before evaluating network success. SSH remains a separate acceptance gate.

**Tech stack:** Native Windows PowerShell 5.1, Hyper-V, Ubuntu Bash/systemd-networkd/OpenSSH, Node test runner.

**Spec:** `docs/runbooks/ai09-bootstrap-bridge.md`; owner scope in Issue #1798 comment6172897912; physical diagnosis in comment6204394385.

## Constraints and evidence

- Exact host HAJI; VM453b139b-cceb-446e-99fb-f45bf5895436; hostname848484; eth0 MAC00:15:5d:dc:2c:00.
- Preserve OS/checkpoint chain, Runner/watchdogs, Windows firewall and the four existing default-deny/DHCP VM ACL entries.
- Existing seed CA77-6E6C / PARTUUID703b5247-01 / run02ea2f0d324543a1ab2973e73c97421d is detached and host-dismounted. Never format or recreate it.
- Preserve the original five seed files and FAILED/18 receipt hashes. Existing network file is95 bytes, SHA256 AD37EAF039455B7F058D4DA73C3FD008752787DB45E952D343551D6F8B437FC9; do not overwrite or remove it.
- New seed files only: recover.sh, recovery.id, recovery-stdout.txt, recovery-stderr.txt, recovery-result.txt, recovery-original.network. Recovery ID network-recovery-20261016-v1.
- New guest setting only: /run/systemd/network/09-ai09-bootstrap.network, CreateNew, exact Name/MAC match, DHCPv4. No added DNS, NTP, gateway/route or Internet permissions.
- Actual SSH socket already active and TCP22 listening. Do not add installation/start/enable changes.
- No authentication automation, arbitrary command bridge, automatic rerun or success inferred from CI.

## Review focus

- Changed old evidence or pre-existing new files: refuse before write.
- Partial host mount or failed dismount: retain failure and refuse attachment.
- Stale VM/NIC/Runner/ACL state: recheck before each mutation.
- Competing network file or unexpected DHCP address: fail acceptance visibly.
- Expired sudo or interrupted guest command: require observed results and fresh device-wide unmount before collection.

## Tasks

1. Host staging: `scripts/ai09-stage-network-recovery.ps1`, `tests/ai09-stage-network-recovery.test.ps1`, Node fixture registration in `tests/ai09-bootstrap.test.mjs`.
   - [x] Missing-script RED, then isolated preflight/mount/cleanup/CreateNew/order fixtures GREEN on PS5.1/PS7.
   - [x] Pin final canonical LF guest-script hash, finish independent review, verify source locking and original-evidence guards.
2. Guest recovery: `scripts/ai09-network-recovery.sh`, `tests/ai09-network-recovery.test.mjs`.
   - [x] RED tests, fixed identity/media/original-file guards, CreateNew backup/config/receipt files, bounded reload/reconfigure/DHCP wait; 11 shell fixtures pass.
   - [x] Code requires selected Network File and an actual usable IPv4 within 172.29.80.0/20; keeps failure codes and original bytes. Physical verification remains pending.
3. Collection: `scripts/ai09-collect-network-recovery.ps1` and isolated fixture coverage.
   - [x] Implemented observed unmount and console exit requirements, exact seed detach, ReadOnly collection, bounded file/hash checks and host dismount. No automatic reattachment; 24 isolated fixtures pass on PS5.1/PS7. Physical collection remains pending.
4. Review and physical execution.
   - [x] Recovery implementation at a44e73fd passed related tests, lint, independent review and CI38825147825. Later session changes require their own verification.
   - [ ] Standard administrator launch, source lock, native receipts; fixed observed guest commands, fresh root proof, result/cleanup observations; no password handling.
5. Restricted SSH acceptance after actual IPv4 proof.
   - [ ] Inspect effective SSH auth/environment policy. Install only the authorized dedicated non-root forced-command key and root-owned fixed gate; pin collected host key.
   - [ ] Add only exact host172.29.80.1→observed VM TCP22 stateful ACL, preserving denies; record exact rollback entries.
   - [ ] Observe identity, stdout/stderr/exit7, unknown-command rejection, auth/host-key rejection and timeout through real SSH.
   - [ ] Update GitHub/Compass and physical status; keep Draft/HOLD until all acceptance gates pass.

## Follow-up: one bounded native session

The 2026-10-16 administrator launch ended before a native child started; the owner reported that UAC was not visible. Read-only inspection found the existing elevated interactive PowerShell in the same active console session. The cause of the missing consent UI is not established. Do not repeatedly request UAC, change consent policy, or inject commands into that process.

- [x] Add `ai09-network-recovery-session.ps1` with fixed source-pinned staging, authentication-prompt, console and collection children. Default Verify must remain read-only; no arbitrary command/path parameters, elevation or automatic retry.
- [x] Wait for source/run/nonce-bound observer readiness, then stage once, request only `sudo -v`, and wait for a separate authentication handoff before starting the console. A handoff permits root verification; it does not prove authentication.
- [x] Keep the console's observed `sudo -n id` root/exit0 gate. Require final same-run console evidence for actual guest exit, umount0, device-wide seed unmount and mountpoint32 before collection.
- [x] Bind the collection response to receipt and all four image hashes, consumed observation nonces, source/run and expiry; re-read proof after the response. Preserve timeout/partial child state without killing, detaching or claiming cleanup.
- [ ] Use isolated PS5.1/PS7 fixtures, Node CI registration and independent review before one launch from the already elevated console. Native execution and SSH remain unverified until actual evidence is collected.

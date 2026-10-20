# #1219 — AI-09 authenticated access, new-media preparation

Status: **SOURCE PREPARATION; CRITICAL OWNER APPROVAL REQUIRED. No live key,
permission, disk, network or guest change has been executed.** Existing main is
`cb6b0fa06492b3d610ecb527645244b9a46ba8eb`; starting Draft1827 head is
`1a9fec3128f39924d1b6f1d039949d5c6ab25b90`. Draft1824/1826/1827 remain unmerged.

The owner explicitly requested the first authenticated AI-09 connection, grouped
critical approvals, minimal device operations, and automatic continuation through
the real Goal/Ollama/signed-verifier/restart/next-job and recovery/acceptance tests.
Previous password authentication failed after pinned host-key agreement. Its
server-side reason is still unknown. The earlier network allowance and VMConnect
grant were restored; neither old approval nor launcher is reused.

## Smallest new route

1. Review and pin `ai09-access-media.ps1`, `ai09-owner-key-enroll.py`, and the
   unchanged first-access host/guest observation dependencies. All source files
   are held read-only while an approved privileged operation executes.
2. Under one separately approved Windows administrator invocation, verify the
   running VM `453b139b-cceb-446e-99fb-f45bf5895436`, NIC `00155DDC2C00`, original
   OS/checkpoint chain, switch/host address, original four ACLs and free SCSI0:3.
   Create only `C:\GORIQ-AI09\Bootstrap\AI09-ACCESS-1219-20261020.vhdx`
   (new dynamic256MiB FAT32, label A09). Existing seed/OS disks are never mounted,
   detached, edited or reformatted. Occupied slot, existing new-media path, label
   collision, changed source or changed baseline refuses before attachment.
3. Create a new passphrase-free Ed25519 client identity only inside the new
   `C:\Users\qq113\.codex\ai09-access-1219-20261020` directory. Its new protected
   DACL permits only the owner, SYSTEM and Administrators. No prior ACL is edited.
   The FAT payload contains the public key and reviewed code, never the private key.
4. The owner performs local Ubuntu sudo authentication and the short mount/run
   sequence below. Root code verifies hostname848484, exact NIC/IP and public host
   fingerprint, local account and effective public-key policy before registration.
   No password reset, shell change, PAM/sshd setting change, service start/reload,
   account creation, installation or security disabling is authorized.
5. Append exactly one `restrict,from="172.27.128.1",expiry-time="...Z"` entry for
   the existing ai09 account. Existing bytes/metadata are preserved; a new file is
   created exclusively. Atomic append protects concurrent owner appends; a
   conflicting final image returns uncertainty rather than APPLIED.
6. Relocate to root-owned `/run` code, close inherited media descriptors, finish
   bounded observations, sync, unmount the whole new device and print
   `A09_UNMOUNTED`. Only after the owner reports that exact marker can the host
   detach this new attachment and collect bounded outputs via a read-only mount.
   No unverified/forced detach is attempted.
7. With `Collect -PermitNetwork`, require matching nonce/source/plan/expiry,
   APPLIED, guest process exit0, and a root baseline at most15minutes old. Reuse
   the unchanged first-access network executor with a **new** approval, plan and
   journal to add only stateful host172.27.128.1/32 → guest172.27.140.254/32 TCP22.
   The other four rules remain identical. The Hyper-V rule has no native TTL.
8. Use native batch-mode public-key SSH, pinned server identity, no agent or
   password fallback, to verify real uid/hostname/MAC/IP, exit-code propagation,
   bounded capture and closure of owned sessions. This final authentication has
   **not** been performed yet.

## Owner operations after approval and successful preparation

No long fingerprints, screenshots, output transcription or VMConnect key/OCR
automation are needed. The planned Ubuntu input is three short lines:

```sh
sudo mkdir /a09
sudo mount -L A09 /a09
sudo sh /a09/go
```

Stop if mkdir or mount fails; do not run the next line. Enter the existing sudo
password only on the Ubuntu console. After `A09_UNMOUNTED exit=...`, reply with
the marker/exit number. The agent then runs the fixed collection/network step.
Windows elevation may require the owner's UAC action; if no UAC is displayed,
use one prepared launch in the existing administrator PowerShell instead of
repeating hidden elevation requests.

## Authority and recovery limits that the approval must disclose

- This grants **ordinary ai09 command authority**, including its existing
  groups/sudo/service access. It is not a diagnostic-only grant or a trusted
  independent Verifier boundary. Source/key expiry does not prevent that account
  from changing its own future authorized keys or persistence.
- The lease denies new authentication using this authorization entry after its
  timestamp. It does not terminate already authenticated sessions. Close only
  SSH processes owned by this test; do not terminate unrelated sessions.
- An auth-file rewrite cannot provide a compare-and-swap guarantee against an
  independent owner writer. Therefore automated key-file rollback is deliberately
  **unsupported**: the root helper refuses without writing AUTH and records
  `MANUAL_RECONCILIATION_REQUIRED`. Do not claim the old key file was restored.
  An owner-controlled, quiescent root cleanup can later remove only the recorded
  line after reconciling current bytes. The public entry and protected evidence
  may remain after expiry; the private identity is not silently deleted.
- Network recovery uses a new SHA-pinned rollback plan and the existing executor
  to remove only this run's recorded TCP22 rule after checking all other rules.
  Expired/stale authorization requires a new narrow recovery approval. The old
  network/console approvals are not reusable.
- Preserve the new media and receipts, original VMConnect35224, all previous
  evidence, existing worktrees and ports8787/8796/8797/Ollama. 8796 was already
  absent; its cause is unknown and it is not restarted by this work.

## Acceptance and continuation

Source/fixture PASS is not native activation. The previous exact1a9fec31 hosted
six-check CI is historical HOSTED_CONTAINER_CI only; it does not verify these new
sources or AI-09. New code must pass its own checks/review before owner approval.

After actual SSH authentication, collect real existing runtime, container/signer
availability and privilege separation. Reuse existing Verifier capabilities; any
required new signer key, credential, installation or permission is a separate
concrete critical gate based on that inventory. Then run isolated authenticated
Goal → actual ZBook Ollama → actual six checks and signature verification → owned
test-Broker restart/resume → independently accepted Job2. This is not a Windows
OS reboot authorization. Finally test real repair, requirement-derived next-work
selection and artifact-based final acceptance; fixtures and fixed job sequences
do not satisfy these claims.

The current phase remains BLOCKED on the new critical owner approval. No PASS is
claimed for native SSH, native independent Verifier, iPhone intake or stages3/4.

## Frozen source preparation and verification

Independent AI-employee review: READY_FOR_CRITICAL_OWNER_APPROVAL, no remaining
P1/P2 within the explicit ordinary-account/manual-key-reconciliation scope.

- Five-source execution bundle SHA256:
  `b4ae80eabb6f1c75ee7ad1f224366313c30284bc4e23e1c415e8ddfdbf0af389`.
- Media executor SHA256:
  `dda77f41d4999bb29b5c70f9987c4af51f3c9f99455e923c5ac27f92ff5de715`.
- Enrollment executor SHA256:
  `b35dcbb57bcd134937c0ba6b8419d0aa846ba5d3ddaac638f43896842a287be2`.
- Related Node wrappers:6/6 PASS with explicit bundled Python. New enrollment
  Python fixtures:15 PASS/1 Windows symlink-privilege SKIP. These are adapters,
  not guest activation. PowerShell5.1/7 media lifecycle:90 assertions PASS.
- RED→GREEN covered missing implementation, concurrent owner append/new-file
  preservation, JSON date preservation, nonzero/malformed/missing guest exit,
  and no-effect dismount. Lifecycle tests also cover expiry, topology/ACL/source
  drift, format failure, private-key exclusion, read-only/UUID/output bounds.
- `npm run lint`, `tsc --noEmit --incremental false`, and `git diff --check` PASS.
- Native PS5 default Verify returned SOURCE_ONLY_NOT_ACTIVATED. New credential
  directory and new VHDX paths remain absent; protected service PIDs8787=10068,
  8797=25144, Ollama11434=12920 remain unchanged. 8796 remains absent.

Requested approval reference: `owner-1219-ai09-key-media-20261020`. Proposed
execution/key-entry deadline: **2026-10-21 18:00 JST**
(`2026-10-21T09:00:00.000Z`, at most24hours when execution starts). This document
requests authority; it does not constitute owner consent or an active approval.

OpenSSH option semantics are checked against the official
[Ubuntu24.04 sshd manual](https://manpages.ubuntu.com/manpages/noble/man8/sshd.8.html):
`restrict` restricts transport features, not ordinary remote-command authority;
`expiry-time` determines acceptance of the supplied key for new authentication.

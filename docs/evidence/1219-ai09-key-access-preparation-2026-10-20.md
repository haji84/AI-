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
   Create only `C:\Users\qq113\.codex\AI09-ACCESS-1219-20261020.vhdx`
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

## Historical frozen source preparation and verification (548924ff)

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

## Native preparation refusal and bounded path correction (2026-10-21 JST)

The owner explicitly approved the historical 548924ff/b4ae80ea bundle until
2026-10-21 18:00 JST. CI39406126768 attempt2 subsequently completed all four
jobs and real six-check execution successfully. Artifact12257354956 ZIP SHA256
`d5e3d70754b44222728a130fef64c71853572784b19781168533b619053370f0`
matches GitHub's digest; independent signature/log/source/cleanup auditing is
recorded in `checks/ai09-key-media-20261020/548924ff-attempt2-cryptographic-audit.json`
outside the repository. This is historical HOSTED_CONTAINER_CI evidence, not
current authorization or physical verification. Attempt1's retained heartbeat
failure cause remains unresolved; a successful rerun does not establish a fix.

One owner-approved native Prepare launch returned `OWNER_PATH_REQUIRED` before
the first mutation. Read-only ACL inspection and the unmodified production guard
both confirm that the old media parent `C:\GORIQ-AI09\Bootstrap` grants inherited
Modify to Authenticated Users. The new credential directory and original proposed
VHDX remain absent. No guest enrollment, media attachment or network grant ran.

The bounded correction changes only the NEW public media destination to
`C:\Users\qq113\.codex\AI09-ACCESS-1219-20261020.vhdx`. The same production
owner guard passes on its existing parent. No existing parent ACL is changed;
the separately protected private credential directory remains unchanged in the
plan. Capacity256MiB, labelA09, SCSI0:3, payload binding, fresh guest verification,
TCP22 scope and all manual-reconciliation/expiry limits remain unchanged.
The rejected parent is not made permissive and its guard is not weakened.

The regression scope assertion was first observed RED on the old production
path. Tests/review/CI for the corrected commit are required before activation;
the old exact-code approval cannot authorize the corrected source/path. A single
renewed critical gate must bind the replacement commit and five-file bundle.
Until then native authenticated SSH and stages3/4 remain BLOCKED. No new owner
terminal operation is needed to prepare or review this correction.

Corrected five-source bundle SHA256:
`2b09f592fb9c85ea0bb7511dc0c43c76c0cff38be20202d323fee3e3633c731f`;
media executor SHA256:
`820ede6b4e239e999ad630c38803a9654895bf66db0c8c9f4d826c292d00e198`.
The other four privileged dependency hashes remain exactly the historical ones.
Focused Node wrappers6/6 PASS with explicit bundled Python; PS5.1 and PS7
lifecycle90 assertions PASS; lint and typecheck PASS. Related-test log SHA256
`16b4d43265a965dcbf8f2107d93edfae48ea2af54fc83a743180f022b914119b`.
The existing production path validator was also executed read-only on both
proposed new paths and passed. These checks are not native preparation or SSH
success. After any future approved Prepare, inspect the new VHD file's actual
ACL before guest execution; do not silently allow unknown writable principals.

## Native read-only preflight and null-MAC repair (2026-10-21 JST)

The owner approved exactedbd97ed/bundle2b09 and completed Windows UAC. That
Prepare returned InvokeMethodOnNull in first-access-host.ps1:36, before new
State/key/VHD creation. Receipt SHA256:
`7e8d6b330773a86758715f805c0248b8d6f133c5251ad677f85d884f224904e6`.
Native PS5 read-only enumeration confirmed19 adapters,14 without MAC and5 with
MAC. A hidden WAN/Tailscale/switch adapter must not prevent finding the exact
Hyper-V management interface. No mutating replay was performed.

The bounded repair changes the first-access and media snapshot readers only:
require one management adapter with a valid12-hex MAC, convert each row MAC to
string before normalization, exclude empty/malformed rows, and retain exact-one
match refusal. Active client/native source pins and their fixture are updated.
Legacy unused access-host readers and historical hashes remain unchanged; no
new authority or first/name/index fallback is introduced. Fixtures reproduce
null and malformed-MAC REDs, then verify normal identity and refusal of absent,
empty, malformed, missing-match and duplicate bindings. Related Node8/8 PASS;
first-access101/media96 assertions PASS on native PS5.1. Lint/typecheck PASS.

Corrected five-source bundle:
`31e1c7a45abb7ef9b3834f0763da4ae4d4e219a9d8a2d4a48511f93e942dcd02`.
Media SHA256 `ef0b44f3cdf3dd4f1298a64a8d8850062e62714a7716236e92c307dc53c3b5b9`;
first-access SHA256
`c4c1fed72a8059b1175aa1c33cb2644e8f937fc20873a99554477e586c0e3668`.

Before another activation gate, an independently reviewed fixed native
**read-only** preflight executed the real Assert-Ai09MediaState(false), rather
than substituting source-only Verify. Media source was opened/read-locked and
handle-hashed before dot-source; all five source locks were retained for the
native observations. The caller also pinned/read-locked the preflight wrapper
across native launch. At2026-10-20T17:02:36.6922958Z it returned
READ_ONLY_NATIVE_PREFLIGHT_PASS/exit0: exact Running VM/OS disk/freeSCSI0:3,
management interface37/172.27.128.1/20, original4ACLs, safe proposed paths,
absent State/newVHD/A09 label, required native commands and Valid keygen signature.
No configuration mutation or guest authentication occurred.

Public receipt: checks/ai09-key-media-20261020/readonly-native-preflight-31e1c7a4.json
outside the repository. Wrapper SHA256:
`dcbf352a74317d7a712fc4642e249853c66fa4af1675b8e94dc80f0bc6e9bb84`.
CI/review on the final corrected commit and a replacement exact-code critical
gate are still required before activation. Both previous failed launchers remain
consumed; neither is replayed. Native SSH/Verifier/stages3/4 remain unverified.

## Consumed native preparation and retained partial media (2026-10-21 JST)

Exact source `0f1b61b1e75ad9f8da261853084fc429ff1c5ff1` subsequently passed
CI39462873672 all four jobs, actual six checks and signature/log/source audit.
Artifact12284415487 ZIP SHA256
`4cb1c37c36189a6ed115c913f7c0d0aa61707560acd3d1eae89bec5edd9b8e80`.
Audit SHA256 `018f49dba597ed10b9a294013d2b2f30ae3c666a1a50e2516fee5b78b7d251c5`.
This remains historical HOSTED_CONTAINER_CI evidence, not guest verification.

Owner explicitly approved the replacement source/bundle. Its one fixed native
Prepare was executed once: child21300 exit1, NATIVE_PREPARATION_FAILED,
CmdletizationQuery_NotFound_DiskNumber,Get-Partition. The real Windows CDXML
provider throws when a disk-number query has no matching partition; the fixture
returned an empty list and concealed the compatibility bug. The exception followed
new client-key and exact new256MiB VHD creation and MBR initialization, before
New-Partition, Format-Volume, payload writes, VM attachment or network change.

Original evidence outside the repository is retained in
`checks/ai09-key-media-20261020/`:

- Failure `native-prepare-0f1b61b1-20261020T1705Z.json`, SHA256
  `8e551f6bff745fb5b08d80578b63a2c44c2e287130741887fc0ebc483bc4a298`.
- Fresh read-only `readonly-partial-media-inspect-028cc365.json`, SHA256
  `7989b72529625b4e68635a1bc585f450d80b94015ff3fcf74d823fe4557f56a1`.
  Real native child41904 exit0 at2026-10-20T17:29:18Z confirmed the same Running
  VM/OS/NIC/host37 and original4ACLs; new VHD detached from both host and guest.
  This inspection does not mount the media or independently prove MBR/partition0.

The new State `C:\Users\qq113\.codex\ai09-access-1219-20261020` is protected
for owner/SYSTEM/Administrators. Private-key content was not read or hashed.
New VHD `C:\Users\qq113\.codex\AI09-ACCESS-1219-20261020.vhdx` has identifier
`BB6408C8-49AE-4575-B5F0-69AC73DDFE86`, disk UniqueId
`60022480C80864BBAE4969AC73DDFE86`, run
`028cc365d24b48d3a8ddfbbe07d0ac95`. No unknown writer was found in its metadata ACL.
Original intent SHA256 is
`f9dc1e81ca498ac0c2b5a5d576b48b5aa044e557a238654de7b64bb4a391b8f5`;
prepared SHA256 is
`75409f7caf39af78a1d6c4b000e6de377fd6b8e075f1496620c75b425f4cb56d`.
The empty payload/UUID stage and original records remain preserved.

No Prepare replay or automatic cleanup is authorized. The third and final bounded
software repair will reproduce provider behavior and implement explicit,
origin-hash-bound ResumeEmptyMbr for only the existing owned empty MBR media.
It must not create another key, call New-VHD/Initialize-Disk, alter ACLs, delete,
or overwrite original records. A separate CreateNew completion record and
explicit pinned Collect linkage preserve provenance. Native continuation must
first verify fresh baseline, detachment, exact VHD/disk identity, MBR and zero
partitions; its new exact-source approval must describe existing-media writes.
Tests, independent review and exact-commit CI are required before that gate.

Authenticated AI09, independent signer authority, signed six checks on this guest,
iPhone Goal/Ollama/restart/Job2 and later repair/selection/final acceptance remain
NOT VERIFIED. Existing services/VM/old seed/worktrees remain protected.
## Explicit empty-MBR continuation implementation

The provider mismatch was first reproduced RED using the real error identifier
and a fixture containing another disk's partition. The correction enumerates
partitions without a filtered empty-disk query, then selects only the fresh owned
DiskNumber; actual provider errors still terminate. No error suppression was added.

The explicit ResumeEmptyMbr mode binds the old bundle, exact original
intent/prepared/failure/public-key hashes and one owned run/VHD/UniqueId to a new
current source bundle and approval. It reuses the existing key and media. It never
creates a key/VHD, initializes a disk, changes ACLs, deletes or overwrites originals.
A durable CreateNew attempt marker prevents silent replay. Fresh native baseline,
host/guest detachment, exact VHD/disk identity, writable online nonboot/nonsystem
MBR and zero partitions are mandatory before the shared partition/payload steps.
A separate CreateNew completion record and its explicit hash connect Collect;
there is no automatic fallback from Prepare or discovery of another record.

Prepared bundle SHA256:
`cb65d46ec0cad1040114453b1ab3056f6e5fe10b41b1fe491247f57a95939762`.
Media source SHA256:
`7ff6a932825e14db4b9be3a7895bd09bdb8dc7a0000841fb566b1445af3d8088`.
Final tests on this source: PS5.1 and bundled PS7 each pass media17/lifecycle323/
first-access101/legacy-host131 assertions; related Node wrappers18PASS/0SKIP;
lint and typecheck exit0. Provider RED log SHA256
`5edca0f622d9a40fd79b362f6610fb3dfc37180e88eb4fc790550127c3e2920a`;
PS5/PS7 GREEN log SHA256 (identical textual results)
`6d580decf4573cf398b6f63628052fa74aa1859c1ca5f7a066f37f83fb833712`;
Node log SHA256 `5cba0d7789b963a462f58f6c2ef643e39545ac2bc5cd5fa0826ee93c93b57486`.
Report SHA256 `e329b165bfed566d343ff04b50b03c31cc47b9fd744dadcc0790fbe2cd19daff`.
All logs/report are retained under the external checks directory. These are
software fixtures, not native recovery or physical Verifier evidence.

Independent review, exact committed CI and source-blob/bundle matching remain
activation conditions. A fixed read-only native origin/ACL/detachment preflight
is separate from activation and must not mount or write the media. Its successful
result, if obtained, still cannot establish MBR/partition0; that check belongs to
the separately approved limited resume. Current expiry is not extended beyond
2026-10-21T09:00:00.000Z. Authenticated SSH and stages3/4 remain unverified.
The fixed new-source read-only native preflight completed at
2026-10-20T17:40:52.9035020Z, child40916 exit0,
READ_ONLY_RESUME_PREFLIGHT_PASS. Source/binding/original-record locks were retained;
origin hashes/private-key metadata ACL and fresh exact baseline verified. New
media is detached from host and guest and resume attempt/completion are absent.
Receipt `readonly-resume-preflight-cb65d46e.json` SHA256
`d5c297b468033e3247b56d5ccc62aba08dc14481332e0bcadaecaa1c7836c92f`.
Wrapper SHA256 `c9621abdd9c4a727724864d5e2822d55575be65a808332ea85f645a665ba780d`;
resume binding SHA256
`d9dc8192431d2efe6f5454dd94e4157e6caf1acab1b8a58aef00241e853e5784`.
ConfigurationMutationsPerformed/privateKeyContentRead/partitionStageVerified/
authenticatedConnectionVerified/physicalE2EVerified are all false. This is a
native read-only preflight, not authorization or recovery success.
Independent task review: source/spec PASS, no P1/P2; existing Prepare/Collect
gates preserved, fixed read-only preflight has no activation call and matches
source/binding pins. Report `resume-empty-mbr-review-1.md` SHA256
`3c5cb5c0596c0da33565163efcfad458dd7e237055d99e8a61955a600e22ef38`.

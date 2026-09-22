# Windows native Worker integration (#1207 / PR #1208)

Status: SOFTWARE VALIDATED LOCALLY / PR CI PENDING / PHYSICAL PENDING / MERGE HOLD.
Code revision: cb7db43a4c0796a2569b98f5fd05b46047c9a280. Base main: 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa.
Machine-readable local checks and log hashes: [verification.json](1207/verification.json).

## Reproduced failures and corrections
- An offline persisted Windows identity never became schedulable. Signed native heartbeat restores connectivity while retaining disabled/locked/needs-human, policy and capabilities.
- Lost success acknowledgement entered the execution catch and sent a contradictory failure. The durable identity/endpoint-bound journal retains exact execution evidence and separates execution from delivery.
- Default fetch redirected signed requests; redirects are now refused. Request/body time and byte limits are enforced.
- Unrelated Windows tasks could be claimed by the new consumer; native polling filters by exact task type/target through the existing scheduler.
- Caller-selected result schema bypassed validation and allowed terminal outcome changes. Stored task type now selects validation; malformed evidence is rejected and terminal outcomes are immutable.
- Expired results permanently wedged the worker. A definitive terminal rejection is persisted visibly with original report; unknown/transient failures stay pending. After an existing audit event ages out, the Broker says UNVERIFIABLE instead of claiming matching evidence.
- Crash-stale file locks were replaced by OS-owned Windows pipe mutexes for both identity/origin and journal path. Acquire before loading durable state; process termination releases them.

## Verification
- 1436/1436 full tests; 314/314 P8 security; 19/19 focused; zero skipped/failing.
- Typecheck, lint, build and isolated production-build health HTTP200 PASS.
- Real Windows service process (not a substituted probe) completed a fixed native Node platform check through an isolated signed HTTP Broker and durable SQLite.
- Crash/restart, duplicate service, same identity, unrelated queue preservation, schema omission, redirect denial, response bounds, network result loss, expired lease, terminal audit eviction and resumed polling are covered.
- Independent review found no remaining blocking findings after the corrections.
- Linux CI refuses native Windows execution. Its delivery reconciliation uses an explicitly labeled synthetic probe; it does not claim Windows physical evidence.

## Scope and remaining acceptance
Only fixed read-only smoke/platform is supported. The Broker checks signature, task binding and expected output shape/hash; this is not remote hardware attestation or a general Windows automation verifier. Browser/Office/development operations remain outside this consumer.

Temporary test identity/keys and loopback state are CODE/UNIT/INTEGRATION/SECURITY evidence only. Existing enrolled owner device, production Broker path, actual Windows reboot/AC loss/network recovery and physical acceptance remain pending. DEV-PC-001 stays PARTIAL with last_verified_commit null. No device version, enrollment, identity, key, credential, permission, firewall, billing, DB schema or production setting was changed.

## Durable next action
Check exact PR-head CI, then retain PR #1208 unmerged until a bounded existing-device canary can use the existing credential and task path. Compare device ID, public key metadata, enrollment and pending queue before/after; never extract secrets into logs or re-enroll. Reconcile full requirement coverage in #1205 independently of this physical gate.

## Rollback
Stop only the candidate process, retain its journal and restore the prior candidate code. Production services were not replaced. No state migration or destructive cleanup is needed.

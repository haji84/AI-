# Windows native Worker integration (#1207 / PR #1208)

Status: CURRENT INTEGRATION FOCUSED/P8 PASS / EXACT-HEAD CI PENDING / PHYSICAL PENDING / MERGE HOLD.
Historical validated code revision: cb7db43a4c0796a2569b98f5fd05b46047c9a280. Historical base main: 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa.
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

## Latest main integration
UI-007 reconciliation from main 9cbf6accaec5eb1ec76359a6b88af6bf225eb51e is retained in this branch. Previous candidate d94a4532928923618383814c1789c1568cc8a89f passed CI35794037590; that result does not substitute for the new combined head. Exact current-head CI is recorded on PR #1208. This merge adds canonical documentation only; native code remains cb7db43a4c0796a2569b98f5fd05b46047c9a280. Physical merge hold is unchanged.
## 2026-10-08 integration with protection enabled

Integrated main a7bfcbe52e8108aa567c0ef4c6b90b16c2156c00 into the existing PR1208 candidate as 12b6b374c13049997786d1c219fd8f752829a900. The only new behavioral correction in this integration is test cleanup: the PC enrollment fixture waited for a second exit event after its child had already exited with exitCode null and signalCode SIGTERM. The unmodified main baseline also timed out after 30 seconds. An idempotent stop helper now recognizes either completion state; no assertions, test deadline or permission checks were removed.

Current local checks on the integrated code:

- Windows consumer/recovery/Broker plus PC enrollment/identity suites: 23 PASS, 2 existing platform SKIP, 0 FAIL. The PC enrollment test completed in 1.58 seconds after the cleanup correction.
- Existing Windows dispatch/Broker-path/verifier/target suites: 6 PASS, 0 FAIL.
- P8 security regression suite: 350 PASS, 0 SKIP, 0 FAIL.
- Candidate diff whitespace check: PASS.
- Local lint: BLOCKED before source linting by missing minimatch dist/commonjs files in this checkout's node_modules. Frozen install and force reinstall reported up to date without restoring them. Do not report local lint PASS. Hosted exact-head CI must independently install and run lint, full tests, P8 and build.

The older full-suite counts above belong only to the historical code revision. New local results use temporary identities and isolated Broker state; they do not establish production identity reuse or Windows reboot acceptance. Smart App Control remains On, and no protection policy, runtime files or task privileges were changed.

The existing production ZBook identity is DPAPI-protected; this candidate CLI expects an existing PEM path. Native metadata-only inspection confirmed the identity file exists without reading its secret. The enrolled PC authority has a filesystem-only ceiling, while this consumer requires windows-tooling. Neither exporting a plaintext key nor silently extending capabilities is an acceptable integration step.

Main already has a separate bounded public-file digest executor using the existing PC identity. Its approved-source/runtime/configuration guards require exact revisions. The production Broker is still a49c458d; its refresh remains blocked by the separate #1662 no-repeat ACL-repair boundary. Do not bypass those guards to manufacture an existing-device PASS.

PR1208 remains draft and unmerged. Next: verify and review this exact integration head, then resolve a supported identity/capability/runtime-compatible acceptance path. The queued Runner rejoin/final Verifier for #1745 is a separate unverified gate; these isolated Windows tests cannot satisfy it. No new DPAPI adapter, capability grant, production task or deployment is included.

Hosted CI37752827506 on 8e256c05 passed lint and Windows runtime byte fixtures, then failed the canonical reverse-traceability guard: four changed surfaces and five newly introduced candidate surfaces were not yet reconciled to the newer main audit. The follow-up explicitly maps these nine reviewed surfaces to existing DEV-PC-001, retains every previous parent, and changes no requirement status. The reverse audit now passes for 576 surfaces / 341 requirements, and the 18 traceability/completion-audit tests pass locally. Fresh full exact-head CI remains required; physical MERGE HOLD is unchanged.

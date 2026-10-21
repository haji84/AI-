# GORIQ workflow audit — Issue #1845

Baseline: `cb6b0fa06492b3d610ecb527645244b9a46ba8eb`. Read-only; no repository refs/files, workflows, services, credentials, diagnostics uploads or Compass state modified.

75 workflows; 135 declared jobs; 3 two-runner matrices expand to 138 possible jobs before conditions. Current placement: {'A': 43, 'C': 40, 'B': 49, 'B/C': 3}. Dependency classification: {'A': 45, 'C': 39, 'B': 48, 'B/C': 3}. A includes the R20 artifact processor (local input handoff unresolved) and reservation dispatcher (unnecessary physical host use); these are not automatic move approvals.

## Minimal recommended changes

1. **Reject impossible recovery before native allocation.** `.github/workflows/goriq-pr-ci-recovery.yml:48-62` checks open/same-repo/current-head but does not inspect repairable files. `scripts/goriq-pr-ci-recovery.ts:1063-1065` rejects no allowed repair paths only after `.github/workflows/goriq-pr-ci-recovery.yml:96-98` dependency install. Reuse the exact existing `allowedRepairPaths` policy (do not duplicate or broaden it), paginate changed-file metadata from trusted control, and leave all controller checks in place. API errors must fail visibly, never grant eligibility. This removes installs for provably impossible recovery, with no skipped candidate checks.

2. **Revalidate queued recovery before setup/install and pin checkout.** The hosted receipt can become stale while waiting for ZBook. Recheck PR open/same-repo/current-head at the first native step, compare to the receipt, then checkout that exact SHA instead of mutable branch (`workflow:81`). An expected stale state should record an explicit skip reason and gate every subsequent expensive/recovery step; unexpected API/source mismatch remains failure. Retain controller checks at `script:1047-1055` and final head fence at `1120-1124`. No inference, dependencies or model access for rejected receipts.

Meaningful tests: eligibility rejects closed/fork/stale/all-protected files; mixed allowed+protected remains eligible without broadening; >100 filenames pagination; API error fails closed; native stale receipt does not invoke pnpm, model, build or push; matching receipt executes unchanged lint/test/P8/build; expected checkout SHA equals receipt. Run existing recovery controller/workflow tests plus focused new cases, lint and protected CI. Existing regex tests may need legitimate refactor updates while preserving their safety assertions; do not weaken them.

## Confirmed overlap and deferred candidates

- R1 baseline duplicates: `gai-workers.yml:227-245` and `gai-r1-evidence-rerun.yml:69-87` both run frozen real baseline, R1 evidence, same five safety tests, safety evidence and status on six shared push paths. Distinct concurrency groups allow both. The rerun uses fresh `--real` and Issue321 publication; multi-worker uses `--real --resume` and physical smoke prerequisites. Consolidation needs provenance/publication preservation and is larger than the first change; no runtime duplicate count was measured here.
- Shared persistent Builder: `install-code-builder-windows.ps1:15-24,105-123,146-160` uses one owner-local path, task, token and port8796 and replaces its launcher/process. Four workflows invoke it with differing workspace values: code-builder, real-builder-recovery, daily-smoke and goal1218. This is confirmed shared resource incompatibility, not evidence of a memory leak. Avoid canceling side-effecting native install/device jobs or adding naive global concurrency that silently replaces pending work.
- R20 `gai-r20-dossier.yml:21,30-32` is only JSON/Node computation (`scripts/gai-r20-dossier.mjs:1-62`), but reads local persistent ledger. Upstream `gai-research-ledger.yml:60-69` already emits `gai-research-ledger-state`. A future hosted path can consume the exact successful upstream artifact after proving source/schema/content/provenance equivalence; currently UNKNOWN, so a runner label alone is unsafe.
- Dispatcher `zbook-e2e-dispatcher.yml:17,34-36` reserves Mac for180s solely to force generic target `[self-hosted]` (`zbook-e2e-target.yml:13`) toward ZBook; target already enforces nameZBook at:21-28. Explicit existing zbook runner labels (used elsewhere) remove reservation; no measured ZBook CPU benefit claimed.
- CI already hosted (`ci.yml:14,29,69`). PR-specific concurrency could stop obsolete PR commits, while preserving main CI and latest-head required checks; no measured physical memory reduction claimed. Privileged deploy/token workflows remain outside changes.

## Evidence boundaries

Local-model acceptance must keep actual loopback inference/process provenance, exact candidate workspace checks (`goriq-self-development-local-model-e2e.mjs:30-31,229-237` and verifier). Physical iPhone remains Mac/USB/signing/device work. StageB artifact/lease harnesses are controlled physical-host evidence, not native distributed workload or abrupt power-loss acceptance. No heavy tests or model calls ran during this audit. No historical RSS/CPU/failure comparison can be inferred from YAML. Triggers, caches, artifacts and timeout maxima appear in `job-audit.json`; exact source is retained in local `inventory.json`.

## Job-by-job inventory

| Workflow | Job (line) | Class / flags | Runner | Dependency / boundary |
|---|---|---|---|---|
| autonomy-mobile.yml | issue-command-bridge (50) | A | ubuntu-latest | Hosted bounded control/state work; Mac project-chat-work-repair requires resident authenticated ChatGPT bridge. |
| autonomy-mobile.yml | project-chat-work-repair (90) | C | [self-hosted, macOS, ARM64] | Hosted bounded control/state work; Mac project-chat-work-repair requires resident authenticated ChatGPT bridge. |
| autonomy-mobile.yml | autonomy (117) | A | ubuntu-latest | Hosted bounded control/state work; Mac project-chat-work-repair requires resident authenticated ChatGPT bridge. |
| ci.yml | repository-guard (13) | A / E | ubuntu-latest | Repository/lint/test/P8/build/health and Windows 5.1 fixture checks already use standard hosted runners. |
| ci.yml | project-checks (28) | A / E | ubuntu-latest | Repository/lint/test/P8/build/health and Windows 5.1 fixture checks already use standard hosted runners. |
| ci.yml | windows-runtime-byte-fixtures (68) | A / E | windows-latest | Repository/lint/test/P8/build/health and Windows 5.1 fixture checks already use standard hosted runners. |
| gai-code-builder-zbook.yml | install-and-probe (21) | B | [self-hosted, Windows, X64] | Installs persistent shared ZBook Builder scheduled task/8796 and reads owner-local state. |
| gai-r1-evidence-rerun.yml | r1-zbook (25) | B / D | [self-hosted, Windows, X64] | ZBook loopback Ollama real baseline plus derived evidence/safety tests; publishes Issue321 measurement. |
| gai-r10-router-governance.yml | r10-policy (18) | A | ubuntu-latest | Deterministic router policy campaign, no physical device dependency. |
| gai-r11-recovery.yml | r11-recovery (18) | A | ubuntu-latest | Deterministic two-process checkpoint/recovery campaign. |
| gai-r13-cross-device.yml | zbook-prefix (18) | B | [self-hosted, Windows, X64] | Small deterministic computation, but current evidence explicitly represents ZBook/Mac execution; preserve provenance. Aggregate is artifact-only hosted. |
| gai-r13-cross-device.yml | mac-resume (37) | C | [self-hosted, macOS, ARM64] | Small deterministic computation, but current evidence explicitly represents ZBook/Mac execution; preserve provenance. Aggregate is artifact-only hosted. |
| gai-r13-cross-device.yml | aggregate (60) | A | ubuntu-latest | Small deterministic computation, but current evidence explicitly represents ZBook/Mac execution; preserve provenance. Aggregate is artifact-only hosted. |
| gai-r14-continual-learning.yml | r14-continual (18) | A | ubuntu-latest | Deterministic sequential learning evidence campaign already hosted. |
| gai-r15-curriculum.yml | r15-curriculum (18) | A | ubuntu-latest | Reads verified R1 artifact and derives heldout-safe curriculum, already hosted. |
| gai-r16-research-loop.yml | r16-sandbox (17) | A | ubuntu-latest | Reproducible sandbox hypothesis campaign already hosted. |
| gai-r17-self-modification.yml | r17-sandbox (18) | A | ubuntu-latest | Owner-gated ephemeral sandbox mutation with safety checks, already hosted; preserve approval checks. |
| gai-r18-adaptation-preflight.yml | route (24) | A | ubuntu-latest | Hosted provenance/availability router; ZBook job inspects physical GPU/CUDA/RAM/disk/Ollama. |
| gai-r18-adaptation-preflight.yml | r18-preflight (71) | B | [self-hosted, Windows, X64] | Hosted provenance/availability router; ZBook job inspects physical GPU/CUDA/RAM/disk/Ollama. |
| gai-r2-fresh-v2.yml | route (24) | A | ubuntu-latest | Hosted router has already/executing/busy checks; physical ZBook/Mac inference or existing hosted CPU fallback. Not all branches run together. |
| gai-r2-fresh-v2.yml | zbook (78) | B | [self-hosted, Windows, X64] | Hosted router has already/executing/busy checks; physical ZBook/Mac inference or existing hosted CPU fallback. Not all branches run together. |
| gai-r2-fresh-v2.yml | macbook (121) | C | [self-hosted, macOS, ARM64] | Hosted router has already/executing/busy checks; physical ZBook/Mac inference or existing hosted CPU fallback. Not all branches run together. |
| gai-r2-fresh-v2.yml | hosted (155) | A | ubuntu-latest | Hosted router has already/executing/busy checks; physical ZBook/Mac inference or existing hosted CPU fallback. Not all branches run together. |
| gai-r2-hypothesis-plan.yml | plan-r2 (18) | A | ubuntu-latest | Verified R1 artifact-to-plan derivation already hosted. |
| gai-r2-improvement.yml | route (31) | A | ubuntu-latest | Hosted R1 provenance/router; real local-model TRAIN/HELDOUT campaign on selected physical worker. Existing prior-run guard limits repeated work. |
| gai-r2-improvement.yml | r2-zbook (97) | B | [self-hosted, Windows, X64] | Hosted R1 provenance/router; real local-model TRAIN/HELDOUT campaign on selected physical worker. Existing prior-run guard limits repeated work. |
| gai-r2-improvement.yml | r2-macbook (148) | C | [self-hosted, macOS, ARM64] | Hosted R1 provenance/router; real local-model TRAIN/HELDOUT campaign on selected physical worker. Existing prior-run guard limits repeated work. |
| gai-r20-dossier.yml | dossier (18) | A / E,F | [self-hosted, Windows, X64] | Pure Node artifact processor; workflow presently requires persistent ZBook-local ledger. Hosted migration needs explicit provenance-preserving ledger artifact handoff; equivalence unknown. |
| gai-r3-swebench-preflight.yml | zbook-preflight (18) | B | [self-hosted, Windows, X64] | Physical ZBook capacity/Ollama inspection. |
| gai-r4-endurance.yml | r4-zbook (17) | B | [self-hosted, Windows, X64] | ZBook loopback real model endurance/checkpoint campaign; derived evidence/checks share same job. |
| gai-r6-benchmark.yml | r6-zbook (21) | B | [self-hosted, Windows, X64] | ZBook real-model benchmark; source/GPU performance context must remain explicit. |
| gai-r6-calibration.yml | calibrate-zbook (19) | B | [self-hosted, Windows, X64] | Physical ZBook GPU/local-model calibration with nvidia-smi. |
| gai-r6-output-canary.yml | canary-zbook (18) | B | [self-hosted, Windows, X64] | Real ZBook local-model canary, bounded task output validation. |
| gai-r7-repeatability.yml | r7-zbook (18) | B | [self-hosted, Windows, X64] | Second real ZBook model run paired with downloaded R6 reference. |
| gai-r8-memory-transfer.yml | r8-zbook (18) | B | [self-hosted, Windows, X64] | Real ZBook local-model heldout transfer campaign. |
| gai-r9-calibration.yml | r9-zbook (18) | B | [self-hosted, Windows, X64] | Real ZBook local-model heldout calibration. |
| gai-real-builder-recovery-e2e.yml | real-builder-recovery (12) | B | [self-hosted, Windows, X64] | Owner-local Codex login/token, shared persistent Builder8796, isolated fixture repo and real E2E. |
| gai-research-control-plane.yml | control-plane (24) | A | ubuntu-latest | Hosted nonblocking runner registry/control-plane routing; actual CPU/RAM snapshots unavailable. |
| gai-research-ledger.yml | rebuild-hosted-ledger (25) | A | ubuntu-latest | Hosted scan of retained artifacts and canonical ledger rebuild; no physical dependency. |
| gai-runtime-builder-daily-smoke.yml | runtime-builder-smoke (12) | B | [self-hosted, Windows, X64] | ZBook-local persistent Builder installer and durable smoke state; real local coding runtime. |
| gai-tool-use-120.yml | tool-use-zbook (18) | B | [self-hosted, Windows, X64] | Real ZBook loopback local-model tool-use benchmark. |
| gai-worker-persistence.yml | zbook-persistence (23) | B | [self-hosted, Windows, X64] | Exact-scope authorized OS startup/watchdog mutation and native status; physical host required. |
| gai-worker-persistence.yml | macbook-persistence (133) | C | [self-hosted, macbook] | Exact-scope authorized OS startup/watchdog mutation and native status; physical host required. |
| gai-workers.yml | zbook-smoke (32) | B | [self-hosted, Windows, X64] | Physical smoke metadata on each PC; ZBook baseline uses local Ollama. Same baseline/evidence sequence overlaps R1 rerun. |
| gai-workers.yml | macbook-smoke (61) | C | [self-hosted, macbook] | Physical smoke metadata on each PC; ZBook baseline uses local Ollama. Same baseline/evidence sequence overlaps R1 rerun. |
| gai-workers.yml | baseline-zbook (92) | B / D | [self-hosted, Windows, X64] | Physical smoke metadata on each PC; ZBook baseline uses local Ollama. Same baseline/evidence sequence overlaps R1 rerun. |
| gai-zbook-diagnostic-1218.yml | inspect (10) | B | [self-hosted, Windows, X64] | Reads ZBook persisted Goal/workspace/credential diagnostics plus portable tests; do not export owner state to hosted. |
| gai-zbook-goal-1218.yml | owner-code-goal (10) | B | [self-hosted, Windows, X64] | ZBook owner-local Goal/Builder/token/durable workspace path. |
| gai-zbook-goal-state-1218.yml | inspect (10) | B | [self-hosted, Windows, X64] | Reads persisted native Goal/verifier state. |
| goriq-ai09-existing-builder-start.yml | existing-builder-one-shot (12) | B | [self-hosted, Windows, X64] | Exact-main owner-only starts existing ZBook scheduled task and authenticates loopback health. |
| goriq-ai09-hosted-benchmark.yml | synthetic-local-model-probe (20) | A | ubuntu-24.04 | Existing hosted CPU local-model pilot with bounded public model, advisory artifacts, no PR writes. |
| goriq-ai09-owner-builder-connect.yml | owner-broker-readonly (13) | C | [self-hosted, macOS, ARM64] | Authenticates physical Mac owner Broker / ZBook local Builder with host-local credentials, read-only. |
| goriq-ai09-owner-builder-connect.yml | zbook-builder-readonly (53) | B | [self-hosted, Windows, X64] | Authenticates physical Mac owner Broker / ZBook local Builder with host-local credentials, read-only. |
| goriq-ai09-pr-review.yml | preflight (16) | A | ubuntu-24.04 | All jobs hosted; trusted source, precise CI/PR provenance, local inference and separate bounded comment job. Preserve current patch/SHA revalidation. |
| goriq-ai09-pr-review.yml | review (49) | A | ubuntu-24.04 | All jobs hosted; trusted source, precise CI/PR provenance, local inference and separate bounded comment job. Preserve current patch/SHA revalidation. |
| goriq-ai09-pr-review.yml | comment (128) | A | ubuntu-24.04 | All jobs hosted; trusted source, precise CI/PR provenance, local inference and separate bounded comment job. Preserve current patch/SHA revalidation. |
| goriq-broker-db-inventory.yml | mac (16) | C | [self-hosted, macOS, ARM64] | Reads each native production DB path; no fixture substitute for physical inventory. |
| goriq-broker-db-inventory.yml | zbook (27) | B | [self-hosted, Windows, X64] | Reads each native production DB path; no fixture substitute for physical inventory. |
| goriq-daily-driver-live-e2e.yml | live-device-status (22) | C | [self-hosted, macOS, ARM64] | Mac native owner Broker token and physical Android status acceptance. |
| goriq-groq-one-click-bootstrap.yml | install-launcher (22) | B | [self-hosted, Windows, X64] | ZBook launcher install and DPAPI-held existing external-repair secret. Privileged/cost-sensitive path outside optimization scope. |
| goriq-groq-one-click-bootstrap.yml | groq-repair-smoke (43) | B | [self-hosted, Windows, X64] | ZBook launcher install and DPAPI-held existing external-repair secret. Privileged/cost-sensitive path outside optimization scope. |
| goriq-jarvis-production-sync.yml | deploy-code (18) | A | ubuntu-latest | Hosted exact-authorized deploy plus physical Mac runtime/env/launchd/endpoint synchronization; gated production mutations. Do not optimize under read-only audit. |
| goriq-jarvis-production-sync.yml | sync (179) | C | [self-hosted, macOS, ARM64] | Hosted exact-authorized deploy plus physical Mac runtime/env/launchd/endpoint synchronization; gated production mutations. Do not optimize under read-only audit. |
| goriq-mac-private-dashboard.yml | mac-dashboard (24) | C | [self-hosted, macOS, ARM64] | Existing exact-main/CI-approved native dashboard staging/plan/apply with private route and owner scope. |
| goriq-pc-enrollment.yml | source (28) | A | ubuntu-latest | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | preflight (42) | B/C | ${{ fromJSON(matrix.runner) }} | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | mac-enroll (69) | C | [self-hosted, macOS, ARM64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | zbook-enroll (85) | B | [self-hosted, Windows, X64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | mac-public-proof (105) | C | [self-hosted, macOS, ARM64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | zbook-peer-challenge (124) | B | [self-hosted, Windows, X64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | mac-peer-sign (149) | C | [self-hosted, macOS, ARM64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | zbook-peer-prove (171) | B | [self-hosted, Windows, X64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-enrollment.yml | mac-peer-prove (197) | C | [self-hosted, macOS, ARM64] | Hosted public source check; native Mac/ZBook enrollment and peer challenge/sign/prove use existing host-bound identities. Matrix preflight expands to two physical jobs. |
| goriq-pc-private-network-probe.yml | observe (14) | B/C | ${{ matrix.runner }} | Native route/local health read-only probe matrix, expands to Mac and ZBook. |
| goriq-pc-runtime-refresh.yml | source (28) | A | ubuntu-latest | Hosted approved source; native ZBook ACL/process/state/release plan/apply. Preserve strict guards. |
| goriq-pc-runtime-refresh.yml | zbook (41) | B | [self-hosted, Windows, X64] | Hosted approved source; native ZBook ACL/process/state/release plan/apply. Preserve strict guards. |
| goriq-pc-task-execution.yml | source (22) | A | ubuntu-latest | Hosted approved source; signed task on registered host identities/native DB paths; matrix expands to both PCs. |
| goriq-pc-task-execution.yml | execute (36) | B/C | ${{ fromJSON(matrix.runner) }} | Hosted approved source; signed task on registered host identities/native DB paths; matrix expands to both PCs. |
| goriq-physical-iphone-preflight.yml | physical-iphone-preflight (16) | C | [self-hosted, macOS, ARM64] | Physical USB iPhone discovery/pairing/Xcode/signing identity; cannot substitute hosted simulator. |
| goriq-pr-ci-recovery.yml | preflight (19) | A / E | ubuntu-latest | Hosted current-head preflight; Windows recovery uses DPAPI repair secret/local engine memory/Codex/Ollama and candidate lint/test/P8/build. Portable check substeps are not standalone physical dependencies. |
| goriq-pr-ci-recovery.yml | recover (64) | B / E | [self-hosted, Windows, X64] | Hosted current-head preflight; Windows recovery uses DPAPI repair secret/local engine memory/Codex/Ollama and candidate lint/test/P8/build. Portable check substeps are not standalone physical dependencies. |
| goriq-repair-engines-runtime.yml | zbook-local-repair (36) | B | [self-hosted, Windows, X64] | Native Windows local-engine install, native Mac resident bridge/update/proof; learned-memory smoke/optional client roundtrip already hosted. |
| goriq-repair-engines-runtime.yml | mac-chat-work-bridge (66) | C | [self-hosted, macOS, ARM64] | Native Windows local-engine install, native Mac resident bridge/update/proof; learned-memory smoke/optional client roundtrip already hosted. |
| goriq-repair-engines-runtime.yml | learned-repair-smoke (97) | A | ubuntu-latest | Native Windows local-engine install, native Mac resident bridge/update/proof; learned-memory smoke/optional client roundtrip already hosted. |
| goriq-repair-engines-runtime.yml | mac-bridge-post-cleanup-proof (111) | C | [self-hosted, macOS, ARM64] | Native Windows local-engine install, native Mac resident bridge/update/proof; learned-memory smoke/optional client roundtrip already hosted. |
| goriq-repair-engines-runtime.yml | chat-work-repair-smoke (141) | A | ubuntu-latest | Native Windows local-engine install, native Mac resident bridge/update/proof; learned-memory smoke/optional client roundtrip already hosted. |
| goriq-secure-fleet-db-migration.yml | mac-prepare (21) | C | [self-hosted, macOS, ARM64] | Native keygen/DPAPI snapshot/encrypted transfer/native DB import/restart, authority-sensitive. No migration executed. |
| goriq-secure-fleet-db-migration.yml | zbook-seal (46) | B | [self-hosted, Windows, X64] | Native keygen/DPAPI snapshot/encrypted transfer/native DB import/restart, authority-sensitive. No migration executed. |
| goriq-secure-fleet-db-migration.yml | mac-import (75) | C | [self-hosted, macOS, ARM64] | Native keygen/DPAPI snapshot/encrypted transfer/native DB import/restart, authority-sensitive. No migration executed. |
| goriq-self-development-live-acceptance.yml | real-local-model (20) | B | [self-hosted, Windows, X64] | ZBook loopback actual model/provenance, isolated candidate and exact-candidate verification; Mac physical iPhone signed roundtrip/install. Preserve both evidence classes. |
| goriq-self-development-live-acceptance.yml | physical-iphone (75) | C | [self-hosted, macOS, ARM64] | ZBook loopback actual model/provenance, isolated candidate and exact-candidate verification; Mac physical iPhone signed roundtrip/install. Preserve both evidence classes. |
| goriq-stage-b-coordinator-failover.yml | mac-origin (20) | C | [self-hosted, macOS, ARM64] | Physical Mac/ZBook controlled lease/fencing harness with artifact transport; hosted aggregate. This does not prove native coordinator or abrupt power recovery. |
| goriq-stage-b-coordinator-failover.yml | zbook-failover (50) | B | [self-hosted, Windows, X64] | Physical Mac/ZBook controlled lease/fencing harness with artifact transport; hosted aggregate. This does not prove native coordinator or abrupt power recovery. |
| goriq-stage-b-coordinator-failover.yml | mac-return (94) | C | [self-hosted, macOS, ARM64] | Physical Mac/ZBook controlled lease/fencing harness with artifact transport; hosted aggregate. This does not prove native coordinator or abrupt power recovery. |
| goriq-stage-b-coordinator-failover.yml | verify (129) | A | ubuntu-latest | Physical Mac/ZBook controlled lease/fencing harness with artifact transport; hosted aggregate. This does not prove native coordinator or abrupt power recovery. |
| goriq-stage-b-node-loss-rejoin.yml | mac-loss (16) | C | [self-hosted, macOS, ARM64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | zbook-survives-mac (83) | B | [self-hosted, Windows, X64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | mac-rejoin (109) | C | [self-hosted, macOS, ARM64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | zbook-loss (164) | B | [self-hosted, Windows, X64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | mac-survives-zbook (208) | C | [self-hosted, macOS, ARM64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | zbook-rejoin (234) | B | [self-hosted, Windows, X64] | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-node-loss-rejoin.yml | verify (294) | A | ubuntu-latest | Physical listener-loss/watchdog recovery evidence on both hosts; hosted verifier. Not eligible for cancellation/hosted substitution. |
| goriq-stage-b-two-node-failover.yml | mac-origin (21) | C | [self-hosted, macOS, ARM64] | Physical controlled handoff harness on both hosts, exact-SHA verifier hosted; no claim of abrupt/native workload migration. |
| goriq-stage-b-two-node-failover.yml | zbook-resume (52) | B | [self-hosted, Windows, X64] | Physical controlled handoff harness on both hosts, exact-SHA verifier hosted; no claim of abrupt/native workload migration. |
| goriq-stage-b-two-node-failover.yml | zbook-origin (87) | B | [self-hosted, Windows, X64] | Physical controlled handoff harness on both hosts, exact-SHA verifier hosted; no claim of abrupt/native workload migration. |
| goriq-stage-b-two-node-failover.yml | mac-resume (119) | C | [self-hosted, macOS, ARM64] | Physical controlled handoff harness on both hosts, exact-SHA verifier hosted; no claim of abrupt/native workload migration. |
| goriq-stage-b-two-node-failover.yml | verify (154) | A | ubuntu-latest | Physical controlled handoff harness on both hosts, exact-SHA verifier hosted; no claim of abrupt/native workload migration. |
| goriq-stage-c-preflight.yml | nubia-preflight (16) | B | [self-hosted, Windows, X64] | Existing authorized USB Nubia/native Broker state on ZBook. |
| goriq-zbook-fleet-liveness.yml | inspect (16) | B | [self-hosted, Windows, X64] | Physical protected ZBook SQLite freshness and registered scheduled task. |
| iphone-owner-auto-update.yml | classify (28) | A | ubuntu-latest | Hosted path/security classifier; Mac native signing/device/install-state path. Actual install conditioned on eligibility. |
| iphone-owner-auto-update.yml | install (85) | C | [self-hosted, macOS, ARM64] | Hosted path/security classifier; Mac native signing/device/install-state path. Actual install conditioned on eligibility. |
| iphone-owner-build-1218.yml | compile (29) | C | [self-hosted, macOS, ARM64] | Mac unsigned compile could be split to hosted macOS only after preserving physical preflight; same job also contains authorized device signing/install. |
| jarvis-android-worker.yml | android-worker (19) | A | ubuntu-latest | APK compile/test hosted; Mac uses local signing/state and resident Broker distribution. |
| jarvis-android-worker.yml | deploy-mac (52) | C | [self-hosted, macOS, ARM64] | APK compile/test hosted; Mac uses local signing/state and resident Broker distribution. |
| jarvis-broker-refresh.yml | refresh (14) | C | [self-hosted, macOS, ARM64] | Native Mac resident repository/launchd Broker refresh, preserves live tunnel. |
| jarvis-direct-commander.yml | deploy (20) | C | [self-hosted, macOS, ARM64] | Native Mac resident service/launchd/optional tunnel/owner state; privileged mutations not eligible here. |
| jarvis-mac-bootstrap.yml | install (26) | C | [self-hosted, macOS, ARM64] | Native Mac zero-touch runtime and authenticated resident ChatGPT bridge install/status. |
| jarvis-one-tap-e2e.yml | live-one-tap-url (10) | C | [self-hosted, macOS, ARM64] | Native Mac live enrollment URL/owner token and connected Android check. |
| jarvis-real-device-cell-e2e.yml | real-device-cell-e2e (10) | C | [self-hosted, macOS, ARM64] | Native Mac live Broker/Android cell selection diagnosis. |
| jarvis-vercel-access-diagnostic.yml | diagnose (14) | A | ubuntu-latest | Hosted Vercel API scope diagnostic, no local device dependency. |
| nightly.yml | governance (12) | A | ubuntu-latest | Hosted governance file existence check; distinct scheduled governance purpose. |
| research-worker-e2e.yml | zbook-real (25) | B | [self-hosted, zbook] | Native per-PC watchdog/bootstrap/Ollama Research Worker acceptance; hosted aggregate validates both artifacts. |
| research-worker-e2e.yml | macbook-real (55) | C | [self-hosted, macOS] | Native per-PC watchdog/bootstrap/Ollama Research Worker acceptance; hosted aggregate validates both artifacts. |
| research-worker-e2e.yml | aggregate (85) | A | ubuntu-latest | Native per-PC watchdog/bootstrap/Ollama Research Worker acceptance; hosted aggregate validates both artifacts. |
| resident-research-worker-e2e.yml | install-zbook (28) | B | [self-hosted, Windows, zbook] | Native service install/health on both PCs, then ZBook natural-command E2E against resident service. |
| resident-research-worker-e2e.yml | install-macbook (62) | C | [self-hosted, macOS] | Native service install/health on both PCs, then ZBook natural-command E2E against resident service. |
| resident-research-worker-e2e.yml | natural-command-e2e (93) | B | [self-hosted, Windows, zbook] | Native service install/health on both PCs, then ZBook natural-command E2E against resident service. |
| runtime-github-token-repair.yml | authorize (18) | A | ubuntu-latest | Hosted owner-authorized credential repair and exact commit production deploy; separate Human Gate, do not touch. |
| runtime-github-token-repair.yml | repair-and-deploy (110) | A | ubuntu-latest | Hosted owner-authorized credential repair and exact commit production deploy; separate Human Gate, do not touch. |
| vercel-dashboard-deploy.yml | deploy (35) | A | ubuntu-latest | Hosted explicit preview/production path with existing secret/project/deploy behavior, do not touch. |
| vercel-scoped-production-deploy.yml | authorize (18) | A | ubuntu-latest | Hosted machine-readable exact task-scope authorization and exact successful main deploy; do not touch. |
| vercel-scoped-production-deploy.yml | deploy (117) | A | ubuntu-latest | Hosted machine-readable exact task-scope authorization and exact successful main deploy; do not touch. |
| zbook-e2e-dispatcher.yml | reserve-mac-and-dispatch (15) | A / E | [self-hosted, macOS] | Dispatch API has no physical Mac need; Mac is intentionally held by sleep180 only to coerce generic self-hosted target selection. Proper target labels can eliminate reservation. |
| zbook-e2e-target.yml | zbook-forced-real (11) | B / E | [self-hosted] | Generic self-hosted label is disambiguated by runtime Require ZBook guard; local GPU/Ollama/watchdog real research E2E. |
| zbook-wake-via-macbook.yml | wake-zbook (12) | C | [self-hosted, macOS] | Bounded Wake-on-LAN from existing Mac LAN to physical ZBook; network reachability required. |

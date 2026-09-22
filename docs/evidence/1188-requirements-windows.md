# #1188 requirement reconciliation and Windows execution audit

Date: 2026-09-23 JST. Parent: #681 / #882. Owner scope: consolidate all requirements and verify the latest Windows execution path. This is software evidence, not expanded physical acceptance.

## Sources and scope

- Inventory baseline: main `278d17c28528476f12bc6f9b8d5221ea340686b9`.
- Expanded inventory: staged #905 `6af365ceb1b52b9111f98760da8d352449632871`, carrying #783/#784 and Home Coordinator migration requirements.
- Latest tested base: main `547889aca5db6b0c4163e471b21522e56b15e770`, including #1186 required-fact guard and #1189 research hardening. The PR/CI record binds the final candidate commit.
- Read AGENTS, PROJECT_STATE, ROADMAP, #681/#882/#1187/#1188 and related architecture/decisions before implementation. No production device/configuration was changed.

## Complete inventory, conservative classification

All original 244 IDs retain their titles, descriptions, required evidence, evidence references and last-verified commits. Existing evidence_records are unchanged. Added 96 IDs: CORE 34, GOV 28, MIG 30, DEV-AX 4. Frozen validator requires all 340 exactly once in both ledger and JSON, and rejects missing IDs or removal of required physical evidence.

| Evidence status | Count |
|---|---:|
| VERIFIED (existing scoped evidence only) | 3 |
| IMPLEMENTED_UNVERIFIED | 2 |
| PARTIAL | 231 |
| MISSING | 104 |

These counts are not a product completion percentage. There are 234 rows with a source mapped on main, 19 with staged-only code, and 87 without a mapped source. MISSING remains conservative where full requirement implementation/evidence has not been established. MAIN_CODE_PRESENT is file presence, not semantic completeness. RUNTIME_ACCEPTANCE_REQUIRED is unknown/unverified, not a claim that every such feature is disconnected. The human-readable table covers every ID in `docs/JARVIS_REQUIREMENT_STATUS.md`.

Missing staged paths are preserved as exact-commit GitHub references, never presented as current-main files. Main paths were checked to exist; staged blob paths were independently checked at their stated commit. No row was newly promoted to VERIFIED. Settings UI-005 now reflects its existing page rather than saying the page is absent.

## Execution-path findings and next work

| Requirement area | Observed implementation / connection | Remaining work |
|---|---|---|
| CORE-012 facts / research | WorkDispatcher calls an optional fact gate; #1189 acquisition helpers have only test callers under src/scripts | Wire trusted acquisition policy and claim-bearing workflows; persist provenance/graph and report references; no confidence-only truth claim |
| CORE-016 Skills | Persistent library, verified write-back wrapper and context source exist | No production constructor call found for VerifiedSkillWriteBackStore/GaiSkillContextSource; connect verified outcomes to candidate storage, certification and reuse |
| CORE-018 demonstrations | Owner-authenticated teaching route/store exists; correction classifier exists | No non-test learnDemonstration caller found; bridge real observations/corrections to validated workflow and Skill candidate, retain mistake provenance |
| CORE-032 organization | Adaptive team runner uses team organizational memory | This does not implement full formal-rule hierarchy, effective dates and approval-role switching; reuse staged Digital Twin components after integration/security review |
| MIG-001..030 Coordinator | Compatibility requirements now preserved, staged references retained | Actual shadow comparison, state copy validation, same-identity canaries, leave/return and rollback evidence remain; no fleet migration performed |
| DEV-PC-001 Windows | Broker authenticated dispatch and signed queue path exist; isolated integration now tested | No production consumer of windows-real-machine-verification found in src/scripts. Wire/review a bounded native Worker handler, then existing registered Worker canary; do not equate fixture Worker with production acceptance |
| GOV advanced controls | Some main primitives and staged implementations are mapped | Trace enforcement at mutation/egress/tenant/revocation boundaries; existing primitives alone do not establish every end-to-end control |

Next software priority after this audit: integrate observation -> correction classification -> independently validated Skill candidate -> durable write-back -> certified reuse, with negative tests for mistaken actions and unverified promotion. In parallel planning, define the bounded Windows Worker operation handler before any production device test. Physical-facing changes retain the owner's pre-merge acceptance rule.

## Windows faults found and fixed

1. Expected Worker identity was checked after execution. The runtime now filters required Worker/platform before dispatch; a missing target causes zero execution.
2. Windows was only a preference and could fall back to another platform advertising the capability. Windows verification now requires Windows and an online Worker.
3. Dispatch omitted payload from default idempotency identity. Different payloads now produce different keys; target identity must match the selected node. Explicit caller keys remain supported.
4. Main Windows full suite had two harness failures: SEC-008 tried executing a .mjs fixture as a Windows native program; SEC-010 assumed POSIX separators. A test-only preload launches only the exact fake-ADB fixture via Node, and path assertions normalize separators. Existing allowlist/private-ingress assertions remain enabled. No production bypass was added.

## Actual isolated integration sequence

`tests/windows-broker-path-integration.test.ts` launches the actual Broker on an ephemeral loopback port and temporary SQLite stores. It creates two synthetic fixture identities with ephemeral ECDSA keys, not existing registrations. Checks:

- unauthenticated owner dispatch denied; wrong-platform target denied;
- authorized Windows task queued with exact target/maxAttempts=1;
- signed poll by another fixture receives no task; intended fixture receives the same task ID;
- a real read-only local Node child process returns actual platform/version, hashed into result;
- unsigned result denied; signed result accepted; nonce replay denied;
- Broker stops/restarts and task completion, public identity and replay rejection persist.

Worker polling/result submission is a test adapter. The test does not prove a deployed native Windows daemon, production enrollment, UI automation, physical device wake, real power recovery or WAN acceptance. No existing Worker ID/key/queue was modified.

## Verification on Windows

Environment: win32, Node v24.19.0, pnpm 11.19.0, Git Bash available for repository tests. Final working candidate based on `547889a`:

- `node scripts/validate-jarvis-requirements.mjs`: PASS, 340 requirements, product_complete=false.
- `pnpm test`: 1399/1399 PASS, zero failed/skipped/cancelled.
- `pnpm test:p8-security`: 266/266 PASS.
- `pnpm lint`: PASS.
- `pnpm build`: PASS. Existing video-plan-store broad filesystem tracing warning remains; no warning suppression.
- Built Next app started on isolated Windows loopback ephemeral port: `/api/health` HTTP 200 / status=ok, then stopped.
- Independent review: 20 targeted tests PASS and no actionable blockers. Review is advisory; raw machine checks and exact-head CI remain the completion evidence.

The final PR must have required repository guard, lint, full suite, P8, build and production-build health checks green on its exact head. This report does not authorize updating production Windows services or release existing held physical-facing PRs.

## Rollback and production boundary

Revert this issue's code/docs commit and rerun affected checks. No runtime DB schema/data migration, enrollment change, credential change, permission change, firewall/network exposure, APK update or paid provider was introduced. New requiredWorkerId/requiredPlatform fields are optional and preserve callers that omit them.

#1189 merged at `547889a`; main CI run 35758976065 succeeded. The Scoped Production Deploy run 35759129488 completed authorization but its deploy job was skipped, so it is not deployment evidence. Its credential-upsert path is outside this task's ordinary completion authority. Do not claim a production update from a green workflow wrapper.

Remaining physical acceptance: existing enrolled Windows/Android/iPhone canaries, Coordinator migration/leave-return, actual reboot/AC restore/network outage, Android wake/update, sustained remote-assist latency, camera/voice/accessibility and real fleet load. Historical physical evidence is retained only for its original scope.

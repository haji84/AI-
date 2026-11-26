# Resident authority binding and G1 refusal diagnostics

Issue: [#1219](https://github.com/haji84/AI-/issues/1219). Original Goal `goal-fcc81c97e09153f7`; original Job `rotation-recovery-37`. Parent main: `cfb6a35427efdd7f71beec4d313dbda4c0bd470b`. This document describes a source candidate; exact candidate CI and post-merge observations must be recorded separately.

## Scope and remaining production boundary

The source connects the existing execution path to a selected authority. It does not recover or fabricate the missing original. G1 remains HOLD; the Goal remains NOT_ACHIEVED; Issue #1219 remains OPEN. There is no new importer, Goal, state branch, credential, key, permission, provider, election, endpoint or production activation in this change.

An authenticated original control/WorkState import and an already-authorized shared store/claim are required. Fixture imports and fixture signatures are not production authority. Actual Actions A/B restoration, actual AI repair, production result authenticity and final artifact delivery remain unproved.

## Why the runtime connection needs a single authority

The previous executor selected local Job and Change Set stores while its adapter, hosted admission and Broker also read pause, requirements, WorkRun and progress from local Compass. Replacing only the Job stores would let execution and scheduling use different canonical states.

The new trusted code dependency joins these surfaces:

| Boundary | Selected-authority behavior |
| --- | --- |
| Accepted-decision Broker scheduling | Read current runnable phase, canonical stop and waits from the selected authority; shared binding does not dispatch the default local child |
| Existing CLI / shared host | Use the same Resident executor runner, with the existing GoalController bridge and Resident host |
| Adapter and hosted admission | Preserve the branded local writer and host routing requirements; selected reads do not fall back to local Compass |
| Normal, sequence and tracked-repair factories | Use the selected Jobs and Change Sets, including the tracked recovery closure |
| Progress, WorkRun and events | Preserve the accepted contract, canonical control and accumulated evidence; commit against the observed version |
| Shared checkpoint read | Validate the existing claim and checkpoint against the same root GET, including lease/epoch ownership |
| Shared metadata write | Canonical execution control must be a condition on the same expected root CAS used for Job/Change Set mutations |
| Uncertain shared execution exception | Do not obtain a new observation and write a catch result after an uncertain/conflicting persistence outcome |

Default Compass behavior remains the ordinary CLI choice. Existing non-Resident Compass work retains its prior route; explicit shared selection supports the Resident route only. Code-supplied bindings cannot be selected from model text, intake context or an arbitrary module path.

## Original import and mutation integrity

The shared projection requires exactly one supported import record bound to the authenticated Goal contract. It validates the complete original StateRecord and selected WorkRun/WorkState/bridge envelopes, required fields, enum types, timestamps, unique/versioned projections and Goal-to-WorkState objective/constraints/DoD relationships.

The validator follows existing contracts: initial `currentState` may be an empty string, and canonical control blockers retain their opaque `unknown[]` contents. WorkRun and WorkState blockers remain typed string arrays. Arrays cannot impersonate enum strings through coercion.

Runtime mutations cannot edit owner control, replace the accepted Goal, erase inherited blockers or evidence, truncate event history, reset terminal work or reuse an invalidated observation. A proposed snapshot is cloned before awaited operations, so subsequent caller mutation cannot alter the already-validated write.

Independent review reproduced incomplete imports, asynchronous caller mutation, blocker/evidence deletion, enum coercion and rejection of valid initial state. Those foundation findings were corrected and independently rechecked with 43 passing tests. Whole-runner review additionally reproduced catch writeback after conflict/unknown outcomes, Job/Change Set mutation after a concurrent canonical pause, and early release of an owned local writer while a default Compass delegation was still pending. All were corrected and independently rechecked; the final review has no unresolved findings.

## Integration evidence and limits

The fixture integration uses the actual encrypted GitHub coordinator and CAS implementation, actual executor runner, existing GoalController bridge and existing Resident host. It reaches verification wait, discards and reconstructs store/authority/runtime objects, resumes the same Job without rebuilding, consumes a fixture verification result and starts the approved successor. It reads back the resulting WorkRun/WorkState/events from the same shared root.

A separate tracked-repair test uses injected stores through the real factory and its recovery closure, retaining the rejected candidate while generating a different repaired candidate after a fixture signed FAIL. These are source integration tests, not actual original-Goal or real-model acceptance.

The remote root and the local filesystem are not one transaction. Existing local serialization and downstream `beforeWrite` fencing remain necessary; this change does not claim universal atomicity with external services or local artifact writes.

## Actual G1 observation and the bounded follow-up

[PR #1915](https://github.com/haji84/AI-/pull/1915) merged at parent `cfb6a354` after [PR CI 43681846997](https://github.com/haji84/AI-/actions/runs/43681846997) passed all four jobs. The fresh [inventory run 43682611613](https://github.com/haji84/AI-/actions/runs/43682611613) succeeded on Mac and ZBook; the new G1 Compass observer is the Mac step only.

Actual Mac classification: 9 named candidates, 7 MISSING, 2 UNSAFE_PATH, 0 checked managed generations, 0 inspected historical candidates and no authenticated recovery. All nine candidate Job/Change Set observations were MISSING. The two refused labels were `owner-config-file` and `mac-canonical-repo-default`. The complete sanitized output is in [the observation record](1219-20261115-g1-actual-inventory.json).

The follow-up keeps every `safePath` condition and its existing short-circuit priority. It adds a fixed internal reason and fixed Compass/WAL role only for a locally generated refusal. A private WeakMap prevents external error messages/properties from supplying the detail. Raw paths, UID, permission mode, error text and bytes remain absent. It changes no permission and reads no newly selected directory. Root independently reran its focused set: 38 PASS / 0 FAIL / 0 SKIP.

## Parent CI timeout and controlled recheck

Parent [main CI 43682611578](https://github.com/haji84/AI-/actions/runs/43682611578) first passed project, Windows and repository jobs, but its independent Unit check hit the unchanged 300,000 ms limit at 300,007.714804 ms with ETIMEDOUT/SIGKILL. Later integration/security/build checks did not execute; cleanup was confirmed. No complete result is inferred from partial stdout.

The PR and merge have the same Git tree, `e400f499f40530ab99bfbdbd86b210d3f61b9ea9`. Artifact comparison found no assertion failure in retained timeout output and slower Lint/Typecheck as well as Unit. The successful PR Unit was 212,257.751823 ms. This supports an execution-speed variation hypothesis, not a proved cause. Image digests and run-specific probes differ; supplemental resource samples do not establish a true peak or absence of OOM.

After that comparison, the failed independent job alone was requested for one recheck without changing source, assertions, the 300-second check limit, memory/CPU limits or test concurrency. Attempt 2 completed successfully on exact main `cfb6a354`, with all four latest job results successful and independent job `132720179030` successful. Both attempts are retained. The successful retry is not a permanent performance repair or a proved explanation of the first timeout.

## Verification ledger

The implementation plan retains the RED/GREEN sequence and command details. Source was frozen after the final writer correction; the reviewed adapter SHA256 is `2212dc02e2c09f3c04fd41fdc0f040048b429b907d4120c1ae01508576457ce9`.

| Check | Observed result |
| --- | --- |
| G1 bounded refusal regression set, repeated by parent | 38 PASS / 0 FAIL / 0 SKIP |
| G3 18 related files after catch/CAS/default-route corrections | 241 PASS / 0 FAIL / 0 SKIP; before final writer one-line correction |
| G3 6 affected files after final writer correction | 46 PASS / 0 FAIL / 0 SKIP |
| Independent final writer recheck with real Compass/OS writer | 2 PASS / 0 FAIL / 0 SKIP; owned and supplied writer cases |
| Independent whole-scope review | No unresolved Critical, Important or Minor findings in reviewed G3/G1 scope |
| Repository ESLint, TypeScript no-emit and Next production build | Each exited 0 on frozen source |
| Reverse traceability audit | PASS; 626 surfaces / 341 requirements; no functional-completion claim |
| `git diff --check` | PASS |

These test sets overlap and must not be added together. The earlier 4,063-test diagnostic ran while review regressions were being added: 4,029 passed, 8 failed and 26 skipped. It is not exact-source acceptance. Its two network-interface failures reproduce on unchanged baseline; the other six failures were corrected by the reviewed changes. The frozen rerun independently observed the approved-next Broker and stale WorkRun cases passing.

The final local whole-suite attempt (`pnpm@11.19.0 test`, Node 24.22.1, unchanged concurrency 2) remained INCONCLUSIVE. An existing `jarvis-pc-reconnect-broker` local after-commit TCP-loss case timed out at 30,001.109326 ms; later peer variants passed, but the process did not finish and was interrupted with exit 130. No full totals or success are inferred from its partial output. A bounded rerun of the unchanged four-case file passed 4/4 on the candidate (4,956.021508 ms) and on unchanged parent `cfb6a354` (5,117.501305 ms). The test uses PC task/result routes without creating a Compass Goal, so it does not dispatch the new Goal scheduler. Unbounded child/proxy cleanup awaits are a possible explanation, not an established cause. The timeout is retained, not waived; exact published-HEAD hosted full CI remains mandatory before merge.

The first local build refused the worktree's external `node_modules` symlink. Replacing that temporary setup with a local pinned `pnpm@11.19.0 install --frozen-lockfile --offline` resolved it; the final ordinary build exited 0 without package, lockfile or configuration changes. Its generated `next-env.d.ts` was restored to the unchanged parent version. No test assertion, timeout, workflow or protection was changed to obtain a pass.

Published-HEAD CI, protected integration, exact-main CI and the actual follow-up refusal reason require their own Issue #1219 writeback. This pre-publication source ledger does not claim those later observations or any original-Goal completion.

## Rollback

Revert this selected-authority injection and its source/test changes as a unit, restoring the previous default runtime path. Keep the evidence and handoff history. There is no activated shared production data or migration to reverse. Reverting only one factory or scheduling consumer would reintroduce split authority and is not a valid partial rollback.

# GORIQ Bounded CI Fixture Runtime Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task-by-task. This assignment permits no additional agents, commits, pushes or remote mutation.

**Goal:** Remove repeated Linux PowerShell cold starts for 16 reviewed inert rotation variants while retaining their exact test identities, assertions, closed outputs and native Windows execution.

**Architecture:** Reuse the existing `createPowerShellFixtureBatch` helper with one Linux batch per existing test file. Every variant still runs the unchanged fixture and production algorithm in a fresh runspace. Existing Windows branches and the explicit authority PowerShell probe retain their original process calls.

**Tech stack:** Observed local Node 24.22.1 and approved portable PowerShell 7.7.0, with pnpm 11.19.0 dependencies; existing Node test runner and fixture batch helper. Repository engines permit Node >=24.19.0 <25; CI uses Node 24.19.0. These local measurements do not substitute for that CI environment.

**Spec:** Existing Issue #1219 completion scope and parent-approved bounded test-harness optimization. Exact base `ed2713bfc862fd0d0eaf5471d2417469ee340585`; worktree `/workspace/scratch/d10f272cafc1/goriq-ci`, branch `work/1219-ci-bounded-runtime-20261115`.

## Boundaries

- Owned files are only this plan and `scripts/owner-code-rotation-authority.test.mjs`, `scripts/owner-code-private-rotation-exercise.test.mjs`, `scripts/owner-code-planned-reserve.test.mjs`.
- Preserve all 16 variant IDs, the additional public-boundary test, every assertion, fixture source, CLI/process probe, exit status and existing 30000ms fixture bound.
- Windows and non-Linux platforms retain their exact native process calls. Protocol/IPC, native APIs, Add-Type/COM and process-sensitive closure tests are outside this patch.
- No production source, workflow, resource, 300s verifier gate, 2CPU/2GiB/128PID limit, concurrency2, permission or authority changes.
- Do not increase or bypass the preflight helper's eight-source limit. This patch uses only the already reviewed three-file group and the existing generic helper within its existing bounds.
- Local timing is a bounded sample; it cannot establish exact-HEAD hosted CI success or CI margin.

## Task 1: Capture the unchanged baseline once per file

- [x] Verify clean exact base and pinned Node/PowerShell paths and versions.
- [x] Run each owned test file individually once under an external 60s timeout (5s kill grace), using the same node/pwsh PATH for baseline and candidate.
- [x] Capture raw stdout/stderr, shell exit, outer wall, Node test totals and case-duration sum. A temporary `--import` data-URL observer records actual PowerShell child status/stdout/stderr and calls without changing test source or fixture arguments.
- [x] Verify the baseline has 7 authority, 6 exercise and 3 reserve payload processes; retain the separate authority version probe. Freeze these per-scenario closed outputs before editing.

## Task 2: Apply the smallest Linux-only batching change

- [x] Add one `createPowerShellFixtureBatch` import and one static scenario list per test file.
- [x] On Linux, select one batch over the same fixture, `Case` parameter and unchanged `SourcePath`; keep `timeoutMs:30000` explicit.
- [x] On Windows/non-Linux, preserve the existing `spawnSync` branches and arguments verbatim. Keep every existing assertion and test label.
- [x] Keep fixture files untouched. Do not extend scope to other candidates.

## Task 3: Measure the candidate once and compare evidence

- [x] Run the same three files individually once under the same outer envelope and observer.
- [x] Require the same 17 test IDs (16 variants plus one public-boundary test), PASS/FAIL/SKIP counts and parsed closed JSON values; compare per-scenario exit status and stderr as well. Raw records remain available for inspection.
- [x] Confirm 16 payload starts become three, with the explicit version probe still one. No fallback/retry may hide a failed batch.
- [x] Report each raw outer wall and case sum, not just a percentage. Treat any observed gain as local only.
- [x] Run focused lint on the three files and `git diff --check`; inspect the full diff, fixture hashes and all unchanged assertions. Parent owns full-suite/remote CI and final evidence/handoff.

## Rollback and Completion

Rollback changes only the three test selectors back to their original `spawnSync` paths; no runtime state or production data is touched. Completion requires measured benefit and exact per-scenario equivalence. If any case diverges or a batch hits its existing bound, diagnose without increasing a bound, weakening an assertion or widening this patch.

## Execution Record

The three baseline files and the three candidate files were each run exactly once, individually, with the same local Node executable, portable PowerShell PATH, data-URL child observer, `--test-concurrency=2`, spec reporter and external `timeout --signal=TERM --kill-after=5s 60s` envelope. All six runs exited 0. No full suite or remote mutation was performed by this implementer.

| File | Tests before/after | Outer wall before | Outer wall after | Case sum before | Case sum after |
| --- | --- | ---: | ---: | ---: | ---: |
| rotation authority | 7/7 PASS | 6729.236ms | 3688.205ms | 6192.460ms | 3210.107ms |
| private rotation exercise | 7/7 PASS | 7556.033ms | 5240.440ms | 7395.623ms | 5072.655ms |
| planned reserve | 3/3 PASS | 3829.462ms | 3108.347ms | 3669.423ms | 2953.830ms |
| Serialized sum | 17/17 PASS | 18114.732ms | 12036.993ms | 17257.506ms | 11236.593ms |

All runs had 0 FAIL, 0 SKIP and 0 CANCELLED. The observed serialized outer-wall difference was 6077.739ms. This is one baseline-first/candidate-second local sample; cache/load variation was not separately measured, and parallel full-suite wall savings or CI margin are not established.

The observer captured all 16 original per-scenario JSON results, statuses and stderr, then decoded the three batch envelopes. All 16 complete parsed JSON values, all 16 statuses and all 16 stderr strings matched exactly, with no field exclusions. All 17 test IDs remained identical. Payload process starts changed from 7+6+3 to 1+1+1; the authority's separate version probe remained one identical native call.

Canonical closed-result SHA256 by scenario map:

- authority: `011a3e92ac43111184251ad81110d005c7a60ef5035d6aa966692e56db45a81f`
- exercise: `8f6fe45f174a571d729830bfab86001c85111452d0cac2b24c5af00d9c066e91`
- reserve: `48b195d35a18abd10defeddd0b029c4d1be655a28c6264abcdd7451f72f23b80`

TypeScript AST inspection confirmed all 74 existing assertion calls (16/38/20) and all four native `spawnSync` call expressions (2/1/1) retain their exact original text. All four fixture sources and the existing batch helpers are unchanged. Focused ESLint on the three modified test files and `git diff --check` passed. Windows was not executed locally; its unchanged native branches require the normal hosted checks.

Raw logs, child captures and machine-readable summaries are intermediate evidence under `/workspace/scratch/d10f272cafc1/goriq-ci-measurements/`; the parent owns the final evidence/handoff record. No candidate-2 batching, production source, workflow, dependency manifest, gate or resource changes were made by this implementer.

## Follow-up: Preserve the tracked Broker fixture's inherited Node options

Parent-authorized scope at `636e93f2217aca19f672e8b2b613be6e15ec85dd`: only this plan and `tests/autonomous-tracked-repair-runtime.test.ts`. The tracked Broker fixture currently replaces inherited `NODE_OPTIONS`, unlike the existing sequence Broker fixture, which appends its synthetic telemetry import. The verifier image uses inherited `NODE_OPTIONS` for its image-owned home/cache initializer; no new cache or initializer is proposed.

- [x] Capture one bounded selected authenticated Broker scenario before changing source. A private temporary preload observes real process startup and preservation of a benign existing Node option; the external regression check must fail because both Broker startup events are absent. Keep the full existing scenario and assertions.
- [x] Apply only the sequence fixture's existing append-and-trim pattern to the tracked Broker fixture's `NODE_OPTIONS` expression. Preserve telemetry import, all subprocesses, explicit probe env, source, timeout and resource limits.
- [x] Run the same selected scenario once; require two distinct Broker preload activations, retained existing option, unchanged subprocess outcomes and all scenario assertions. Record before/after wall without claiming CI margin.
- [x] If adopted, run all 49 tracked-runtime tests once under an external 120s timeout plus 5s kill grace. Run focused lint and diff check; inspect the exact source diff. Parent owns full checks, review, evidence and hosted CI.

The temporary preload is a local observation fixture only. It does not implement or replace the image-owned initializer and introduces no production cache setting. Rollback is the one test expression; no production or runtime state is changed.


### Follow-up execution record

The selected existing authenticated Broker scenario was run once before and once after, with the same private local `--require` observer plus a benign existing `--no-deprecation` option. The observer records actual startup PID/parent PID, role and option-presence booleans only; it does not replace Node, Broker, executor, readback, telemetry, cache APIs or image initialization. Both runs used an outer 120s bound with 5s kill grace. The original selected scenario passed, but the external regression assertion failed with `INHERITED_PRELOAD_NOT_ACTIVE_IN_BOTH_REAL_BROKERS`: both real Broker spawns exited0 while neither activated the inherited observer. After the one-line append fix, the same scenario passed and both distinct real Broker PIDs retained the original option, observer and telemetry import. Two downstream executor starts and eight downstream readback starts also activated the observer. The selected case name, all11 observed command outcomes (excluding varying PIDs), and empty stderr remained identical.

| Selected scenario | Before | After |
| --- | ---: | ---: |
| Outer wall | 3535.276ms | 3335.986ms |
| Test footer | 3436.961ms | 3250.378ms |
| Existing scenario result | 1PASS/0FAIL | 1PASS/0FAIL |
| Real Broker startup observer activations | 0 | 2 distinct PIDs |

These single local runs do not establish a CI timing gain. This is a correction to inheritance of the existing image-owned initializer, not a new compile-cache feature. The rejected external `NODE_COMPILE_CACHE` proposal remains rejected because the image already enables its private cache and refuses a pre-enabled external cache.

After adopting the one-line inheritance fix, all49 tracked-runtime tests were run once with the same private observation preload, no cache environment setting, external120s/kill5s bound, unchanged test concurrency2, source and assertions. Result:49PASS/0FAIL/0SKIP/0CANCELLED, outer65389.585ms, footer65300.049ms, stderr empty. All49 names and824 ordered observed command outcomes matched the earlier unchanged-source baseline. The351 direct readbacks,40 probes (39RED failures/1GREEN success),2 direct executors,2 Broker starts and429 Git commands remained present. Both real Broker PIDs retained the inherited options.

Focused ESLint for the modified test and `git diff --check` passed. Exact test-source diff is one `NODE_OPTIONS` expression; no helper, fixture, test name, assertion, explicit probe environment, dependency, production source, workflow, timeout or resource limit changed. Temporary machine-readable observations and raw logs are under `/workspace/scratch/d10f272cafc1/tracked-runtime-preload-propagation/`. No commit or remote mutation was performed. Parent owns final review, full checks, hosted CI, evidence and handoff.

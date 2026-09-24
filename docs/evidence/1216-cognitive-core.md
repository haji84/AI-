# #1216 Cognitive Core candidate evidence

Date: 2026-09-23. Source baseline main54b5df2a41eaef75e7c40a83474aceb8fc15b3be. Final candidate commit and CI appended after integration. This is not Production activation or physical-fleet acceptance.

## Baseline
- Existing memory/world/GoalLoop tests:34 PASS before implementation.
- Loopback Ollama /api/version:0.34.2; /api/tags advertised qwen3:4b, qwen2.5:1.5b and two qwen3-vl:2b variants. No download, model installation, credential, runtime configuration or device changes.

## Actual local-model adapter trials
Input: isolated synthetic arithmetic goal, produce42 from20; candidate double (20*2) versus add22 (20+22); prior doubling observed40. No tools or external expert invoked by the adapter.

1. Initial adapter, unconstrained JSON, default model thinking: FAIL by60,006ms timeout. No result treated as success.
2. think:false and bounded output: FAIL by9,155ms because returned candidate did not validate against the host catalog. No action was executed.
3. think:false plus JSON schema restricting candidateId to host-provided IDs: PASS for candidate selection,6,743ms, model qwen3:4b selected add22, confidence0.85.

The final explanation still contained inconsistent phrasing ('Doubling failed to produce40') and malformed claimed evidence ('20 + 2:22 =42'). These are AI_ASSERTED proposals, not verified facts. Only selection of the expected host candidate passed. An independent arithmetic verifier is required for execution acceptance. This one case establishes neither broad unknown-task capability nor accuracy calibration.

Ollama thinking API contract was checked against the official documentation: https://ollama.com/blog/thinking . Runtime output validation remains mandatory even with structured output.

## Integrated actual-local-model acceptance
`GAI_LOCAL_MODEL_NAME=qwen3:4b node scripts/goriq-local-brain-smoke.ts` passed on the isolated Windows candidate: 14,692ms, local model used, configured output independently read back, Goal completed, external AI calls per Goal 0. The test used temporary Compass/data and removed them afterward. It is one host-authorized artifact task, not a general capability benchmark.

## Bounded acceptance A–J
All ten executable cases pass in `tests/goriq-cognitive-acceptance.test.ts`:

| Test | Measured result | Boundary |
| --- | --- | --- |
| A known certified skill | 1 attempt, 0 model/expert calls; regression quarantines | Host action catalog binding |
| B unfamiliar input | 2 attempts, first failed, alternative verified | Host supplied alternatives, no novel code synthesis |
| C failure recall | Matching failed strategy avoided | Task/environment scoped |
| D matched memory ablation | Without memory 2 attempts; with memory 1 | Single paired task, training cost excluded |
| E expert then internal reuse | First expert calls 1; next 0 | Synthetic expert, independently verified host action |
| F correction | Old action not repeated, tester correction leakage 0 | Explicit existing verified attempts |
| G offline restart | Same Goal restored, 1 saved attempt to 2 final, external 0 | Runtime restart on same host |
| H no improvement | Rejected, 0 mutations | R17 adapter gate |
| I regression | Baseline file/output restored and independently checked | Synthetic canary, not physical device |
| J model unavailable | Safe degraded local task completed, external 0 | Available registered local capability required |

Metrics retain null for absent denominators; no invented unknown-task/transfer pass rates.

## Recovery, isolation and independent review
Independent review found and reproduced false child completion, orphaned file locks, cross-volume path escape, replayed outcome counts, transitive dataset leakage and interrupted certification quarantine loss. Regression tests were added and failures fixed; final bounded-candidate re-review approved with 39/39 focused tests passing.

- Native SQLite lock arbitration uses no schema/migration and releases on process exit; atomically published complete owner metadata; unknown/foreign legacy writers fail closed.
- Existing authority commits before cognition/learning. Uncertain local file effects reconcile only after independent readback and exact action/child binding; no duplicate create.
- Incomplete child work cannot persist Goal completion or completed metrics.
- Concurrent file creates cannot overwrite the winning content; Windows different-volume/UNC paths rejected before I/O.
- Learning outbox retries are idempotent, certification version/evidence preserved, interrupted regression remains quarantined.
- Held-out families survive failed outcomes and transitive duplicate chains; they cannot enter training.

## Repository verification on Windows
- `node --test --test-concurrency=4`: **1,520/1,520 PASS**, zero skipped (Git Bash added to this process PATH only).
- `pnpm test:p8-security`: **331/331 PASS**.
- `pnpm lint`: PASS.
- `pnpm build`: PASS including TypeScript.
- Isolated production-format Next health: HTTP200.
- Actual authenticated Broker → Core → local artifact → verifier → persistence → restart: PASS. Unauthenticated calls and caller-supplied scope/external-provider arguments rejected.
- Browser: isolated owner sign-in, current Goal display, button-triggered local work and 100% for the one test Goal observed. Narrow viewport inspected; this is not physical-device/assist evidence.

An initial simultaneous full-suite/build/security run failed because Bash was absent from process PATH and the 2s bounded cross-process lease wait expired under contention. Neither tests nor runtime bounds were weakened. Full suite passed with installed Git Bash and four concurrent test files. CI uses its repository-defined commands unchanged.

Final commit/CI identities are recorded after this candidate is committed. Transient local logs are not product source.

## Reuse and remaining gaps
Reused GoalDrivenLoop, WorkState authority/guards/write-back, CapabilityRegistry, LocalFileCapability/LocalArtifactVerifier, PersistentMemoryStore/WorldModel/SkillLibrary, VerifiedWorkLearningEngine, ClosedLearningLoop, ContinualLearningRuntime, R16 hypotheses and R17 improvement gate. No replacement Goal registry, Worker identity or enrollment protocol was introduced.

The existing code-builder is an explicit opt-in external expert: its loopback Worker may invoke Codex/aider and is not counted as local cognition. Direct paid-provider inference was not added. Default execution has external experts disabled.

Still PARTIAL: arbitrary novel decomposition and generated executable skills; full historical GitHub ingestion; free-form correction/teaching UI; autonomous R8/R14/R16/R17 campaigns and improvement proposals; full strategy quality calibration; model fine-tuning/promotion; automatic cross-device cognitive checkpoint transport; production activation and physical acceptance. A host work manifest is currently required for material local work. These are retained requirements, not removed scope or completed claims. Full component status: `docs/goriq-cognitive-status.json`.

Rollback: revert candidate source composition; preserve existing Compass/device DBs and scoped cognition/learning files. No production processes, credentials, enrollment, network/firewall or installed models were changed. Never delete stored state as rollback.

## Exact candidate CI

Software commit `596b3f893ddfcc0ea5d5989a55e29e7f1265cc70`: [CI #1853](https://github.com/haji84/AI-/actions/runs/35873940497) **SUCCESS**. Repository guard, lint, full tests, P8 security, build and production-health verification passed on the repository Linux runner. [PR #1217](https://github.com/haji84/AI-/pull/1217) remains draft/unmerged. This records software evidence only; OWN-001 remains PARTIAL.


## 2026-09-24 continuation: outcome-driven local work

Added `cognitive-local-outcomes.ts` and host configuration wiring through the same Broker → CognitiveService → Compass adapter → CognitiveCore/GoalDrivenLoop → WorkState → learner path. The owner supplies trusted source hashes and desired outputs, not prewritten read/write steps or output hashes. Existing file/XLSX/DOCX adapters and independent artifact-lineage verifier are reused.

Measured virtual acceptance:
- A new Goal with workbook JSON and document JSON automatically performs four actions, resumes after its first three-cycle budget, saves XLSX/DOCX, decodes the expected contents, completes and records zero external-AI calls. A repeated continue performs no extra writes.
- Real isolated authenticated Broker: legacy steps and new outcome contracts both execute, independently verify and retain the same Goal/results after restart. Caller-supplied scope remains rejected.
- Source drift, occupied outputs, unsafe paths, secrets, formulas, invalid schemas, oversize input/output, invalid Office XML and normalization-sensitive Office data fail closed. Plain-text CRLF remains intact.
- Current Goal and complete host contract/root are checked before recovery or completion. Changed contracts cannot reuse old PASS, and unbound authoritative history cannot acquire a new contract silently.
- All declared outputs need verified action evidence even when they share one criterion. The final report and persisted completion use this condition.

Independent review reproduced premature multi-output completion and invalid XML acceptance; regression tests demonstrated RED before correction. Final independent review: **39/39 PASS**, zero skipped, approved for bounded local transformations and same-host recovery only.

Final local verification:
- `node --test --test-concurrency=1`: **1,541/1,541 PASS**, zero skipped.
- `pnpm test:p8-security`: **331/331 PASS**; final full suite includes those tests too.
- `pnpm lint`: PASS.
- `pnpm build`: PASS, including TypeScript.
- Isolated production-format Next `/api/health`: HTTP200, status `ok`; server stopped afterward.
- Requirement audit: PASS, 493 surfaces, 341 requirements, functional completion claim false.

One final parallel full-suite run failed the existing registration grant 30-minute wall-clock assertion (1,540 PASS / 1 FAIL). The affected enrollment implementation and assertion were not changed. Standalone rerun passed; a bounded diagnostic measured 1,799,996ms remaining and passed. The exact cause of the intermittent timing failure was not established. With test concurrency1 the whole final suite passed. This failure is retained as evidence, not hidden or converted to a weaker assertion. Linux exact-head CI is recorded separately.

Remaining: unrestricted task decomposition/executable skill synthesis, natural-language material/authorization intake, live historical and teaching/research integration, model training/promotion, cross-device transport and physical acceptance. Fixed conversion verifies preservation of supplied data, not factual truth or arbitrary Office functionality. The work is still OWN-001 PARTIAL. No Production activation, Worker update, re-enrollment, credential, permission, network or database schema change.

Rollback: revert this additive compiler/wiring increment while preserving Compass/WorkState/device stores. The prior candidate cannot read newly bound checkpoint fields; retain these scoped cognition files and review/replay under the matching candidate rather than deleting them or silently downgrading state. Existing enrolled Worker identity is unaffected.

## Exact continuation CI

Software commit `bee371198444408217cfa19fbcff97424933ef18`: [CI #1854](https://github.com/haji84/AI-/actions/runs/35930238569) **SUCCESS**. Repository guard, lint, full tests, P8 security, build and production-health verification all passed on the exact pushed software commit. The final local full suite passed 1,541/1,541, zero skipped; independent review passed 39/39. This is bounded software evidence. PR #1217 stays draft/unmerged; OWN-001 stays PARTIAL. No Production or physical acceptance is implied.

## Next-integration audit: owner upload to local material

Read-only audit after CI1854 identified no existing trusted upload-to-local-material bridge. Reuse `src/app/attachment-storage.ts` and `src/app/api/attachments/presign/route.ts`, but their current Private Blob references are metadata, not filesystem execution authority. Issuance creates a random pathname; reference validation checks URL shape/expiry rather than proving a server-issued grant, exact store, bytes, digest and Goal binding. A fabricated-reference probe was accepted by this metadata validator; this does not demonstrate an existing filesystem vulnerability.

`src/app/api/command/route.ts` supplies attachmentCount to normalized intake and dispatches attachment references under an issue ID. Cognitive execution requires the existing authoritative `goal-...` identity. Conversation persistence has names/MIME/size/pathname, not verified bytes or a durable Goal-bound grant receipt. No general Blob acquisition/staging consumer was found. New Goals also need explicit success criteria before output-to-criterion mapping.

Minimum next increment: prove the exact owner-issued upload grant; resolve authoritative Goal and owner-approved output/criterion mapping; acquire at most 64KiB with redirects rejected; stage generated relative names under the already authorized dataRoot; calculate SHA-256 server-side; generate the existing outcome contract. Preserve goalId-only continue, contract/root/Goal binding and restart idempotence. HTTP/model data must not supply filesystem authority or verification hashes. Unavailable proof, storage or acquisition must fail visibly.

Start with text-to-file. Current uploads do not accept application/json, and uploaded XLSX/DOCX/PDF are not the compiler's canonical workbook/document JSON. Those formats need separately bounded parsing. Add behavioral forged/cross-store/wrong-Goal, expiry, streaming overflow, redirect, caller-scope, restart and source-drift tests; current route tests largely use source assertions. Read-only audit verification: `node --test tests/attachment-storage.test.ts tests/command-chat-attachments.test.ts` — 6/6 PASS. This paragraph is an implementation handoff, not a completed bridge claim.


## Continuation 2026-09-24: authenticated materials, historical candidates and correction UI

Source baseline `7947ee000dc521f11fcc86b318241ddef1c988f9`. Scope: candidate-only changes under #1216, not Production activation. The prior Blob acquisition proposal was superseded after audit: the existing owner/private Broker can receive bounded bytes directly, avoiding a new cloud acquisition or credential path. Existing step/outcome manifests remain compatible.

Implemented and reused:
- Direct owner-authenticated material intake binds actual bytes and generated relative names to the full current Goal, existing criteria and canonical host root. Immutable receipts make retries/restarts idempotent. Reuses the outcome compiler, local file/Office adapters, independent verifier, GoalDrivenLoop, WorkState and shared execution lease.
- Browser upload accepts UTF-8 text and canonical workbook/document JSON with explicit criterion acknowledgement. Server derives hashes; HTTP cannot provide paths, roots, permission, verification, partition or source URLs. Download is available only after current-contract verification and fresh exact-byte comparison.
- Host-configured local history manifest imports actual bounded artifacts with source hashes/provenance, serializes concurrent imports and retains owner/tester partitions. All imported claims remain UNVERIFIED and are excluded from training/recall. UI shows counts; dataset preview does not train or promote a model.
- Authenticated correction controls select actual Goal attempts; full Goal/contract identity, shared lease and pending reconciliation are checked before learning. Existing correction recall and skill quarantine are reused.

Independent review reproduced then verified repairs for: state-root symlink writes outside scope; correction after Goal/contract changes or while the execution lease is held; legacy Broker status crashing the updated learning UI. Behavioral regression tests preserve each boundary. Separate actual-browser execution caught duplicate sibling React keys causing repeated download controls; distinct keys fixed it. Expanded learning controls at 390px initially exceeded viewport width (506px); responsive form containment fixed it. These failures were not accepted as PASS.

Fresh verification:
- `pnpm lint`: PASS after removing the temporary exploratory harness (the harness had caused lint failure; production code was not suppressed).
- `pnpm build`: PASS after final UI changes.
- `pnpm test:p8-security`: 331/331 PASS, zero skipped.
- Full Windows suite: `node --test --test-concurrency=1` with installed Git Bash in process PATH: 1,578/1,578 PASS, zero skipped.
- Independent boundary review: 27/27 behavioral checks PASS, zero skipped; no remaining blocker in the reviewed bounded scope.
- `node scripts/jarvis-requirement-audit.mjs --check`: 500 surfaces / 341 requirements PASS; functional_completion_claim=false.
- `scripts/goriq-cognitive-browser-smoke.mjs`: PASS with installed Chrome153.0.8010.48, isolated temporary Broker/Compass and synthetic owner login. Actual UI upload → criterion acknowledgement → 2 Core actions → Goal verification → downloaded text exactly matches source; external AI calls per Goal 0. Three refreshes preserve exactly one download control; reload preserves completion; expanded learning fits390px; zero page errors. One fixed text conversion is not a general unknown-task benchmark.

Browser reproduction requires a fresh `pnpm build`, existing Playwright module via optional `GORIQ_BROWSER_PLAYWRIGHT` and installed browser path via `GORIQ_BROWSER_EXECUTABLE`. The script never downloads a runtime, reuses an owner browser profile, changes production configuration or enrolls a device. Its temporary server/database tree is removed on exit; screenshots remain in its printed temporary artifact directory. CUA browser surfaces and agent-browser were unavailable in this session; the isolated headless integration harness provided the browser evidence. Browser screenshots are stored beside this document as `1216-cognitive-desktop.png` and `1216-cognitive-mobile.png`; screenshots are synthetic fixture evidence, not owner-device acceptance.

Remaining software: normal natural-language Goal intake still needs explicit semantic DoD integration; arbitrary new plans/executable skills, free-form teaching-to-Goal binding, independently verified historical promotion, R16 experiment execution/R17 runtime improvement and model training, and automatic cross-device transport are not complete. Physical acceptance and production activation remain separate. OWN-001 stays PARTIAL.

Rollback: revert this additive intake/history/UI increment and remove only its opt-in configuration if activated in a future approved release. Preserve Compass, WorkState, enrolled device stores, material receipts and private history/checkpoints. Do not erase/re-enroll devices or treat unsupported state as verified after downgrade.


Full-suite diagnostics retained: the first run had1,575PASS/3FAIL. Bash was absent from the invoking process PATH; adding the already-installed Git Bash resolved its syntax-check failure. Two unchanged enrollment/wake expiry assertions also failed; bounded diagnostic copies (not weakened original tests) measured1,799,997ms and14,997ms and passed. One diagnostic copy initially failed from a relocated relative import; pointing that copy at the original dependency corrected the probe. The cause of the intermittent cross-process wall-clock assertions is not established. The final unchanged full suite passed; no enrollment/runtime timing logic or assertion was relaxed. CI on the exact software commit remains separate evidence.

Next audited integration seam: `GoalControllerRuntime → GoalResolver → CompassGoalRegistryAdapter` currently creates new Goals with empty success criteria (`src/orchestrator/goal-controller-runtime.ts`). Reuse `normalizeGoalDraft`/`assessGoalReadiness` and additive goal refinement under current Goal ID/full digest/shared execution lease. Do not expose `applyExecutionReadyGoalDraft` directly: it unconditionally sets the Goal. Initial DoD adoption must reject existing criteria, pending effects, execution contracts, verified/child work; preserve identity/constraints/history and the definition_of_done_required fail-closed check. Model-generated criteria remain proposals, not authority or evidence. This next seam is audited but not implemented by this increment.


## Exact material/history CI

Software commit `68fd08bb586fb9863763ca8a44a08bbf7ee3a659`: [CI #1856](https://github.com/haji84/AI-/actions/runs/35934446080) **SUCCESS**. Repository guard, lint, full tests, P8 security, build and health passed. This validates the preceding material/history/correction increment, not completion of all Cognitive Core requirements.

## Continuation 2026-09-24: explicit completion conditions through normal intake

Source baseline `68fd08bb586fb9863763ca8a44a08bbf7ee3a659`. Normal Goal Controller intake creates an empty success-criteria list; a new owner-authenticated Tasks control now adopts explicit DoD before material work. Reuses GoalDraft normalization/readiness and the existing Compass Goal, execution lease and WorkState. No second Goal registry, schema change, network grant or provider was added.

The bounded request contains only the current Goal ID/full digest, 1–16 explicit criteria and acknowledgement. Adoption preserves identity/title/description/constraints. An atomic full Goal+state compare-and-swap commits criteria and its digest receipt together; transaction failure restores both. Existing criteria, checkpoints, WorkState, runtime material contracts and prior adoption receipts prevent replacement. Exact retry after restart or execution is acknowledgement only, with no new write or completion authority. These owner-authored criteria are not automatic semantic interpretation or verification of their meaning.

Independent review verified stale/competing submissions, a real intervening Compass write, unchanged pending work, malformed/cross-scope input, bounded owner-first proxy and no automatic transport retry. It identified an availability mismatch after restoring empty criteria while retaining a receipt; status now rejects that path too. A subsequent orphan-learning review adds rejection when same-Goal experience/correction history remains without its checkpoint. Other-Goal and other-principal memory do not block legitimate new work.

Development failures retained: the first transactional store implementation attempted a nested transaction; the RED test failed and the write was moved into one existing transaction. The first Next build pulled host Compass filesystem modules through a request validator; extracting the pure input boundary repaired that dependency. A browser probe initially read status before its actual adoption POST had completed; it now awaits the real HTTP200 and checks the changed Goal digest before continuing. No checks were removed or weakened.

Actual installed qwen3:4b smoke on this candidate: **PASS**, 23,947ms, local model used, configured output read back exactly, Goal completed, external AI calls per Goal0. This is one bounded host-catalog task, not general unknown-task ability.

Final suite, browser and exact pushed commit/CI results follow after verification. Production remains inactive, PR #1217 draft, OWN-001 PARTIAL. General semantic DoD inference, arbitrary novel plans/executable skills, physical teaching binding, independently verified historical promotion, real R16/R17 campaigns, model training/promotion and automatic cross-device transport remain software/acceptance work.

Rollback: revert this additive criteria/proxy/UI composition while retaining the adopted Goal criteria, Compass decisions and all learning/WorkState/checkpoints. Do not erase evidence or restore empty criteria to bypass existing-work checks. Existing Goal IDs and enrolled Worker credentials/queues remain unchanged.


### Final explicit-DoD software verification

- Full Windows suite: **1,608/1,608 PASS**, zero skipped, `node --test --test-concurrency=1` with the installed Git Bash in this process PATH.
- P8 security: **331/331 PASS**, zero skipped, including staged new files.
- Lint and production-format Next build: **PASS**. Build retains pre-existing dynamic filesystem tracing warnings; no deployment is implied.
- Independent DoD contract/store/service/proxy review: **33/33 PASS**; additional orphan-learning/learning-service focused suite **38/38 PASS**. New orphan tests first reproduced5 failures and then passed.
- Requirement audit: **504 surfaces / 341 requirements PASS**; functional_completion_claim=false.
- Fresh installed Chrome153.0.8010.48: actual owner login → normal Goal Controller empty criteria → explicit UI DoD adoption (same Goal ID) → material upload/acknowledgement →2 Core actions → independent verification → exact downloaded output. Reload, three refreshes,390px expanded controls and no-page-errors checks pass; external AI calls0. The two stored screenshots were refreshed from this isolated fixture.

The initial full run had1,605 PASS /3 FAIL: all three were existing repository secret checks matching a synthetic PEM header in a new rejection-test fixture. The fixture now constructs the identical header at runtime; the rejection test and scanner rules are unchanged. The complete rerun passed1,608. A later build caught the independent review test's incomplete Request type cast; the mock now starts from an actual Request with a throwing body getter. Its12 behavioral tests and the final build pass. This test-only correction was verified directly; exact-head CI reruns the full suite. No real private key was present.


## Exact explicit-DoD CI

Software commit `477fbdc61fd32f09612ca905d38568a2bc8baa46`: [CI #1857](https://github.com/haji84/AI-/actions/runs/35936514485) **SUCCESS**. Repository guard, lint, full tests, P8 security, build and health passed. This is the preceding explicit owner-DoD increment; subsequent local proposal changes need their own evidence.

## Continuation 2026-09-24: local Primary Brain completion-condition proposals

The previous explicit DoD control required all conditions to be typed by the owner. The additive path now reuses `PrimaryBrainAdapter.plan()` and GoalDraft normalization to propose missing desired outcomes. It does not reinterpret `requiredEvidence` as DoD: proof descriptions and desired world state are separate. Context supplies the authoritative current Goal/constraints, known local material/download capability, no executable candidates and action budget0. The output is bounded/privacy-screened `PROPOSED / UNVERIFIED` data, including assumptions and questions. Existing responses without a proposal remain compatible.

`CognitiveService.proposeGoalCriteria` uses the same execution lease, rejects any previous same-Goal work/history, and checks exact Compass Goal/state again after all awaited checks and inference. It saves no Goal, cognitive checkpoint, learning record or completion status. Only the existing explicit owner adoption can write criteria. The owner-first1024-byte request accepts Goal ID/digest only; model/provider/endpoint/scope arguments are rejected. Production-configured inference is one bounded loopback call, no automatic retry/external fallback. Proxy response is32KiB and deadline45s; the existing model adapter defaults30s and validates its configured bound. This is not a watchdog guarantee for arbitrary host-injected adapters.

UI shows the unverified proposal, assumptions/questions and an explicit copy-to-editor button. Copying clears acknowledgement; editing and adopting remain separate from generation. When local inference is unavailable, typed criteria remain usable. Actual browser checks run through the real owner/Next/Broker/local adapter chain; the positive browser case uses a clearly labelled synthetic loopback model fixture and does not measure model quality.

Independent review reproduced2 stale-output cases: Goal and state changes during the second asynchronous pristine scan escaped the earlier snapshot comparison. Final snapshot reads now occur after that await. The original RED cases pass. The first build also caught an incomplete Request cast in the new review test; using a real Request preserves the same owner-before-body assertion. Browser testing then caught an exact accessible-label lookup failure after copying a controlled textarea value. Captured DOM showed the value had become part of the nested label text; separate label/htmlFor/useId now keeps the label stable. The same browser assertions passed without relaxing their expected names or values.

Actual local-model measurements (existing qwen3:4b, no downloads):
- First structural proposal PASS in16,695ms, Goal unchanged, actions0/external0. Output was English and omitted the requested download outcome; semantic adequacy was not accepted.
- After supplying known host capability and strengthening language/outcome-preservation instructions: structural PASS in10,720ms, Goal unchanged, actions0/external0. The candidate included download/content preservation, but still used English and was not proven to cover all meaning. This limitation remains visible; no general semantic accuracy or automatic adoption claim is made.

The actual-model probe is `scripts/goriq-local-goal-proposal-smoke.ts`; it prints the bounded draft for inspection and asserts no Goal/state mutation. This is a proposal test, not task-completion evidence. `scripts/goriq-cognitive-browser-smoke.mjs` supports `GORIQ_BROWSER_PROPOSAL_FIXTURE=1` for the synthetic positive path; default disabled-model mode verifies manual fallback. Both use temporary isolated databases and an already installed browser, preserve failures as synthetic screenshots/DOM, and clean up their test servers.

All unrestricted planning/executable skill synthesis, independent semantic result validation, physical teaching binding, historical promotion, actual R16/R17 experiment/model promotion and cross-device acceptance remain tracked. This increment cannot change OWN-001 to VERIFIED or justify Production activation.


### Final local-proposal verification

- Full Windows suite: **1,627/1,627 PASS**, zero skipped (`node --test --test-concurrency=1`, existing Git Bash in process PATH).
- P8 security: **331/331 PASS**, zero skipped; lint and Next production build **PASS**.
- Independent combined proposal/previous-Goal checks: **31/31 PASS**; specification/traceability and proposal checks **29/29 PASS**.
- Requirement audit: **505 surfaces /341 requirements PASS**, functional_completion_claim=false.
- Actual Chrome153.0.8010.48 positive synthetic local-model transport and model-disabled manual fallback: both **PASS** through the same authenticated UI→Broker→Core→independent output verification/download. Each completes the bounded fixture in2actions, external AI calls0, preserves Goal identity/reload, contains expanded controls at390px, and has zero page errors.

Exact software commit/CI is recorded after push. Production remains inactive. Rollback removes only the additive proposal UI/API/adapter contract, preserving previously adopted criteria, receipts, checkpoints and all learning/device state.


## Exact local-proposal CI and continuation

Software commit `d26d67ff10b3cf3b69b7d255c598e77dd603132e`: [CI #1858](https://github.com/haji84/AI-/actions/runs/35938051239) **SUCCESS**. Repository guard, lint, full tests, P8 security, build and production-format health endpoint passed. PR #1217 remains draft/unmerged; Production is inactive. This is bounded software evidence, not semantic model-quality, physical acceptance or whole-Core DONE.

PR description and Compass history166 were refreshed with all three increments (68fd08b,477fbdc,d26d67f), their exact CI and current limitations. Next: inspect R16/R17 experiment and teaching/skill execution integration, implement the smallest missing bounded software path with existing authority/stores and independent behavioral review.


## Continuation: portable operation learning from actual local Goal execution

Audit found a concrete integration gap: outcome action IDs deliberately include Goal/root/material hashes, but synthesis required identical action IDs across two independent Goals. Consequently normal material intake could not accumulate reusable candidates. Legacy step manifests could share action IDs and were not affected by that diagnosis.

Reuse the existing Core, learning engine, skill library and certification gate. The host outcome catalog now derives exactly six versioned operation identities: three source-format inspections, text copy, XLSX creation and DOCX creation. Exact action/Goal/contract/evidence IDs remain in every attempt; the additive operation metadata is selection information, never permission or an executable script. Two same-task/environment, separately verified Goals with non-overlapping evidence can synthesize a candidate across distinct input hashes. Held-out/failed/unverified history, unknown operations and legacy/portable mixing cannot manufacture a candidate. Existing exact-action skills remain readable and usable.

Certified operation recall can select only a currently eligible low-risk local catalog action; dependency/Goal/root/source/overwrite/risk/verifier checks remain in the existing path. It never copies old files, inputs, paths or criteria. A verified explicit correction is more specific than generalized recall and wins over it. Failures/corrections retain exact action exclusion; a verified matching operation regression can quarantine its certified skill without banning every new input for that operation.

The real two-Goal service test completes two separately bound text outputs, reads back exact bytes, preserves different effect/Goal/contract IDs and produces two **inert** candidates (inspect/copy) after restart. It uses zero external calls and no model. No real candidate was certified: certification still requires fresh independent measured gain, and a100%-vs100% fixed transform correctly fails that gain gate. Mock certification inputs in unit tests exercise the gate contract only and are not research/model-quality evidence.

Independent review first reproduced3 recovery failures: operation not saved before effect, changed operation accepted at reconciliation, and legacy pending state receiving inferred new metadata. Pending state now captures the host selection before execution; mismatch rejects before authority write; old pending state recovers under its exact effect contract without inventing operation metadata. A separate RED correction case showed broad family recall overriding an exact verified replacement; the exact correction now takes priority. All original RED assertions pass. Review also covers model-injected fields, outbox/attempt consistency, risk/uncertified/external filtering and unknown versions.

Initial runtime test used the wrong Planner method name; correcting the harness to existing proposeNextAction exposed the intended3 failures before implementation. Initial build found an implicit-any test state array; explicit CognitiveState[] repaired the test without changing assertions. The production-format build then passed; pre-existing dynamic filesystem warnings remain.

R16 currently produces failure hypotheses but has no actual runtime experiment runner. Teaching correction ledger/engine has only test callers and lacks an authoritative Goal/action binding. Do not instantiate TeachingStore merely to inspect live data: its constructor changes active records. The next increment requires actual sandbox snapshots and independent oracles; do not invent an improvement or copy teaching Skills into execution authority. R17 runtime promotion, arbitrary executable skill generation, semantic quality, model training and cross-device/physical acceptance remain open.

Rollback preserves all exact identity/evidence and additive records. No production, device, credential, enrollment, filesystem permission or database schema change was performed. Whole Core remains PARTIAL.


### Final portable-operation software verification

- Full Windows suite: **1,647/1,647 PASS**, zero skipped, using `node --test --test-concurrency=1` and the installed Git Bash in the process PATH.
- P8 security: **331/331 PASS**, zero skipped; lint and Next production-format build **PASS**.
- Independent behavioral review **34/34 PASS**, including eight new recovery/authority cases; documentation checks **17/17 PASS**.
- Requirement audit **506 surfaces /341 requirements PASS**; functional_completion_claim=false.
- Fresh installed Chrome153.0.8010.48 isolated login/proposal/edit/adopt/material/execute/download flow **PASS**, two actions/external AI calls0, exact downloaded bytes, refresh/reload, narrow390px control containment and no page errors. Proposal response is a labelled synthetic local fixture. Desktop/mobile screenshots visually inspected at temporary artifact directory `goriq-cognitive-visual-X1neyz`; this is not physical or broad layout acceptance.

The first full operation run was1,646 PASS/1 FAIL because traceability hashes were pending concurrent documentation updates. After the reviewed six surface hashes and one additive mapping were recorded, the full suite passed1,647; no runtime assertion or audit rule was relaxed. Latest build repaired only the previously recorded test-array type. Exact software commit/CI follows after push.

Parallel R16 audit reproduced an existing unsafe numerical decision: NaN before/after scores yield an accepted result. No production callers of decideExperiment were found. Fix the numerical boundary before connecting a real evidence-bound experiment; do not present hypothesis generation as completed R16 execution.


## Exact portable-operation CI

Commit `20c30191e45dcd3a64b171ed455e6111ec1895e3`: [CI1859](https://github.com/haji84/AI-/actions/runs/35940168246) SUCCESS. Windows1647/P8331, independent34, lint/build/browser/audit506/341 PASS. GitHub parents and Compass history167 updated. Whole Core remains PARTIAL; no Production activation.

## Continuation: bounded R16 numerical decisions and offline calibration

Reuse R16 `decideExperiment`/`PersistentResearchHistory`, World Model `evaluateCalibration`, current partition lease/verified learning ledger and PrimaryBrainContext. Fixed training-only Laplace probability is compared on separate host-assigned heldout outcomes; actual numerical error is computed, not provided as a caller's claimed improvement. Research results are bounded model-context data and owner-visible counts. No automatic prediction replacement, task/Skill/model completion or authority elevation.

RED evidence: the module was initially absent. Independent probes then reproduced two integration errors: fifth training observations outside the frozen fit could contaminate heldout identity, and partition property order changed experiment IDs. Regression tests failed2/9 before repair and passed9/9 after. All same-partition train identity/evidence reuse now invalidates evaluation; scope digest uses explicit ordered values. Unknown split rejects. R16 NaN/Infinity/malformed-history/terminal-reproposal defects are covered separately by boundary tests. The initial boundary lint failure was only its control-character-regex spelling and was repaired without changing assertions.

Synthetic numerical fixture (not model/task benchmark): four training successes and four independent heldout successes, original confidence0.1, fixed train estimate5/6. Deterministic Brier error0.81→0.027777777777777766; actual calculation is accepted at fixed0.01 minimum gain. Ties, worse forecasts and later independent heldout regression reject. Production-like ordinary train-only history performs no comparison; no heldout or real performance evidence is invented. General experiment execution, model/skill promotion and independent scientific validation remain outstanding.

Rollback removes additive research consumers while preserving exact experiences and research records. Do not downgrade malformed/unknown research records into accepted authority. No device, enrollment, credential, network or database schema change.

Additional independent review reproduced same-experiment replay with a different valid minimum-gain policy. The exact fixed0.01 threshold is now bound in both experiment inputs and identity; the RED test passed after repair. Independent combined61/61 PASS. The first research build reported three implicit-any callback parameters after Array.isArray narrowing; explicit typed verified-experience selection repaired type inference, with unchanged runtime assertions. Final build PASS. Data contamination lookup uses bounded sets rather than quadratic evidence comparisons.


### Final research integration software checks

- Full Windows suite **1,673/1,673 PASS**, zero skipped (`node --test --test-concurrency=1`, existing Git Bash in process PATH).
- Independent combined review **61/61 PASS**, including eight actual service/Core/ledger boundary cases; lint and Next production-format build PASS.
- Requirement audit **507 surfaces /341 requirements PASS**. Existing CORE-011/AUTO-009 calibration links are preserved while adding OWN-001 reuse; no requirement is replaced or marked complete.
- Fresh installed Chrome153.0.8010.48: real isolated owner login→proposal edit/adopt→material upload→Core→independent verifier→exact downloaded file PASS. New no-independent-evidence text is asserted, external0/actions2, reload/390px/no page errors checked. Temporary screenshots `goriq-cognitive-visual-YHc5II` inspected; synthetic proposal transport and synthetic local document fixture, not model/task quality or physical evidence.

Next concrete software dependency: host-owned evaluation-trial allocation fixed before execution, with independent Goal/evidence receipts and no retrospective train relabeling. Current ordinary Core observations remain train, so no natural heldout comparisons are claimed. Existing certify() receives host benchmark scores; connecting actual immutable evaluation measurements is still required before automatic measured-gain promotion. Exact CI/P8 confirmation follows after final verification; PR1217 remains draft/unmerged.

Final P8 security331/331 PASS, zero skipped, with staged files included. Remaining software audit is recorded in `docs/audit/goriq-cognitive-remaining-software-2026-09-24.md`; remaining work is not reduced to physical tests.

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

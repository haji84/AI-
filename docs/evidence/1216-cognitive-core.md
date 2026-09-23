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

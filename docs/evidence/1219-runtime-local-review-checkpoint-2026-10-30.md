# #1219 / #1824: additional local model review checkpoint

## Baseline and bounded change

Baseline source: `8e89f2b05983dd6e4c255446fa21e0f3f109a23f`, existing branch
`feat/1219-isolated-ollama-builder`, Draft PR #1824. No new issue or PR.
The owner requested actual separate-model review, same-task repair and restart continuity.

The existing `createRuntimeDevelopmentVerifier()` now has an **unset by default**
`GORIQ_LOCAL_REVIEW_CONFIG_JSON` option. It first obtains and validates its original
deterministic verifier result. Only then does it invoke the additional local model
review stage. A model response cannot manufacture missing deterministic checks,
signed AI09 acceptance, GitHub approval or merge/deploy authority.

The checkpoint is a capability observation cache, not a second Goal/Job scheduler.
Existing `DevelopmentJobStore`, Change Sets, resident state controller and release
gates retain ownership of task transitions. Related stacked PRs #1826/#1827 already
contain sequence/prepared-write/signed-verifier work; this change does not copy or
replace that implementation.

## What the implementation does

- Reads only one allowlisted, untracked new candidate from a detached linked worktree.
  Binds exact Git base, candidate revision, source bytes, artifact reference, task ID,
  configured repository/PR, check contract and verifier checks. Never executes the source.
- Calls only local Ollama `/api/tags`, `/api/ps`, `/api/generate`; verifies installed model
  digests and refuses same-name/same-weights builder/reviewer, remote models or a busy model.
  No pull, external provider, new secret, token transfer, file repair or Git write occurs.
- Records bounded raw model responses and validated findings in a private runtime directory
  outside the candidate. A JSON checksum detects corruption but is NOT a signature.
  Runtime-directory ownership remains an operator precondition; Windows ACL verification
  and power-loss guarantees are not established by these tests.
- Atomically publishes create-only receipts. After a clean process restart, an unchanged
  task/artifact/contract reuses its receipt, including FAIL/INCONCLUSIVE. No retry-until-PASS.
- A changed candidate under the same task/configured PR receives a new receipt; old failure
  evidence is retained. This tests the review half of repair, not automatic Builder rewriting.
- Uses a per-task exclusive lock, never time-based lock stealing. An interrupted in-flight
  inference remains blocked pending reconciliation; it is not silently reissued or approved.
- Keeps original verifier checks on success; a local model failure does not expose passed
  verificationEvidence as if the combined result had passed.

## Opt-in contract, not activation

`GORIQ_LOCAL_REVIEW_CONFIG_JSON` is controller-supplied JSON with `version:1`, absolute
`workspace`, absolute `stateDirectory`, `repository`, positive `pullRequest`, exact
40-character `baseRevision`, `allowedPaths`, `builderModels:[{name,digest}]`, and
`reviewer:{name,digest}`. Model digests must be the observed installed SHA-256 values.
This source change sets no environment variable, changes no running service and creates
no model/credential. Configuration and the local directory are trusted controller inputs,
not authenticated proof of a GitHub PR or an independent OS principal.

## Executed verification

A pinned source subset was used because this session could not download/clone the complete
repository. Original verifier blob `b5c0644d22fec314d63dca1b52dbd9f3c2d630ef` and original
verifier-test blob `a96aa00937db6ddd27353975aeacd8def5b57e4e` were reconstructed and byte-checked
with `git hash-object` against GitHub before changing the verifier.

- RED: new checkpoint suite 24 cases, 23 failed and 1 existing fail-closed case passed.
- Provenance regression: an altered observation class initially passed; the test failed,
  then the implementation was corrected to bind the persisted class to the request.
- Final source-subset suite: `node --experimental-strip-types --test`, 39 passed,
  0 failed, 0 skipped, including all 4 unchanged original verifier tests.
- Two actual Node processes share a real on-disk checkpoint; process 1 makes one mocked
  generation call, process 2 makes zero, with the same receipt digest. This is NOT Actions replay.
- `node --check` for the new module and strict standalone declaration typecheck passed.
- Test runtime: Node 22.16.0. Repository CI requires Node 24.19.0; full repo CI is separate.
- All new model/HTTP responses are TEST_DOUBLE_NOT_REAL_MODEL. No new physical inference,
  independent source review, Windows test or production acceptance is claimed.

## Remaining acceptance and next work

1. Full repository CI on the exact final PR head and independent source review.
2. Reconcile this additive stage with the existing signed-verifier/sequence stack. Keep
   legitimate verifier authority; do not substitute a local qwen PASS for signed acceptance.
3. Connect actual scoped Builder correction to stored failure feedback without overwriting
   owner changes; the base PR's create-only Builder is deliberately unchanged here.
4. Validate a real Goal through generation, deterministic verification, this model-review
   stage, correction, process restart and authenticated durable storage across Actions runs.
5. Only then evaluate existing protected integration and post-integration gates.

Status: source increment, Draft/HOLD. formalAI09ReviewExecuted=false;
actionsReplayVerified=false; runtimeIntegrationVerified=false; endToEndVerified=false;
mergeAuthorized=false. Existing successful small-function local model logs remain valid
only for their original bounded scope and were not rerun in this change.

## Rollback and read log

No runtime configuration, permissions, workflows, keys, models, services or release state
were mutated. Before any future activation, keep the flag unset or remove the opt-in to
retain the original verifier route. Revert the additive hook/module/declaration/tests as
one dependency-consistent source change after review; retain private historical receipts.

Read: root AGENTS, PROJECT_STATE, ROADMAP; issue #1219 and PRs #1824/#1827; runtime verifier,
local Builder/router, resident host, job/change-set stores, verification plan, existing
AI09 reviewer and related prepared-write contract. Compass write-back was not performed;
this PR evidence record is a source handoff, not a claim that the runtime Goal is complete.

## Addendum: offline checkpoint replay, October 30, 2026

- Owner's Codex-free smoke demonstrated that a small candidate can be generated,
  tested and re-reviewed by a different local model. This is **not** a formal
  AI09 review or autonomous Goal/PR integration proof.
- Before this change, `reviewRuntimeCandidate()` contacted Ollama even when
  a matching stored receipt already existed. If the model was unavailable
  after restart, valid matching evidence could not be replayed.
- Added three tests to the existing PR #1824. The first CI run was stopped by
  an existing test-file lint violation; its single output statement was made
  lint-clean, without changing the test's assertions.
- **RED evidence:** exact head `2b493c22be6e9676e3429f47b4b25af77efb3903`,
  CI run `41020768829`: 2,750 tests / 2,736 pass / 9 fail / 5 skipped.
  One targeted failure was offline replay; the other eight were pre-existing
  reverse-traceability mapping drift, not evidence of the new replay logic.
- **GREEN evidence:** exact head `47cb5a65e39d73f647eb12425bf129b23438ca13`,
  CI run `41021045658`: 2,750 tests / 2,737 pass / 8 fail / 5 skipped.
  All three new tests passed (offline reuse with zero HTTP calls, unreviewed
  candidate rejection, and modified candidate rejection). Only existing
  canonical-mapping errors remained.
- The fix checks workspace, candidate bytes and deterministic test binding,
  then verifies a create-only saved receipt checksum and exact binding
  **before** requiring a live model. Only a cache MISS requires local
  installed-model/digest checks and new inference. It does not promote an
  unsigned local observation to a signed verifier or release approval.
- Mapping reconciliation commit
  `f3573420022be590fea66f9ae6e82cec8298ee04` updates only the
  `runtime-development-verifier.ts` hash and adds the two
  `runtime-ollama-review-checkpoint` source/declaration surfaces in
  `docs/jarvis-reverse-traceability.json`. All original requirement
  status, human gates, owners and security decisions remain unchanged.
- **Latest exact-head full CI is not yet confirmed.** Do not assume the
  mapping update has passed merely because the targeted replay tests passed.

Remaining acceptance: real ZBook runtime and source-of-truth connection;
genuine scoped same-task correction of a failed candidate; separately rooted
and signed AI09 verification; authenticated durable persistence across distinct
GitHub Actions executions; subsequent Job continuity; protected integration,
post-integration physical checks and owner-approved critical changes.
No owner PC, secret, service, workflow, model or production environment was
changed by this source-only increment. PR remains Draft/HOLD.

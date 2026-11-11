# GORIQ hosted model connection and bounded CI repair

> Continue Issue #1219 and Draft PR #1907. Use the existing resident execution
> architecture, evidence-first debugging, focused RED/GREEN checks and independent
> review. This plan records implementation choices within the owner's existing
> completion request; it grants no new execution, signing or production authority.

**Goal:** Remove verified software blockers on the canonical development path,
then distinguish an actual model-produced candidate from unproved production
Goal acceptance, distributed ownership and independently managed signing.

**Baseline:** PR HEAD `374d65e7e2b1d2109ddf97f9cf5c3a1e9716fac1`,
main `6737e15033eced135461076d72f792516e83c9b3`, retrieved on 2026-11-11.
CI `43001898750` fails only the restricted verifier Unit budget. The passing
parent is `ec5f5d24f311ac577c17e29d25cab85d81539372` / CI `42994392421`.

**Spec:** Issue #1219, AGENTS.md, the owner's 2026-11-11 handoff,
`docs/decisions/2026-11-11-hosted-goal-routing.md` including its integration and
tracked-repair updates, and the existing two resident execution plans.

## Constraints

- Keep the original Goal/Job and all failed evidence. Do not synthesize an owner
  Goal or use a copied checkpoint as cross-host execution authority.
- Reuse the tracked-repair resident factory and existing verifier contracts.
- No Codex, CodeRabbit or Copilot invocation/fallback.
- Retain the 300000ms check budget, container resource limits, check coverage,
  signatures, approval conditions and all existing stop conditions.
- No secret creation, permission change, persistent service activation or main
  deployment is part of these source repairs.
- Publish only to the existing PR after re-reading its HEAD; reject conflicts.

## Task 1: Remove measured CI overhead

- [x] Compare successful and failed Unit logs and resource observations.
- [x] Reproduce the dominant avoidable overhead with the actual runtime.
- [x] Make the smallest coverage-preserving execution change and retain the
  existing security assertions, process-isolation requirements and limits.
- [ ] Verify the affected fixtures, then inspect the complete exact-head CI.

Files are limited to the measured fixture/runner path and its meaningful
regressions; record the causal experiment and final file list in the audit.

## Task 2: Connect the available Ollama model protocol explicitly

Files: `src/orchestrator/tracked-repair-resident-runtime.ts` and
`tests/tracked-repair-runtime.test.ts`.

- [x] Demonstrate that the current tracked-source profile accepts only the
  llama.cpp `/completion` protocol although the hosted asset prepares Ollama.
- [x] Add an explicit provider selection. Omitted selection preserves the
  existing llama.cpp behavior; Ollama uses only a loopback `/api/generate`
  endpoint and a pinned local model ID/digest. No implicit provider fallback.
- [x] Pin discovery, generation and loaded-model evidence; reject identity drift,
  remote/cloud models, redirects, incomplete output and oversized responses.
- [x] Preserve immutable intent/prepared/response records, same-Goal attempt
  selection, signed-FAIL prerequisite, expiry and write-boundary admission.
- [x] Run focused RED/GREEN and replay/failure/recovery regressions.
- [x] Attempt a bounded actual-model candidate on isolated scratch worktrees,
  retain exact provenance, and label the acceptance boundary honestly.

## Task 3: Expose the actual advisory-review blocker

Files: `scripts/goriq-ai09-ci-review.mjs`,
`src/orchestrator/ai09-pr-review-automation.mjs`, and
`tests/ai09-pr-review-automation.test.mjs`.

- [x] Reproduce the 41-file input against the existing 30-file comparison limit.
- [x] Preserve fixed known failure codes in logs while receipts remain generic; unknown text remains
  sanitized. Keep BLOCKED and every existing review/approval restriction.
- [x] Test pre-inference refusal and non-disclosure of arbitrary error text.

## Task 4: Evidence, review and remaining production gates

- [x] Inspect current signer transport and state-store implementations; distinguish
  accessible metadata from unobservable owner settings.
- [x] Update exact source hashes in `docs/jarvis-reverse-traceability.json`.
- [x] Obtain an independent code review and resolve substantive findings.
- [ ] Publish the reviewed changes to PR #1907 and read back exact-head CI.
- [x] Record what actually ran, what remains unproved, and any precise final
  authorization or capability boundary. Keep #1219 open without real E2E proof.

## Review focus

1. Model tag retargeting or a remote-model alias must not become local provenance.
2. Timeout/truncated output must retain the consumed intent and prohibit replay.
3. Batching test execution must not leak fixture state or remove child-process
   isolation when that isolation is itself under test.
4. Extra provider metadata must not invalidate or silently rebind old manifests.
5. Diagnostic specificity must not publish raw API errors, tokens or model output.

## Follow-up: complete tracked verification connection

Inspection found source blockers in the existing transfer/runner boundary, not
only inaccessible deployment configuration. Continue within the same Issue/PR:

- [ ] Extend `scripts/jarvis-verifier-request-transfer.mjs` to strictly bind the
  existing version-2 tracked request, candidate bytes and original baseline;
  keep version-1 compatibility and refuse mismatches before writes.
- [ ] Update `scripts/jarvis-independent-check-runner.mjs` to collect all required
  results after a definitive completed check FAIL. Preserve bounded stops for
  timeout, inconclusive infrastructure, expiry or missing authority. Never fill
  unexecuted checks with fabricated outcomes.
- [ ] Prove both behaviors and negative boundaries in the existing transfer and
  snapshot test files, then independently review and publish the source.
- [ ] Keep actual signer transport/host authority separate from these source
  fixes. Do not create keys, loosen receipt completeness or reset the real attempt.

## Rollback

Revert only this continuation's source/doc commits. Preserve existing failed
candidates, inference records, Goal/Job history and receipts. No data migration,
credential mutation, production activation or new authority is included.

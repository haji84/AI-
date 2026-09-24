# GORIQ Local DoD Proposal Implementation Plan

> For agentic workers: use executing-plans for parent integration and independent bounded sub-agent review.

**Goal:** Let the existing local Primary Brain propose missing completion conditions for the current unstarted Goal, without making model output Goal authority or execution evidence.

**Architecture:** Reuse PrimaryBrainAdapter.plan, GoalDraft normalization, the owner-authenticated Broker/Next path and the existing explicit refineGoal adoption. The model proposes desired outcomes separately from required verification evidence. Only the owner-adopted criteria are saved by the existing atomic CAS.

**Tech Stack:** Existing Node24/TypeScript/React, Compass, loopback Ollama; no dependency/download/provider/permission changes.

**Spec:** docs/architecture/goriq-cognitive-core.md; owner Primary Brain/local-first/Ask Last requirements in #1216. Baseline477fbdc.

## Constraints and review focus
- One bounded local model call per explicit proposal request; no external expert fallback or execution candidate.
- Authoritative title/description/constraints and identity come only from Compass. No model-supplied scope, completion status or grants.
- Proposal has PROPOSED/UNVERIFIED state, assumptions/questions, and exact current Goal digest. It is not knowledge or a verifier.
- Preserve manual criteria input when model unavailable/invalid. Never fabricate a generic successful proposal.
- Reject non-pristine work and stale Goal/state both before and after inference. Shared lease protects normal execution; Compass changes during inference invalidate output.
- Model output is bounded/privacy-filtered; evidence descriptions cannot be silently relabeled as desired outcomes.

## Task1: Local adapter proposal contract
Files: src/gai/primary-brain.ts; tests/goriq-goal-proposal-brain.test.ts.
- [ ] RED tests for optional goalDraft {successCriteria,assumptions,unresolvedQuestions}, intent purpose goal-draft, strict fields/bounds/privacy.
- [ ] Extend existing plan response only for purpose goal-draft; preserve old adapter response compatibility. Reuse normalizeGoalDraft with host title/description/constraints.
- [ ] Empty candidate catalog and action budget0; candidateId null, empty plan, no execution. No promotion from confidence.
- [ ] Test transport/format and unavailable model, then independent review.

## Task2: Authenticated proposal/UI integration
Files: cognitive-service.ts; cognitive-goal-input.ts; cognitive-material-proxy.ts; jarvis-broker.ts; new API cognitive/goal/proposal/route.ts; CognitiveGoalCriteria.tsx.
- [ ] RED service test: no Goal/state/history mutation; stale state during inference rejected; no local model visible fallback.
- [ ] Add proposeGoalCriteria({goalId,goalDigest}) and strict 1024-byte proxy. Reuse current pristine checks/lease, host-configured local adapter and validateBrainDecision.
- [ ] Return sanitized bounded candidate only after full snapshot recheck. No automatic retries/writes/actions.
- [ ] UI displays unverified candidate/assumptions/questions, explicit copy-to-editor clears acknowledgement; existing owner adoption remains sole write.
- [ ] Real isolated browser fixture exercises proposal → edit/ack → adoption → material → verified download; manual fallback remains.

## Task3: Verify and record
- [ ] Unit/integration/security, lint/build, exact-commit CI and independent review.
- [ ] Actual configured local-model proposal smoke with independent checks of no side effects and bounded nonempty draft. No claim of broad semantic correctness.
- [ ] Spec/ledger/reverse traceability/evidence/PROJECT_STATE/GitHub/Compass writeback. OWN-001 remains PARTIAL; broader unknown plans, semantic result verification, teaching/research/model/cross-device integration remain.

Rollback: revert this additive proposal helper/API/UI; retain all owner-adopted criteria/receipts and existing learning/work state. No production/device mutation.

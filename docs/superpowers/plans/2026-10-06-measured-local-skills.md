# Matched local Skill measurements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace supplied-score activation for local material Skill candidates with immutable matched runtime measurements and honest no-gain rejection.

**Architecture:** Extend existing private evaluation plans and learning lease, then use existing Core/WorkState/capability/oracle execution. A host-only helper reserves both arms before effects. No new execution authority or automatic promotion.

**Tech Stack:** Node 24.19.0, TypeScript 6.0.3, pnpm 11.19.0, existing file/Office capabilities and temporary Compass databases.

**Spec:** `docs/superpowers/specs/2026-10-06-measured-local-skills.md`

## Global Constraints

- Current material:v1 Skills are inert catalog bindings; identical procedures cannot establish Skill gain.
- Preserve normative requirements, Node/fleet/ECC/privacy/fencing/Gates and default Production activation.
- Keep train/heldout exclusions, exact replay, persisted receipts and dependency-consistent rollback.

## Review Focus

- Same Goal in isolated arms must select the exact plan without train fallback.
- A source/output/criteria mismatch must refuse allocation, never improve a score.
- A crash between allocation and state binding must retain both arm reservations.
- Candidate/library version drift must invalidate measurements.
- Missing, duplicate or unverified action receipts must not yield rates or activation.

### Task 1: Matched allocation and measured rejection

**Files:** Modify `cognitive-evaluation.ts`, `cognitive-learning.ts`, `cognitive-local-outcomes.ts`, `compass-goal-execution-adapter.ts`; create `cognitive-skill-evaluation.ts` and `tests/cognitive-skill-evaluation.test.ts`; preserve operation-regression fixture coverage in `tests/cognitive-operation-learning.test.ts`.

**Interfaces:** `prepareCognitiveSkillEvaluation({learning,partition,skillId,id,baseline:{catalog,goalId},candidate:{catalog,goalId}})` returns both preallocated plans. `CognitiveLearningEngine.certify({partition,skillId,comparisonId})` returns derived measurements/rejection. Old exact-action score calls remain compatible; material operation calls fail closed without measured comparison.

- [ ] Write tests for supplied-score refusal, real Core matched equal outcomes, source/criteria/target mismatch, restart, missing receipts and subject drift; verify RED.
- [ ] Implement bounded pair metadata/validation, atomic reservation and receipt binding under the existing lease; add host preparation and exact adapter reservation lookup.
- [ ] Derive rates from complete measured actions; retain candidates for equal or incomparable outcomes; verify GREEN with existing learning/Core/recovery tests.
- [ ] Run full suite, P8 security, lint/TS, canonical/reverse traceability and diff checks. Independent reviewer checks whole branch; fix findings and rerun affected checks.
- [ ] Publish exact tested tree, protected PR, merge/main CI, Evidence and parent Goal writeback. Do not close whole Goal.

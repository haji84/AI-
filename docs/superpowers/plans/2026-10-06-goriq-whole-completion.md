# GORIQ Whole Completion Reconciliation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for this owner-authorized continuation. Review the completed branch independently; no routine human plan gate is needed under the owner's explicit continuous-execution instruction.

**Goal:** Account for every canonical requirement and resume unfinished GORIQ work without mistaking source presence, closed Issues or CI for product completion.

**Architecture:** Derive a read-only audit from the existing canonical validator, owner-decision validator and reverse traceability. Keep the original ledger and all gates authoritative. A deterministic snapshot records all341 requirement IDs plus17 Cognitive components, their code/test/evidence leads, phase ownership and remaining actions; separate narrative evidence binds current Issues and physical receipts.

**Tech Stack:** Node24.19 ESM, existing repository JSON/Markdown contracts and node:test.

**Spec:** docs/JARVIS_PRODUCT_SPEC.md; docs/architecture/jarvis-requirement-traceability.md; docs/architecture/goriq-distributed-node-fabric.md; docs/architecture/goriq-cognitive-core.md; #681/#1219/#1727.

## Global Constraints

- No Evidence, No Done; no new VERIFIED/PLATFORM_LIMITED statuses.
- Preserve all341 IDs, requirements, existing evidence, privacy, leases/epochs/fencing and Human Gates.
- No Production, credentials, permissions, new enrollment/key, destructive DB/schema, transport or workflow changes.
- Nubia and Android38 are owner-deferred; retain their eventual acceptance, never report deferred as PASS.
- #321 research/AGI acceptance stays separate.
- One parent Goal, maximum2 Issues per cycle; active audit #1727 and physical blocker #1662.
- All reported file presence is evidence-leading metadata, never semantic or physical verification.

## Review Focus

1. Missing/deleted/duplicate canonical IDs must fail, not disappear from the queue.
2. Existing source for MISSING/PARTIAL requirements must not become a completion claim.
3. New accepted owner decisions and every COG remaining clause must remain visible.
4. Evidence record IDs must be resolved separately from file paths; absent leads stay absent.
5. Closed Issue status and successful deployment must not override product-complete:false.

### Task 1: Read-only complete requirement audit

**Files:** Create scripts/goriq-completion-audit.mjs, tests/goriq-completion-audit.test.mjs, docs/audit/goriq-completion-2026-10-06.json.
**Interface:** buildCompletionAudit({root,revision,matrix,ledger,inventory,decisions,reverse,cognitive}) returns deterministic metadata and rows, or rejects invalid canonical state. CLI --check reads current checkout and prints metadata; --json prints full snapshot to stdout. No mutation or network.
- [ ] Test real canonical341/COG17 coverage, conservative completion, covered-but-MISSING leads, absent evidence refs, deleted/duplicate mirror rejection and malformed COG rejection.
- [ ] Run node --test tests/goriq-completion-audit.test.mjs; confirm the scaffold fails for missing behavior.
- [ ] Reuse existing validators; derive metadata without changing source objects or statuses.
- [ ] Run focused tests and existing requirement/reverse-audit tests; generate the deterministic snapshot against exact7c45c42.
- [ ] Run the full existing suite; retain the exit code and named failures.
- [ ] Commit the read-only audit, tests and snapshot.

### Task 2: Durable whole-product remaining work and state

**Files:** Create docs/audit/goriq-completion-2026-10-06.md; state-only update PROJECT_STATE.md.
**Interface:** Narrative binds the audit to #681 P0-P10/#1219 A-J, source-pinned actual receipts and ordered workstreams.
- [ ] Record341 statuses and every family; point to all-ID JSON for individual actions.
- [ ] Preserve actual production/physical successes as scoped evidence; identify unverified classes and stale records.
- [ ] Record Mac source rejection, earlier prepare failure, current main advancement and UAC limitation without weakening authorization.
- [ ] Record reopened #681/#1216 and merged #1217/#1720/#1722/#1726; remove stale runner-wait/PR-unmerged assertions from state fields only.
- [ ] Map independent software work to existing parents; next first bounded cognitive trial collector followed by measured certification, plan/compiler, teaching/history and cross-host work.
- [ ] Self-review all normative sections and run documentation/requirements checks.
- [ ] Open PR, obtain independent review, full CI, protected merge and main CI. Leave global completion open.

### Task 3: Continue implementation and actual acceptance

- [ ] Begin the next independently executable software slice under #1216/#882 after the audit; require actual RED→GREEN and independent review.
- [ ] Resume #1662 only with valid exact-source authorization and actual native capabilities. Never widen PR1718 binding to current unrelated main.
- [ ] Collect current-revision Windows/Mac receipts, signed cross-device task, offline/reconnect/failover/resync/rebalance.
- [ ] Later Nubia/iPhone/future-PC acceptance retains the original platform contracts; Android38 stays deferred.
- [ ] Product completion requires all in-scope canonical gates and P0-P10 exit conditions verified or a genuinely unavoidable platform restriction with an implemented displayed fallback.

## Rulings and rollback

The owner's standing instruction overrides routine plan-confirmation/worktree-consent pauses. Work uses a fresh isolated audit checkout; original workspaces remain untouched. GitHub Issues are a fallback handoff, not a claimed Compass Controller write. Reverting the audit files/state bookkeeping has no runtime effect; retain historical evidence and reopened unfinished parent work.


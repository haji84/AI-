# GORIQ Completion-First Delivery Policy

Owner decision: 2026-10-17. Tracking Issue: #1817. Parent product Goals: #681, #1219, #882. This decision changes **delivery order and execution economics**, not the frozen product scope or any security/approval rule.

## Outcome, not activity

GORIQ succeeds by increasing **requirements with current, valid completion evidence** and reaching the full canonical product DoD. Neither source-file presence, lines of code, commits, Issues/PRs, green CI alone, simulations, nor model assertions prove product completion. Keep the original requirement IDs, evidence classes, owner decisions and product specification authoritative. Do not quietly defer, drop or reclassify requirements to inflate progress.

The completion-first policy is proposed through protected review. It becomes repository-operative when integrated under existing governance; documentation alone does not implement, activate or prove autonomous runtime behavior.

## Critical path and ordered exit gates

### Gate 0: Baseline, deduplicate and stabilize the backlog
1. Pin the current main commit, authoritative PROJECT_STATE/ROADMAP/AGENTS, product requirements, existing Goal state, and available latest evidence. Mark evidence by source revision and date; distinguish historical from current.
2. Inventory open Issues and PRs; classify each as **required critical-path dependency**, **safe independently finishable**, **blocked with an evidence-backed cause**, **superseded/duplicate candidate**, or **later scope**. Do not bulk close, delete, merge or abandon unreviewed work.
3. Select only the minimum integration work necessary for Gate 1. Reuse already implemented Builder, Goal Controller, WorkState, CI, verifier and recovery paths. Resolve conflicts/dependencies before adding more PRs.
4. Freeze unrelated feature expansion. Exceptions: verified security/critical regression fixes, required dependencies for the current gate, and explicitly authorized owner priorities. Freeze does not disable critical safeguards, security patches, essential maintenance, or recording of requested future features.
5. Maintain one active critical-path integration slice at a time by default. Preserve the existing MAX_ACTIVE_AGENTS=3, MAX_PARALLEL_CODE_AGENTS=2 and MAX_ISSUES_PER_CYCLE=2 ceilings; fewer lanes are preferred when integration or verifier capacity is the bottleneck.

**Exit:** a current-revision critical-path backlog, selected one-host acceptance Goal, actual required environment, clear blockers and evidence requirements, and no competing active authority for the same Goal.

### Gate 1: One actual host completes one real development Goal end-to-end
Use one already-authorized PC as a **temporary acceptance slice**, not as GORIQ's permanent Coordinator or architectural single point of failure. Select a small, non-trivial code change with a real failing test or independently reproducible defect and owner-authorized execution scope.

Record proof for each link:
1. One authenticated Goal is accepted, persisted and deduplicated by Goal Controller.
2. Its requirement, exact base/head revision, selected Builder and acceptance test are recorded.
3. A real, reachable Builder executes a bounded implementation change; an invented task ID, model mock, or simulated receipt is not accepted.
4. Relevant actual tests, security checks and independent verification execute on the changed artifact. A Builder cannot certify its own high-risk result.
5. An actual PR is created, current revision and protected checks verified, review requirements satisfied, and integration performed only under existing gates.
6. Exact merged main is reverified; applicable real runtime/E2E receives the work/result and confirms intended behavior.
7. Evidence and completion status are persisted in authoritative Goal/Job state and linked to relevant requirement IDs. A PR merge is not itself completion.
8. The Controller selects the next evidence-backed unfinished action, without an owner typing 'continue'.

**Exit:** an auditable, real revision- and environment-bound complete chain. Green CI, fixture-only acceptance, local partial execution or a chat statement cannot substitute for missing links.

### Gate 2: Unattended continuation and bounded recovery
Using the same authenticated control plane and genuine Builder, demonstrate a distinct next-task transition, durable checkpoint/restart and resumption, a reproduced failure followed by changed-hypothesis repair/reverification, duplicate prevention, and correct Human Gate pause/resume. Run until the Goal's applicable conditions are verified or a legitimate authority/capability/safety/budget blocker is reached. No infinite retry cycles, artificial approvals or fake PASS.

**Exit:** real repeatable unattended operation on the accepted host with valid results and negative-case checks. Only then extend the automated workload to broader independent tasks.

### Gate 3: Real MacBook/ZBook distributed acceptance
With scoped identity/credential/permission approvals obtained separately, verify both actual PCs and their provenance, signed cross-device task ownership and evidence, coordinator transfer, abrupt node loss, restart, reconnect, partition/conflict handling, stale-owner fencing, resynchronization and rebalancing. A controlled lease-loss test alone is not abrupt power-loss or partition evidence. Preserve privacy, Owner controls, security and task migration classifications. No permanent main PC is introduced.

**Exit:** exact-current-artifact physical receipts for required distributed acceptance cases, or explicit unpassed blockers for each case.

### Gate 4: Whole-product verification and release
Reconcile every frozen requirement and accepted owner decision; evaluate remaining UI, operation, recovery and actual-device requirements using their required evidence classes. Preserve explicitly deferred physical rollout order without treating deferred items as PASS. Research/AGI claims remain a separate evidence program. Perform security, release, backup/rollback and actual operational acceptance under existing release/Human Gates.

**Exit:** all in-scope product DoD gates satisfied, or release not approved with honest remaining gaps. No percentage inferred from commit/PR count.

## How each job is selected and finished

- Choose the job with the strongest contribution to the *next blocking exit gate*: prerequisite readiness, critical path, measurable requirement completion, integration cost, independent verifiability and resource budget. Prefer fixes to existing code over new parallel subsystems.
- Treat discovery -> implementation -> tests -> independent verification -> integration -> real operation -> evidence write-back as one delivery unit; work-in-progress is not DONE.
- Block creating competing PRs for the same underlying failure signature or Goal. Use exact head SHA, error signature, attempt ID and changed hypothesis to deduplicate recovery. A repetition without new evidence is not progress.
- Document genuinely blocked jobs with the exact unavailable authority/device/capability, alternate safe work, and first next executable action. Do not invent evidence or demand repeated owner re-approval for ordinary already-authorized work.
- Retain merge/security/test gates and rollback invariants from AGENTS.md and the RC2 protocol, even under time pressure.

## Scarce model and resource budget

- Prefer deterministic repository queries, targeted scripts, local tests, diff/line-scoped retrieval, cached verified facts and suitable local models before expensive remote reasoning.
- Route difficult architecture, reasoning or unresolvable diagnostics to an appropriately capable model. Save Work/Codex/Pro capacity for decisions or edits that genuinely need them. Never use a weak model's unsupported verdict as independent evidence.
- Work and Codex may share plan allocation; internal call counts are **not** OpenAI's live remaining quota. Treat unavailable balance as unknown. Use user-provided/account-shown limits, explicit soft budgets and fail-closed exhaustion rather than guessed capacity or limit-bypass methods.
- No paid API fallback, new credential/OAuth/permission, scraping-based bypass of product limits, hidden billing or unsanctioned model access. Existing non-billable capability policy stays in force.
- Measure per completed/verified requirement: external-AI invocations when observable, repeated attempts, elapsed execution, runtime verification and remaining backlog. Compare outcomes across repeatable tasks; do not promise arbitrary percentage savings.

## Execution report (each completed delivery slice)

Record: parent Goal and exact requirement IDs; base/head/merge SHA; test and independent-verification evidence; actual host/runtime result; outcome (VERIFIED / PARTIAL / BLOCKED / INCONCLUSIVE); root cause and changed recovery strategy if any; resource use when genuinely measured; residual blockers; exact next action; rollback reference. Preserve audit history and do not overwrite old snapshots to claim new acceptance.

## Completion accountability and shared-development reuse (owner proposal, 2026-11-02)

The core failure to eliminate is a cycle of planning, partial PRs, CI and "next step" reports without a product the owner can actually use. These are **delivery acceptance instructions**, not permission to lower gates, expand repository scope or change other projects.

1. **Reuse audit before any new AI, reviewer, model, orchestrator or framework.** Read current exact main/PR/head, existing components, tests and model-run evidence in the *authorized* relevant repositories. Record the missing capability, candidate reuse or consolidation options, quality/independence results, cost and integration risk. Prefer one reusable implementation for overlapping functions. A separate reviewer role or independent execution identity must remain separate even when shared parsers or transport are reused. Never claim two models are interchangeable without actual comparison.
2. **One shortest path to a usable product.** Keep one owner-selected product Goal on the active critical delivery path by default. Stop unrelated framework/feature expansion unless required for its acceptance, an independently evidenced security/critical repair, or an explicit owner exception. Do not start another "framework to finish the framework" without demonstrating why the existing components cannot close the named blocker. Preserve other Goals, Issues, code and historical evidence without bulk closing or deleting them.
3. **Product acceptance is stronger than code acceptance.** Track separately: DESIGN_ONLY, CODE_PRESENT, CI_VERIFIED, INTEGRATION_VERIFIED, USER_USABLE, and FULL_GOAL_VERIFIED (or BLOCKED/HUMAN_REQUIRED). USER_USABLE requires reproducible actual launch/install or accessible UI, its intended end-user core task, data persistence/recovery where relevant, failure handling, and applicable actual device/network/security evidence. FULL_GOAL_VERIFIED additionally requires every canonical requirement and all release, security, permission, reviewer and Human Gates. A unit test, passing CI, merged PR, mock, sample screenshot or successful model call cannot substitute for these.
4. **Keep work moving within existing authority.** Each task must have a durable Goal/Issue/PR link, current revision, acceptance evidence, unique failure signature, attempted hypothesis, remaining gaps and executable next action. After a safe, approved action succeeds, autonomously select and execute the next authorized action via the actual durable runtime when available; do not stop at "next step is ...". If the runner/capability is absent or authority is missing, say exactly what is blocked and the smallest necessary Human Gate; do not promise background execution from an ordinary chat.
5. **Fix real failures, not success labels.** Investigate exact-head logs, reproduce the mechanism, apply the smallest reversible same-PR correction, and rerun affected checks. Reject unchanged repeated attempts without a new hypothesis. Never reuse a green result or review from an older base/head, skip tests to get green, or treat synthetic inference as real independent model evidence. Record actual distinct-model inference provenance and separately required formal GitHub approval; AI self-attestation is advisory.
6. **Report delivery, not activity volume.** Every product report distinguishes usable verified capabilities, unresolved Goal criteria, actual tests/device proof, blocked gates, and the next permissible action. PR count, new models, code volume, jobs and "everything is progressing" are not success metrics. Use the owner's experience and validated acceptance criteria as the final product quality measure.
7. **Cross-repository scope is opt-in.** This document binds only this repository after its normal reviewed adoption. Other projects may reuse the rules by deliberately referencing or adopting them in their own authoritative instructions with their own owner approval, specifications, privacy rules and Human Gates. No cross-project write or new workflow authority is implied.

Do not replace existing independent review or Human approval with a single convenient "common AI". Consolidate overlapping source-processing modules where justified, but preserve genuine reviewer separation, immutable evidence and authorized deployment boundaries.

## Governance boundaries

AGENTS.md, RC2, the product specification, current verified requirements, independent review, protected CI, access/identity/security/privacy/rollback controls and Human Gates remain authoritative. Changing this delivery policy never authorizes secret handling, token/scope expansion, credential enrollment, firewall/network exposure, billing, destructive data changes, disabling tests, permission changes or deployment beyond task-scoped approval.

Policy integration itself requires existing governance review; runtime implementation and physical enrollment remain separate reviewed/approved tasks. No direct main commits or protection bypass. A reversible documentation-only PR may be reverted through the same protected process; preserve the owner decision and evidence trail.

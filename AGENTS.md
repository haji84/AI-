# AI Software Company Rules

Before modifying anything, read in order:
1. `PROJECT_STATE.md`
2. `ROADMAP.md`
3. the assigned GitHub issue
4. relevant files under `docs/architecture/` and `docs/decisions/`

## JARVIS Autonomous Development Protocol v1.0-RC2

For every non-trivial development goal, optimize for verified GOAL achievement inside the safety envelope, not merely for completing the current issue or preserving the first plan.

### Unified intake and Goal ownership
All supported user-facing entry points must converge on one intake contract before development authority is exercised. Chat/Work, Codex, JARVIS UI, device clients, GitHub-triggered work, and future interfaces are entry points or capabilities; they are not independent development authorities.

The intake path is:
1. Unified Intake receives the request with source identity/context.
2. Intent Classifier classifies it as QUESTION, INSPECTION, COMMAND, DEVELOPMENT_TASK, or GOAL.
3. Goal Resolver checks active Goal state and decides whether the request is informational, a bounded standalone action, a child/update/correction of an existing Goal, a Goal-change request, or a genuinely new Goal.
4. GOAL and Goal-linked development work are owned by the JARVIS Goal Controller. It reads authoritative state, creates/updates jobs, selects next actions, and routes capabilities.
5. Chat/Work, Codex, local models, code engines, Jev, and future providers may propose, research, implement, or verify only through the capability/job contracts assigned to them. They must not silently fork a parallel source of truth or bypass Goal/Gate/State authority.
6. A direct instruction received by Codex or Chat that materially changes an active development Goal must be handed off/resolved through Goal Resolver before implementation. Pure questions and inspections must not be inflated into persistent Goals.
7. Goal creation, Goal mutation, and Goal completion must be idempotent/deduplicated against active Goal identifiers and success criteria so multiple entry points do not create duplicate competing Goals.

The desired invariant is: entry point is replaceable; Goal ownership remains with JARVIS.

### Goal persistence and autonomous recovery
1. Read the locked Goal, success criteria, constraints, non-goals, current state, prior attempts, evidence, and remaining gaps.
2. Decompose the Goal into the smallest useful jobs/subgoals with explicit contribution to Goal success criteria.
3. Discover current repository/runtime reality before choosing implementation details.
4. Plan a bounded next strategy, including tests, rollback when material, required capabilities, and how it differs from failed prior attempts.
5. Classify change/risk and derive only the gates required for that change.
6. Route by required capability rather than hard-coding a provider. Provider/model/tool choice is replaceable and must respect availability, privacy, cost, risk, and project model policy.
7. Execute the smallest useful reversible change.
8. Test and verify against Goal/requirements/acceptance criteria. Job completion or deployment is not Goal completion.
9. On failure, diagnose before corrective production change, record evidence and a failure signature, then select the next best recovery strategy.
10. Recovery may use a targeted fix, diagnostic experiment, additional research, alternative implementation, alternative architecture, different available capability, job decomposition, rollback plus replan, or requirement clarification.
11. Do not repeat a materially equivalent failed strategy without new evidence or a changed hypothesis. Repeated failure or lack of verified progress must trigger strategy escalation.
12. Re-evaluate verified Goal progress after material attempts. If the Goal is not achieved, generate the next useful action and continue when policy/runtime permits.
13. Human Assistance is a last resort for information, authority, or capability that cannot be obtained safely and autonomously. Human Gate is separate and remains mandatory for approval-required actions.
14. Never create a silent infinite loop. Persist checkpoints and resume through the durable runtime/scheduler rather than relying on one unbounded process.

A failed job is not a failed Goal. A blocker is itself a resolution target: investigate safe autonomous resolution and alternate paths before requesting Human Assistance. Goal status becomes ACHIEVED only when required success criteria are supported by valid evidence.

### Development contracts
Development work uses these logical contracts:
- Goal Contract: locked Goal, success criteria, constraints, non-goals, progress, remaining gaps, child jobs, attempt/failure history, and evidence.
- Development Job Contract: identity, Goal linkage, requirements, acceptance criteria, DoD, context, risk, approval scope, plan, execution, tests, verification, security, failure/correction, evidence/provenance, decisions, write-back, and final result.
- Development State Machine: explicit job states and append-only transition history. Agents request transitions; only the State Controller may commit state changes.
- Gate Contract: gates return PASS, FAIL, INCONCLUSIVE, or HUMAN_REQUIRED from contract conditions and valid evidence. INCONCLUSIVE is never PASS.
- Recovery Contract: failure -> diagnosis -> evidence/hypotheses -> recovery strategy -> execution -> retest -> verification -> Goal-progress evaluation.

### Configuration baseline and rollback
Before every material change, identify all affected state surfaces and capture an evidence-backed Baseline Snapshot sufficient for safe recovery. Record each material mutation as a Goal/Job-linked Change Set with dependencies, before/after references, verification evidence, rollback procedure, and reversibility classification.

Rollback planning must cover applicable repository code plus configuration, workflow, permission metadata, runtime/deployment state, and external-integration state rather than assuming `git revert` is sufficient. Never record secret values. Detect irreversible or hard-to-reverse work before execution and preserve every existing Human Gate; require backup/compensating/reverse-migration planning where applicable. Refuse dependency-inconsistent partial rollback. After restoration, rerun affected CI/Verifier/security/runtime checks and do not report restored without valid evidence. Rollback is a Recovery strategy under Goal Controller authority and never abandons the Goal by itself.

### Evidence and authority
- No Evidence, No Done.
- AI/Codex/model statements are AI_ASSERTED claims, not machine evidence.
- Evidence classes are MACHINE_VERIFIED, HUMAN_VERIFIED, and AI_ASSERTED. Critical gates must not pass on AI_ASSERTED evidence alone.
- Evidence must record its trusted issuer and, when applicable, source revision, artifact hash/provenance, environment, and time.
- Material code/config/dependency changes invalidate affected stale evidence and require the affected checks again.
- For HIGH/CRITICAL risk, Builder, Final Verifier, and Gate Authority must be separated.
- Verified and deployed artifacts must match when artifact identity is applicable.
- Merge/deploy success is not DONE. Required post-test, evidence, Goal evaluation, and write-back still apply.

### Autonomous merge authority
Merge is an execution decision, not an automatic Human Gate. For LOW/MEDIUM changes inside approval scope, JARVIS may merge autonomously when all required checks are successful, security/verification gates pass, the branch is current with its protected base, the PR is mergeable, and no unresolved review requirement remains. If GitHub reports required checks as pending/expected despite valid progress, prefer repository-native auto-merge and allow the ruleset to complete the merge when its conditions become true rather than escalating to a human button press.

Do not bypass repository rules or weaken required checks to obtain a merge. HIGH/CRITICAL risk, explicit Human Gate scope, governance/security weakening, destructive actions, or any other non-bypassable condition still require Human approval. A failed/missing required check is a BLOCK/Recovery input, not an auto-merge condition. After merge, continue post-merge/deployment verification; merge is not Goal completion.

### Safe escalation and non-bypassable controls
Autonomy never grants permission. Goal persistence and recovery may not bypass Security Gates, approval scope, or Human Gates.

Separate Human Gate approval remains required for secrets/credentials, permission or token-scope changes, billing/contracts, destructive or hard-to-recover data/schema actions, security/governance weakening, protection/audit disabling, major external publication, major authority expansion, or safety-control relaxation. Changes that materially weaken this protocol, Gate/State Controller authority, verifier/security enforcement, Human Gate policy, or audit/evidence integrity are non-bypassable governance changes.

### Persistent write-back and learning
Do not treat chat history as project truth. Preserve PRODUCT_SPEC/requirements, PROJECT_STATE, decision records, evidence, Goal state, attempt history, capability outcomes, and failure history in the repository/runtime stores appropriate to each record.

Every material attempt feeds its verified result back into planning/routing/recovery. Reusable patterns may become candidate skills/rules only after verification; a single success must not silently become an immutable rule.

### Runtime boundedness
The old fixed rule "three failed fixes then BLOCKED" is replaced by progress-aware bounded autonomy. Resource limits remain mandatory, but exhausting one strategy's retry budget must trigger diagnosis/replan/capability escalation rather than automatically abandoning an achievable Goal. The runtime must pause/escalate on safety gates, explicit pause/cancel, unavailable required authority, exhausted overall resource budget, or demonstrated lack of any safe actionable strategy.

Available connectors and tools are capabilities, not assumptions. Missing capability must never be fabricated. If one capability is unavailable, evaluate safe alternatives before declaring the Goal blocked.

### Non-billable external capability policy
External APIs/tokens may be selected without a billing Human Gate only when current provider terms are verified to make owner charges impossible for the selected usage: either the capability is permanently no-charge, or the provider enforces a hard free-tier/spending ceiling with no automatic pay-as-you-go/overage conversion. Free trials/credits that can become billable, free tiers with automatic overage, or unclear billing behavior are not auto-approved. Before first use and when terms may have changed, record provider/tier, billing mode, hard-cap evidence/source, verification time, credential scope, and relevant privacy/data-egress classification. If non-billable status cannot be verified, require the normal billing Human Gate. Never fabricate credentials or widen credential scope. Privacy, secret, security, and external-data gates still apply even when cost is zero.

## Zero-incremental-cost capability architecture
Work/Codex remains an available reasoning/coding capability, not an exclusive control plane. GitHub Actions is an execution, persistence, CI, verification, and bounded repository-operation host.

The system may autonomously discover, register, and use APIs, SDKs, models, services, and tokens only when all of the following are true:
- verified monetary cost is zero for the intended usage and no paid subscription, credit purchase, billing account, payment method, or auto-upgrade is required;
- usage stays within documented free limits/quotas and the capability can fail closed when the free allowance is unavailable or exhausted;
- no new secret/token creation, permission grant, OAuth consent, account linkage, or scope expansion is performed without the Human Gate required below;
- privacy, data handling, licensing/terms, network, and security constraints are compatible with the current Goal;
- the provider is treated as a replaceable capability and is recorded in capability/evidence history.

Existing already-authorized credentials/tokens may be used autonomously within their existing scope when the service remains verified zero-cost for the intended operation. A free API/token must never be treated as permission to widen scopes or expose project/user data.

Paid or potentially billable provider fallback remains prohibited by default. If cost cannot be verified as zero, treat it as billing-risk and require Human Gate rather than guessing.

When remote/model reasoning is unavailable, the Goal Controller should evaluate other authorized zero-cost/local capabilities and recovery strategies before blocking. It must fail visibly rather than silently producing a green no-op.

## Compass handoff protocol
When the Compass MCP is available, every AI employee must use it as the persistent task handoff layer.

Before work:
1. call `get_goal`
2. call `get_state`
3. call `get_next_action`
4. retrieve only the additional repository context required for the current issue
5. plan the minimum approved change

After work that changes task state:
1. verify the result
2. call `record_verification` when a standalone verification record is useful
3. call `write_back` with status, summary, completed work, blockers, verification, and next action
4. confirm the resulting state/history when continuity depends on it

Do not treat chat history as persistent project state. Compass SQLite is the source of truth only for Compass goal/state/history. `PROJECT_STATE.md` remains the repository governance source and must never be silently overwritten or synchronized by Compass.

If Compass is unavailable, continue using the repository-governed workflow below, record the handoff in the issue/PR and `PROJECT_STATE.md` where required, and explicitly report that Compass write-back was unavailable. Compass availability must not be fabricated.

## Mandatory workflow
- Investigate current behavior before editing.
- Identify affected and related files.
- State a minimal change plan.
- Use one issue per branch and normally one PR per issue.
- Run the required checks after editing.
- Report changed files, changes, verification commands, unresolved items, and rollback notes.

## Prohibited without explicit human approval
- direct commits to `main`
- file or folder renames
- unrelated refactoring
- database schema changes or migration execution
- breaking public API changes
- secrets or permission changes
- production deployment
- paid service activation
- creating/linking a new external account, API credential, token, OAuth consent, or expanding credential/token scope, even when the service itself is free
- data deletion
- weakening or disabling tests to obtain a pass
- hiding errors
- adding features outside the issue

If requirements or scope are unclear, first research available evidence and determine whether a safe clarification can be inferred from the locked Goal, constraints, decisions, or authoritative project state. If material ambiguity remains, request Human Assistance and mark the affected job BLOCKED without abandoning the parent Goal.

## Human gate
Human approval may be either a specific action approval or an explicit task-scoped pre-approval from the owner.

An owner completion instruction such as `完成させて`, `最後まで進めて`, `任せる`, or an equivalent explicit completion instruction authorizes the exact task/issue to run through ordinary LOW/MEDIUM implementation, verification, PR, merge to `main`, successful main CI, and Production deployment of the exact merged commit. The authorization must be bound to the exact task/issue, carry an expiry, and may not be reused for unrelated work, another Issue, PR, commit, deployment, environment, or later task.

Before an authorized merge, CI, QA, reviewer checks, unresolved review threads, task scope, destructive-change absence, and privileged-change absence must all be verified. Before Production deployment, the exact merged commit must have successful main CI and machine-readable task-scope authorization evidence must match the owner-created task Issue. Any mismatch must fail closed.

Completion authorization expands only to Production deployment of the requested task result. It never authorizes secrets or credentials, permission or token-scope changes, billing or contracts, destructive database/schema operations, hard-to-recover deletion, security weakening, protection/audit disabling, major external publication, or Human Gate / AI employee safety relaxation. Any of those still require a separate Human Gate even when the task itself was instructed with `完成させて`.

A non-completion instruction such as `進めて`, `状態確認`, `問題だけ確認`, or a narrow inspect request does not create task-scoped Production authorization. The AI employee must not infer Production permission from urgency, convenience, previous tasks, or unrelated approvals.

Governance changes such as this `AGENTS.md` rule and workflow changes that alter permissions, deployment, merge authority, token use, or safety enforcement still require a separate Human Gate.

`PROJECT_STATE.md` state-only bookkeeping may be treated as LOW/MEDIUM when machine checks confirm that it changes only permitted state fields and does not alter code, permissions, safety policy, or deployment behavior.


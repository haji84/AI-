# AI Software Company Rules

Before modifying anything, read in order:
1. `PROJECT_STATE.md`
2. `ROADMAP.md`
3. the assigned GitHub issue
4. relevant files under `docs/architecture/` and `docs/decisions/`

## Goal-driven operating loop
For every non-trivial task, operate as a bounded loop instead of a one-shot chat response:
1. read the explicit goal and success criteria
2. read current project state and the current next action
3. collect only the context required for that action from available capabilities
4. infer likely user intent from explicit goals, constraints, preferences, and recent decisions; attach confidence and evidence and never claim mind-reading
5. propose the smallest next action that advances the goal
6. classify risk before execution
7. execute low-risk reversible work when policy permits
8. verify the result
9. write back completed work, blockers, verification, and next action
10. repeat only when the runtime explicitly schedules another cycle

Stop immediately when the goal is complete, the project is paused, a blocker exists, retry budget is exhausted, or Human Gate approval is required. Never create a silent infinite loop.

Available connectors and tools are capabilities, not assumptions. GitHub, conversation files, web research, mail, calendar, local runtimes, or other providers may be used only when actually available and relevant to the goal. Missing capability must be reported, never fabricated.

## Zero-additional-AI-API architecture
Work/Codex is the model-reasoning control plane for AI employee planning and coding work. GitHub Actions is an execution, persistence, CI, verification, and bounded repository-operation host; it must not silently substitute another model provider.

Production runtime and workflows must not add or call direct OpenAI, Anthropic, Gemini/Google AI, GitHub Models, or Copilot CLI model paths. Do not add their API keys, SDKs, inference endpoints, model permissions, or equivalent paid-provider fallback routes. Any future exception requires an explicit Human Gate for billing, secrets, permissions, and architecture change.

When GitHub Actions needs model reasoning, it must receive an explicit bounded plan handed off from Work/Codex. If that handoff is unavailable or invalid, fail visibly rather than degrading to a green no-op or silently choosing another provider.

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
- data deletion
- weakening or disabling tests to obtain a pass
- hiding errors
- adding features outside the issue

If requirements or scope are unclear, stop and mark the task BLOCKED.

## Human gate
Human approval may be either a specific action approval or an explicit task-scoped pre-approval from the owner.

An owner completion instruction such as `完成させて`, `最後まで進めて`, `任せる`, or an equivalent explicit completion instruction authorizes the exact task/issue to run through ordinary LOW/MEDIUM implementation, verification, PR, merge to `main`, successful main CI, and Production deployment of the exact merged commit. The authorization must be bound to the exact task/issue, carry an expiry, and may not be reused for unrelated work, another Issue, PR, commit, deployment, environment, or later task.

Before an authorized merge, CI, QA, reviewer checks, unresolved review threads, task scope, destructive-change absence, and privileged-change absence must all be verified. Before Production deployment, the exact merged commit must have successful main CI and machine-readable task-scope authorization evidence must match the owner-created task Issue. Any mismatch must fail closed.

Completion authorization expands only to Production deployment of the requested task result. It never authorizes secrets or credentials, permission or token-scope changes, billing or contracts, destructive database/schema operations, hard-to-recover deletion, security weakening, protection/audit disabling, major external publication, or Human Gate / AI employee safety relaxation. Any of those still require a separate Human Gate even when the task itself was instructed with `完成させて`.

A non-completion instruction such as `進めて`, `状態確認`, `問題だけ確認`, or a narrow inspect request does not create task-scoped Production authorization. The AI employee must not infer Production permission from urgency, convenience, previous tasks, or unrelated approvals.

Governance changes such as this `AGENTS.md` rule and workflow changes that alter permissions, deployment, merge authority, token use, or safety enforcement still require a separate Human Gate.

`PROJECT_STATE.md` state-only bookkeeping may be treated as LOW/MEDIUM when machine checks confirm that it changes only permitted state fields and does not alter code, permissions, safety policy, or deployment behavior.

## Retry limit
Maximum automatic fix attempts per issue: 3. After that, mark BLOCKED and return to Governor.

# Chat-first GitHub Actions autonomous development: proposed activation plan

Issue #1865 / Draft PR #1866. Owner direction: ordinary ChatGPT Chat is the preferred development command surface; GitHub Actions is the hosted bounded execution and verification runtime. Codex is a last-resort capability, not the default for coding.

## Existing components, to be reused

- `.github/workflows/autonomy-mobile.yml` already accepts a bounded `command_json` with `source=chat` using `workflow_dispatch`, a repository-dispatch event, or a trusted owner Issue label bridge.
- `src/orchestrator/command-ingress.ts` normalizes Chat/Work/Codex command envelopes.
- `GoalControllerRuntime`, `DevelopmentOrchestrator`, `WorkState`, `risk-policy.ts` and the existing durable runtime remain the only Goal/task authority.
- `development-pr-advisory.ts` proposes existing PR reuse, risk gates, AI09 exact-head advisory status, and Chat-first Actions handoff. `DevelopmentOrchestrator.inspectChatActionsDevelopment` exposes these decisions WITHOUT dispatch.
- AI09 review is read-only and AI_ASSERTED; it cannot satisfy formal GitHub APPROVED requirements.
- The PR Fixer must add corrections to the existing PR head branch, never open a correction PR by default. It cannot merge.
- A separate trusted integration controller may merge LOW/MEDIUM only when existing controls and repository Rulesets allow it.

## Desired Chat -> Actions -> verified Goal loop

1. Owner instructs ChatGPT Chat. Chat gathers the exact Goal/task/issue and acceptance criteria and proposes a bounded command.
2. A trusted, authenticated GitHub handoff uses the existing Mobile Autonomy input contract. **Chat text or a `source=chat` JSON field does not prove owner authentication**. The connector/action that submits the event must bind owner identity, repository, scope and idempotency key independently.
3. Existing Goal Resolver deduplicates against the current Goal, Issue and PR. If an open PR belongs to that issue, reuse it. Ambiguous or incomplete inventories require reconciliation, not a new PR.
4. GitHub Actions chooses an already-authorized non-Codex Builder/capability and runs bounded implementation and tests. GitHub Actions itself is not a coding model; absence of a callable Builder must cause a capability hold, not invented execution.
5. AI09 reviews the exact base/head and diff. The verifier separately checks machine evidence. Actionable confirmed failure returns to the SAME PR branch through the bounded repair loop.
6. The integration controller alone evaluates protected checks and Human Gates. HIGH changes await owner approval; CRITICAL security-governance weakening remains a hold. Only safe unrelated tasks continue.
7. After merge, verify main CI and real acceptance evidence. The durable Goal Controller selects next useful work, with state stored outside transient Actions jobs. Completion is evidence-based.

## Codex-last policy (target behavior, not activated)

Default: existing GitHub Actions execution environment plus approved non-Codex code capability. Never infer that ChatGPT subscription is a model API or that Actions alone can reason and implement code. No new paid model, token or permission should be configured without separate approval.

Codex can only be considered when:
- the other configured capabilities were tried or are demonstrably unavailable;
- a concrete requirement remains impossible with them, with failure/availability evidence;
- the scope and cost/credential/privacy policy permit Codex;
- explicit task-level or other required Human Gate authorization exists.

A model may propose this escalation but never authorize itself. If no usable alternative exists, retain CAPABILITY_UNAVAILABLE and keep a durable checkpoint. Existing `reasoning-router.ts` still currently recommends Codex for code-related tasks: replacing that active behavior is a separate reviewed integration change.

## Approval / permission boundary

This PR only implements read-only advice and tests. No GitHub Actions workflow, deployment, token, Ruleset, `AGENTS.md`, actual reasoning route, model provider or merge permission is changed.

For activation, present an exact reviewed diff and request task-scoped owner Human Gate before any change to:
- `.github/workflows/autonomy-mobile.yml` or trusted chat webhook / dispatch permissions;
- `reasoning-router.ts` or active provider selection policy;
- write-capable PR repair, integration and the continuous next-action dispatcher;
- secrets, provider access or repository protection.

The first real trial must prove one owner-authenticated Chat instruction, deduplicated issue/PR linkage, normal Actions Builder, native CI, actual AI09 advisory, same-PR correction, permitted integration, and post-merge Goal continuation. Independently test that unauthenticated input, stale AI09, missing proof, HIGH approval wait, CRITICAL hold, and missing Builder do not auto-dispatch or merge.

## Dynamic parallelism

Do not hardcode a 2-worker limit. Admit independent work based on dependencies, runner/resource quotas, conflict risks and actual throughput. Serialize commits to the same PR head, and never run multiple writers on the same branch concurrently.

## Current phase acceptance

- Pure proposal contract and isolated tests can pass in GitHub Actions CI.
- No actual Chat message automatically dispatches Actions merely because this document/PR exists.
- The real end-to-end unattended loop is NOT accepted until the separately approved activation and native evidence pass.

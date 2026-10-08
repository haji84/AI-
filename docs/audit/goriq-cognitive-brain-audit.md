# Cognitive execution audit — Issue #1216

Baseline: main `54b5df2a41eaef75e7c40a83474aceb8fc15b3be`, inspected 2026-09-23. This document describes the pre-change integration gap; candidate implementation/evidence is recorded separately. No Production calls, credentials, devices or registrations were changed by this audit.

| Capability | Existing implementation | Baseline state | Core reuse | Gap / action |
|---|---|---|---|---|
| Goal authority | `src/orchestrator/goal-controller-runtime.ts`: GoalResolver/GoalControllerRuntime; Compass adapters | IMPLEMENTED | Preserve authoritative Goal, idempotent decision and WorkState | Add cognitive context under Goal authority, never replace it |
| Bounded execution | `goal-loop.ts`: GoalDrivenLoop; `work-state-integration.ts`: createWorkStateIntegratedGoalLoop | IMPLEMENTED | Reuse risk, approval, execution, verifier, write-back sequence | Planner/store/context/executor decorators supply cognition without another execution authority |
| Runtime composition | `compass-goal-execution-adapter.ts`: run | PARTIAL | Actual local Goal execution seam | Baseline planner is RuntimeDevelopmentPlanner(BaselinePlanner); memory/world/local model are absent here |
| Default development planning | `runtime-development-planner.ts` | PARTIAL | Existing bounded code.builder request and deterministic verification contract | Regex development detection and previous-result repair are not general local reasoning |
| Memory/world planning | `gai-informed-planner.ts` | EXPERIMENTAL | PersistentMemoryStore, PersistentWorldModel, PersistentSkillLibrary | Only decorates a baseline inspection/action description; not installed in Compass execution adapter |
| Local model execution | `src/gai/model-execution.ts`: GovernedModelExecutor and createFunctionAdapter | PARTIAL | Tier policy/usage ledger remain reusable | No production class named LocalModelRuntime exists. Generic function adapter requires injected runtime; no complete PrimaryBrainAdapter |
| Ollama research | `scripts/gai-*-*.mjs`, especially r8-memory-transfer and tool-use-benchmark | EXPERIMENTAL | Reuse local Ollama API contract and real-model evidence boundaries | Research scripts call /api/generate directly. They do not compose current durable Goal execution |
| Builder execution | `runtime-builder-capability.ts`, `scripts/code-builder-worker-service.ts` | PARTIAL | Existing authenticated loopback Builder and independent file verifier | Service selects codex/aider. Local HTTP transport is not proof of external-AI independence; classify Builder as optional external expertise |
| Model planning on cloud path | `unified-planning-client.ts`, `scripts/autonomy-cloud-run.ts` | LEGACY | Explicit bounded handoffs remain available | Cloudflare planner or explicit Chat/Work/Codex plan; missing handoff throws. Keep separate from local Primary Brain |
| User command dispatch | `src/app/api/command/route.ts` | PARTIAL | Preserve owner authentication and existing external job dispatch | Requires GitHub token/dispatch; not an offline local intake by itself |
| Local owner intake | `scripts/jarvis-broker.ts` POST /api/jarvis/admin/work | PARTIAL | Existing owner auth, requirement receipt, Goal Controller | Records intake but does not invoke GoalControllerExecutionBridge/CompassGoalExecutionAdapter here |
| Capability execution | `capabilities.ts`, `capability-policy.ts`, `adaptive-team-runner.ts` | IMPLEMENTED | Preserve registered/managed handlers and bounded dynamic team expansion | Core must select only host candidate IDs; model descriptions must not assign risk/permissions |
| Offline/worker execution | `src/gai/offline-first-runtime.ts`, durable-task-runtime, goal-loop-worker-executor | IMPLEMENTED | Reuse worker identity, connectivity, checkpoint/idempotency infrastructure | New cognitive sidecar must not replace or mutate existing worker queue |
| Failure/state | GoalLoop recovery map; WorkState/Compass events | PARTIAL | Retain existing recovery and append-only evidence | Immediate previous result and recovery counters are process-local; add bounded persistent hypothesis/action history |
| Persistent memory/world | `memory-store.ts`, `world-model.ts` | IMPLEMENTED | Learning engine partitions existing stores and controls verified promotion | Legacy store alone does not enforce tenant/privacy or independent verification; Core must not write raw model output as knowledge |

## Minimal implementation seam

Compose `CognitiveCore` as the existing `Planner` and `ContextSource`, decorate `StateStore.writeBack` for verified observations, and guard execution with a durable in-flight marker. Pass these through `createWorkStateIntegratedGoalLoop`. Keep GoalResolver, WorkStateGuardedExecutor, RiskPolicy, CapabilityRegistry and Verifier authoritative.

The host constructs candidate actions with fixed capability, scope and risk. The model emits only a candidate ID plus non-authoritative hypotheses/prediction. Null/invalid/unavailable model output never implies completion. A host completion predicate plus existing completion blockers is required.

## Limits that require explicit evidence

- Real Ollama plan generation, actual files/tools and unknown-task acceptance are different evidence classes from scripted adapter tests.
- The default registered local catalog is limited; existing external Builder remains an optional, explicitly enabled capability. General local code generation is not proved by replacing a planner.
- An in-flight marker prevents blind replay after an uncertain effect; it does not prove automatic recovery of every external side effect. Reconciliation needs actual downstream evidence/idempotency.
- Atomic snapshots/CAS do not establish cross-device transfer correctness, power-loss durability, or live Fleet migration.
- Existing cloud entry points and research workflows are retained; Core integration must be traced per entry point rather than claimed globally.

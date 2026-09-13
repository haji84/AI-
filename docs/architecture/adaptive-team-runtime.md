# Adaptive Team Runtime

## Purpose
The user interacts with one autonomous AI front door. The runtime may internally recall a proven `TeamBlueprint` or assemble a new capability team for the current goal. Team composition is an execution detail; verified organizational experience survives between runs.

## Runtime flow
1. Load persistent organizational team memory.
2. Read the current goal, explicit capability requirements and currently available capability catalog.
3. Recall the best non-demoted blueprint only when all of its capabilities are still available and it satisfies current required capabilities.
4. If no eligible blueprint exists, deterministically assemble the smallest supported team from the current catalog.
5. If any required capability is missing, stop before the `GoalDrivenLoop` and report the blocker. Never fabricate a capability.
6. Scope execution to the selected team's capabilities. Any planner request outside the active team fails closed.
7. Run the existing bounded `GoalDrivenLoop`. Risk classification, Human Gates, verifier, retry/recovery and write-back remain authoritative and are never bypassed by team recall.
8. Convert execution evidence into team-performance evidence only when the team actually executed. Verified goal completion records success. Execution or verification failure records failure. Paused, approval-required and pre-execution safety stops do not count against team performance.
9. Persist the updated blueprint memory atomically so a later process can recall the learned organization pattern.

## Persistence
`JsonFileTeamMemoryStore` stores a versioned JSON snapshot and uses a temporary file followed by rename for replacement. A missing file means an empty memory. Invalid or corrupt memory fails visibly rather than silently discarding organizational experience.

## Learning semantics
An assembled team is not trusted merely because it was composed. It becomes reusable only after evidence is recorded. Repeated verified success may promote the blueprint to `standing_candidate`; repeated failure demotes it through the existing organizational-memory policy. Every recall still revalidates current capability availability and current requirements.

## Security and governance
A remembered team carries no inherited permission. Every action continues through the same current risk and approval policies. Organizational memory cannot grant access to unavailable capabilities, bypass a Human Gate, weaken verification, exceed bounded-run limits, or invent external state.

## Completion boundary
This integration completes the runtime path for dynamic team composition and organizational learning. It does not establish that the project is AGI. Empirical generalization, transfer, long-horizon reliability, device execution and external evaluation remain separately measurable research/operation concerns.

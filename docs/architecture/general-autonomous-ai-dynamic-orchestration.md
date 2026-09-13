# General Autonomous AI: dynamic capability orchestration

## North-star goal

Human gives one goal. The system determines the work required, assembles only the capabilities needed for that goal, executes, verifies, repairs, records the result, and returns to the human only when the goal is complete or a real Human Gate/blocker exists.

The user-facing mental model is one autonomous AI. Internally it may compose many temporary roles. Fixed named "AI employees" are no longer the final architecture; existing AI Company workers, contracts, runtimes, and dashboards remain reusable execution capabilities and research infrastructure.

## Core rule

**One front door, dynamic internal team.**

A task does not select a permanent employee first. The planner identifies capability requirements, the team assembler maps those requirements to capabilities that actually exist, and the GoalDrivenLoop executes through the existing CapabilityRegistry and verification/safety boundaries.

The team is ephemeral. It exists for the goal/work item and can be different for the next goal.

## Control flow

1. Goal
2. Definition of Done / success criteria
3. Current State
4. Relevant context partition
5. Intent inference
6. Planner produces capability requirements and the next bounded action
7. Dynamic capability team assembly
8. Child Goal Gate when decomposition creates material child work
9. Execute through CapabilityRegistry
10. Verify independently from execution where practical
11. Repair / strategy pivot within retry budget
12. Deliverables
13. Decisions
14. Write-back to persistent work state / memory
15. Repeat only through an explicitly scheduled bounded cycle

## Contracts retained from the current system

- `GoalDrivenLoop`: bounded goal execution and stop conditions
- `CapabilityRegistry`: real capability discovery/execution boundary
- risk policy and Human Gates: unchanged
- Compass Work-State: goal/current-state/child-work/write-back continuity
- GAI memory/world model/research loop: retained as learning and evaluation layers
- AI Company jobs/providers/workers: retained as capabilities, not as the top-level product metaphor

## Dynamic team contract

`assembleCapabilityTeam()` receives:

- the current goal
- a catalog of capabilities that are actually available
- optional explicit requirements produced by planning/reasoning

It returns:

- deterministic role-to-capability assignments
- missing required capabilities
- a blocked flag when the goal cannot safely proceed

It must never fabricate a capability. Missing capability is data, not a reason to pretend success.

Goal-text matching is deliberately lightweight. It supports simple deterministic routing, while the higher-level planner can provide explicit requirements for complex goals. This keeps the assembler testable and model-agnostic.

## Context partitioning

Each temporary role should receive only the context needed for its work item. The global goal, constraints, relevant decisions, dependency outputs, and required evidence are shared; unrelated conversation/history should not be copied into every role.

This reduces context pollution and makes verification/reproduction easier.

## Definition of Done

A goal is complete only when:

- all required deliverables exist
- verification passes
- unresolved blockers are empty
- required write-back is persisted
- any material child goals are complete or explicitly blocked
- no Human Gate remains outstanding

"The model produced an answer" is not completion.

## Design consequence

The system may eventually use dozens or hundreds of specialist roles, but those are runtime compositions rather than a permanent organization chart. The invariant is not the number of agents. The invariant is that one user goal can recruit the minimum sufficient set of capabilities and drive the work to verified completion.

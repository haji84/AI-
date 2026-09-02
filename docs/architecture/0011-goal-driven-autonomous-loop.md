# ADR 0011: Goal-driven autonomous execution loop

Status: Proposed by Issue #80

## Decision
The AI Software Company uses a bounded goal-driven loop as the control plane for autonomous work.

The loop is:

`Goal -> State -> Context -> Intent inference -> Next action -> Risk policy -> Execute -> Verify -> Write back -> Next cycle`

A cycle is finite. Another cycle occurs only when the runtime, task system, user, or approved automation explicitly schedules it.

## Goal
A goal contains a title, optional description, success criteria, and constraints. The goal remains stable until explicitly replaced or completed.

## Context
Context is collected through capability adapters. Examples include GitHub, conversation/library files, public web research, mail, calendar, and local runtimes. These are optional capabilities. The orchestrator must not assume a connector is present and must not fabricate data from an unavailable connector.

Context collection follows least-context rules: read only what is relevant to the current goal and next action.

## Intent inference
The system may infer likely intent from:
- the explicit goal
- constraints
- stable preferences
- recent decisions
- retrieved task context

Inference must produce a confidence score and evidence. It is a working hypothesis, not mind-reading. Low-confidence or conflicting intent must not authorize risky action.

## Planning
The planner proposes one smallest useful next action. Each action declares a capability and risk metadata.

## Human Gate policy
Human approval is mandatory for actions that are high risk, irreversible, destructive, production deployment, secrets/permissions/billing changes, external publication, or unresolved security/license risk. Policy is evaluated before execution.

Low-risk reversible analysis and repository work may proceed automatically when the repository workflow allows it.

## Execution and verification
Execution is performed through a bounded capability executor. The executor never receives unrestricted authority by default. Every successful execution is verified before the cycle is considered successful.

## Write-back
Every cycle writes a structured record containing:
- inferred intent and evidence
- proposed action
- execution result
- verification result
- stop reason
- next action

Compass remains the persistent handoff layer when available. `PROJECT_STATE.md` remains repository governance state and is updated only through the normal issue/branch/PR workflow.

## Stop conditions
A cycle stops when any of the following is true:
- goal is complete
- project is paused
- blocker exists
- Human Gate approval is required
- retry budget is exhausted
- planner has no valid next action

No silent infinite loop is allowed.

## Scheduling
Continuous progress requires an external trigger such as a user turn, scheduled task, GitHub event, CI workflow, Codex automation, or another approved runtime. The core orchestrator deliberately does not pretend that a chat session continues running after execution ends.

## Initial implementation
`src/orchestrator/goal-loop.ts` defines the bounded core interfaces and cycle runner. `src/orchestrator/intent.ts` provides an evidence-based deterministic baseline for intent inference. Providers can later bind these interfaces to Compass, GitHub, files, web, mail, calendar, and local execution runtimes without changing the safety policy.

# GAI Work-State Protocol

Status: Implemented by Issues #464 and #466

## Decision
The GAI runtime uses a provider-neutral Work-State layer so autonomous work can continue across sessions, workers, and devices without depending on chat history or any specific task-management product.

The protocol adopts useful ideas from the reviewed Windows AGI workspace and current Addness-style agent operation while explicitly rejecting product dependency and seminar/gameification behavior.

## Adopted concepts
- stable Goal identity
- explicit Definition of Done
- Current State
- Decisions and rationale
- Deliverable / artifact references
- structured Write-back after execution
- Child Work Item gate before material mutation
- shared work context separated from agent-local context
- resume / handoff snapshots
- explicit blocked / verifying / completed state

## Rejected concepts
- required Addness API, CLI, SDK, MCP, token, or endpoint
- product-specific source-of-truth assumptions
- seminar onboarding levels and staged demonstrations
- fixed demo task sequences
- marketing claims treated as architecture requirements

## Boundary with existing GAI components
Work-State does not replace G1 memory, G2 world model, G3 planner, G4 closed loop, or G7/G8 self-improvement and continual learning.

Work-State answers:

`What are we doing, where are we now, what changed, what remains, and what evidence exists?`

Memory answers:

`What verified reusable knowledge should influence future tasks?`

World Model answers:

`What do we predict about the environment and outcomes?`

Only verified reusable lessons are promoted from Work-State events into semantic or procedural memory.

## Core lifecycle

`Goal -> Work-State -> Plan -> Child Work Item -> Risk policy -> Execute -> Observe -> Verify DoD -> Write-back -> Handoff/Next action`

A completed executor action is not equivalent to a completed goal. Required DoD items must be supported by verifier evidence or an explicit policy/owner waiver.

## Child Work Item gate
Before a material mutation, an action must be bound to an active Work Item containing:
- objective
- Definition of Done
- affected scope/resources
- execution approach
- verification method

Small reversible operations may share an existing scoped Work Item. The system should not create meaningless child-goal spam.

## Permission model
The architecture prioritizes useful automation. Broad command surfaces such as PowerShell, pwsh, shell, npm, package managers, git, and local filesystem editing may be enabled when needed.

Command names are not the primary safety boundary. Risk is determined by actual side effect and scope.

### R0 Read / inspect
Autonomous.

### R1 Reversible local work
Generated files, tests, builds, local tools, scoped workspace edits. Autonomous.

### R2 Consequential but reversible
Existing code/config edits, branches/commits, controlled drafts. Autonomous when bound to valid Work-State/DoD and a verifier path.

### R3 High-impact external mutation
Production changes, permissions, secrets/security policy, substantial deletion, billing/paid actions, or external publication. Requires an applicable approval policy unless the owner has explicitly delegated that exact class.

### R4 Destructive / irreversible / governance weakening
Broad unrecoverable deletion, formatting, disabling audit/protection controls, or unbounded secret exposure. Generic automation permission never authorizes this class.

Thus `powershell:*` may be available while destructive effects remain controlled by policy, scope, verification, and audit trail.

## Persistence
The protocol remains provider-neutral through `WorkStateStore`.

`CompassWorkStateStoreAdapter` is the default runtime adapter. It stores versioned Work-State envelopes and a bounded event history inside Compass state without adding a product-specific dependency to the domain contract.

## Runtime integration
Both local and cloud autonomy entry points use `createWorkStateIntegratedGoalLoop`.

The integration layer:
- injects a compact Handoff Snapshot into planning context before each cycle
- initializes Work-State deterministically from the Goal when no state exists
- enforces the Child Work Item mutation gate before executor invocation
- records current state, artifacts, decisions, blockers, risk class and next action after each cycle
- converts verified action evidence into explicit DoD results when the action declares which DoD items it satisfies
- can close the bound Child Work Item after successful verification
- appends a bounded audit event for each Goal Loop cycle

This keeps the existing planner, verifier, memory, world model, risk policy and capability system intact rather than replacing them with a new monolith.

## Handoff
A Handoff Snapshot includes only information required to continue:
- goal identity/objective
- current state/status
- remaining DoD
- relevant decisions
- artifact references
- blockers
- next action
- updated timestamp

Secrets, private reasoning, caches, and unnecessary agent-local context are excluded.

## Completion rule
A goal may enter `COMPLETED` only when:
- every required DoD item has passed or been explicitly waived
- no blocker remains
- completion evidence is written back

## Implementation
- `src/orchestrator/work-state.ts`: provider-neutral domain, DoD evaluation, mutation binding, status derivation and handoff snapshots
- `src/orchestrator/work-state-integration.ts`: Goal Loop context/executor/write-back integration and integrated-loop factory
- `src/orchestrator/compass-work-state-store.ts`: default Compass persistence adapter
- `scripts/autonomy-run.ts`: local runtime integration
- `scripts/autonomy-cloud-run.ts`: cloud runtime integration
- `tests/work-state.test.ts`: domain tests
- `tests/work-state-integration.test.ts`: integration and persistence tests

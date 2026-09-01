# Compass MCP v1 Architecture

## Objective
Provide a local, paid-service-free MCP server that preserves project goal, state, next action, verification, and task history across Codex sessions and future AI agents.

Invariant loop:

`GOAL -> STATE -> RETRIEVE -> PLAN -> ACT -> VERIFY -> WRITE BACK -> NEW STATE`

## Scope
Compass v1 is intentionally small. It does not orchestrate agents, host a web UI, synchronize with cloud services, or replace repository governance state.

## Boundaries
- Runtime: existing TypeScript/Node toolchain.
- MCP: protocol-compatible JSON-RPC tool surface implemented locally without a new runtime dependency in v1.
- Transport: local stdio.
- Persistence: local SQLite database using Node.js built-in `node:sqlite`.
- Application DBs: untouched.
- `PROJECT_STATE.md`: remains the repository governance source required by `AGENTS.md` and is never silently overwritten by Compass.
- Compass DB: source of truth only for Compass goal/state/history.

The initial issue proposed the official MCP SDK. During implementation, the v1 boundary was narrowed to a dependency-free stdio adapter because the required MCP behavior is small and testable, the repository already has the necessary Node runtime, and this avoids adding a package solely for transport plumbing. Adopting the official SDK remains a future-compatible option if protocol breadth or maintenance needs justify it. This decision does not relax the required MCP behavior or Codex interoperability requirement.

## Required tools
1. `get_goal`
2. `set_goal`
3. `get_state`
4. `update_state`
5. `get_next_action`
6. `set_next_action`
7. `record_verification`
8. `write_back`
9. `get_history`

All read tools are side-effect free. All write tools validate input, persist timestamps, return persisted state, and surface errors.

## MCP stdio contract
The server must support the minimum local tool flow needed by Codex:
- `initialize`
- notifications without responses
- `ping`
- `tools/list`
- `tools/call`
- JSON-RPC parse, invalid-parameter, and method-not-found errors

The server advertises a tools capability and returns tool results as MCP text content. Tool failures are surfaced with `isError: true` rather than hidden.

## Persistence model
Minimum logical tables:
- `goal`
- `state`
- `verification`
- `history`

Structured list/object fields may be JSON text in SQLite for v1. Prefer a simple schema over generic abstraction.

## Atomic write-back
`write_back` is the core continuity operation and must execute in a single SQLite transaction. It may:
- append a verification row when supplied;
- append one history row;
- patch current state;
- set or clear the next action.

If any sub-operation fails, the entire transaction rolls back. State/history reads used to construct the returned successful result occur before commit so an error cannot occur after commit and then be mistaken for a rollback-capable failure.

## Runtime data path
The database path is configurable by environment variable. A repository-local default may be used for development only when the directory is gitignored. Starting the MCP server must not modify tracked files.

## Agent usage contract
Before work:
1. `get_goal`
2. `get_state`
3. `get_next_action`
4. retrieve only relevant context
5. plan

After work:
1. verify
2. optionally `record_verification`
3. `write_back`

Installing the MCP does not itself force an agent to follow this loop. Agent instructions must explicitly require it.

## Failure semantics
Return concise actionable errors for invalid inputs, unavailable DB paths, invalid history limits, malformed JSON-compatible fields, invalid verification states, transaction failures, malformed JSON-RPC, and unknown methods. Do not hide or downgrade failures.

## Test strategy
Use temporary databases only. Cover first-run initialization, persistence across reopen, patch preservation, next-action clear/set, verification validation, atomic rollback, history ordering/limit, exact nine-tool registration, and an end-to-end stdio flow covering initialize, tool listing, tool call, and persisted read-back.

## Deferred
- synchronization with `PROJECT_STATE.md`
- GitHub issue/PR linking
- semantic context search
- remote hosting
- authentication/OAuth
- multi-project and multi-user tenancy
- autonomous scheduling/orchestration
- adopting the official MCP SDK if future protocol breadth warrants it

These are future issues after the v1 contract is proven.

# Unified AI Creator Studio

Phase 1 application foundation for a guarded AI software-development
organization.

## Operating model
ChatGPT/Work handles planning and research. Codex handles implementation. GitHub is the source of truth. GitHub Actions provides deterministic quality gates. Human approval is required for merge, production deployment, destructive migrations, secrets, billing, and destructive changes.

## Start here
1. Read `AGENTS.md`.
2. Read `PROJECT_STATE.md`.
3. Read the assigned GitHub issue.
4. Work only inside the issue scope.
5. Open a PR and stop at the human gate.

## Toolchain

- Node.js 24 LTS (`>=24.19.0 <25`)
- pnpm 11.19.0
- Next.js 16 App Router
- React 19
- TypeScript
- ESLint
- Node.js built-in test runner

## Local development

```text
pnpm install
pnpm dev
```

The development server is available at `http://127.0.0.1:3000`. Verify the
running application in another terminal:

```text
pnpm healthcheck
```

The health endpoint is `GET /api/health` and returns HTTP 200 with
`{ "status": "ok" }`.

## Compass MCP v1

Compass is a local persistent goal/state handoff service for Codex and future
agents. Runtime data defaults to `.compass/compass.db` and is intentionally not
tracked by git. Set `COMPASS_DB_PATH` to use another local database path.

Start the local stdio server directly:

```text
pnpm compass:mcp
```

The v1 tool surface is:

```text
get_goal
set_goal
get_state
update_state
get_next_action
set_next_action
record_verification
write_back
get_history
```

The intended work loop is:

```text
GOAL -> STATE -> RETRIEVE -> PLAN -> ACT -> VERIFY -> WRITE BACK -> NEW STATE
```

Installing the MCP server does not force an agent to follow that loop. Agent
instructions must explicitly require reading goal/state before work and writing
back verified results after work.

### Register Compass in Codex

Codex supports local STDIO MCP servers started by a command. Use absolute paths
for a user-wide registration so the server does not depend on the current shell
directory. Replace the placeholders below with local paths and do not commit
machine-specific paths.

```text
codex mcp add compass --env COMPASS_DB_PATH=<absolute-db-path> -- node <absolute-repo-path>/src/compass/server.ts
codex mcp list
codex mcp get compass
```

Restart the Codex client after adding the server. Remove the registration with:

```text
codex mcp remove compass
```

`PROJECT_STATE.md` remains the repository governance state required by
`AGENTS.md`. Compass SQLite is the source of truth only for Compass goal/state
and handoff history. Compass v1 does not silently synchronize or overwrite
`PROJECT_STATE.md`.

## Standard commands

| Purpose | Command |
| --- | --- |
| Install | `pnpm install` |
| Develop | `pnpm dev` |
| Lint | `pnpm lint` |
| Test | `pnpm test` |
| Build | `pnpm build` |
| Production start | `pnpm start` |
| Health check | `pnpm healthcheck` |
| Compass MCP | `pnpm compass:mcp` |

## Application structure

- `src/app/`: application pages and layout
- `src/app/api/`: backend Route Handlers
- `src/compass/`: local Compass persistence, tool contract, and stdio adapter
- `tests/`: Node.js tests
- `scripts/`: operational verification scripts

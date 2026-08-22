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

## Application structure

- `src/app/`: application pages and layout
- `src/app/api/`: backend Route Handlers
- `tests/`: Node.js tests
- `scripts/`: operational verification scripts

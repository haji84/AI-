# ADR 0002: Phase 1 Application Foundation

Status: Accepted for Phase 1

## Context

Phase 1 needs the smallest executable application shell that establishes one
reproducible contract for local development and CI. Product features, data
storage, authentication, media providers, and deployment are outside this
decision.

## Decision

- Use Node.js 24 LTS with pnpm 11.19.0.
- Use a single Next.js 16 App Router application with React 19 and TypeScript.
- Keep frontend pages under `src/app/` and backend HTTP handlers as Next.js
  Route Handlers under `src/app/api/`.
- Use ESLint for static checks and the Node.js built-in test runner.
- Expose `GET /api/health`, returning HTTP 200 and `{ "status": "ok" }`.
- Validate install, lint, test, build, production startup, and the live health
  endpoint in the existing `project-checks` CI job.

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

CI uses `pnpm install --frozen-lockfile` to enforce the committed lockfile.

## Alternatives considered

- A separate Vite frontend and Express or Fastify backend was rejected because
  it introduces a second application process and additional dependencies.
- A monorepo was rejected because Phase 1 currently has only one application.
- A separate test framework was rejected because the built-in Node.js test
  runner covers the foundation contract.

## Consequences

The repository has one runtime, package manager, dependency graph, and build.
Future product models and integrations must be introduced by separately scoped
issues rather than anticipated in this shell.

## Rollback

Before merge, close the pull request. After merge, revert the foundation commit
through a new pull request without rewriting history.

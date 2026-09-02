# Autonomy trigger runbook

The autonomy runtime is always bounded. Trigger entrypoints start a finite run and never create an unbounded background worker.

## Runtime configuration

Compass uses `COMPASS_DB_PATH` when set, otherwise `.compass/compass.db`.

The live GitHub read client uses runtime-only configuration:
- `GITHUB_TOKEN`: optional token supplied by the operator/runtime. Never commit it.
- `GITHUB_REPOSITORY`: `owner/repo`, defaults to `haji84/AI-`.
- `GITHUB_API_URL`: defaults to `https://api.github.com`.

Without `GITHUB_TOKEN`, GitHub state returns `{ available: false, reason: "not_connected" }`. Access must never be fabricated.

## Manual event

```sh
pnpm autonomy:event -- --type=manual --id=manual-1 --summary="inspect current goal"
```

## Scheduled event

```sh
pnpm autonomy:schedule
```

This is suitable for a local scheduler, Codex automation, or another approved scheduler. The command itself performs only one bounded run.

## Repository-state event

```sh
pnpm autonomy:repository-event
```

A future webhook or GitHub Actions adapter may call this entrypoint after a pull request, issue, check, or push event. Event handling remains bounded and Human Gate rules still apply.

## Dry run

Use `pnpm autonomy:dry-run` when validating a planned capability execution without invoking its handler.

## Safety

This stage exposes read-only GitHub state. Merge, deployment, destructive changes, secrets, permissions, billing, publication, and external write actions remain Human Gates.

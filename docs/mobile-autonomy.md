# Mobile-first autonomy

The phone remains a control surface, but model reasoning is owned by Work/Codex. GitHub Actions is the remote execution, persistence, CI, verification, and bounded repository-operation host. It must not call a replacement model provider on its own.

## Control-plane flow

1. Work/Codex reads the explicit goal, repository state, issue, and required context.
2. Work/Codex produces one bounded plan envelope with `source: "work-codex"`.
3. `Mobile Autonomy` receives that envelope through the `work_codex_plan` workflow input for `run` or `resume`.
4. GitHub Actions validates and executes only the bounded plan through existing capabilities.
5. Verification and Compass state are written back and published in the workflow summary.
6. Merge, deployment, billing, secrets, permissions, and other Human Gates remain outside automatic execution.

If a run requires model reasoning and no valid Work/Codex handoff is supplied, the workflow fails visibly. It must not silently fall back to another model provider or return a misleading green no-op.

## From iPhone or Android

Open the repository in the GitHub mobile app or mobile browser, open **Actions**, choose **Mobile Autonomy**, then choose **Run workflow**.

Modes:
- `run`: execute a bounded plan supplied by Work/Codex.
- `pause`: persist `PAUSED` state.
- `resume`: clear the pause and execute a bounded Work/Codex plan.
- `status`: read and publish current persisted state without model reasoning.

The workflow summary shows status, pause state, blockers, verification summary, and next action in a mobile-readable view.

## Scheduled operation

The workflow wakes every six hours at minute 17 in `status` mode only. Scheduled GitHub Actions runs never perform model reasoning and never call an AI model provider. Planning/coding work is initiated by Work/Codex and handed to the bounded execution host explicitly.

## Persistence

`.autonomy-state/compass.db` is restored and saved through GitHub Actions cache using a unique per-run key and the `autonomy-state-` restore prefix. This allows state to survive ephemeral runners without committing the SQLite database to the repository. If no persisted goal exists yet, the cloud runner bootstraps a conservative repository-governance goal from the checked-out project context.

GitHub Actions cache is operational persistence, not archival storage. If durable audit-grade persistence becomes required, add a dedicated remote state backend behind the same state-store boundary rather than committing mutable state to `main`.

## Zero-additional-AI-API rule

Production runtime and workflows must not use direct OpenAI, Anthropic, Gemini/Google AI, GitHub Models, or Copilot CLI model paths. They must not add those provider API keys, SDKs, inference endpoints, or model permissions. Repository tests enforce this boundary.

GitHub access remains limited to the permissions needed for bounded repository work. Human Gate remains mandatory for merge, deployment, destructive operations, billing, secrets, permissions, and external publication.

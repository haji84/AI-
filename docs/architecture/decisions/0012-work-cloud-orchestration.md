# ADR 0012: ChatGPT Work cloud as the zero-extra-cost orchestration path

## Status
Accepted for implementation in Issue #109, pending Human Gate merge.

## Context
The repository's first cloud planner used GitHub Models, which returned HTTP 410 after that inference service was retired. A bounded Copilot CLI adapter was then added, but activating it in GitHub Actions would require additional Copilot permissions and could consume a separately metered Copilot allowance.

The owner requires a PC-less control path without activating additional paid API or Copilot usage. OpenAI's current product supports ChatGPT Work cloud on web and mobile, recurring Scheduled Tasks, and supported GitHub-connected event-triggered Work tasks for eligible plans. Codex cloud work runs in OpenAI-managed environments, while Work is the supported web/mobile cloud control surface for longer multi-step tasks and connected-app actions.

## Decision
Use ChatGPT Work cloud and Scheduled Tasks as the primary planning/orchestration layer for the zero-extra-cost path. The connected GitHub app is the repository action surface available to that layer.

The repository's GitHub-hosted Mobile Autonomy runner remains useful for state inspection, CI, verification, and bounded execution infrastructure, but it must not invoke Copilot CLI or another separately metered model provider by default.

`AUTONOMY_PLANNER_PROVIDER` therefore defaults to `work-cloud`. In this mode the in-repository planner returns a bounded inspect result that explicitly records that planning is external. Optional `copilot-cli` and legacy `github-models` providers remain available only through explicit configuration.

The Work-side goal loop must continue to obey `AGENTS.md`: read the goal/state, gather minimum context, perform at most a bounded low-risk reversible unit of work, verify it, write back evidence, and stop at Human Gates. It must never fabricate local-machine evidence.

## Consequences
- No Copilot permission or billing activation is needed for the default path.
- No OpenAI API key is introduced.
- A phone can remain the control surface while Work executes in the cloud.
- GitHub Actions no longer provides the default model brain; it is an execution and verification substrate.
- If Work/Scheduled Tasks are unavailable or paused, the repository runner fails closed into inspection instead of silently switching to a paid provider.
- Merge, deployment, secret, permission, billing, destructive, and other existing Human Gates remain unchanged.

## Operational note
A recurring ChatGPT cloud task may inspect `haji84/AI-` and advance at most one cloud-safe unit of work per run. GitHub pull request activity may also be used as a supported Work trigger when configured in the ChatGPT product. Neither path changes the requirement for human approval before merge to `main`.

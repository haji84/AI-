# Mobile-first autonomy

The phone remains a control surface. Chat, Work, and Codex are now first-class ingress sources into one goal-driven command layer. GitHub Actions is the remote execution, persistence, CI, verification, and bounded repository-operation host. It must not call a replacement model provider on its own.

## Control-plane flow

1. Chat, Work, or Codex receives the user's command and reads the explicit goal, repository state, issue, and required context available to that surface.
2. The source produces one unified JSON command envelope containing `source`, `command`, optional goal/conversation identifiers, and an explicit bounded `plan` when model reasoning is required.
3. `source` must be exactly `chat`, `work`, or `codex`.
4. `Mobile Autonomy` receives the same envelope through the `command_json` workflow input for `run` or `resume`.
5. The command router normalizes all three sources into one downstream execution contract before planning/execution.
6. GitHub Actions validates and executes only the bounded plan through existing capabilities.
7. Verification and Compass state are written back and published in the workflow summary.
8. Merge, deployment, billing, secrets, permissions, and other Human Gates remain outside automatic execution.

Example envelope:

```json
{
  "source": "chat",
  "command": "continue the current goal",
  "goalId": "optional-goal-id",
  "conversationId": "optional-conversation-id",
  "plan": {
    "kind": "inspect",
    "description": "Inspect current repository and Compass state"
  }
}
```

The same schema is used when `source` is `work` or `codex`. Source metadata never bypasses verification, capability policy, or Human Gates.

If a run requires model reasoning and no valid bounded plan is supplied, the workflow fails visibly. It must not silently fall back to another model provider or return a misleading green no-op.

## Roles of the three ingress surfaces

- `chat`: primary conversational command and goal ingress.
- `work`: general multi-step knowledge and artifact work ingress.
- `codex`: coding, test, and repository-work ingress.

These are different entry surfaces, not separate state machines. They converge before bounded execution and operate against the same goal-driven loop and Compass-backed state boundary.

## From iPhone or Android

Open the repository in the GitHub mobile app or mobile browser, open **Actions**, choose **Mobile Autonomy**, then choose **Run workflow**.

Modes:
- `run`: execute a bounded plan supplied through the unified Chat/Work/Codex command envelope.
- `pause`: persist `PAUSED` state.
- `resume`: clear the pause and execute a bounded unified command.
- `status`: read and publish current persisted state without model reasoning.

The workflow summary shows command source, command, status, pause state, blockers, verification summary, and next action in a mobile-readable view.

## Scheduled operation

The workflow wakes every six hours at minute 17 in `status` mode only. Scheduled GitHub Actions runs never perform model reasoning and never call an AI model provider. Reasoning work is initiated through Chat, Work, or Codex and handed to the bounded execution host explicitly.

## Persistence

`.autonomy-state/compass.db` is restored and saved through GitHub Actions cache using a unique per-run key and the `autonomy-state-` restore prefix. This allows state to survive ephemeral runners without committing the SQLite database to the repository. If no persisted goal exists yet, the cloud runner bootstraps a conservative repository-governance goal from the checked-out project context.

GitHub Actions cache is operational persistence, not archival storage. If durable audit-grade persistence becomes required, add a dedicated remote state backend behind the same state-store boundary rather than committing mutable state to `main`.

## Zero-additional-AI-API rule

Production runtime and workflows must not use direct OpenAI, Anthropic, Gemini/Google AI, GitHub Models, or Copilot CLI model paths. They must not add those provider API keys, SDKs, inference endpoints, or model permissions. Repository tests enforce this boundary.

GitHub access remains limited to the permissions needed for bounded repository work. Human Gate remains mandatory for merge, deployment, destructive operations, billing, secrets, permissions, and external publication.

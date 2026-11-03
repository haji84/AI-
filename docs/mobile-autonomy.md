# Mobile-first autonomy

The phone remains a control surface. Chat, Work, and Codex are now first-class ingress sources into one goal-driven command layer. GitHub Actions is the remote execution, persistence, CI, verification, and bounded repository-operation host. Direct replacement-model APIs remain prohibited by default; the only adopted exception is the bounded Groq Free Plan repair fallback at stage 7 described below.

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

- `chat`: primary conversational command and goal ingress. Repair stage 5 reuses the existing Chat surface inside the ChatGPT Project `自動化`.
- `work`: general multi-step knowledge and artifact work ingress. Repair stage 6 reuses Work inside the same ChatGPT Project `自動化` and is reached only after the earlier GORIQ/local/Chat stages fail.
- `codex`: coding, test, and repository-work ingress. Repair stage 8 uses Codex only after stage 7 fails or is unavailable.

These are different entry surfaces, not separate state machines. They converge before bounded execution and operate against the same goal-driven loop and Compass-backed state boundary.

For repair execution, Chat and Work must remain Project-scoped:
- Reuse the saved Chat/Work surface URL inside Project `自動化` when it exists.
- If a repair-specific Chat or Work surface does not exist yet, create/use it from inside Project `自動化`, then persist that Project-scoped URL for later reuse.
- Never fall back to a standalone root Chat/Work outside Project `自動化`.
- If Project `自動化` cannot be found or Project context cannot be confirmed, fail closed and continue to the next repair stage rather than creating an unscoped session.

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

## External AI API boundary

Production runtime and workflows must not add direct OpenAI, Anthropic, Gemini/Google AI, GitHub Models, Copilot CLI, or other replacement-provider model paths by default.

One narrow exception is adopted for autonomous repair stage 7:
- Provider: Groq.
- Plan: Free Plan only.
- Endpoint: `POST https://api.groq.com/openai/v1/chat/completions`.
- Default repair model: `qwen/qwen3.8-27b`.
- Credential on ZBook: one-time local entry through `GORIQ Groq設定`, validated against Groq, then protected with Windows CurrentUser DPAPI at `%LOCALAPPDATA%\GORIQ\secrets\groq.dpapi`.
- The key is decrypted only for the bounded Stage-7 child process and cleared immediately afterward; GitHub CLI and repository Actions secrets are not required.
- The plaintext key must never be written to prompts, logs, issues, commits, artifacts, or repository files.
- No automatic paid upgrade, billing activation, credit purchase, or plan change is permitted.
- Missing credential, Free Plan exhaustion/rate limiting, provider error, invalid response, or verification failure must fail closed and advance to repair stage 8 (Codex).
- Stage 7 may edit only the already-authorized repair paths and remains subject to the same lint, test, security, build, and scope verification as every other repair engine.

This exception does not authorize Groq for general GORIQ reasoning or scheduled autonomy. It is limited to repair stage 7.

GitHub access remains limited to the permissions needed for bounded repository work. Human Gate remains mandatory for merge, deployment, destructive operations, billing, secrets, permissions, and external publication.

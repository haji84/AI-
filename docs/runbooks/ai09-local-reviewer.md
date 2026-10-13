# AI-09 Reviewer: local read-only review worker (phase 1)

Issue: #1796. Existing role: `.github/agents/reviewer.agent.md`.

## Scope and independent boundaries

- Runs a separate **Reviewer role** from the implementation role, with an opt-in local Ollama model at `http://127.0.0.1:11434/api/chat`. No external AI APIs, billed tokens or endpoint overrides.
- Reads a bounded exact-commit `git diff` without changing files or running PR-provided code. The diff is **untrusted text**. Refuses missing ancestors, inconsistent HEAD, sensitive paths, missing Ollama and malformed model findings.
- Model output remains `AI_ASSERTED` advisory evidence, not machine proof. Passing AI-09 output is `NO_ACTIONABLE_FINDINGS`, **never `APPROVED`** in GitHub. A local model, role name or separate process alone does not prove a second authenticated GitHub reviewer or satisfy branch protection.
- No GitHub write, PR merge, permission/credential changes, approval bypass, host stops, deployment, workflow permission changes or production edits.

## Opt-in local operation

From a local checkout of the exact PR head, using Node.js 24.19+ and an already installed Ollama model:

```sh
node scripts/goriq-ai09-review.mjs --base <40-hex-base-commit> --head <40-hex-PR-head-commit> --maker Builder --model qwen2.5-coder:3b
```

The CLI outputs a single JSON record containing reviewer ID, base/head SHA, patch SHA-256, changed paths, findings and blockers. Its `githubApprovalSatisfied`, `independentGitHubAccountVerified` and `mergeAuthorized` fields are always false. Blocked/inconclusive/findings outcomes exit nonzero.

**CI:** `node --test tests/ai09-local-reviewer.test.mjs`, plus normal `pnpm lint`, `pnpm test`, `pnpm test:p8-security`, `pnpm build`. These checks validate the software contract only. Actual local-model inference on ZBook/MacBook requires separate observed runtime evidence.

## Next stage (not activated)

Automatic triggering on PR changes and posting advisory review comments would add workflow and/or permission behavior. That requires a separately governed change and appropriate Human Gate before modifying `.github/workflows/**` or API scopes. High-risk changes, self-authored approvals and AI-inferred evidence never override QA, security checks, independent reviewer requirements or owner gates. A future orchestrator must persist exact-commit review evidence, detect stale reports after new pushes and bound retries.

`COMPASS_WRITE_BACK: unavailable` if Compass cannot be reached. The issue/PR remains the repository-native handoff.

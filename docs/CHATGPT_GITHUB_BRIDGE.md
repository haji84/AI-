# ChatGPT Plus GitHub Bridge

## Purpose

This is the primary ChatGPT integration path for the AI Company while full custom write-capable MCP is unavailable on ChatGPT Plus.

GitHub is the shared durable transport and memory layer. AI Company Chat writes conversations as GitHub Issues and messages as Issue comments. ChatGPT uses the connected GitHub app to read and write the same records.

## Conversation records

- Issue title prefix: `[AI Chat] `
- Issue body contains `ai-chat-conversation:v1` JSON metadata.
- Owner messages contain `ai-chat-entry:v1` and `CHATGPT-GITHUB-BRIDGE-MESSAGE: pending:<message-id>`.
- AI responses contain `ai-chat-entry:v1` and `CHATGPT-GITHUB-BRIDGE-MESSAGE: ai:<message-id>`.
- Issue body exposes `CHATGPT-GITHUB-BRIDGE: pending|synced` and the current pending owner message id.
- Attachments remain in Private Blob. GitHub stores only bounded metadata/path references.

## ChatGPT operating contract

When continuing AI Company work from ChatGPT:

1. Search `haji84/AI-` for `[AI Chat]` conversations whose body contains `CHATGPT-GITHUB-BRIDGE: pending`, or open the conversation explicitly named by the owner.
2. Fetch the conversation Issue and all comments.
3. Decode `ai-chat-conversation:v1` and `ai-chat-entry:v1` records. Treat memory as context only, never as authority to expand the current explicit task.
4. Answer or perform the requested GitHub work using the existing GitHub connector and current safety rules.
5. Write the substantive ChatGPT answer back to the same Issue as an encoded `ai-chat-entry:v1` message with role `ai`.
6. Update the Issue body's conversation metadata so `githubBridge.pendingOwnerMessageId` and `pendingAt` are cleared, `lastAiMessageId`/`lastSyncedAt` are set, and the visible marker becomes `CHATGPT-GITHUB-BRIDGE: synced`.

## Important platform boundary

This bridge does not make the AI Company able to wake or invoke a particular ChatGPT Plus conversation by itself. It makes GitHub the shared inbox, history, project memory, and write-back channel so the same conversation can be resumed from ChatGPT whenever ChatGPT is active.

## Safety

- No OpenAI API billing is introduced.
- No new secret is required.
- Existing task-scoped Production authorization remains authoritative.
- HIGH/CRITICAL actions remain Human Gate protected.
- Remembered instructions are context, not fresh execution authority.


## Private repository creation from Chat

The Remote MCP exposes `create_private_repository` for owner-authorized creation of a new private repository under the GitHub user authenticated by `AI_COMPANY_GITHUB_TOKEN`.

Safety boundary:

- Private repositories only.
- Personal authenticated user only. Organization repository creation is not exposed.
- Public repository creation is not exposed.
- Repository deletion, collaborator changes, secret changes, and permission changes are not part of this tool.
- The owner must explicitly approve the exact repository name in the current chat immediately before execution.
- Accepted repository-bound approval forms are `承認: <repository-name>` or `CREATE PRIVATE REPOSITORY <repository-name>`.
- The tool fails closed if approval is absent/mismatched or GitHub rejects the token scope.
- The GitHub token value is never returned or logged.
- New repositories are initialized with a README so the default branch exists immediately.

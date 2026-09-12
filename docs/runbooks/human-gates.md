# Human Approval Gates

Human approval is mandatory before:
- merge to main when not already covered by an exact task-scoped owner completion authorization
- production deployment when not already covered by an exact task-scoped owner completion authorization
- database migration execution or destructive schema change
- secrets/credential changes
- permission changes
- paid service activation or billing changes
- external publication
- data deletion
- breaking API changes
- unresolved security or license risk

Agents must stop with `HUMAN_APPROVAL_REQUIRED` and **report before execution**:
- the exact action to be performed
- the exact target/scope
- why it is required now
- impact and rollback path
- evidence that led to the gate

For a single already-reported HIGH action, owner chat language such as `許可`, `承認`, `完成させて`, `最後まで完成させて`, or `任せる` may release that exact approval key and resume execution. The approval must never widen to another action, another task, another secret key, or a later run.

Fail closed rules:
- no pre-reported pending HIGH action: do not execute a standalone approval command
- more than one pending action: require disambiguation before execution
- missing/stale approval key: do not execute
- CRITICAL: chat approval cannot release it
- secret/credential value itself must not be written to Chat, GitHub, logs, or ordinary audit output

If the same kind of privileged operation becomes necessary again later, the agent must report it again **before** execution and wait for a fresh owner approval. Previous approval is not reusable.

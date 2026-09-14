# PAI unified autonomy wiring checkpoints

This temporary implementation note records the concrete wiring checkpoints used in PR #542.

1. Commander/CommandChat ingress must produce a goal + Definition of Done.
2. The shared autonomy path must evaluate existing delegated authority and risk policy.
3. Approved work must enter the existing JARVIS control-plane/task-queue implementation.
4. Direct device-task commands must remain backward compatible.
5. Completion/failure evidence must remain available to the verifier/recovery loop.
6. CI must pass before the draft PR is marked ready.

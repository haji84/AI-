# Codex shared autonomy implementation — Issue 1952

Authority: the owner's detailed 2026-11-26 request and https://github.com/haji84/AI-/issues/1952. Execute implementation and acceptance now; do not stop at this plan. Preserve all unrelated state and gates.

Design: use supported user-level Codex settings, compact AGENTS guidance and one discoverable workflow skill. Portable Node code supplies opt-in, bounded lifecycle hooks and a reversible installer. Existing project Goal/state remains canonical; a small JSON state is a fallback only for projects without a state mechanism. Existing canonical state may supply a read-only projection whose source hash is checked. Hooks never write project truth or read transcripts/credentials. Agent roles and hardware capacity are separate. Normal exact-hook trust is required; no trust bypass or managed-policy substitution.

Alternatives considered: instructions alone cannot enforce or prove lifecycle behavior; a new scheduler/Goal database would duplicate existing infrastructure. Native hooks plus a small adapter fit the request. Keep current permissions, models and billing unchanged.

1. Audit and baseline: compare installed version schemas, preserve existing config/guidance/hooks, existing repository governance and old stopped Compass state. Create an isolated feature checkout from current main; keep local backups private.
2. In parallel, implement controller and meaningful failing tests (session/turn binding; unrelated question disarm; interruption; dependency-aware unfinished work; evidence; continuation/time/no-progress caps; concurrent audit writes), and portable installer/preflight/templates with preservation/rollback tests.
3. Integrate: install only owned files plus precise supported config keys. Confirm valid config with installed runtime, no approval/sandbox/model/trust changes, small guidance and project-specific restrictions retained. Register useful roles without increasing actual runtime concurrency beyond safe admission.
4. Fresh-session acceptance: ordinary Goal prompts, no parallel instructions; independent artifact ownership, timestamped overlapping actual agents, functional tests, failed-worker isolation, second project and resume. Distinguish synthetic hook unit tests from real lifecycle tests. Use normal user hook review if untrusted.
5. Independent review, fix material findings, rerun affected checks; commit and push sanitized portable source/evidence to the existing GitHub task branch. Keep main/deployment untouched unless exact gates are met. Apply on reachable authorized machines only; document Mac hardware/trust constraints and deliver an installer rather than claim a fake PASS.

Review focus: trust bypass; broad config overwrite; stale/unscoped Compass; symlink/path escape; stop/cancel interference; forged or missing evidence; resource bounds; concurrent file races; new-session real versus synthetic evidence; credential leaks and dual-host availability.

Completion requires observed behavior and usable artifacts. Pending trust/hardware is an explicit unmet criterion, never a fabricated success.

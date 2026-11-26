---
name: autonomous-development
description: Use when an owner requests a nontrivial software build, fix, or development Goal, including resuming unfinished development across sessions. Excludes ordinary questions and consultations.
---

# Autonomous development

Read repository instructions and the authoritative Goal/requirements/state. Reuse the existing GitHub issue, requirements ledger, PROJECT_STATE, job store and resource lane. An unscoped Compass belonging to another Goal must stay untouched. The current user request authorizes its own work; no repeated process approval is needed for already authorized reversible implementation.

Map requirements to acceptance evidence and remaining tasks. Separate dependency chains from independent work. Read current usage with available native tools, then run `node "{{AUTONOMY_DIR}}/preflight.mjs" --cwd <root> --tasks <independent-task-count> --quota <remaining-percent>`; omit quota if unavailable. Pass `--session-cap <native-child-limit>` if the current native/project configuration is tighter than the helper's hardware ceiling. Choose children at or below its recommendation and tighter runtime/project limits. A zero recommendation means work alone or wait for the limiting resource, not bypass admission. Recheck after load, limits or phase changes. Use native subagents with explicit file/worktree ownership and focused contexts. Three registered roles are available: autonomy-implementer, autonomy-verifier and autonomy-diagnostician; logical specialisms are assigned in their task brief. Do not start an agent just to fill a slot.

For long development with lifecycle continuation, bind only after recognizing an authorized development/resume request:

`node "{{AUTONOMY_DIR}}/controller.mjs" bind --cwd <root> --state <relative-state-json> --session <session-id-from-SessionStart>`

Use a native canonical JSON state if it fits [state contract]({{AUTONOMY_DIR}}/state-contract.md). Otherwise export a small read-only projection under the existing ignored runtime/evidence directory with a source path and SHA256; update it after authoritative state changes. The hook validates its source hash and never edits project truth. Do not create a second editable task ledger for an established project. When no state mechanism exists, create `.codex/autonomy-state.json` as the single repo-owned Goal/task record. Track it with project source and link the GitHub issue when available. Read the contract only when binding is needed.

SessionStart supplies the current session ID. If hooks are untrusted or the ID is unavailable, use normal native hook review and continue within the user's task scope with explicit evidence/write-back; do not invent an ID or claim lifecycle enforcement is active. Every ordinary new user prompt disarms automatic continuation. Rebind for an authorized development continuation; never bind for a question. Interrupt saves a pause latch. A later explicit owner resume may rebind while keeping spent counters.

Implement and test owned parts concurrently, integrate verified parts continuously, and use an independent reviewer for material changes. Record timestamped starts/stops and actual functional checks. Failures stay in history; unaffected tasks continue. Investigate/replan when verified progress stalls. Stop controls cap repeated continuations, unchanged verified progress and elapsed time; they do not grant authority or substitute for native account limits. No unattended scheduler or paid API is installed.

Evaluate every acceptance criterion against artifacts and evidence, persist remaining work and next action, and finish only when the actual Goal is met. If a real authority, resource or platform limit remains, preserve it as an unmet criterion with an implemented safe fallback where possible.

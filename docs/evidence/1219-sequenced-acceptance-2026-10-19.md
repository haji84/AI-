# #1219 — signed acceptance and bounded successor Jobs

This increment connects criterion acceptance, persisted Job completion, successor creation and Goal remaining-criteria reporting. It extends Draft #1827 on #1826/#1824. It does not establish the independent physical verifier boundary or complete #1219.

## Trusted contract

The host supplies `GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE` and its exact-byte `GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256`. The manifest is outside every candidate workspace. The accepted Goal title, description, success criteria and constraints must match its `sequence.goalDigest`. Configuration is not derived from the Goal text, a model response or a candidate file.

The version 1 sequence declares an expiring task scope, risk, completion mode and at most 32 ordered Jobs. Each Goal criterion is assigned exactly once. Job IDs bind the Goal ID, entire sequence digest and declared Job key. The concrete adapter additionally binds the entire pinned manifest SHA as `executionContractDigest`, including acceptance hashes, workspaces and verifier pins. Existing Jobs cannot be silently adopted after configuration drift, mixed with legacy Jobs, reordered or skipped. A completed Job permits creation of only its next declared successor. This is bounded execution of an approved decomposition, not autonomous discovery of arbitrary new requirements.

`verified-local-artifact` is an explicit LOW-risk completion contract. It requires non-destructive/non-privileged classification, all required independent checks and criterion-specific acceptance. Protected operations still require the existing Human Gate. The default `release` path retains its original release conditions. The new local adapter rejects release-mode manifests rather than treating a missing release capability as authorization.

## Concrete runtime adapter

Each Job needs a distinct, existing detached Git worktree, receipt path, external public-key path and public-key SHA-256. This code creates no runtime keys, accounts, permissions, network rules, containers or worktrees. `GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED=1` and an already installed `GAI_LOCAL_MODEL_NAME` are required. The adapter uses only the selected local Ollama Builder and never falls back to 8796/8797 or an external model.

The initial adapter supports the existing `python_add_v1` profile and exact two-file allowlist (`tests/fixtures/goriq_goal_add.py` and `tests/fixtures/goriq_goal_add_test.py`). Both paths must be in the Job contract. General arbitrary-code execution is not enabled by this fixture.

For each criterion, `acceptance` explicitly binds the exact criterion ID and description to expected file SHA-256 values. The host first validates the existing signed receipt against the exact Goal/Job/Change Set, complete candidate identity, public key, freshness and required checks. A fixed subprocess re-reads the complete candidate; its identity must match the signed identity before expected file hashes can satisfy a criterion. This is an exact-file oracle, not a claim that arbitrary prose requirements are proved by passing repository checks.

Missing checks or criterion acceptance keep the durable candidate in VERIFYING. Completion and its acceptance evidence are committed together to the Job store. Reconstructed hosts do not rebuild completed Jobs. Only completed Jobs with matching persisted checks and acceptance can project criterion results into Compass WorkState; canonical requirement blockers, existing constraints and unfinished child work remain effective.

Broker receipt polling observes all manifest receipt paths. A file change only wakes an already accepted nonterminal Work Run; it does not create a Goal or grant authority. The executor validates the manifest, receipt and candidate again.

Sequence execution checks Compass PAUSED and existing/canonical blockers before calling the runtime. A pause stops the bridge after one invocation. The existing WorkRun contract represents this stop as BLOCKED with reason `paused`, preventing receipt polling or startup from resuming it automatically; no new persistence phase or database schema is introduced.

## Verification and physical limits

Regression tests use real temporary Git worktrees, JSON/SQLite persistence, actual bounded Python, mock Ollama responses and temporary fixture Ed25519 keys. They cover missing/stale/wrong acceptance, Goal/sequence drift, replay/order, protected gates, file tampering, public-key pinning and successor deduplication. Fresh object/process reconstruction is software restart evidence. Exact commands, counts, independent review findings and CI URLs are recorded on Issue #1219 when completed; no anticipated CI success is asserted here.

Local final source checks: **74 passed, 0 failed, 0 skipped** across the resident sequence/acceptance/progress tests, real Broker subprocess regression, existing restart/bridge tests and traceability/completion audit tests. `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`, full `eslint .` and `git diff --check` passed. The Windows invocation explicitly selected the already bundled interpreter with `GORIQ_LOCAL_TDD_PYTHON`; no Python installation was requested.

The Broker test demonstrated HTTP401 without owner authorization, HTTP202 with the fixture owner token, signed wait, an actual Broker process stop/start with changed PID, receipt wake, automatic successor generation, two total mock inference calls and final empty remaining criteria. The entire test used new temporary databases, worktrees, loopback ports and fixture keys; no production listener participated.

Independent cross-agent review found and drove regressions for three defects: the new early acceptance checkpoint unintentionally blocked legacy release gates; persisted stop conditions were checked after successor execution; and changing only an execution oracle could inherit old completion. Each was reproduced before its fix. Narrow re-review found no additional P1/P2. This is code review evidence, not a submitted human GitHub approval or independent physical execution.

The owner reported that Chat had already configured the VM connection. A bounded read-only search included the observed Chat working directory `C:\actions-runner\ZBook\AI-\AI-`. Accessible records did not establish the current SSH endpoint, authenticated mechanism or successful connection. The Oct16 diagnostic receipt reported `SshVerified=false`, `BootstrapVerified=false`, and `GuestExecutionVerified=false`; the Oct19 Runner documents repeated existing physical HOLD evidence. These older records do not disprove later Chat setup. The later Chat handoff body was not retrievable through the available tools.

At the read-only service check, existing listeners remained 8787/PID10068, 8796/PID33948, 8797/PID25144 and Ollama11434/PID12920. No protected service was restarted. AI-09 VM, prior worktrees, existing physical evidence, credentials, ACLs and network settings were preserved. No VMConnect/OCR/UAC loop was repeated.

Remaining physical gate: recover and verify the already established authenticated AI-09 connection and independent signer/container boundary, then run authenticated test-Broker intake with actual Ollama, actual independent six-check signing, restart and successor continuation. A Windows reboot remains a separate unverified physical event. Temporary fixture signing keys and fake check payloads cannot satisfy these gates. Any new credential, permission, network or container provisioning still requires its own approval. Draft integration remains governed by the formal handoff.

## Rollback

Revert this source increment as a unit, preserving stored Jobs, manifests, receipts and evidence. Do not resume sequence-bound Jobs with a legacy host or a changed manifest; the binding deliberately fails closed. No production or host configuration rollback is needed because this increment does not deploy or provision those resources.

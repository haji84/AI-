# Common device teaching and guarded replay — #734

Owner requested a platform-neutral feature, not a nubia-specific macro. Every Android/iOS/Windows/macOS/Linux profile can retain demonstrations/instructions in one local procedure library. Common goal names group device/model/common variants; exact platform/OS/app-version checks prevent blindly sharing steps.

## What is implemented

- `/jarvis/teach`: common procedure library, platform capability descriptions, manual teaching for all five platforms, completion conditions and replay history.
- Remote Assist `操作を教える`: start demonstration, record successful JARVIS-routed operations with before/after UI observations, finish/cancel, distinct reproduction test and verified execution with a per-run HTTPS URL parameter.
- Android records platform/model/OS/foreground app/version from the device, not caller claims. Unique resource IDs provide semantic tap targets. Screen structure/state hashes guard every step. Raw UI text, typed text, screenshots and full URLs are not persisted as learned steps. Unknown/ambiguous/sensitive actions become Human Takeover steps.
- Only narrowly recognized navigation targets and HOME/BACK/APP_SWITCH/HTTPS opening have an automatic adapter. Password/payment/deletion/publication/permission/login markers stop replay. Unrecognized tap labels and coordinate-only swipes remain manual; this is not a universal visual reasoning model.
- Reproduction must pass independently before the same variant/device/environment is executable. Selecting execution routes to the most specific compatible variant; drafts never inherit another variant's evidence. Other devices need their own verification even when the model matches.
- Local atomic JSON persistence (`JARVIS_TEACHING_PATH`, default `.jarvis/teaching.json`), step/run capacities and pre-input checkpoints. Restart preserves history and pauses uncertain runs. Inputs are never automatically retried after a transport failure. No database migration.

## Current boundaries

Windows/Mac/Linux/iOS teaching storage is usable; native observation/control adapters are NOT connected by this change. Their automatic replay is therefore unavailable, not falsely PLATFORM_LIMITED. The common `TeachingAdapter` contract is device-neutral and tests use explicit simulated adapters. iOS unrestricted control is not promised.

Direct touches on a physical device are not captured automatically. Demonstrations must use JARVIS Remote Assist; manual instruction entry is available otherwise. Uploaded video interpretation, model-driven screen reasoning, automatic spreadsheet fetching/multi-row scheduling, offline task execution and autonomous recovery of failed procedures remain follow-ups. URL parameters are consumed for one replay and not stored in procedure/history. Completion means the demonstrated screen sequence was reproduced, not proof of an arbitrary business outcome.

## Security and recovery

Owner authentication protects both teaching APIs. Active serial-bound controllable Remote Assist session protects observe/replay/record, and is checked again per adapter call. Gateway independently enforces bearer/serial allowlist plus expected screen/profile and safe semantic target before input. Session ending cancels recording. Failed audit admission prevents input. No automatic credential, permission, purchase, deletion or publication step is accepted from a demonstration.

Recorded instructions are personal data; repository ignores runtime `.jarvis/`. Do not paste passwords or secrets into manual notes. Storage corruption and capacity exhaustion fail visibly. This local file store is intended for the single ZBook process; multi-process writer coordination is not implemented.

## Verification

- Domain tests cover all-platform durable teaching, model/device/version selection, verified reproduction, per-device revalidation, mismatch/gates, restart/uncertain action, auth revocation, URL credential rejection and semantic target ambiguity.
- Adapter tests cover view-only/cross-device/ended session denial before gateway calls, recording hooks and duplicate-operation exclusion.
- Local full suite781/781, TypeScript, lint and build passed before the additional ledger requirements.
- No new physical teaching PASS: previous authorized runtime expired03:39:35Z and was not extended. Owner accepted the preceding video latency on the actual nubia/iPhone4G path; that is not evidence for teaching or all platforms.

Rollback: revert code/UI changes. Saved `.jarvis/teaching.json` is retained; do not delete personal procedures. No public port, paid API, model dependency, secret or OS permission change.

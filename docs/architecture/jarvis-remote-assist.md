# JARVIS Remote Assist

Parent product program: Issue #681, P3.

## Current capability boundary

The existing Android Remote Gateway is loopback-only by default, requires a bearer token, restricts ADB operations to an explicit serial allowlist, and supports on-demand screenshots plus bounded tap/swipe/text/keyevent/open-URL operations. Those primitives are Remote Assist building blocks, but screenshot refresh is not evidence of a continuous video stream and ADB control is not evidence of full device management.

P3 advances in layers instead of relabeling existing controls as complete live view.

## Owner-facing session contract

Manual Remote Assist actions pass through `/api/jarvis/remote`, which requires owner authentication. Before a manual screenshot/control action can be forwarded to the loopback Remote Gateway, the owner-facing API requires a bounded Remote Assist session:

1. `session-start` validates that the requested serial is in the gateway's authorized device list and currently usable.
2. The returned session is bound to exactly that serial and has a short idle expiry (10 minutes by default, capped at 30 minutes).
3. Manual `screenshot`, `tap`, `swipe`, `text`, `keyevent`, and `open-url` calls require the matching active session ID.
4. Activity renews the idle timeout. Cross-device reuse, expired sessions and ended sessions fail closed.
5. `session-end` ends control explicitly and first stops any active bounded recording for that session.
6. QA automation endpoints remain outside the manual Remote Assist session because they have their own bounded workflow contract and are not human remote control.

The loopback Remote Gateway continues to require its bearer token and serial allowlist. The session layer does not expose ADB directly and does not make the gateway public.

## Durable privacy-safe audit

Remote Assist lifecycle and forwarded manual actions are written to an append-only local JSONL audit at `.jarvis/remote-assist-audit.jsonl` by default. The path may be overridden only by host configuration through `JARVIS_REMOTE_ASSIST_AUDIT_PATH`; it is never supplied by a remote request.

The audit contract is deliberately privacy-minimizing:

- session created/touched/ended/expired events are durable
- manual forwarded actions record action name, outcome and HTTP status, not typed text or opened URL content
- recording events record recording ID, frame/byte counts and bounded stop reason, not image data
- detail keys associated with text, URL, token, secret, password, credential or authorization data are stripped before persistence
- audit retention is bounded by event count/file size and compacts to recent events
- the owner-authenticated `session-audit` route reads the durable audit, so process restart does not erase retained evidence
- if the session audit sink cannot persist a lifecycle/touch event, the session operation fails closed before the protected gateway action is forwarded

This is a local audit trail, not an external telemetry service. No paid logging provider is introduced.

## Capability labels

Capability labels are deliberately conservative:

- `VIEW_ONLY`: screen observation exists, control does not.
- `CONTROLLABLE`: observation and bounded remote input exist.
- `FULL_MANAGEMENT`: reserved for a separately verified management contract; current Android ADB Remote Assist does **not** claim this merely because ADB is connected.

The API enforces the capability, not only the UI. A `VIEW_ONLY` session may request screenshots and bounded screenshot-frame recording but cannot forward tap/swipe/text/keyevent/open-URL input. A connected, allowlisted Android on the current screenshot/input path is surfaced as `CONTROLLABLE`. A device that is not in a usable ADB state receives no usable Remote Assist capability from this path.

## Per-platform fleet capability presentation

The owner-authenticated `/api/jarvis/state` response enriches each registered fleet node with a conservative Remote Assist descriptor derived from the node's declared capabilities, current status and owner policy. `/jarvis/devices` presents that matrix for every registered platform.

The descriptor never invents a transport path:

- no `remote-view` declaration -> `UNAVAILABLE`
- `remote-view` without policy-approved `remote-control` -> `VIEW_ONLY`
- `remote-view` plus policy-approved `remote-control` -> at most `CONTROLLABLE`
- `FULL_MANAGEMENT` is never inferred from generic capability flags
- offline/disabled/locked/needs-human nodes keep their underlying capability label but are marked temporarily unavailable for current control
- iOS is always degraded to at most `VIEW_ONLY` by this generic fleet descriptor, even if a generic `remote-control` flag is present; unrestricted external iOS control requires a separately implemented and verified path
- cloud nodes are observation-only in this device-control model

This fleet-level descriptor is presentation and policy evidence, not proof that a given transport is physically working. Android ADB Remote Gateway sessions remain a separate, stricter serial-allowlisted runtime path.

## Console lifecycle and sufficiently-live refresh

The JARVIS console must explicitly start Remote Assist for the selected serial before any manual screen/control request is enabled. Every manual request carries the active session ID. Changing device clears the local session and attempts to close the previous bounded session; a session can never be reused for another serial.

The console may offer **画面自動更新** as a sufficiently-live convenience mode. Its current contract is intentionally narrow:

- screenshot polling interval: 2 seconds
- at most one screenshot request in flight
- polling runs only while the page is visible and the matching session is active
- session expiry/mismatch fails closed and stops refresh
- refresh is opt-in and stops when Remote Assist ends
- UI copy must call this screenshot refresh, not video streaming

This mode is software evidence for a bounded refresh UX only. It is not physical live-stream evidence.

## Bounded screenshot-frame recording

The current recording path is intentionally honest: it records a bounded sequence of PNG screenshots through the existing authenticated screenshot capability. It is **not** continuous video streaming and must be labeled `png-frame-sequence` by the API/UI.

`recording-start`, `recording-status` and `recording-stop` all require the same active serial-bound Remote Assist session. The recorder has these hard boundaries by default:

- default duration 30 seconds; maximum duration 60 seconds
- default frame interval 2 seconds; minimum 500 ms
- maximum 60 frames per recording
- maximum 8 MiB per PNG frame
- maximum 64 MiB total per recording
- at most one active recording per serial
- recordings stored below `.jarvis/remote-assist-recordings/<random-id>/` with a manifest and numbered PNG frames
- retained local recording directories bounded to the newest 10 by default
- stale `recording`/`stopping` manifests found after process restart are marked failed with `process-restart`, never presented as still active
- `session-end` requests recording stop before closing the Remote Assist session

Recording admission is audited before the first capture. Audit failure rejects admission with zero captures. Each frame rechecks the active session and observation capability before capture and before persistence; background capture does not renew session authority. The gateway request receives an abort signal, and the recorder races it against the remaining recording deadline. Owner stop aborts capture and the interval wait immediately. A late response from an adapter that ignores cancellation is discarded. Final audit/storage failures produce an explicit failed recording status instead of an unhandled background rejection. These safeguards are software-tested; they do not prove physical recording or network recovery.

Recording paths and filenames are server-generated. A remote caller cannot supply a filesystem path. This provides a supported evidence/recording path without adding ffmpeg, a paid service or a public media endpoint. A later product phase may add an owner-facing export/container format, but must not relabel this frame sequence as MP4/video until that implementation exists.

## Bounded multi-view

P3 also provides observation-first multi-view modes for authorized Remote Gateway devices:

- `split2`: at most 2 device tiles
- `split4`: at most 4 device tiles
- `fleet`: paged/windowed at 12 device tiles per page even when the registered fleet is 100 devices
- multi-view screenshot refresh interval: 4 seconds
- global screenshot/start/stop concurrency cap: 4
- each visible device receives its own bounded Remote Assist session; a session ID is never reused across serials
- one screenshot request may be in flight per tile, while the global concurrency cap prevents a screenshot storm
- polling pauses when the document is hidden
- expired/missing sessions fail closed per tile and stale/error state is shown instead of pretending the image is current
- mode/page/slot changes are disabled while the view is running; the owner ends the bounded view before changing its membership
- selecting a tile promotes its serial to the existing single-device Remote Assist surface, but does not reuse the multi-view session for manual input

Multi-view is deliberately not a 100-device simultaneous video wall. It is a bounded screenshot-monitoring surface intended to remain safe on the current ADB/HTTP gateway path. Required physical evidence is still separate from code/CI evidence.

## Human Takeover linkage

The control plane already has a separate Human Takeover lifecycle. The console may surface an inline takeover action beside Remote Assist only when the takeover `nodeId` exactly equals the selected Remote Gateway serial. It must not guess an identity mapping.

`続きやって` remains an explicit owner action that calls the existing takeover resolution path and resumes the waiting task. Ending a Remote Assist session must never silently resolve a Human Takeover.

## Security boundary

Remote Assist never changes the existing Human Gate policy. Pointing/tapping is not authority for purchase, credential/permission changes, destructive deletion, security/governance weakening or other protected operations. This session contract only bounds the already-existing non-destructive manual Remote Gateway primitives.

## Not yet complete

This foundation does not make P3 complete. The following still require separate implementation and evidence:

- broader Human Takeover -> Remote Assist identity linkage where node IDs and gateway serials differ, if an authoritative mapping is added
- physical evidence for single-view, multi-view, recording and manual control on each supported platform
- any true continuous/low-latency streaming or encoded-video implementation if retained as a product requirement
- Requirement Ledger reconciliation for already-merged P3 software evidence; physical-dependent rows must remain below VERIFIED until actual device evidence exists

Until those gates pass, the corresponding Requirement Ledger rows remain PARTIAL or MISSING. CI is not physical evidence.

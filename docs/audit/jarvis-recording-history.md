# JARVIS Remote Assist recording history

Parent: #681  
Original UI issue: #709  
Hardening: #714 / #718

## Goal

Expose the bounded local Remote Assist PNG-frame artifacts to the authenticated owner without turning the recording directory into a public file server or allowing corrupted local artifacts to exhaust the always-on host.

## Design

- Recording files remain under `JARVIS_REMOTE_ASSIST_RECORDING_DIR` or the recorder's local default directory.
- `JarvisRemoteAssistRecordingHistory` is a read-only view over persisted manifests and PNG frames.
- Recording IDs are validated before any path is resolved; callers never provide raw paths or filenames.
- `/api/jarvis/recordings` requires the existing owner session for list, frame retrieval and export.
- Export is a bounded JSON bundle containing manifest metadata and base64 PNG frames. Raw filesystem paths are never returned.
- Active `recording`/`stopping` artifacts are not replayed or exported. Completed, stopped and failed artifacts can be replayed when frames exist.
- Failed recordings with surviving frames are explicitly marked `partial` rather than being presented as successful recordings.
- Retention remains owned by `JarvisRemoteAssistFrameRecorder`; this feature does not add a second retention policy or another storage backend.

## Corrupted-artifact bounds

The history reader independently revalidates persisted artifacts before presenting them to the owner:

- manifest files: maximum 32 KiB
- PNG frames: maximum 8 MiB each
- frame count: maximum 60 and never greater than the manifest's `maxFrames`
- recording bytes: maximum 64 MiB
- frame interval: 500-5000 ms, matching the recorder contract
- statuses: only the recorder's known status enum
- timestamps: parseable, with `updatedAt >= createdAt` and `expiresAt >= createdAt`
- PNG data: standard 8-byte PNG signature required
- export: sequential bounded iteration; decoded aggregate bytes must not exceed the recording cap or the manifest accounting and must match `totalBytes` at completion
- directory scan: bounded to 256 inspected entries and fails closed if the dedicated recording directory exceeds that budget

File data is read through size-bounded file descriptors instead of unbounded `readFileSync` calls. Existing recording-directory and frame symlink/path-escape rejection remains in force.

## API failure boundary

Recording-history responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, including authentication and error responses. Only the recording-history domain's known safe errors are returned. Unexpected filesystem/runtime failures are collapsed to generic messages so host paths and low-level filesystem details are not exposed to the client.

## Verification

Software verification includes unit/source-contract coverage for:

- restart persistence, ordering, partial failure metadata and active-artifact behavior
- traversal rejection and platform-portable symlink escape coverage
- oversized and malformed manifests
- excessive frame count / recording byte declarations / invalid timestamps
- oversized PNG files and invalid PNG signatures
- aggregate export accounting mismatch
- bounded directory inspection
- owner-authenticated API wiring and no-store/nosniff response policy

## Evidence boundary

This hardening is CODE/UNIT/INTEGRATION evidence only. It does **not** constitute physical-device recording/playback evidence. RA-013 and the P3 physical exit gate remain open until a real supported device is recorded and replayed through the owner UI.

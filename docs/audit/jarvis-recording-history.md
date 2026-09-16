# JARVIS Remote Assist recording history

Parent: #681  
Issue: #709

## Goal

Expose the already bounded local Remote Assist PNG-frame artifacts to the authenticated owner without turning the recording directory into a public file server.

## Design

- Recording files remain under `JARVIS_REMOTE_ASSIST_RECORDING_DIR` or the recorder's local default directory.
- `JarvisRemoteAssistRecordingHistory` is a read-only view over persisted manifests and PNG frames.
- Recording IDs are validated before any path is resolved; callers never provide raw paths or filenames.
- `/api/jarvis/recordings` requires the existing owner session for list, frame retrieval and export.
- Export is a bounded JSON bundle containing manifest metadata and base64 PNG frames. Raw filesystem paths are never returned.
- Active `recording`/`stopping` artifacts are not replayed or exported. Completed, stopped and failed artifacts can be replayed when frames exist.
- Failed recordings with surviving frames are explicitly marked `partial` rather than being presented as successful recordings.
- Retention remains owned by `JarvisRemoteAssistFrameRecorder`; this feature does not add a second retention policy or another storage backend.

## Evidence boundary

The software path is covered by unit/source-contract tests for restart persistence, ordering, partial failure metadata, bounded frame access, traversal rejection, active-export rejection, owner-authenticated API usage and owner UI wiring.

This does **not** constitute physical-device recording/playback evidence. RA-013 and the P3 physical exit gate remain open until a real supported device is recorded and replayed through the owner UI.

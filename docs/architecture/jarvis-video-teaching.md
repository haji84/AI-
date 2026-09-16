# Local video teaching drafts — #734

The owner clarified that the earlier app screenshots were examples, and requested
a device-neutral video teaching feature. The product must not claim arbitrary
video understanding or universal device control.

`/jarvis/teach` accepts a browser-playable local video up to 512 MiB and three
hours. A local canvas compares at most 120 downsampled frames and proposes at most
50 screen-change timestamps. These are visual changes, not inferred taps or
verified task steps. Animations can produce false candidates and short actions
can be missed. A user can add timestamps, remove candidates, explain each action,
and confirm the description. Editing a description clears its confirmation.

Only confirmed descriptions and timestamps enter the existing manual procedure
form. The user then supplies device/platform/version and completion criteria and
saves through the existing owner-authenticated API. Stored steps remain gated
manual DRAFTs with no final-screen evidence or verified run. Original teaching
records are unchanged. The video and pixels are never uploaded or stored by the
server, and no AI provider is called. Candidates are in-memory until saved;
reopening the page requires reselecting the local video.

Limitations: automatic action semantics, OCR/model reasoning, grounding video
steps in live device elements, and non-Android control adapters remain unavailable.
Video annotation does not itself enable automatic replay. Existing live Android
teaching can separately collect safe actions and verify them on the same device.
No claim of all-app/all-device automation is made.

Tests cover bounded sampling including five-minute/three-hour clips, frame
comparison, invalid/unconfirmed/sensitive descriptions, chronological ordering,
durable manual draft storage and refusal to execute without verified observations.
These tests are not physical-device acceptance or video-model accuracy evidence.

Rollback: revert the video UI/helper changes. Existing personal teaching records
remain intact; no schema, credential, permission or billing changes are needed.

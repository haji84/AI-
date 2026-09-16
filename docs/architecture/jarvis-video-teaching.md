# Local video understanding and guarded replay — #734

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
records are unchanged. In the manual annotation path, video and pixels remain
in the browser. Candidates are in-memory until saved;
reopening the page requires reselecting the local video.

## Local AI path

The explicit AI button samples 12 ordered frames and sends them to the owner's
JARVIS host, not an external AI provider. Owner authentication and an 8MB streaming
body cap protect the endpoint. The host resizes images and calls only fixed
loopback Ollama with `qwen3-vl:2b-instruct`; redirects/cloud models are forbidden.
The runtime must already have that model installed. Images are processed in memory,
not persisted. A 120-second inference deadline, concurrency exclusion, bounded
images and output validation constrain resource use. Structured model output is
untrusted. Only existing safe navigation labels are accepted; unsupported/uncertain
actions fail visibly. No new payment, credential, permission or destructive actions.

The inferred plan is retained under the teaching store's private `video-plans`
directory (500-plan cap). A serial-bound Remote Assist session can ground it on
Android: compare the current screenshot to the inferred state, reobserve stable
UI/profile, resolve exactly one independently allowed navigation target by hashed
label, execute via existing Gateway guards, then verify the postcondition. Text in
images is data, not authority. Failure stops without resending input. Only a DRAFT
is learned from this first run; JARVIS automatically attempts a separate existing replay verification, which must pass
before device/version-specific execution is enabled. Session stop revokes later
inputs, including while model inference is pending.

The owner-facing AI button hands off analysis and replay: if exactly one authorized
device is connected, it is selected automatically and no intermediate Continue
buttons are required. With multiple devices the owner chooses the target. A changed
start screen stops the independent verification instead of inventing reset actions.
There is no hidden recurring schedule or unlimited replay.

Limitations: image sampling can miss short actions; VLM predictions can be wrong.
Typed text, swipes, arbitrary app controls and non-Android adapters remain unsupported.
Missing accessibility targets must not degrade to model-guessed coordinates. The
current physical Android has no enabled accessibility service and Chrome exposes
only its toolbar, so successful physical web-button replay is not yet verified.
No claim of all-app/all-device automation or completion is made.

Local model smoke (2026-09-16): three synthetic list/details/list images yielded
Details → Close and the correct completion state in 15.5 seconds with the actual
local model. Initial thinking variant returned empty JSON; instruct output without
schema returned unsupported labels; instruct plus JSON schema passed. This is model
evidence on a neutral fixture, not physical replay evidence.

Tests cover bounded sampling including five-minute/three-hour clips, frame
comparison, invalid/unconfirmed/sensitive descriptions, chronological ordering,
durable manual draft storage and refusal to execute without verified observations.
These tests are not physical-device acceptance or video-model accuracy evidence.

Rollback: revert the video UI/helper changes. Existing personal teaching records
remain intact; no schema, credential, permission or billing changes are needed.

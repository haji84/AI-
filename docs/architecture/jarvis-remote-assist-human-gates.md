# JARVIS Remote Assist Human Gate boundary

Parent: Issue #681 P3 / RA-021. Implementation issue: #699.

Remote Assist input and authorization are separate concepts.

A tap, pointer position, swipe or camera/hand gesture may express **where/how to interact with the current device UI**. It must never be treated as approval for a protected action. The policy engine therefore carries explicit interaction provenance for planned remote-control tasks.

`pointer` and `gesture` origins remain eligible for ordinary zero-cost, non-destructive remote control when the node policy allows remote control. If the same intent is marked destructive, external-publication, secret-access, permission-changing or paid, it fails closed and requires a Human Gate. For destructive/publication intent this remains true even when a node-level policy flag would otherwise allow that category: pointer/gesture provenance is not approval.

The owner-facing manual Remote Assist API is also intentionally narrow. It forwards only the bounded screenshot/input/open-HTTPS primitives already allowed by the Remote Gateway and does not mint a Human Gate approval token or rewrite task policy. Any higher-level workflow that crosses a purchase, destructive, credential, permission, billing, protected publication or security/governance boundary must pass through the existing Human Gate mechanism separately.

This contract does not claim that arbitrary third-party app UI can be semantically classified from raw screen coordinates. Risk classification belongs to the planned action/workflow. Coordinates and gestures are interaction signals, not authority.

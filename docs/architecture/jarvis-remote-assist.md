# JARVIS Remote Assist

Parent product program: Issue #681, P3.

## Current capability boundary

The existing Android Remote Gateway is loopback-only by default, requires a bearer token, restricts ADB operations to an explicit serial allowlist, and already supports on-demand screenshots plus bounded tap/swipe/text/keyevent/open-URL operations. Those primitives are useful Remote Assist building blocks, but an on-demand screenshot is not evidence of a continuous live stream and the existence of ADB primitives is not evidence of full device management.

P3 therefore advances in layers rather than relabeling the old controls as complete live view.

## Owner-facing session contract

Manual Remote Assist actions pass through `/api/jarvis/remote`, which already requires owner authentication. Before a manual screenshot/control action can be forwarded to the loopback Remote Gateway, the owner-facing API now requires a bounded Remote Assist session:

1. `session-start` validates that the requested serial is in the gateway's authorized device list and currently usable.
2. The returned session is bound to exactly that serial and has a short idle expiry (10 minutes by default, capped at 30 minutes).
3. Manual `screenshot`, `tap`, `swipe`, `text`, `keyevent`, and `open-url` calls require the matching active session ID.
4. Activity renews the idle timeout. Cross-device reuse, expired sessions and ended sessions fail closed.
5. `session-end` ends control explicitly. Session audit events are retained in bounded in-process memory.
6. QA automation endpoints remain outside the manual Remote Assist session because they have their own bounded workflow contract and should not be misrepresented as human remote control.

The loopback Remote Gateway continues to require its bearer token and serial allowlist. The session layer does not expose ADB directly and does not make the gateway public.

## Capability labels

Capability labels are deliberately conservative:

- `VIEW_ONLY`: screen observation exists, control does not.
- `CONTROLLABLE`: observation and bounded remote input exist.
- `FULL_MANAGEMENT`: reserved for a separately verified management contract; current Android ADB Remote Assist does **not** claim this merely because ADB is connected.

A connected, allowlisted Android on the current screenshot/input path is surfaced as `CONTROLLABLE`. A device that is not in a usable ADB state receives no usable Remote Assist capability from this path.

## Security boundary

Remote Assist never changes the existing Human Gate policy. Pointing/tapping is not authority for purchase, credential/permission changes, destructive deletion, security/governance weakening or other protected operations. This session contract only bounds the already-existing non-destructive manual Remote Gateway primitives.

## Not yet complete

This foundation does not make P3 complete. The following still require separate implementation and evidence:

- sufficiently-live refresh/streaming UX rather than manual screenshot refresh
- 2-way / 4-way / fleet thumbnail grid
- recording where supported and policy-approved
- explicit Human Takeover -> Remote Assist -> owner intervention -> `続きやって` resume linkage
- durable/auditable session history beyond process-local bounded audit where required
- per-platform capability presentation including iOS degradation
- physical evidence on each supported platform

Until those gates pass, the corresponding Requirement Ledger rows remain PARTIAL or MISSING. CI is not physical evidence.

# JARVIS security boundary and threat model

Parent product track: #681

Production autonomy is orchestration, not new authority. The coordinator does not implement a second approval policy and cannot grant permissions. Existing Goal Loop risk evaluation, task-scoped authorization, Human Gates, credential boundaries, worker/runtime security metadata, and verifier decisions remain authoritative.

## Protected assets

JARVIS treats the following as protected assets:

- owner identity and authenticated owner sessions
- worker identity, signing keys, capability grants, and device enrollment state
- task payloads, results, evidence, screenshots, recordings, and stored application data
- credentials, tokens, passcodes, private keys, and service configuration
- billing state, production deployment/publication authority, permission changes, and governance/security controls
- durable task state, verifier results, approval records, audit records, and recovery checkpoints

## Trust boundaries

Trusted components are limited to code and state that have passed the repository's configured controls and the explicit runtime authorities already granted to them. External text, browser content, model output, network input, worker messages, device telemetry, URLs, files, and user-supplied task payloads are inputs rather than authority.

A successful model response, planner proposal, executor result, or verifier summary cannot create new permission by itself. Authorization is derived from owner/session state, registered worker identity, task-scoped capability, policy evaluation, and Human Gate state.

## Owner and session authentication

Owner-only routes must fail closed when the owner secret is not configured or when the owner session is invalid. Session cookies are HTTP-only and use SameSite strict; production cookies must use Secure transport. Owner authentication must not be inferred from page visibility, local UI state, model output, request text, or worker identity.

Session handling is a separate control from worker authentication. Compromise or acceptance of one must not silently satisfy the other.

## Worker identity, signing, freshness, and replay protection

Worker requests/results must be bound to the enrolled worker identity and verified with the configured public-key mechanism before trusted mutation. Verification must reject revoked or mismatched identities, invalid signatures, timestamps outside the accepted freshness window, and reused nonces.

Nonce, replay, and clock-skew controls are fail-closed controls. Restart, retry, reconnection, queue replay, or durable recovery must not create an implicit bypass. A stale or replayed signed message remains invalid even when its payload would otherwise be allowed.

## Device allowlist and capability authorization

Enrollment establishes device identity but does not grant arbitrary capability. Execution must be limited to the registered device and the task-scoped capabilities required by the action. A device not on the allowlist, a revoked device, or a device missing the required capability must not receive protected work.

Capability claims from the worker are untrusted until matched against server-side enrollment and policy state. Device replacement or key rotation must preserve explicit proof/approval boundaries rather than silently inheriting trust from a similar label or device name.

## Private ingress and transport

Remote-control, broker, enrollment, and worker ingress are private by default. Loopback HTTP is acceptable only for same-host local service boundaries; non-loopback service endpoints must use HTTPS and the repository must not introduce a public unauthenticated control path as a convenience fallback.

Loss of private connectivity is an availability event, not authorization to weaken ingress policy. Offline/reconnect behavior may queue or resume eligible work, but must not widen who can reach or authorize protected operations.

## Remote Assist, recording, and privacy blackout

Remote Assist requires authenticated, capability-scoped control and auditability. Human Takeover remains an explicit safety surface and must not be hidden by presentation modes. Recording and screenshot flows must preserve session/capability checks throughout capture and fail closed on revoked/expired state.

Privacy Blackout is a display-protection control for sensitive visible surfaces such as remote screens, fleet previews, and enrollment tokens. It reduces shoulder-surfing/screen-exposure risk but is not a substitute for authorization, storage protection, or audit controls. Privacy mode must not hide safety warnings or Human Takeover state.

## Secrets and logs

Credentials, private keys, owner secrets/tokens, passcodes, session tokens, and equivalent sensitive material must not be committed to repository content or directly written to logs. Security findings should report location/rule metadata without echoing the matched secret value.

Static repository scanning is intentionally bounded and cannot prove that historical Git objects, runtime memory, operating-system logs, third-party observability systems, or external credential stores are clean. Those require separate operational evidence.

## Human Gates and no-paid-default routing

Production deployment/publication, billing/payment/purchase, destructive deletion, permission or credential changes, governance/security weakening, protected external publication, and other irreversible/protected actions remain approval-required under project policy.

A planner, model, voice command, UI shortcut, retry, verifier result, or worker cannot approve its own protected action. Pointer/gesture automation cannot manufacture approval. Paid or external-provider execution is not the default route and must not be selected silently merely because a free/local route failed or is unavailable.

## Verifier and fail-closed behavior

Verification is evidence, not authority expansion. Unverified or failed work must not be written back as a verified deliverable, certified Skill, or completed protected outcome. If a required verifier, audit control, policy check, signature check, or security dependency is unavailable, the protected path must block, wait, or require explicit recovery rather than silently treating the missing check as success.

Durable restart/recovery must preserve blocked, approval-required, waiting, and terminal states. Restarting a process is not a reset button for a failed security decision.

## Availability and recovery

JARVIS distinguishes availability from authorization. Connectivity loss, service restart, device reboot, queue recovery, and power recovery may affect whether work can continue, but they must not weaken authentication, signing, nonce/replay protection, Human Gates, capability authorization, or private-ingress policy.

Physical recovery claims require physical evidence. Simulated network/restart tests are CODE/UNIT/INTEGRATION evidence only and cannot be promoted to PHYSICAL completion.

## Residual limits and evidence boundary

This document defines the intended defensive boundary. It does not prove every control is operational in every deployment. Requirement-ledger status must still follow the evidence rules in the product specification: CODE/UNIT/INTEGRATION/SECURITY evidence cannot substitute for a requirement that explicitly needs PHYSICAL, RECOVERY, EXTERNAL, or HUMAN verification.

Research R1-R20 remains a separate track. Security evidence in the product track does not establish general intelligence or any AGI completion claim.

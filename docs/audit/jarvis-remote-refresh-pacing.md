# Completion-paced remote observation — #723

Parent #681; follows #721/#722. Owner clarified that the corrected cellular view catches up after several seconds rather than remaining permanently stale. The fixed 2-second timer added avoidable delay to capture, compression, transfer and rendering.

## Implementation

Request the next frame 100ms after the previous refresh completes. Permit one active polling call; the existing capture queue still coalesces manual refreshes. Retry failures after 2 seconds, suspend capture when hidden or while touch is active, and refresh on foreground return. Late results are not published during a touch gesture, preventing faster frames from remounting and cancelling the active drag. Native coordinates and session authorization are unchanged.

## Evidence

- Focused refresh/preview/gesture/console tests: 16 PASS.
- Full local suite: 759/759 PASS. Lint, TypeScript and production build PASS.
- Local physical authenticated PNG/JPEG paths, Home command, unauthenticated denial and ended-session denial rerun successfully.
- Capture/preview samples vary by screen: approximately 0.4–1.3 seconds on this host. A 100ms scheduling pause is **not** a 100ms end-to-end latency claim.
- Owner cellular perceived-latency retest pending. This remains screenshots, not low-latency video. USB backhaul remains in use.
- Local staging restarted with the existing owner code held only in memory and the original expiry 2026-09-16T03:39:35Z; no lifetime extension.

Rollback: revert #723 code. No data migration or permission change.

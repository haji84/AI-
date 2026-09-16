# Remote screenshot touch input — #716

Parent: #681. Owner priority: remote operation. Requirements: RA-007, RA-009, UI-026, UI-031.

The owner can tap or drag the displayed Android screenshot. Display coordinates map to the loaded image's native dimensions; a movement of 8 CSS pixels or more becomes a bounded swipe. Keyboard/assistive activation explicitly taps the center, as stated in the accessible label.

Input is cancelled on pointer cancellation, lost capture, blur, additional pointer, mismatched pointer, changed image geometry, outside release, invalid dimensions or duration over five seconds. Session/device/capability/screenshot changes remount the control and discard the pending gesture. Pointer-generated clicks do not issue a second tap. VIEW_ONLY remains disabled; touch-action is restricted only on an enabled remote screen.

The existing owner-authenticated, allowlisted, session-bound API handles commands. This change adds no transport, credentials, authority or Human Gate exemption. Existing fixed-direction buttons remain available.

## Verification

- `node --test tests/jarvis-remote-screen-input.test.ts`: six tests PASS, including scaled coordinates, edges, invalid data, cancellation, multitouch and duplicate completion.
- `pnpm lint`: PASS.
- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- `pnpm build`: PASS before the tracker extraction; final build recorded in PR checks.
- Physical phone-to-Android operation, browser touch behavior and cellular connectivity remain unverified. No PHYSICAL PASS or requirement completion is claimed.

## Follow-up and rollback

Exercise tap/swipe, context changes, multi-touch and keyboard activation through a real browser and an authenticated Android Remote Assist session. Revert the #716 commit to restore the previous click-only screenshot control; no persisted data or schema changes require migration.

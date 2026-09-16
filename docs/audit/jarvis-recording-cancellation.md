# Recording admission and cancellation — #707

Parent #681. Baseline `d00d4ca844b34785b16f2309d03eb284f7b3b34e`.

Reproduced failures before editing: rejected audit admission did not reject start; stalled capture exceeded the test deadline; late revoked authorization produced a completed recording. The previous adapter did not receive a cancellation context.

The recorder now audits admission before starting capture, accepts an abort signal in the capture adapter, bounds a stalled frame by the remaining recording deadline, and checks session/capability before capture and persistence. Owner stop interrupts capture and interval waiting. Late results are discarded, and final storage/audit failures become visible failed statuses. The route connects these contracts to its existing session manager and authenticated gateway fetch. No session renewal is granted by background capture.

Validation: new controlled-capture negative tests plus existing recording tests PASS; full suite 731/731 PASS, zero skips. Final lint/typecheck/build passed; CI #977 passed all required jobs before the ledger-only main integration. Simulated frames are UNIT evidence only, not PHYSICAL/RECOVERY.

Remaining: authenticated retrieval/playback/export, full HTTP integration, real-device recording and offline recovery. A non-cooperative adapter may retain its own pending promise, but it cannot cause the recorder to wait past its deadline or persist a late frame; the production fetch receives cancellation.

Risk LOW/MEDIUM; no new listener, credentials, permissions, paid service, schema or deployment. Rollback by reverting this issue's PR. Automatic fix attempts: 0 after initial implementation.

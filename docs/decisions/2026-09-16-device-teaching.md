# ADR: device-neutral teaching variants

Date:2026-09-16. Owner request / Issue #734, parent #681.

Use one procedure model and adapter interface for all devices. Retain device/model/common variant provenance and guard execution by actual platform, OS, app/version and screen observations. Teach success is not execution verification: only a separate guarded reproduction grants per-device execution eligibility. Changing instructions creates a new unverified variant.

Use a local atomic file store to avoid database schema changes. Save transition hashes and stable selectors rather than raw UI text/media/credential input. Password/unknown/high-impact operations stay manual. The Android adapter uses the existing owner-authenticated gateway and UI hierarchy; other native adapters remain explicit missing capabilities. Do not call simulated adapter tests physical evidence.

The first version intentionally pauses after uncertain actions or restart instead of resending. This trades automatic resume coverage for duplicate prevention. Spreadsheet input is a runtime URL parameter; accessing a connected spreadsheet is a separate integration requiring its actual URL/access.

See [implementation and limits](../architecture/jarvis-device-teaching.md).

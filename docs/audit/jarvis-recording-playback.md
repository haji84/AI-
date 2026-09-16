# Owner PNG playback — #709

Parent #681, RA-013 / UI-037 / OPS-018. Baseline main `92a136f9bf54b8c8960469c1624ec628acb08967`.

The Console now offers owner-authenticated recording history, frame selection and PNG download. The read-only endpoint never creates a recorder or changes recording status. It returns at most 20 summaries after inspecting at most 200 directory entries, omits session identifiers, validates manifests/frame indices, bounds reads to 32 KiB manifests / 8 MiB frames, rejects directory/file symlinks and path escapes, and applies private no-store and nosniff response headers. Invalid or concurrently updated records are visible as unreadable counts or explicit errors.

## Verification

- Four response/storage tests PASS: unauthenticated denial before storage access, owner history/download byte equality, malformed IDs/frame traversal/corrupt manifest/invalid PNG rejection, and directory symlink escape rejection.
- Full local suite 732/732 PASS, zero skips; lint, typecheck and production build PASS.
- Local browser at port 3097 with a synthetic one-pixel PNG and isolated test-only owner credential: unauthenticated history shows denial; authenticated history lists the fixture; selecting it displays a decoded image and disables previous/next at the one-frame boundary.
- Narrow viewport initially overflowed at 396 px panel width with 319 px viewport. Added minimum-width handling and bounded select width; screenshot recheck showed wrapped paragraphs and controls within the panel. A subsequent DOM measurement timed out, so no numeric post-fix width is claimed.
- PNG save link was clicked; response tests verify attachment headers and exact bytes. Browser download completion on disk was not independently inspected.
- Broker/Gateway were deliberately not running; their connection errors remained visible. This verifies local playback in isolation, not physical remote execution. No PHYSICAL/RECOVERY promotion.

## Remaining

Actual device recording/playback and network recovery still need evidence. Existing login redirected a 127.0.0.1 request to localhost, leaving that first host cookie behind; localhost login succeeded. This is a separate owner-access bug to repair, not hidden by the playback feature.

No new credentials, permissions, retention/deletion policy, schema, public service or paid API. The temporary test server was stopped. Rollback: revert this PR. One visual correction after initial implementation.

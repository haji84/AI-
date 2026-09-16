# #852 unified enrollment and Wi-Fi Remote Assist

Date: 2026-09-17 JST. PR: https://github.com/haji84/AI-/pull/856

## Findings

Production Broker previously held two registered identities; ADB discovery only
returned one physical connection. The remote selector did not query registered
nodes. Worker 0.4.2 opened without the invitation handoff followed the legacy
pairing window path. These were separate failures, not evidence of lost identities.

## Implemented

- Worker opening requests owner registration with signed proof of its own key.
- One owner page lists candidates, comparison codes and multi-select registration.
- Exact offer IDs prevent a stale owner selection from enrolling a changed key.
- Pending requests are not enrolled or authorized until an owner submits selection.
- Registration automatically feeds the remote selector; no second enrollment.
- Existing identities reconnect without consuming invitation slots or replacing keys.
- Native 0.4.3 Android 11+ screenshot/input mailbox uses signed worker polling/results,
  short deadlines and single delivery. Unsupported features remain explicitly disabled.
- Legacy registration controls are secondary, and home registration uses the same page.

## Software evidence

- Local `node --test`: 972 passed (Git Bash included in PATH for shell syntax test).
- Local TypeScript, ESLint and Next production build passed. Existing dynamic
  filesystem tracing warning in video-plan-store remains.
- Signed Broker integration: unsigned/ownerless enrollment and remote operations
  rejected; pending enrollment does not increment registered count; owner batch
  enrolls once; existing identity replacement rejected; input delivery claimed once;
  signature nonce replay and duplicate result rejected.
- Pending store: 100/101 capacity, 30-minute expiry, changed key and stale offer
  selection rejection. Remote mailbox: cancellation/expiry/cross-device isolation.
- Browser at loopback test instance: synthetic Android A and B appeared as pending;
  select-all/register showed two registered; remote selector listed both while ADB
  was unavailable. Missing Accessibility correctly disabled session start.
- CI for ec02416: 35136986564 success; Android build/unit tests 35136986459 success.
- CI for efc5146: 35137811184 success; Android release/debug build, unit tests and
  installation-certificate check 35137811410 success.

## Not verified / release gate

No production update or signed APK publication is claimed by this evidence.
No new native physical screen/tap/reconnect PASS is claimed. Existing production
and 0.4.2 APK remain in service until task-specific release authorization.
The permission-sensitive additions are Android Accessibility screenshot metadata
and private-ingress signed registration-request/remote worker routes. Owner auth,
TLS, nonce/clock protections, firewall and public exposure policy remain unchanged.
The main Android workflow automatically signs/publishes APK on merge; obtain the
specific release authorization before merging this PR, not after publication.

Next: final exact-head CI/review, approved release of dashboard/Broker and signed
0.4.3, two Android devices on home Wi-Fi with no USB, actual screenshot/input and
disconnect/reconnect acceptance. Preserve database, identities and invitation
sidecar on rollback. See ../architecture/jarvis-worker-remote.md.

# Issue #1207 Windows native verification worker evidence

Status: SOFTWARE IMPLEMENTED / CI PENDING / PHYSICAL PENDING

## Requirement

Continue the Windows path left by #1188 without re-enrollment or Production credential changes. Reuse the existing Broker dispatch and signed worker result contract while adding the missing bounded native Windows consumer.

## Implemented software evidence

- `src/jarvis/windows-verification-worker.ts`
  - accepts only `windows-real-machine-verification`
  - requires exact target and assigned node identity
  - requires `windows-tooling`, Windows preference, online execution and exactly one attempt
  - accepts only schema `jarvis.real-machine.v1`, operation `smoke`, payload `{check:"platform"}`
  - refuses non-Windows runtime before native execution
  - launches only the current Node executable with a fixed read-only platform/version probe; no caller command or arguments are accepted
  - bounds probe time and output, validates the returned platform/version, and hashes the exact native output
- `src/jarvis/windows-worker-client.ts`
  - polls `/api/jarvis/worker/next` and posts `/api/jarvis/worker/result`
  - signs both requests with the existing canonical worker-auth contract
  - accepts an existing private key only; it has no enrollment, key-generation or rotation path
  - allows plain HTTP only for loopback and requires HTTPS for remote Broker URLs
  - bounds Broker response size and request timeout
  - sanitizes failure detail before returning it to the Broker
- `scripts/jarvis-windows-worker-service.ts`
  - refuses to start outside Windows
  - reads an existing identity key from an explicit file path
  - does not install startup tasks, change ACLs, open firewall ports, re-enroll a device or create credentials
- `tests/jarvis-windows-native-worker.test.ts`
  - fail-closed task/schema/node/capability/attempt checks
  - bounded native probe success and platform-mismatch rejection
  - cryptographic verification of signed poll/result requests
  - test-only process restart by constructing a second client with the same fixture identity; no enrollment endpoint is invoked
  - remote non-TLS Broker rejection
- The new regression test is pinned into `test:p8-security`.

## Reconciliation with #1181 / #1182

Current main already contains the bounded Windows dispatch validator and owner-authenticated Broker enqueue endpoint originally proposed by those stale PRs. #1207 starts from current main and does not revive their stale branches.

## Explicit evidence boundary

The fixture runtime platform and fixture worker identity used in CI are test inputs. They are CODE/UNIT/INTEGRATION/SECURITY evidence only. They do not establish:

- execution on the owner's actual Windows device
- reuse of the owner's actual enrolled private key
- process survival or reconnect after an actual reboot
- Production Broker reachability
- physical acceptance
- independent audit
- AGI evidence

No device app version, enrollment, secret, credential, permission, firewall, billing or Human Gate is changed by this implementation.

Because this is physical-facing Worker code, the PR must remain unmerged if merging current main would deploy it before owner physical acceptance.

# #1187 bounded research retrieval

Baseline: main 278d17c28528476f12bc6f9b8d5221ea340686b9. Scope: external research acquisition only; no production/device/config/credential mutation.

## Audit and implementation

Exact-main `rg` over src/scripts/tests found only test callers for `runProductionResearch` and `HttpSourceAcquirer`. They are library entry points, not proof of a deployed user-request workflow. Both now share `research-transport.ts`; native HTTPS pins the validated DNS answer with a per-request connection and normal TLS verification. No second DNS lookup, proxy environment use, redirect, credentials or non-443 port. Empty trusted origin allowlist denies before DNS/HTTP. Callers must supply host-owned job policy, never promote document fields into authority. Trusted injected resolver/fetch functions are test/adapter dependencies, not request data; production defaults to the pinned native transport.

Limits: 20 claims, 5 sources/claim, 40 total sources; 2 MB/response, 8 MB/batch; 5 s/request (maximum 10 s), 30 s/batch maximum. Deadlines cover DNS, response headers and streaming body. Oversized/stalled responses cancel/destroy. Compressed responses fail closed. Private/shared/reserved/multicast/documentation ranges rejected, including mapped IPv6 and mixed DNS answers. IPv6 support conservatively permits global unicast outside special-purpose ranges.

Claim-owned sourceClass cannot assign authority: only host classifier does; absent classification stays other/UNVERIFIED. Require own JSON field and finite recursively bounded JSON values. Optional freshness demands publication timestamp rather than mistaking retrieval time for publication. Evidence retains canonical URL, claim ID, SHA-256, retrieval and publication times. Matching supplied JSON is not general factual truth or independent-source verification.

## Verification

- RED: 5 initial policy/stream/schema/trust regressions reproduced against main; GREEN after implementation.
- Independent reviewer found asynchronous status-600 exception and non-finite JSON false match; both reproduced RED then fixed.
- Targeted 4 test files: 19 PASS; independent re-review: no new blockers.
- pnpm lint PASS; pnpm build PASS (existing video-plan-store filesystem tracing warning retained).
- Full Windows suite before final two regressions: 1390 tests, 1388 PASS, 2 FAIL. P8: 266 tests, 264 PASS, same 2 FAIL. SEC-008 fake ADB script execution and SEC-010 slash-specific path assertion also fail on untouched exact-main baseline after dependency installation. They are tracked under #1188; not hidden/skipped or attributed to research changes. Linux exact-head CI will be recorded in PR.
- Real native HTTPS GET to https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt with 100 KB/5 s limits: 3171 bytes text/plain, SHA-256 f410428039e2c922a14058df067a4482691c9304a5c01a75847f9f3f2d3307f6. This validates native DNS/TLS/streaming, not malicious-network penetration testing.

References: https://nodejs.org/download/release/latest-v24.x/docs/api/http.html ; https://www.iana.org/assignments/iana-ipv4-special-registry ; https://www.iana.org/assignments/iana-ipv6-special-registry .

## Rollback / remaining work

Revert this issue's code commit; no stored state migration. Never re-enable unrestricted network paths merely to obtain green tests. Runtime callers must provide authority-scoped origins/classification; no new runtime wiring is asserted. Existing physical-facing PR holds remain. #1188 reconciles full requirements and Windows execution separately.

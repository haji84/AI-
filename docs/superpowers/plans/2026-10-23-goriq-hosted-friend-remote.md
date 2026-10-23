# GORIQ hosted friend remote integration Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded implementation. Continue the owner's already authorized autonomous work; keep independent review and real credential/deployment Gates.

**Goal:** Run the existing manual-only friend remote module under the owner's GORIQ supervisor, without requiring another PC or giving friends GORIQ administrative authority.

**Architecture:** Reuse the existing HTTPS portal, per-owner authentication, registry, APK, Windows host and process manager. Add one default-off managed feature with an explicit private wrapper configuration. Its child receives only an OS environment allowlist, uses a distinct hostname, and cannot stop the core on failure.

**Tech Stack:** Existing Node ES modules, node:test, existing GORIQ supervisor and Remote Lite HTTPS server. No new dependencies.

**Spec:** Owner's 2026-10-23 choice recorded at Issue1831 comment6340796031: 「あなたのGORIQを友達専用アカウントで使う」. Existing manual-only / own-device / OS-consent requirements remain binding. docs/remote-lite/SERVICE_OPERATIONS_JA.md records the revised delivery model.

## Global Constraints

- Existing PR1832 and worktree only; no new PR.
- Reuse successful Android/Windows media/input paths unchanged.
- Do not modify requireJarvisOwner, Broker authority, existing credentials, production protected config schema or default core services.
- No real account/key issuance, service start/stop, OS permission, DNS/publication or deployment in this implementation.
- Same-hostname different-port is NOT cookie isolation: friend hostname must differ from every explicitly configured owner origin.
- Same OS user is not a filesystem sandbox; claim no such isolation.
- No automatic registry initialization/deletion, insecure TLS fallback or arbitrary command arguments.

## Review Focus

- Absent feature setting must preserve existing core startup.
- Missing/invalid wrapper, child synchronous spawn failure and exhausted retries must leave the core running.
- Inherited JARVIS/owner/AI credentials, NODE_OPTIONS and TLS-disable environment must not reach the friend child.
- Origin comparison must happen against the exact parsed portal config used by the child, not a separate parent preflight vulnerable to file replacement.
- Main shutdown must stop the owned friend process and cancel its retry timer; no unrelated process termination.

## Task 1: Optional managed feature with actual child boundary checks

**Files:**
- Create: src/remote-lite/goriq-hosted-config.mjs (strict bounded private wrapper and exact portal-origin validation).
- Create: scripts/jarvis-friend-remote.mjs (fixed command, explicit config path, sanitized environment, isolated retry lifecycle).
- Modify: scripts/jarvis-remote-host.mjs (one optional child added to existing shutdown map).
- Modify: scripts/jarvis-managed-process.mjs (optional owned-child stop callback; existing callers retain SIGTERM).
- Modify: scripts/remote-lite-owner-server.mjs (explicit --goriq-friend mode loads wrapper and uses that same parsed portal config; --initialize remains separate).
- Create: tests/remote-lite-goriq-hosted.test.mjs.
- Modify: tests/remote-lite-owner-server.test.mjs (real TLS/IPC/registry close and parent disappearance); tests/jarvis-network-local-runtime.test.mjs (include the new static dependency in isolated core fixture).
- Modify: docs/remote-lite/SERVICE_OPERATIONS_JA.md and docs/architecture/goriq-remote-lite-manual.md with dated owner-hosted choice and precise remaining conditions.
- Create: deploy/remote-lite/goriq-friend.json.example.
- Modify: .github/workflows/ci.yml (existing Windows job also runs new hosted HTTPS/lifecycle checks; no permissions or deployment changes).

**Interfaces:**
- readGoriqHostedPortalConfig(wrapperPath) -> { configPath, config }, with { version:1, ownerOrigins:[exact HTTPS origins], portalConfig:absolutePath } as the wrapper. Maximum16KiB JSON each, regular nonsymlink files, exact wrapper fields. Validate friend exact HTTPS origin and distinct hostname against all owner origins.
- startGoriqFriendRemote({root, configPath, env=process.env, node=process.execPath, report, stdio='inherit'}) -> managed process or null. Absent config disables; invalid config logs fixed disabled reason and returns null. Fixed remote-lite-owner-server.mjs <absolute-wrapper> --goriq-friend, maxFailures3; no parent exhaustion callback.
- OS environment allowlist only, case-normalized duplicate handling; no NODE_OPTIONS, NODE_PATH, TLS overrides or app credentials. NODE_ENV=production.

- [x] Write failing cases: wrapper size/type/fields/path/origin validation; same hostname with another port; configuration replaced between parent and child is judged in child; default disabled; environment missing sensitive synthetic keys in a real harmless child; actual abnormal child exhausts without stopping an independently created harmless core sentinel; stop cancels/reaps owned child.
- [x] Run targeted test and observe RED before product code. Windows SIGTERM left the temporary registry lock; a real IPC graceful-stop test then failed before its handler existed.
- [x] Implement the interfaces and optional host hook. Keep default serviceSpecs/core onExhausted unchanged. Use private IPC for graceful Windows stop and parent disconnect, with callback-handled send errors and a 1250ms fallback cancelled on exit/close. No stale-lock deletion.
- [x] Run targeted tests, existing managed-process/production/private-ingress tests, all Remote Lite tests, changed-JS lint and diff check. Local combined result:164 PASS/6 platform/browser SKIP/0 FAIL. Changed-JS lint and full lint excluding only private .jarvis passed; unfiltered local lint retains the previously recorded private-directory errors. Require clean CI.
- [x] Independent review. P1/P2 remaining:none. Independent local rerun16 PASS/4 Linux-only SKIP. Corrected substantive findings without weakening checks.
- [ ] Commit/push existing branch, verify CI for the new exact head, retain any failures and actual recovery counts.
- [ ] Record results/limitations/next Human Gates in same Issue checkpoint, PR and private continuation.

This task integrates runtime ownership. Public transport/TURN, friend account issuance, production installation and deferred physical acceptance remain separate required completion work.

## Execution record

- RED: real Windows SIGTERM left the temporary registry lock. The new graceful IPC stop then timed out until implemented. No stale lock was removed.
- Review correction: the Linux isolated supervisor fixture needed the new static module. It now also proves that friend-child exhaustion preserves the real supervisor's local Broker endpoint.
- Review correction: final fallback uses SIGKILL on the owned ChildProcess, since SIGTERM can be ignored on POSIX. A real inert child ignores IPC/SIGTERM; the bounded fallback reaps it once. Normal IPC uses no fallback.
- First lint found missing explicit node:url/node:process imports; added them and reran successfully. No lint rule or test was weakened.
- First exact-head CI39877679596 at796cf1c7: Linux2757 PASS/8 FAIL/6 SKIP. All eight failures came from missing reverse-traceability reconciliation for three changed surfaces and one new launcher. New Linux lifecycle/core-isolation tests passed. Reconcile only those four inventory rows, preserving canonical requirement status, prior parent bindings and audit enforcement; audit tests then pass locally.
- The same run's Windows native job failed on setup's first fixed GET with ERR_ABORTED, exactly one request, no response, committed inert bootstrap, no target commit and an unblocked canceled loadingFailed event. Reuse existing evidence-restricted one-recovery opt-in for that initial GET only; no helper-condition relaxation, enrollment-click retry, or later-reopen retry. Record only recovery count0/1 after browser exit. Fragment/response/commit/repeated-failure regression plus audit tests:34 PASS. Gofmt passed; local Go execution was blocked by Windows Application Control and is not a passing test. Android CI39877679580 on796cf1c7 succeeded.
- Continuity uses the existing Issue1831 comment6340796031 / PR1832 and ignored private execution receipt. Compass currently belongs to another Issue and is not overwritten.
- Second exact-head CI39878587933 at0ae467ad: Linux2766 PASS/6 SKIP, security332 PASS; Windows native capture/input, separate Chromium, DPAPI setup (bootstrap recoveries0), hosted IPC lifecycle and MSI install/repair/upgrade/uninstall passed. The owner portal browser failed before module initialization (`Portal UI missing: module initialization; null`). Its harness still navigated the launch-created tab through WebDriver without proving destination arrival. The observed failure alone does not establish the browser's actual URL.
- Align that portal harness with the existing owned-tab/bootstrap and verified CDP navigation. Add explicit literal-loopback HTTPS opt-in, preserve the generated-certificate SPKI trust, and prohibit HTTPS retries. Keep all login/approval/reopen/pending/expiry/disconnect assertions. Independent review: no P1/P2; local22 PASS/1 actual-browser SKIP. Actual Windows resolution requires new exact-head CI; this local skip is not success evidence for Chrome.

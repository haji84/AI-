# #1219 real independent-container CI

This increment closes a software-verification coverage gap: the existing host
suite tested the Docker boundary with process doubles. A new explicit
`independent-verifier-container` hosted-Linux job invokes the unchanged
`runIndependentVerifier()` fixed commands against the complete exact checkout and two detached
worktrees. It does not install or run Docker on ZBook or AI-09.

The image build context contains only the two project dependency manifests, the
reviewed image-owned offline helper and the Dockerfile. Official Node and
PowerShell base manifests are pinned by digest; the complete dependencies are
installed during disposable image assembly, then sealed read-only. No source
candidate or signing key enters an image layer. A temporary loopback registry
establishes an actual repository digest, which is pulled and checked against the
built image ID before executing the six checks. Nothing is published to an
external image registry.

The six required checks remain lint, typecheck,
full unit suite, full integration suite, security suite and build;
180seconds/check,2GiB,128PIDs,2CPUs,1.5GiBtmpfs, UID65534, no network, read-only
root/source/dependencies, dropped capabilities and no-new-privileges. A generated
test candidate checks those actual Linux boundaries, absent Docker socket and
host signing-key path, and absent host-only environment canary during both full
suites. It tries writes to the source, dependencies and root and requires
refusal. No fixed check is replaced by an unconditional-success fixture.

The host generates an ephemeral test Ed25519 key outside every bind mount. The
existing receipt consumer validates signature and Goal/Job/ChangeSet/Builder/
revision/artifact bindings. The CI audit additionally requires all six successful
checks, exact command/image/file hashes, matching retained log digests, actual
process-close observation and confirmed cleanup of each unique named container.
A failed or incomplete check fails CI and retains the available receipt/logs.
Registry and worktree cleanup is attempted independently even if evidence copy
fails. Artifacts contain public key, public metadata, receipt and bounded check
logs; never the private key, Docker config or full source export.

The live entry point requires explicit `--execute-hosted-ci` and GitHub-hosted
Linux metadata, rejects remote Docker environment settings, and verifies the
default local Unix-socket context. Importing it or running ordinary `pnpm test`
does not launch Docker; the six inner suites therefore do not recurse into the
outer job. The workflow keeps its existing `contents:read` permission and changes
no deployment, merge, account or credential authority.

## Verification and limits

The first local audit/guard tests failed with the missing implementation, and the
local CLI refusal test then failed with exit0 before the explicit execution path
was connected. The implemented focused audit/guard set passed8/8. Offline
workspace tests passed11/11; canonical traceability passed10/10 after the new
internal CI surface was mapped. TypeScript and ESLint passed.

The full default Windows suite was also run, and **did not pass**:
2716 tests,2657 passed,32 failed,1 cancelled,26 skipped. Retained log SHA256:
`d293ff414cb5cb6b0bd48f43c2da53b44fca7455c02dcd3a32df303f2ace5b0a`.
Failures include DPAPI, Mac/Bash and workflow-text cases, unavailable default
Python aliases, a PC-enrollment timeout, symlink cases and eight audit cases
which saw the newly added unmapped surface before its reconciliation. The exact
failure list remains in the retained local log; no check is weakened or hidden.
The affected Python continuation tests are rerun with the already-installed real
Python executable, without changing machine configuration. The combined related
run passed51 cases, failed0 and skipped1 POSIX-only permission case on Windows
(52 total), including the RED/GREEN and sequenced checkpoint continuation cases.
Hosted Linux CI is still required to establish the complete image/check outcome.

Independent review found a pnpm11.19 configuration incompatibility before the
first image execution and two cleanup failure paths. The corrected image-owned
pnpm wrapper disables implicit dependency repair and keeps offline mode enabled.
The image-owned helper still admits only byte-identical package/lock manifests
and immutable prepared dependencies. Actual pnpm11.19.0 probes execute the
borrowed TypeScript tool, fail a required missing import with `MODULE_NOT_FOUND`,
and perform no install/network request or dependency metadata change. This
permits an existing nested build fixture to reuse installed dependencies without
overriding or skipping any actual check. Corrections and exact-head hosted
results are recorded on Issue #1219. Source-only checks cannot prove image
viability or successful six-check execution.

## First actual hosted run

At source `3043b8f786192e4cd4bdaf7e221ededab8031a58`,
[CI39244171115](https://github.com/haji84/AI-/actions/runs/39244171115)
successfully built the real image and executed actual lint and typecheck. The
unit container then returned exit1:2716 total,2703 passed,8 failed,5 skipped in
118.95seconds. No timeout or output overflow occurred. Integration, security and
build were not run after that failure. The job failed and retained its partial
signed receipt. All three exact named containers and the outer registry/fixture
cleanup were confirmed. The separate host project job passed2710 tests with5
skipped,332 security cases, build/health and Windows fixtures.

[Artifact12183045654](https://github.com/haji84/AI-/actions/runs/39244171115/artifacts/12183045654)
ZIP SHA256 is `c116ca16c11d6088a45b6c7204abf8fb808c4c77a6311b3fb965b5532b1e7966`.
The retained [partial record](1219-hosted-container-partial-2026-10-19.json)
contains the public key, original receipt, environment/image identity and three
log hashes/cleanup records. Root independently validated the signature and all
three downloaded log hashes. This is a failed result, not a six-check PASS.

The eight real failures exposed test-environment assumptions: a CLI test assumed
surrounding Git metadata; three filesystem tests correctly rejected the writable
`/tmp` ancestor; three executable-discovery fixtures placed shell executables on
Docker's noexec tmpfs; and the nested build fixture's explicit dependency-reuse
setting was overridden by the earlier image wrapper. The corrective source
creates a dedicated Git fixture, uses installed executable symlinks for discovery,
and disables implicit pnpm repair while retaining offline manifest admission.
The runner now states existing `noexec` explicitly and strengthens temporary
ownership to65534:65534 mode0700. A new real probe requires native execution from
tmpfs to fail with EACCES and verifies execution through a link to image-owned
Node. No security gate, assertion, resource limit or test is weakened/removed.
The corrected actual hosted outcome is still required before claiming success.

## Second actual hosted run and explicit build profile

Source `79e07df368d4db6644b2e0475d52fdd1b550fcf9`,
[CI39245845801](https://github.com/haji84/AI-/actions/runs/39245845801), passed the
first five actual container checks. Unit and integration each passed2712 cases
with5 skipped, in174.6/174.8seconds. Both signed logs record UID/GID65534,
mode0700, actual noexec/nosuid/nodev, rejected X_OK/native execution and successful
execution of an image-owned Node symlink. The fixed180second deadline was not
increased; these durations leave limited margin and future timeouts remain
inconclusive failures.

The last build check failed with normal exit1 because Turbopack rejected the
image-owned `node_modules` link outside its inferred project filesystem root.
All six log hashes, receipt signature, exact candidate reconstruction and image
build inputs were independently verified. All six container cleanups and outer
fixture cleanup were confirmed. The [five-check record](1219-hosted-container-five-checks-2026-10-19.json)
retains public evidence; [artifact12183743692](https://github.com/haji84/AI-/actions/runs/39245845801/artifacts/12183743692)
ZIP SHA256 is `b8fad16305de742e6221984c122af31a5eb8e7d93f5be8ad50184195f32b69ed`.
This run remains FAILED, not a six-check PASS.

The bounded third strategy selects the public Next production Webpack build
profile already used by the repository's native Mac build. The actual
code-owned build command is now `pnpm build --webpack`, with
`executionProfile:next-webpack-v1` in the signed log and explicit CI metadata.
The audit rejects missing/conflicting profile or arguments. Other five commands,
all checks, immutable dependencies, source bytes, noexec and resource limits
remain unchanged. There is no source-config rewrite, expanded Turbopack root,
image-wrapper command substitution, private/test environment switch or automatic
bundler fallback. Next documents the [production CLI option](https://nextjs.org/docs/app/api-reference/cli/next)
and the [linked-dependency root limitation](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack).
A successful third run would prove this explicit Webpack profile; it would not
prove Turbopack compatibility. New profile/audit cases were observed failing
before implementation, then passed13 focused cases plus a retained-log case;
broader audit/manual/offline28cases, TypeScript, ESLint and canonical audit pass.
The third actual CI result remains to be observed. Do not report anticipated
success or silently increase the retry budget if it fails.

Even a successful hosted-container run proves only that CI execution and its
receipt plumbing. It does **not** prove AI09 authentication, provisioned physical
Builder/signer principals, the actual Ollama candidate E2E, Windows reboot or
next-Job continuation after OS restart. Existing partial native evidence and
Draft integration HOLD remain in force. The loopback image registry and test
key expire with the hosted runner and are not a production provisioning path.

## Rollback

Revert the scoped test job, harness, image fixture and corresponding manifest
entry together through normal review. Existing production runner commands,
services, credentials, permissions, network and VM configuration are untouched.
Preserve all prior device and CI evidence.

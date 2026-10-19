# #1219 real independent-container CI

This increment closes a software-verification coverage gap: the existing host
suite tested the Docker boundary with process doubles. A new explicit
`independent-verifier-container` hosted-Linux job invokes the unchanged
`runIndependentVerifier()` against the complete exact checkout and two detached
worktrees. It does not install or run Docker on ZBook or AI-09.

The image build context contains only the two project dependency manifests, the
reviewed image-owned offline helper and the Dockerfile. Official Node and
PowerShell base manifests are pinned by digest; the complete dependencies are
installed during disposable image assembly, then sealed read-only. No source
candidate or signing key enters an image layer. A temporary loopback registry
establishes an actual repository digest, which is pulled and checked against the
built image ID before executing the six checks. Nothing is published to an
external image registry.

The six production commands and restrictions remain unchanged: lint, typecheck,
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
first image execution and two cleanup failure paths. The image-owned pnpm wrapper
now passes explicit error-on-dependency-mismatch/offline CLI settings. An actual
pnpm11.19.0 missing-dependency fixture returned `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`
without running its script, creating dependency files or calling guarded network
APIs. Corrections and exact-head hosted results are recorded on Issue #1219.
Source-only checks cannot prove image
viability or successful six-check execution; no anticipated live result is
claimed in this report.

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

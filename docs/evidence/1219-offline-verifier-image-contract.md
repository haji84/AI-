# #1219 offline verifier image contract

This is a source contract and operator handoff, not physical AI09 provisioning or
end-to-end PASS. Disposable hosted-container execution evidence is recorded in
`1219-real-container-ci-2026-10-19.md`; physical acceptance holds remain open.

## Image-owned layout

The independent runner requires an already available digest-pinned Linux image
(`name@sha256:<digest>`). Each check runs with no network, no image pull, a
read-only image filesystem, an unprivileged UID, a read-only source mount and a
fresh private `/tmp` owned by65534:65534 with mode0700, noexec/nosuid/nodev and a
1536MiB bound. The image must provide this layout:

```text
/opt/goriq-verifier/
  jarvis-verifier-offline-workspace.mjs   # reviewed helper baked into the image
  dependencies/
    package.json                        # exact approved repository bytes
    pnpm-lock.yaml                      # exact approved repository bytes
    node_modules/                       # complete, already-installed Linux dependencies
      .pnpm/                            # self-contained pnpm virtual store
      .bin/                             # usable tool shims
```

The image also needs the approved toolchain on its image-controlled `PATH`:
Node24.19.0, pnpm11.19.0, Git, Python3, Bash and PowerShell7. Native dependencies must match the
image's platform and architecture. Merely caching pnpm package archives is
insufficient: the installed module tree and shims must already work without an
install step. The toolchain must be executable and the bundle readable by
UID/GID 65534; it must contain no signing keys, host credentials or user data.

A reusable image assembly input consists of the reviewed helper above, the two
approved manifest files and an owner-prepared dependency tree, plus an approved
toolchain base image. Copy these inputs to the fixed locations, preserving
internal dependency symlinks and executable shims, then record the resulting
image digest in owner-controlled verifier configuration. The helper must be
copied from the reviewed tooling revision; the runner never executes
`/source/scripts/jarvis-verifier-offline-workspace.mjs`. Image assembly and
dependency preparation are separate provisioning actions; neither is performed
by the runner. Disposable hosted CI has built real images; none has been
installed or provisioned on ZBook/AI09 by this work.

## Per-check behavior

Before any fixed `pnpm` check command, the image-owned helper requires
`/source/package.json` and `/source/pnpm-lock.yaml` to match the image bundle
byte for byte. Its success output includes SHA-256 hashes of both manifests,
which the runner retains in the check log. The log also identifies the pinned
image, and the signed receipt binds the log by its output digest.

The helper rejects missing or empty dependencies, manifest mismatch, source
symlinks, Git metadata and candidate-supplied `node_modules`. A prepared
dependency symlink must resolve inside the image's `node_modules`; external or
broken links are refused. Source and dependency roots must be distinct, plain
directories, and `/tmp/verify` must not already exist. Source traversal is
bounded to 100,000 entries, 512 MiB and 64 directory levels; dependency traversal
is bounded to 200,000 entries and 64 levels. Manifest reads are limited to
16 MiB each.

Source files are copied into `/tmp/verify` with owner write access and preserved
executable bits. The copied manifest bytes are checked again before the helper
creates the sole workspace dependency link to the immutable image bundle. No
package installation, lifecycle hook, dependency fetch or arbitrary caller
command is used for preparation. A mismatch stops the shell chain before the
check and remains a failed check with a retained, signed log digest. It never
becomes a successful no-op. The six fixed checks remain lint, typecheck, unit,
integration (the full suite), security and build.

The build check has an explicit `next-webpack-v1` profile: its code-owned command
is `pnpm build --webpack`, and those exact arguments plus the profile identifier
are retained in the signed check log. This invokes the supported Next production
build without changing candidate configuration, widening Turbopack's filesystem
root or introducing an automatic bundler fallback. Immutable dependencies remain
image-owned outside the writable workspace. The prior default Turbopack build
rejected that link layout; a Webpack result does not establish Turbopack
compatibility. No caller-supplied command/profile is accepted.

## Verification boundary

`tests/verifier-offline-workspace.test.mjs` exercises real temporary files and
module resolution. `tests/independent-verifier-snapshot.test.mjs` exercises real
Git snapshots, test-only signing and retained receipt/log binding while doubling
only the unavailable Docker boundary. These tests do not establish that the
required image exists, that its tools run under the production resource limits,
or that the signer is isolated from the Builder. A real prepared image must
still pass all six checks against the complete exact repository baseline and
declared candidate files. A scratch Python-only repository without the two
package manifests is intentionally rejected.

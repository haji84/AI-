# CI assembly only. The hosted harness supplies exactly this Dockerfile, the
# reviewed offline helper and the two approved dependency manifests as context.
# No candidate source, credentials, host dependencies or signing keys are copied.
FROM node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b AS node-toolchain
FROM mcr.microsoft.com/powershell:7.5-debian-12@sha256:7ab5bd5ca6f95a3351fa0c6a1205237d57048c94542355aab55519a0861a9b25

# Keep PowerShell's distribution libraries and copy the matching Debian Node
# toolchain. Installation is allowed only during disposable CI image assembly.
USER 0:0
SHELL ["/bin/sh", "-ec"]
COPY --from=node-toolchain /usr/local/ /usr/local/
RUN apt-get update \
    && apt-get install --yes --no-install-recommends bash ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --prefix=/opt/goriq-verifier/toolchain --ignore-scripts --no-audit --no-fund pnpm@11.19.0 \
    && test "$(node --version)" = "v24.19.0" \
    && test "$(/opt/goriq-verifier/toolchain/bin/pnpm --version)" = "11.19.0"

ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    POWERSHELL_TELEMETRY_OPTOUT=1 \
    POWERSHELL_UPDATECHECK=Off \
    DOTNET_CLI_TELEMETRY_OPTOUT=1

WORKDIR /opt/goriq-verifier/dependencies
COPY package.json pnpm-lock.yaml ./
# Copy from the package store, retaining a self-contained local virtual store.
# Frozen manifests plus ignored install hooks keep candidate code out of image
# preparation. Native prebuilt dependencies are exercised below, not assumed.
RUN sha256sum package.json pnpm-lock.yaml > /tmp/verifier-manifests.sha256 \
    && /opt/goriq-verifier/toolchain/bin/pnpm install --frozen-lockfile --ignore-scripts \
        --store-dir=/tmp/verifier-pnpm-store \
        --config.package-import-method=copy \
        --config.enable-global-virtual-store=false \
    && sha256sum --check /tmp/verifier-manifests.sha256 \
    && rm -rf /tmp/verifier-pnpm-store /tmp/verifier-manifests.sha256 /root/.npm

COPY jarvis-verifier-offline-workspace.mjs /opt/goriq-verifier/jarvis-verifier-offline-workspace.mjs
# The runner overrides ENTRYPOINT and mounts a fresh /tmp tmpfs. Its first Node
# invocation loads this image-owned initializer before any candidate execution.
# Existing directories must already be private, plain and owned by this UID;
# never chmod, follow or repair an unexpected path.
RUN printf '%s\n' \
    '"use strict";' \
    'const fs = require("node:fs");' \
    'if (process.getuid() !== 65534 || process.getgid() !== 65534) throw Error("VERIFIER_HOME_IDENTITY_MISMATCH");' \
    'for (const path of ["/tmp/goriq-verifier-home", "/tmp/goriq-verifier-home/.cache", "/tmp/goriq-verifier-home/.config", "/tmp/goriq-verifier-home/.local", "/tmp/goriq-verifier-home/.local/share"]) {' \
    '  try { fs.mkdirSync(path, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }' \
    '  const info = fs.lstatSync(path);' \
    '  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 65534 || info.gid !== 65534 || (info.mode & 0o777) !== 0o700) throw Error("VERIFIER_HOME_PATH_UNSAFE");' \
    '}' \
    > /opt/goriq-verifier/prepare-home.cjs \
    && printf '%s\n' \
        '#!/bin/sh' \
        'exec /usr/local/bin/node /opt/goriq-verifier/toolchain/lib/node_modules/pnpm/bin/pnpm.mjs --config.verify-deps-before-run=false --config.offline=true "$@"' \
        > /usr/local/bin/pnpm \
    && chmod 0555 /usr/local/bin/pnpm \
    && chmod -R a+rX,a-w /opt/goriq-verifier

# No package installation or version download is permitted during a check.
# The runner independently enforces a read-only root/dependency bundle and no
# network; the image-owned helper requires exact top-level manifest bytes.
# Disable pnpm's implicit dependency repair so nested test fixtures can borrow
# the installed bundle. Actual check commands still fail on missing tools/modules.
# Explicit CLI options avoid pnpm 11.19.0's inconsistent enum environment parsing.
ENV HOME=/tmp/goriq-verifier-home \
    XDG_CACHE_HOME=/tmp/goriq-verifier-home/.cache \
    XDG_CONFIG_HOME=/tmp/goriq-verifier-home/.config \
    XDG_DATA_HOME=/tmp/goriq-verifier-home/.local/share \
    NODE_OPTIONS=--require=/opt/goriq-verifier/prepare-home.cjs \
    PYTHON_MANAGER_AUTOMATIC_INSTALL=false

USER 65534:65534
# Build-time smoke checks run as the same unprivileged identity as the verifier.
# The real six checks with read-only mounts/resource limits run only in CI.
RUN test "$(node --version)" = "v24.19.0" \
    && test "$(pnpm --version)" = "11.19.0" \
    && test "$(pnpm config get verifyDepsBeforeRun)" = "false" \
    && test "$(pnpm config get offline)" = "true" \
    && bash --version \
    && git --version \
    && python3 -I -B -c 'import sys; assert sys.version_info.major == 3' \
    && pwsh -NoLogo -NoProfile -NonInteractive -Command 'if ($PSVersionTable.PSVersion.Major -ne 7) { exit 1 }; $PSVersionTable.PSVersion.ToString()' \
    && pnpm exec tsc --version \
    && pnpm exec eslint --version \
    && pnpm exec next --version \
    && node --input-type=module -e 'import sharp from "sharp"; const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer(); if (bytes.length === 0) throw Error("VERIFIER_SHARP_UNAVAILABLE");' \
    && test ! -w /opt/goriq-verifier/dependencies/node_modules \
    && test -w "$HOME" \
    && test -w "$XDG_CACHE_HOME"

WORKDIR /
ENTRYPOINT []
CMD ["node", "--version"]

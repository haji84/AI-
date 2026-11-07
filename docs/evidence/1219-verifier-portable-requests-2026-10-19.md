# #1219 portable verifier requests and offline execution prerequisites

Status: source implementation under Draft #1827. This does not establish authenticated AI-09 access, independent physical signing or full ZBook Goal E2E.

## Durable request production and cross-host preparation

When a sequenced local Job reaches VERIFYING with a persisted implementation Change Set and its bounded GREEN proof, the runtime now publishes `<receiptFile>.request.json`. The packet includes the exact Goal/Job/Change Set/Builder identity, base and complete candidate revision, required check classes, execution-manifest digest, expiry and declared UTF-8 file bytes with SHA-256 values. Both supporting tests and implementation bytes are included. It contains no local workspace paths, key paths, shell commands or new authorization. Independent byte readback runs before and after collection. A new wake/restart preserves identical bytes; a conflicting existing packet stops without replacement. Request paths cannot overlap manifest, public-key, receipt or other request authority paths.

This packet is a request, never verification evidence or a signed receipt. It does not certify arbitrary prose criteria or enable arbitrary model-generated code in the existing fixture Builder.

`scripts/jarvis-verifier-request-transfer.mjs` accepts two absolute input filenames: the delivered packet and a separate verifier-owned local configuration. The configuration supplies `expectedRequestSha256`, `candidateWorkspace`, `verifierWorkspace`, `privateKeyFile`, `receiptFile` and `verifierId`. Obtain the expected digest through the approved authenticated control channel, not from an untrusted packet or neighboring attacker-written file. Keep the configuration outside candidate control. The preparer reads no private key and grants no filesystem access.

The two workspaces must already exist as distinct detached Git worktrees at the exact base. The candidate mirror admits only declared new paths; the verifier checkout must be clean. All declared destination parents must already exist. The preparer validates every destination before writing, never overwrites differing bytes, and permits exact-byte replay after interrupted staging. It reattests the complete mirror before returning the existing independent runner's JSON request. It preserves the task expiry so delayed execution cannot outlive the request. Existing signer paths and verifier identity are supplied only by local configuration.

An operator can save that output outside all workspaces and invoke the existing `jarvis-independent-check-runner.mjs` under the separately provisioned verifier principal. The runner still needs its pinned image, private signing key, clean verifier checkout and actual required checks. The returned receipt must travel back through the separately approved authenticated transport into the exact host-pinned receipt path. The Broker's existing signed receipt validation, acceptance oracle and wake path remain authoritative. No network transfer, SSH access, signer key or trusted public-key pin is provisioned by these helpers.

## Offline dependency contract

The runner previously exported source without `node_modules` and then directly called pnpm. A generic Node container did not implement the documented preinstalled dependency requirement. The runner now first invokes an absolute helper baked into the trusted image, not the candidate's copy. The helper requires byte-identical `package.json` and `pnpm-lock.yaml`, an already installed dependency tree and a new private execution directory. Missing or mismatched dependencies stop before checks; no package installation or network fallback occurs. See the image layout in the acceptance procedure.

This change does not build or install an image. The actual chosen image, toolchain, native dependencies, memory/time bounds and all six checks still require real execution on the independent verifier. Filesystem fixture tests and a doubled Docker boundary do not certify physical container isolation.

## Verification boundary and recovery

Regression coverage exercises real temporary detached Git worktrees, candidate byte transfer, replay, modified existing files, wrong digest, stale expiry, weakened checks, injected host authority, manifest/outbox collisions and the authenticated temporary Broker restart/successor flow. Model and signing fixtures in Broker tests remain synthetic. Exact commands, counts, review findings and CI run are recorded on Issue #1219 after they finish.

Local full `pnpm test` on Windows returned 2,630 passed, 20 failed, one cancelled and 25 skipped (2,676 total). The failures include existing LF-only workflow assertions against CRLF checkout files, unavailable Unix Bash paths, symlink privilege denial, Windows file-URL conversion and a DPAPI fixture; the enrollment fixture reached its 30-second deadline. The new portable-request, offline-dependency and automatic-baseline cases did not fail. This local full suite is **not PASS**. Full ESLint, TypeScript and the permitted PROJECT_STATE field check passed. Preserve the failed run as evidence and assess the exact-head CI separately; do not weaken tests, change privileges or modify unrelated workflows to turn this result green.

No existing listener, AI-09 VM, prior worktree/evidence, credential, ACL or network setting is changed. Retain any failed staging directory and logs for diagnosis; do not reset or clean it to force a pass. A torn/conflicting outbox is an explicit failure requiring reconciliation, not permission to overwrite evidence. Roll back this source change with its producer/consumer contracts together and preserve pending packets, receipts, manifests and durable Jobs. Do not run a newer transferred request through a legacy runner that lacks the expiry check or offline image contract.

The requested automatic guest baseline collector is a separate read-only capability. It requires an existing authenticated connection and a pinned fixed guest command. Its source is not evidence that the connection is installed. Current access and one-time provisioning constraints are recorded in `1219-ai09-access-gate-2026-10-19.md`.

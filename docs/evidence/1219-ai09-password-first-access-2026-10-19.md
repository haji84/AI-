# #1219 — Proposed native SSH first access

Status: **initial network rule applied then exactly rolled back; actual SSH host-key match VERIFIED; server rejected account authentication; physical E2E NOT VERIFIED.** Latest hosted container CI also failed at the unit deadline. Historical milestones and subsequent failures are distinguished below. This document is not an approval issuer.

The owner requested that command entry, setup and collection be performed by the agent, with critical execution changes presented together. The current native token is non-administrator. The last bounded VMConnect attempt produced no visible input echo, and no Enter was sent. No further VMConnect/keyboard/OCR/UAC diagnostic loop is part of this path.

## Smallest concrete critical change

Add exactly one Hyper-V extended ACL entry to the existing fixed AI-09 virtual NIC:

| Field | Proposed value |
| --- | --- |
| Issue / native host | #1219 / HAJI |
| VM | GORIQ-AI09-Ubuntu, 453b139b-cceb-446e-99fb-f45bf5895436 |
| NIC MAC | 00155DDC2C00 |
| Switch | existing Internal Default Switch c08cb7b8-9b3c-408e-8e30-5e16a3aeb444 |
| Action / direction | Allow / Inbound |
| Local endpoint | candidate172.27.140.254/32, TCP22 |
| Remote endpoint | ZBook host172.27.128.1/32, any source port |
| Weight / state | 201 / stateful, idle session timeout60 |
| Preserved original policy | all four current deny/DHCP entries, byte-equivalent canonical projections |

The address is explicitly proposed from the owner-supplied photo, SHA2561ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4. KVP did not report a guest IP. **The photo/candidate is not a fresh native guest-address proof.** The new profile confines the rule to the exact current VM/NIC and labels `guestAddressVerified:false`; a conflicting KVP address refuses. Current native host/switch/disk identities and the complete original four-rule policy must match before adding anything. Normal growth of the running AVHDX is excluded from identity comparison; its identity, parent, attachment, format and capacity remain pinned.

This approval concerns only the one rule. It does not grant host groups, VMConnect access, a new account, keys, sudo, SSH password-policy changes, signer authority, package/container installation, Internet access or changes to services8787/8796/8797. Existing strict KVP-dependent `ai09-access-host.ps1` modes are unchanged.

## Initial owner authentication and automatic collection

After the approved rule has been independently read back, the agent starts a normal native Windows OpenSSH process in its own visible console with one fixed read-only remote inspector. The owner supplies existing SSH and sudo passwords directly in that process. The agent does not enter or record passwords, automate authentication dialogs, request secret values in chat or ask the owner to type Linux/PowerShell commands.

The actual availability of existing SSH password authentication and sudo is unknown. The client permits one SSH password attempt; sudo retains its existing policy. Unavailable authentication, failed identity, wrong public host key or unsupported configuration stops without enabling/resetting/replacing anything. This source preparation does not prove that the authentication window has opened or can complete on AI-09.

The historical public host key is pinned exactly to SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA. Strict checking is mandatory. The key is neither silently updated nor accepted from an unverified scan. The inspector compares the named public key and fixed guest identity before reporting its UID and inventory. Its output is public identity, runtime presence, selected SSH policy and path ownership metadata. It does not install or activate access, read private keys or execute a candidate. SSH policy uses OpenSSH's parse-only `-G -T -C` exit before private host-key loading; unsupported `-G` records that observation as UNAVAILABLE, never retries with key-loading `-T` alone.

The remote command fixes `/usr/bin/sudo` and `/usr/bin/python3`, avoiding PATH-selected replacements. This initial owner-password path still requires trust in the existing guest login shell and startup files: SSH authenticates the server, not root command execution. A malicious account startup/ForceCommand could forge stdout. The outer receipt therefore reports `AUTHENTICATED_GUEST_BASELINE`, `rootExecutionAttested:false` and `trustedGuestShellRequired:true`; it must not certify an independent Verifier or grant authority from that self-report. Actual independent execution/signing needs its separate trust-bound provisioning and evidence.

A local Windows PTY fixture verified that a native process invoked through a PowerShell output pipeline retains interactive console input and receives a non-secret test line. This is not actual SSH/PAM/sudo evidence. Native pipeline line buffering and owner-controlled authentication prevent claiming a hard pre-allocation raw-output cap or automatic wall-deadline/tree cleanup. Only validated, bounded inspector JSON is retained; unrelated terminal output is not a receipt.

## Execution authority and recovery

The owner approval must bind #1219, this exact rule/profile, source hashes and an expiry. A reviewed native wrapper can inspect current state, materialize the exact fresh baseline/plan, call the bounded Apply once and retain intent/plan/journal/receipt during one existing administrator invocation. JSON does not issue authority. Default validation never elevates, invokes Hyper-V or changes policy. An unavailable native administrator execution channel remains a blocker; no permission is inferred from a visible admin window.

The authorization expiry is an execution deadline. **Hyper-V does not automatically expire this rule.** The same explicit approval may cover adding this entry and removing exactly that recorded entry on failure within the same deadline. Recovery still needs a newly materialized fresh plan and independently pinned journal/permit-plan hashes, checks the entire current policy, and removes only the exact added weight201 entry. After the authorization expires, a new recovery approval is required. Drift or an unconfirmed operation yields BLOCKED/UNCERTAIN and retained records, never blanket restoration or a PASS. The original four rules, worktrees, evidence, VM lifecycle, OS disk and old seed remain protected.

## Subsequent critical bundle and physical acceptance

The initial authenticated baseline is needed to identify the actual account/startup policy, installed runtime and package versions. Only then can the dedicated scoped credential/Verifier/signer/container changes be made concrete. They are not pre-approved as unknown future work. Known required changes will be presented together rather than prompting for each file or routine test.

Once that specific provisioning is approved and verified, continue the existing same-Goal physical sequence automatically: authenticated Goal intake, real installed Ollama execution, all six independent checks, signature validation, Windows OS reboot and next-Job continuation. Preserve duplicate suppression, existing protected services and source/evidence binding. Hosted-container CI and a Broker process restart do not satisfy the physical sequence.

## Verification record

Source byte pins use LF attributes for the new entry points and their shared host dependency, preserving the existing dependency bytes across Windows/Linux checkout. Final source pins, exact-head checks and independent review are recorded in Issue#1219 after implementation. Until then neither this proposal nor fixture results indicate live access or execution readiness.

Reviewed source-byte pins:

| Source | SHA256 |
| --- | --- |
| first-access-host.ps1 | fea386a38e421727134f44af15574c0bf5217bc70aa19291cbd82d7da09fb7cc |
| first-access-native.ps1 | 864ecaded826ca51308bdfb62ee4ef9743b8c88e72140d24d8313133ffc5e166 |
| first-access-client.ps1 | 4a49dfc7d8b9c8cdc504a9182c9981a9a8e621a80e269449eac3de3fbb0cc4c0 |
| first-access-inspect.py | dee4d8d046995431546639e87303cf42b5f96c3cf8b48ec56981851c5688cdc1 |
| unchanged ai09-access-host.ps1 dependency | 1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64 |

The four new Node fixture wrappers pass on native Windows. Host/native/client PowerShell fixtures cover95/84/94 assertions; Python13 cases have11 passes and2 explicit POSIX-only skips on Windows. Client regressions exercised real Windows native argument binding and OpenSSH `-G` option parsing without a network connection. A hidden real PS5 console/native Python regression proved that the former combined stdout/stderr pipeline removed native stderr's TTY; stdout-only capture preserves native stdin/stderr on the console and still validates the frame. It failed before the correction and passed after it. Actual password authentication and the cause of the earlier SSH255 exit remain unproven by that fixture. The private-host-key parsing boundary and absolute sudo/report-only root claim corrections also used failing-then-passing regressions.

The retained native Windows full-suite observation is **FAIL**:2723 cases,2672 pass,24 fail,1 cancelled,26 skipped,135895.8619ms. Its log SHA256 is496a18c3ae7a35b72d75a5522eb8fc9af274c75774404e05f4244b2a65350eaa (`checks/first-access-frozen-native-suite-20261019T1414Z.log` outside the checkout). It includes platform-dependent Mac/Bash/symlink/Python/TDD failures and is a precommit working-tree observation, not clean exact-head CI or physical acceptance. Do not discard these failures or convert the whole native suite to PASS because the new focused fixtures pass. Exact-head hosted CI is a separate required record in Issue#1219.

## Actual execution and current boundary

At source93569855, [CI39267493967](https://github.com/haji84/AI-/actions/runs/39267493967) passed all four jobs, including the actual restricted-container six checks. The public receipt/signature, reconstructed candidate/context, six actual logs and confirmed cleanup were independently audited. Unit/integration each2718PASS/0FAIL/5SKIP within the unchanged180000ms limit. [Permanent evidence](https://github.com/haji84/AI-/issues/1219#issuecomment-6269808514) retains the public signed receipt and key. This remains HOSTED_CONTAINER_CI, physicalAcceptanceVerified:false; it is not the subsequent console correction's exact-head CI.

The owner explicitly approved envelope633f3d013a36194087cca834707a4bf7bd901bef8e5c5f7aedb1bde671644346 and exact recorded-entry removal on failure until2026-10-20T13:00Z. One native admin invocation applied the rule at2026-10-19T14:27:30.7998758Z, verifying original4 to expected5 rules. Before digest00753d23bc2c5d4c24b1d131d13b2e6e184699ad621712cdee9fb4a7e9ac098b; after digest2aecdb55efcb24b2a8f86212b704251924514e6379f5cd41102da4a5217860c7. Plan digest0ed5ba34aa0b8552dcf107e80d3c090bed853980950c17dccd8e540302cf10a3 and pre-recovery journal digesta321e66980117ff4cf92b046b86c16b3338ffe85616671098f6b0525cf6d86f2 bind that operation. **The rule was subsequently removed by the already approved failure rollback below.** Account/key/package/service configuration, VM lifecycle, seed and disk were not changed.

A real bounded no-auth handshake established TCP22 and the exact historical ED25519 host-key match; the server advertised OpenSSH9.6p1 Ubuntu-3ubuntu13.19 and publickey,password authentication. A second all-credentials-disabled diagnostic using the client's exact options/native binding also reached the matching key and user-authentication service. Neither authenticates ai09 or proves a trusted root/Verifier environment.

The initial normal console failed before SSH because an inherited PSModulePath prevented Windows PowerShell5.1 standard-command loading. Removing that variable only for the child launch, then immediately restoring the parent, corrected that preparation failure without OS configuration changes. The first actual client then returned SSH_AUTHENTICATION_OR_COMMAND_FAILED with no guest frame. Its failed request/receipt and historical client pin121587d289884840fd3f4b9138da45d058e5d5aa0e427975454480ff6d2c0fd8 remain preserved. A new request must pin the corrected source and exclusive new output paths before any later owner-password attempt. Do not reuse the old failed attempt or rerun network Apply.

Primary references: [Hyper-V extended ACL](https://learn.microsoft.com/en-us/powershell/module/hyper-v/add-vmnetworkadapterextendedacl?view=windowsserver2025-ps), [OpenSSH client options](https://man.openbsd.org/ssh_config), [existing VMConnect grant semantics](https://learn.microsoft.com/en-us/powershell/module/hyper-v/grant-vmconnectaccess?view=windowsserver2025-ps). These references explain APIs; they do not prove current machine configuration.

The parse-only SSH policy boundary is based on [OpenSSH 9.6 source](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.c): config dumping occurs before `load_hostkeys()`. This does not assert the VM's installed OpenSSH version.

The subsequent bounded DEBUG1 diagnostic isolated the actual pre-authentication failure: strict host-key comparison received the correct server key, but OpenSSH could not open the newly created known-hosts file while the client held its writer. Real System32 `ssh-keygen -F` public lookup inside the actual client's native boundary reproduced255/Permission denied with that writer open. The correction retires only the known-hosts writer, rechecks the owner/reparse-safe path, opens a Read/FileShare.Read guard and revalidates the exact97-byte pinned public line before SSH. The real lookup then returns0 with the exact public key, while concurrent writers remain rejected. No NTFS ACL, key or authentication policy changes are involved. Root and a separate reviewer passed focused wrappers plus native PS5/PS7 fixtures (client94 assertions); no scoped P1/P2 remains. Preserve the prior failed attempts. Actual authentication still requires a fresh source-pinned request and owner-operated password prompt; a public-key lookup fixture does not establish account authentication.

## Authentication refusal and verified rollback, 2026-10-20 JST

With client4a49dfc7 at sourcee32cd8a7, the last actual DEBUG1 observation reached the strict matching host key, user-authentication service and password method, then reported `Permission denied (publickey,password)`. Request SHA25602d3a1732d7cf04cb0145da11e25523ee2d2d5204a2447f176170d2c3902f254 and its failed receipt remain in the external attempt-5 evidence directory. The owner confirmed entering the Ubuntu ai09 password. The evidence does not distinguish a credential mismatch from account/PAM/SSH restrictions. No authenticated session, sudo inspector or guest baseline was obtained; no further equivalent authentication retry was made. Password input was not logged. One read-only `sudo journalctl -u ssh -n 10` in the existing Ubuntu session was requested because the rejected SSH channel cannot fetch its own server-side failure reason.

The exact journal-bound failure removal was separately approved with the original addition. A reviewed one-use native helper (SHA256d55fb35aca0026355b6116d9dfa91311a753409d040f66fb2bb23d262d103927) pinned the original sources, plan, journal and owner reference; default validation performed no mutation. Existing host/native regression wrappers passed2/2. Execution reserved new output files, required the fresh exact five-rule state, then invoked only the unchanged core Rollback once. It did not execute the Apply wrapper.

At2026-10-19T15:14:00.6174429Z the core returned `ROLLED_BACK_NETWORK_ONLY`, restoring original4rules/digest00753d23bc2c5d4c24b1d131d13b2e6e184699ad621712cdee9fb4a7e9ac098b. The byte-identical [public rollback receipt](1219-ai09-first-access-rollback-2026-10-20.json) has SHA2560cbf67c963d44413276b7ba0d584b655b0e46ce49fcf92e0aa83711750a27ebd. A separate fresh Inspect at15:14:01Z confirmed the same original four-rule digest (external readback SHA2566a74081970a07ceed84520286b988c43baf131b386b78046f1ef08969e1a302c). Recovery plan SHA2567f8db601f8d7fcb5710808615f4cc75521fca5c219cf75a2767708c6b68e5c8e; append-only journal after recovery SHA25636531fdc468ab39bec1f0f1272ab59741b9566768d8ec20cd8fbae32e5fd34f9. Original application records remain preserved. Native exit0; no added rule remains. [Permanent operation record](https://github.com/haji84/AI-/issues/1219#issuecomment-6270648252).

## Latest hosted-CI failures, distinct from earlier PASS

Sources72ca2d5a ([run39271905890](https://github.com/haji84/AI-/actions/runs/39271905890)) ande32cd8a7 ([run39273168096](https://github.com/haji84/AI-/actions/runs/39273168096)) both failed at the unchanged180000ms unit deadline. The signed results are lint/typecheck passed and unit inconclusive (`ETIMEDOUT`, `SIGKILL`, exit:null); integration/security/build never ran. Container close and cleanup were confirmed; the other three CI jobs succeeded. Neither overall run is PASS.

Latest artifact12197515080 ZIP SHA2564752767ca22ddd41b0b6c06d40bf9510a237bc5da7a4b5913c8f8122159b8eb6; receipt SHA2566dadf9008d10d4355b6f1d4a16f2a4796320449b5a4f5f3a2b7b0db5870361bf. An independent reviewer verified its Ed25519 signature and all three signed log digests. Its captured2551 passing test lines do not constitute a complete suite summary. The earlier93569855 success took177023.7ms for unit, leaving about3seconds below the cap; increased time across many unchanged cases suggests insufficient timing margin, without establishing a particular source regression. Existing commands, test selection, isolation and resource/deadline limits remain unchanged. Preserve both failures; do not rerun until green or substitute previous success for current evidence. [Detailed current failure record](https://github.com/haji84/AI-/issues/1219#issuecomment-6270586152).

Authenticated physical Goal/Ollama/six-check signing/Windows OS reboot/next-Job acceptance remains NOT VERIFIED, with Draft integration HOLD. Account diagnosis and a concrete separately authorized credential/signer/container/network bundle remain prerequisites.

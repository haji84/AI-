# #1219 — Proposed native SSH first access

Status: source preparation and independent review. **NOT APPLIED; SSH authentication and physical E2E remain unverified.** This document is not an approval record.

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
| first-access-client.ps1 | 121587d289884840fd3f4b9138da45d058e5d5aa0e427975454480ff6d2c0fd8 |
| first-access-inspect.py | dee4d8d046995431546639e87303cf42b5f96c3cf8b48ec56981851c5688cdc1 |
| unchanged ai09-access-host.ps1 dependency | 1e7f2ca24588c3cde6fc7808d14783b0cce8fb88790f6eded73dd0ab79632a64 |

The four new Node fixture wrappers pass on native Windows. Host/native/client PowerShell fixtures cover95/84/84 assertions; Python13 cases have11 passes and2 explicit POSIX-only skips on Windows. Client regressions exercised real Windows native argument binding and OpenSSH `-G` option parsing without a network connection. SSH stdin/PAM/sudo authentication remains untested. The private-host-key parsing boundary and absolute sudo/report-only root claim corrections were first observed as failing regressions, then passed after their fixes.

The retained native Windows full-suite observation is **FAIL**:2723 cases,2672 pass,24 fail,1 cancelled,26 skipped,135895.8619ms. Its log SHA256 is496a18c3ae7a35b72d75a5522eb8fc9af274c75774404e05f4244b2a65350eaa (`checks/first-access-frozen-native-suite-20261019T1414Z.log` outside the checkout). It includes platform-dependent Mac/Bash/symlink/Python/TDD failures and is a precommit working-tree observation, not clean exact-head CI or physical acceptance. Do not discard these failures or convert the whole native suite to PASS because the new focused fixtures pass. Exact-head hosted CI is a separate required record in Issue#1219.

Primary references: [Hyper-V extended ACL](https://learn.microsoft.com/en-us/powershell/module/hyper-v/add-vmnetworkadapterextendedacl?view=windowsserver2025-ps), [OpenSSH client options](https://man.openbsd.org/ssh_config), [existing VMConnect grant semantics](https://learn.microsoft.com/en-us/powershell/module/hyper-v/grant-vmconnectaccess?view=windowsserver2025-ps). These references explain APIs; they do not prove current machine configuration.

The parse-only SSH policy boundary is based on [OpenSSH 9.6 source](https://github.com/openssh/openssh-portable/blob/V_9_6_P1/sshd.c): config dumping occurs before `load_hostkeys()`. This does not assert the VM's installed OpenSSH version.

# AI-09 native SSH first-access plan

**Goal:** Obtain an authenticated, machine-readable Ubuntu baseline without another manual Linux command or VMConnect input loop. Prepare the exact critical network gate before requesting its execution.

**Architecture:** A separate first-access host profile may admit one explicitly owner-approved candidate endpoint on the fixed VM NIC. It does not relax the existing KVP-dependent Apply profile or claim that the candidate is a native guest observation. A normal native Windows OpenSSH process uses the retained exact public host key and the existing `ai09` password. The owner handles SSH/sudo authentication in that process; the agent supplies only a fixed read-only inspector and collects its bounded public JSON. No authentication dialog is automated.

**Scope decision:** Guest package versions, SSH policy and account ownership are not currently known. They cannot safely be included in an installation approval as invented facts. This increment has one known critical action: the fixed NIC's host-only TCP22 permit. Credential/account/signer/container installation remains a subsequent concrete bundle derived from the authenticated baseline. This is not a claim that the whole physical E2E is ready.

## Fixed boundary

- Issue1219; native host HAJI; VM453b139b-cceb-446e-99fb-f45bf5895436; MAC00155DDC2C00; Default Switchc08cb7b8-9b3c-408e-8e30-5e16a3aeb444.
- Proposed host172.27.128.1/32 and guest candidate172.27.140.254/32, TCP22, one stateful inbound rule weight201. The candidate comes from owner photo SHA2561ae8090f7b9c5e6a2a2d7f3cde1c7a1855824d4a4ea5703ec388b39a90de96f4 and requires explicit approval. It is not a fresh KVP observation.
- Preserve exactly the four original deny/DHCP ACL entries. Read current VM/NIC/switch/host/disk identities and complete policy before mutation. Contradictory native evidence or any drift refuses.
- Historical host pin: SHA256:tXO5C217Ce6OU0dYni/SRbrQMA6n735VOI2X/QariEA. Strict checking only; never update/accept-new, regenerate keys, change password authentication or reset passwords on failure.
- Fixed absolute sudo/Python paths avoid PATH substitution. The existing guest shell/startup remains a trust prerequisite; output is an authenticated guest report, not an attestation of root execution or independent verification. SSH policy uses parse-only -G and stays UNAVAILABLE if unsupported.
- Owner may need native UAC for the host operation, then the existing SSH and sudo passwords. These are authentication actions, not repeated code-entry requests. Passwords must never enter chat, arguments, environment, stored input or receipts.
- No VMConnect grant, host group membership, disk/seed operation, VM restart, network repair, account/shell modification, credential creation, protected-service change or package installation in this increment.
- Network authorization expiry is an execution deadline, not a native ACL TTL. Retain the exact journal; verified removal is a separate recorded operation. Do not claim automatic expiry or restoration.

## Work and checks

1. Implement the separate host profile and fixture tests, preserving existing strict modes. Independently review both policy preservation and exact rollback. No native mutation before the critical gate.
2. Add a root-only read-only guest inspector: fixed public identity/SSH/runtime inventory, bounded commands, no private keys, no writes. Test identity mismatch, invalid nonce, missing observations and public-key mismatch before implementation.
3. Prepare a native Windows SSH client with default validation-only behavior, pinned executable/source/known-hosts, fixed remote command, owner-operated password prompts and create-only public receipt. A terminal pipeline fixture must demonstrate that stdin remains an interactive console; it does not prove actual SSH/PAM/sudo success.
4. Run relevant source checks, independent review and exact-head CI. Record any remaining platform limitations. Keep Draft stack HOLD.
5. Ask the one reviewable critical network approval with source/plan pins and expiry. After approval, execute the scoped native operation and first authenticated inspection. If existing password authentication is unavailable or the host pin differs, stop without changing policy.
6. From the actual baseline, prepare the smallest precise credential/Verifier installation bundle. Then prove authenticated Goal → real Ollama → six actual independent checks → signed receipt → Windows OS reboot → same-Goal next-Job continuation. None is currently PASS.

## Ledger

- Existing isolated worktree reused on codex/1219-verifier-hardening, baseline3a674dab; primary checkout and unrelated untracked console proposal preserved.
- Native Windows SSH binary SHA25698d447730047f5df91373e852d057928a921c3d1e89938700ab656ba84b19dc8; Authenticode Valid.
- Real local PTY/pipeline fixture retained interactive stdin and delivered the non-secret fixture input. This is not an SSH, sudo or VM proof.
- Implementation/source/testing authorized by the owner's instruction to prepare changes and ask only critical execution gates. No additional routine design approval requested.

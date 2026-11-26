# AI-09 initial authenticated access implementation plan

> **For agentic workers:** Use executing-plans with delegated Windows implementation and independent review. Steps use checkbox syntax for tracking.

**Goal:** Supply reviewable inspection, bounded activation and verified rollback code for the missing initial AI-09 connection; keep actual activation separately gated.

**Architecture:** Reuse the fixed baseline guest command and host collector. Separate Windows Hyper-V ACL mutation from Ubuntu SSH authorization. Each executor defaults to read-only inspection, binds an independently supplied plan digest and owner approval reference, preserves original state, and records exact mutations before claiming success. No GUI injection, IP probing, installer fallback or authority bypass.

**Tech Stack:** Existing PowerShell 5.1/Hyper-V, Python 3/OpenSSH/systemd, Node test runner. No new package dependency.

**Spec:** docs/evidence/1219-ai09-access-gate-2026-10-19.md; owner continuation explicitly includes creating initial-access setup. Implementation must refine that proposal without claiming live activation.

## Global Constraints

- Issue1219; host HAJI; VM453b139b-cceb-446e-99fb-f45bf5895436; NIC00155DDC2C00; account ai09; TCP22; fresh single private IPv4 endpoints.
- Preserve ports8787/8796/8797, AI-09 VM, all prior media/worktrees/evidence and unrelated keys/rules/configuration.
- No real credential, permission, network, service or container mutation this implementation cycle. Fixture roots and mocked OS capability boundaries only.
- Expired, stale, mismatched, incomplete or unsupported plans refuse before mutation. No blanket rule removal, existing-file overwrite, package installation or automatic elevation.
- Actual independent signed checks, real Goal execution, OS reboot and successor execution remain separate physical acceptance.

## Review Focus

1. A stale baseline or failed postcondition must never overwrite an administrator's concurrent changes.
2. Apply failure and interrupted apply must retain enough evidence to remove only exact owned additions.
3. An untrusted payload cannot become a command, root path, SSH option or broader network scope.
4. Source/fixture validation cannot claim root authority, actual authentication or independent signing.
5. Shell startup, sshd Match precedence and inaccessible policy must not silently bypass fixed-command restrictions.

### Task 1: Bounded Windows ACL executor

**Files:** scripts/ai09-access-host.ps1; tests/ai09-access-host.test.ps1; tests/ai09-access-host.test.mjs.
**Interfaces:** Inspect/Apply/Rollback CLI, external SHA-pinned plan, expiring owner authorization reference and exclusive journal. Baseline binds VM/NIC/switch/endpoints/disk metadata and complete ACL projection. Apply adds exactly one stateful inboundTCP22 host/32 to guest/32 entry; rollback verifies and removes only the recorded addition.

- [x] Write executable PowerShell fixtures for default no mutation, scope/expiry/drift rejection, preservation, postcondition failure and exact rollback; observe RED.
- [x] Implement smallest executor and fixture boundary; run fixtures to GREEN.
- [x] Independently review code and verify no actual Hyper-V invocation in tests. Review found the versioned native manifest path; fixed with bounded discovery and 107 assertions in both PowerShell versions.

### Task 2: Bounded Ubuntu SSH authorization executor

**Files:** scripts/ai09-access-guest.py; tests/ai09-access-guest.test.py; tests/ai09-access-guest.test.mjs.
**Interfaces:** inspect/apply/rollback CLI, fixed filesystem destinations, existing SSH listener only, public key input only, independently pinned plan and approval reference. Inspect reads identity/effective policy and actual standard daemon contract. Apply creates dedicated root-owned gate/public authorization, appends a final Match block to the main config, and verifies policy before/after a fixed HUP request. Rollback removes only matching owned additions and verifies restored policy. An optional Bash-to-dash account change requires its own explicit approved action.

- [x] Write tests against real temporary files with simulated identity/sshd/systemd boundaries; observe RED for missing executor and each security boundary.
- [x] Implement bounded parser, exact public-key restrictions, baseline binding, journal and restoration; no private-key generation or general remote shell. Independent review fixes cover duplicate/CA authority, user-writable sources, service binding and expiry immediately before mutations.
- [ ] Validate actual installed Ubuntu sshd/service applicability. Not available in this cycle; native commands are fixture boundaries. Linux CI runs POSIX file-mode assertions but is not an installed AI-09 service proof.

### Task 3: Connect activation evidence to automatic collection

**Files:** scripts/ai09-access-handoff.mjs; tests/ai09-access-handoff.test.mjs; access evidence document.
**Interfaces:** validated host/guest activation receipts + separately owner-controlled client paths produce the existing collector config/known-hosts content. Require matching endpoints/identity/source/expiry; reject fixture/self-asserted success for physical claims. No network call or credential read by the compiler.

- [x] Write mismatch/expired/failed-receipt tests and successful exact handoff; observe RED.
- [x] Implement handoff compiler and create-only output; test GREEN. Handoff plus existing collector: 24 PASS, with no actual connection claim.
- [x] Document exact execution order, still-needed privileged bootstrap capability and rollback; retain honest limits.

### Task 4: Verification and durable handoff

- [x] Full lint/typecheck, targeted executable tests and independent review.
- [ ] Exact-head GitHub CI: record final outcome on Issue1219/PR1827 after commit; do not infer it from earlier CI.
- [ ] Update only permitted PROJECT_STATE fields, existing Draft1827 and Issue1219 with evidence; write Compass state.
- [x] Do not execute protected activation without its concrete critical approval and an actually available execution channel.

## Execution ledger

Baseline:3e30443c. Source design and execution already authorized by owner; no repeated design approval requested. Ordinary planning/source/tests proceed; actual privileged activation does not.

Read-only real CLI preflight returned `ADMIN_REQUIRED` on HAJI, and the existing collector returned `AUTHENTICATED_GUEST_TRANSPORT_NOT_PROVISIONED`. Neither raised UAC nor touched the VM. Guest fixture21 cases:20 PASS/1 POSIX skip on Windows; host fixture107 assertions in both PowerShell5.1 and pwsh. Current protected listener PIDs remain8787:10068,8796:33948,8797:25144,11434:12920. Existing user-writable key sources are deliberately unsupported rather than silently reconfigured; activation must resolve that from actual approved observations. State/CI completion records are written after the final source commit to preserve exact-head evidence.

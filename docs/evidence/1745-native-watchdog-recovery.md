# ZBook watchdog launcher recovery (#1745)

PR1746 merged as f54f8261ee644868d3eb5eba181f075ec9fb68b7 after independent review and successful PR CI37731916320. Owner governance approval for the worker-distribution guard is recorded in issue1745 comment6052976035 and PR1746 comment6052976230. Exact-main CI37732272129 passed all three jobs. No general persistence installer grant was supplied.

## Native attempt 1: read-only refusal

At2026-10-08T05:31:32Z, exact-main/CI verification passed, then `plan` refused `native-owner` before any target mutation. Wrapper receipt confirms planExitCode1, planVerified=false, publicationVerified=false. No apply phase ran and no helper was created.

Native inspection at05:47:15Z established the exact ownership baseline:

| Target | Owner | Group |
|---|---|---|
| GAIWorker directory | Administrators | current task user |
| gai-zbook-watchdog.ps1 | Administrators | current task user |
| gai-zbook-watchdog-launcher.vbs | current task user | current task user |

Watchdog SHA256 remains E5583739AFECB95DF465424AC836C25A2EBA3BA31F13991C921BA60B956AE7D7; malformed VBS remains19D72ED50FE9630FE9390CF296D9A2426F0251D4CE9053BCAA33591DC1E6AB5B. At06:18:23Z a native non-elevated process successfully opened the existing watchdog with ReadWrite access, then closed it without writing. This proves the current user has the needed existing access; no ACL/owner change or UAC is necessary.

## Bounded follow-up

The recovery now matches that exact mixed owner/group baseline. It updates the watchdog through an exclusive existing-file handle, preserving its file identity, Administrators ownership and ACL. Original bytes are durably backed up first; a caught write failure restores bytes through the same handle. Publication of the launcher stays last and uses the reviewed atomic writer. A process/power interruption during the existing-file write can require recovery from the retained backup; it is not claimed to be an atomic watchdog-script replacement. The malformed VBS is left unchanged until the writer update succeeds.

Backup files use CreateNew and Flush(true), followed by original-byte hash checks before target mutation. Write/flush failure stops in the backup stage. An existing backup cannot be overwritten. This explicitly requests disk flush; actual power-loss recovery remains a separate physical evidence gate.

Focused tests verify full SDDL equality, existing-file write, partial-write rollback and refusal while another reader has the file open. Hosted Windows fixtures exercise files created under the runner's Administrators ownership. The deployment workflow, permission rules, task XML, existing scope expiry and #1662 no-repeat ACL boundary are unchanged by this follow-up.

Physical watchdog recovery and the existing run37607612844 finalVerifier remain unverified. Native mutation attempts: zero; native plan attempts: one. This is a same-Issue follow-up PR because the actual owner baseline was discovered only after PR1746's protected integration.

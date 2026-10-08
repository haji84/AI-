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

## Native attempt 2: publication verified, Runner recovery blocked

PR1747 merged as 7b3e8678e55c91ab85214d9bf2533469cdf6d13e after independent review and PR CI37740929259. Exact-main CI37741317756 passed. Native plan and apply both exited 0; the wrapper completed at 2026-10-08T07:08:21.9252124Z. Cumulative native attempts are two plans and one apply. The earlier zero-mutation count above describes only attempt 1.

The installed launcher has one VBS program block. Original bytes and task XML remain under the native GAIWorker recovery-1745 directory for this exact source revision. The repair verified preserved ownership/ACL and task XML. At 07:49:30Z, task XML was still unchanged, the original node-loss receipt remained, and both periodic tasks had LastTaskResult 0. OnLogon's old result 1 was not rerun. These tasks remain Limited/Interactive: this is not proof of service startup without login.

Installed SHA256 values:

| File | SHA256 |
|---|---|
| gai-zbook-watchdog.ps1 | 915E66C329B806C149E05CCF4D2AE1D7C5A56811AB2119B1CAC35A5975DF8E03 |
| gai-zbook-watchdog-launcher.vbs | 646E8B2A31E7AF286A71DADDE8293DC9EB24A0960B918E656598D41692A751DD |
| gai-zbook-launcher-file.ps1 | 6DC1B72561197232F594D5DE1B64156C063C2B7790C344C85E4AB3DBDB9062B2 |

Successful scheduling does not imply successful Runner connection. At 07:49Z there was no Listener/Worker, health was false, and the newest Runner diagnostic log was still last modified on October 7. Old network-error log entries do not diagnose the current exit.

## Proven pre-log startup rejection

A version-only native probe produced FileLoadException 0x800711C7 for Runner.Listener.dll. CodeIntegrity Operational events 3077 and 3033 independently name that DLL and policy {0283ac0f-fff1-49ae-ada1-8a933130cad6}. Windows 11 Pro 25H2 build 26200.9457 has VerifiedAndReputablePolicyState=1 and the corresponding policy file present. Non-elevated CiTool inventory returned access denied; a complete policy inventory was not obtained.

At 2026-10-08T08:08:05Z, the official [Actions Runner v2.337.0 release](https://github.com/actions/runner/releases/tag/v2.337.0) ZIP was downloaded without installing or executing it. Its SHA256 matched GitHub's published digest 1150692AFA94E71F872017E254EA55B6EECE1EECE3FE7E3A6D4C93D0A1B85CFC. Reading the two entries directly from the verified ZIP proved exact installed-byte matches:

| Entry | SHA256 | Authenticode |
|---|---|---|
| bin/Runner.Listener.dll | 1E7CA4E92A682DB2013CA8DCFDD65378BA1D22DC0EC161F05EA0BFFFB967F264 | NotSigned |
| bin/Runner.Listener.exe | 72C36CC15E21605DC4ADC7C280E7AD9EA524FC8F1FB7B6905D3E0AE7DF7A5DE3 | NotSigned |

No Zone.Identifier stream was found on the installed DLL. There is no evidence of corruption in these two files; the remainder of the runner installation was not compared. No Runner file, registration, credential, trust metadata or Windows security setting was changed during this diagnosis.

The [Microsoft Smart App Control FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) explains that unsigned files lacking an accepted reputation can be blocked and that individual-app exceptions are unavailable. The supported security decision is recorded separately in docs/decisions/2026-10-08-zbook-runner-app-control.md; this evidence creates no permission to weaken protection.

## Remaining physical acceptance

GitHub run [37607612844](https://github.com/haji84/AI-/actions/runs/37607612844) still has five successful jobs and ZBook rejoin job112747693411 queued; final Verifier has not run. No duplicate fault run was started. The existing scenario tests Runner.Listener loss and artifact handoff, not Coordinator loss or network partition. Those later gates remain unverified.

Publication PASS; full watchdog/Runner recovery BLOCKED by application control. Preserve the reviewed files and backups rather than repeat the completed repair. #1662's separately observed ACL recurrence retains its no-repeat-removal boundary. Android38/identity40, the existing a49 native JARVIS runtime, and deferred Nubia scope remain unchanged.

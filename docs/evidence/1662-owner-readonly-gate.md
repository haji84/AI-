# Same-Owner read-only diagnostic — approved scope, execution unresolved

## Current recovery checkpoint

Owner explicitly approved the prepared additional read-only scope in chat; receipt: https://github.com/haji84/AI-/issues/1662#issuecomment-5936094420 (recorded2026-10-02T01:45:19+09:00). No new approval is inferred for service/process authority, ACL repair or runtime apply. Original expiry2026-10-02T20:18:17+09:00 remains unchanged. The pending text below is the historical preparation proposal, superseded as to approval status only.

Owner reports that the explicitly captured diagnostic displayed only `PROBE_START` for over10minutes, with no JSON or end receipt. This is HUMAN_VERIFIED failure evidence, not a successful elevated probe or a confirmed failing Windows cmdlet. Owner was advised to cancel that diagnostic with Ctrl+C; cancellation has not been independently observed. The earlier exit0 belonged to an unidentified prior command and was never acceptance evidence.

Code inspection establishes a boundedness defect: the five-minute deadline was checked between synchronous Windows calls and could not interrupt a blocked call. The outer `$result=@(...)` also held stdout until completion. Recovery keeps the same read-only operation, same Owner/UAC/policy/hash/exact-main/expiry/instance guards and all exclusions. A parent supervises only the dedicated diagnostic PowerShell it starts, relays fixed non-secret stages, and stops only its owned Process handle on deadline/cancellation/exception. It never discovers a PID to stop, stops a service/task/tree, changes policy or grants permission. Stop failure is explicitly `DIAGNOSTIC_STOP_UNCONFIRMED`; timeout is `PROBE_TIMEOUT` with the last observed stage. A silent exit0 is `PROBE_RECEIPT_MISSING`, never PASS. Output size is bounded and native stderr is not published. Repeatedly running the old unbounded helper is not the next strategy.

Regression fixture first failed because the external watchdog was absent, then passed against real dedicated subprocesses: hung call returns within the test deadline, last stage preserved, an unrelated control process remains alive, success JSON preserved, silent exit0 rejected, arbitrary stdout/stderr withheld, expired deadline starts no child. These are controlled Linux PowerShell fixtures, not physical Windows activation. The existing Windows runtime process-fixture entry point now runs these fixtures as well. No workflow permission or deployment behavior changes.

Artifact provenance must be renewed for the repaired helper after independent review and protected main/CI verification. The old hash below remains historical and must not be used with repaired bytes. Do not buffer the entire child output for the next manual invocation; fixed stage lines should appear live. Actual Windows hanging stage, process ownership, runtime apply and production distributed acceptance remain unresolved. Compass unavailable; repository checkpoint only, no fabricated Controller transition. Rollback is a reviewed code revert; production data/configuration/permissions are unchanged.

Repaired helper SHA256: `1cce708b65c07f1581522d2e3257be8478d030a096239d67ed813fbe5fafaa65`. Review caught a JSON-shaped private-output gap; a RED fixture reproduced it, then fixed public success/failure schemas and nested field/type validation passed. PS5 integer/string-date and PS7 integer/date parsing representations are handled without accepting floating/string counts. A second RED fixture showed unterminated lines bypassed the completed-line resource check; chunked1024-character reads now reject over16Ki characters across stdout/stderr before waiting for newline. Controlled regression fixtures PASS; full Node suite2121 (2116PASS/5SKIP/0FAIL), P8 security331PASS/0FAIL, lint/build/diff PASS. These checks never substitute for Windows physical evidence. The Owner must cancel the earlier diagnostic and regain the same shell prompt before manually retrying the revised hash-bound command. No automatic elevated retry or authority to terminate the old probe is inferred.

## Historical preparation proposal

Goal #1219/#681, child #1662. This is an additional narrow operation proposal, not an approval receipt or a new Goal. Owner asked to fix and execute **GORIQ Approved PC Runtime Refresh**; code/merge/exact-main deployment remain authorized within the existing expiry, but privilege expansion is excluded by the original #1662 scope and AGENTS.md. No elevated operation has run.

## Actual evidence

Run36889366703, source110460777841 PASS, ZBook110460901865 FAIL at2026-10-02T01:06:19+09:00, exact maina8b7d78fd13abcb05520a1badf99b572c2fc553b. Caller administratorRoleActive=false. Five service-related Node processes have missing commands and Owner-query access-denied: four directly own the four existing ports; their ancestor spans those ports. The other ten visible Nodes own no service ports. Exact process Owner and runtime identity are unproven. Read-only DB receipt PASS: compatible schema, quiescent,38Android/38identities, old revisionff761733c66f60a49e8c25c5ab0450a7a5e679c5, identityDigest0c3746f99d0fced8922479e143ebf05748401f9817b98990b854d61ae66bd66d.

Existing unauthenticated health/read-only metadata cannot prove OS ownership; Broker has no safe registered PC execution path (current fleet contains only38Android). Reusing watchdog task self-migration/elevated task rewriting, new token/permission, automatic self-elevation or ignoring process/ACL guards is outside scope. Repeating the same unprivileged plan yields no new ownership evidence.

## Concrete requested additional scope

One temporary **same Windows Owner administrator PowerShell context** for the reviewed `scripts/goriq-zbook-owner-readonly-probe.ps1`, before2026-10-02T20:18:17+09:00. The Owner must consent to the OS UAC prompt locally. Allow a dedicated process-only RemoteSigned invocation for this hash-verified probe; machine/user policy remains authoritative and unchanged. No self-elevation, password entry via chat/automation or stored privileged execution.

The script requires explicit OwnerApproved intent, unexpired scope, active administrator context, same Owner directory and existing Limited/Password/Running task principal, exact current-main successful CI, a caller-supplied recorded SHA256 matching its own bytes, and the observed immutable old manifest. It observes only existing port/process relations and bounded32 service-related Node Owner metadata. PID/name/creation time and OS Owner are rechecked around command observations; changed instances are discarded as instance-replaced. CIM observations are not atomic: command flags are retained/emitted only after same-Owner and instance-stability checks, not a claim of race-free retrieval. The probe has a five-minute deadline and10-second CIM call timeouts. It emits fixed non-secret classifications/counts/booleans, never raw commands, PIDs, paths, SIDs, account names, private config, credentials or keys. It is read-only and is **not** an apply authorization or a physical runtime/E2E PASS.

No task action/principal/permission, process stop/start, ACL change, DB read/write/import/schema, key or credential change, listener/firewall/TLS, fleet registration, GORIQ role grant or Android rollout. The script does not run from an automatic workflow. No changes need rollback: local staging is retained, shell privileges end with the process, production state stays untouched. Failure or another Owner/context leaves the refresh blocked.

Reviewed helper SHA256: `c8f5317db15481ea035478c5c8af55215cb3d54fdedbeb812c8cef5761f40a2b`. After approved preparation merge, verify protected main still contains these exact bytes and exact-main CI passed before giving the actual SourceRevision. Any helper change invalidates this hash and review.

After approval: the same Owner opens a temporary administrator PowerShell locally and consents to Windows UAC. Download only the exact merged helper to a retained local temporary staging file using the public raw GitHub URL, verify the recorded byte hash **before executing**, and pass that same recorded value to the helper's own check. No token, account, policy persistence or permission reset. A restrictive Group Policy or RemoteSigned refusal is a blocker, never a reason to unblock/change policy. Prepared invocation (replace `<verified-successful-main>` only after post-merge checks; do not execute while PENDING):

```powershell
$probeRevision='<verified-successful-main>'
$probeHash='c8f5317db15481ea035478c5c8af55215cb3d54fdedbeb812c8cef5761f40a2b'
$probePath=Join-Path $env:TEMP ('goriq-readonly-'+[guid]::NewGuid().ToString('N')+'.ps1')
Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/haji84/AI-/'+$probeRevision+'/scripts/goriq-zbook-owner-readonly-probe.ps1') -OutFile $probePath
if((Get-FileHash -LiteralPath $probePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $probeHash){throw 'PROBE_ARTIFACT_REJECTED'}
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $probePath -OwnerApproved -SourceRevision $probeRevision -ExpectedProbeSha256 $probeHash
```

Send only the last fixed JSON receipt. Keep local staging for inspection; there is no automatic deletion. Use its facts to prepare/review the actual minimum runtime repair. A process-authority or ACL change still needs its own concrete scope if required. Do not treat generic completion instructions as granting those changes.

AGENTS.md: “Separate Human Gate approval remains required for secrets/credentials, permission or token-scope changes” and “Completion authorization … never authorizes … security weakening”. The additional elevated context is outside the recorded non-privileged runtime refresh scope. Compass unavailable; repository handoff is used without fabricated Controller transitions.

## Preparation verification

Official Linux PowerShell parser PASS; PID/creation-time replacement fixtures PASS; no-approval, wrong-hash and non-Windows invocations produce fixed rejection JSON with exit1 as expected. These are guard checks, not physical Windows activation. Repository secret audit and diff check PASS. Initial independent review caught the PID-reuse gap and revision-versus-local-byte distinction; both were corrected before publication. Elevated execution remains PENDING.

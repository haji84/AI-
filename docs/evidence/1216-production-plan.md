# #1216 production plan — reviewable, not executed

Status: **PREPARED / SEPARATE APPROVALS PENDING**. This record does not claim a deployment, physical acceptance, or completed Cognitive Core. Prepared 2026-09-24. Owner requested: `本番反映できるところまではして そのあとゴリック自身でどこまで進めれるかを検証する`.

## Scope and exact baseline

- Issue: #1216; candidate PR: #1217.
- Audited source: `d029c800cd12fc6cf04a2adce96f40ba57be332b`; latest software within it: `44750d237bb20b452d3fa4a186930743404a5141`.
- Current main dependency baseline: `54b5df2a41eaef75e7c40a83474aceb8fc15b3be`. Refresh protected main and PR checks immediately before merge.
- Current native ZBook production: `773ee4ca34b7e8c3889897470a69e36fbc43564e`.
- Release directory: `C:\Users\qq113\JARVIS\releases\773ee4ca34b7e8c3889897470a69e36fbc43564e`.
- Protected configuration: `C:\Users\qq113\JARVIS\production\config.dpapi`.
- Persistent Broker DB: `C:\Users\qq113\JARVIS\production\data\broker.sqlite`.
- Native launcher: `C:\Users\qq113\JARVIS\production\launch-current.ps1`.
- Existing task: `JARVIS Remote Host`, Running, Password logon, Limited. Its action invokes Windows PowerShell with process-scoped RemoteSigned and the established compatibility launcher `C:\Users\qq113\AppData\Local\JARVIS\production\launch-current.ps1`; working directory `C:\WINDOWS`. Preserve the task definition/credential and native compatibility path.
- Observed HTTP 200: `http://127.0.0.1:3000/api/health`, `http://127.0.0.1:8787/health`, `https://haji.tail93987e.ts.net/jarvis`.

No new installer, task registration, password prompt, secret rotation, device APK, public ingress, firewall change or Tailscale change is included.

## Read-only fleet evidence

[Machine-readable baseline](1216-production-baseline.json), captured 2026-09-24T02:38:54.397Z from a read-only SQLite transaction:

- 38 fleet records / 38 unique IDs; 38 identity records / 38 unique IDs.
- Every fleet node has an unrevoked public-key identity; SQL row IDs match payload IDs.
- All 38 identities use `ecdsa-p256-sha256`.
- READY 38, offline 0, queued 0, running 0, completed 75, failed 0; 81 task-history records, zero active takeovers.
- Existing tables: `jarvis_state`, `jarvis_worker_identity` only.
- `broker.sqlite.compass.sqlite` does not yet exist.
- Record contains aggregate identity/enrollment/capability/task hashes; no public-key text, secret values or individual device IDs.

These are point-in-time server observations, not 38 physical interaction tests. Refresh the baseline before activation; expected heartbeats/timestamps may change. Compare identity and enrollment hashes separately from volatile status. Any new enrollment between snapshots must be retained and explained, never overwritten with an earlier baseline.

## Main dependency delta and explicit approval boundaries

Old production to current main contains **375 files, 41,305 additions and 671 deletions**. A full native release switch is broader than PR #1217's direct diff. Review the combined change, preserving previous physical-facing PR holds (#883/#884/#1195/#1208) and excluding unmerged UI PRs #1214/#1215.

Material inherited runtime changes include:

1. Durable nonce replay protection. Opening the existing Broker DB with current main creates `jarvis_worker_nonce(node_id, nonce, expires_at)` and index `jarvis_worker_nonce_expires_at`. Expired nonce cleanup is part of this reviewed security feature. No existing fleet/identity table is removed or recreated.
2. Broker starts a separate Compass DB at `broker.sqlite.compass.sqlite` by default. Its existing Compass schema includes Goal/state/history/verification tables. It is separate from the development Compass MCP store; do not point it at the parent's active #681 database.
3. Fleet restoration rejects duplicate device IDs; the read-only baseline has none.
4. Trusted PIN and Goal/requirement intake/diagnostic integrations become available. Preserve owner passcode fallback; do not enroll a trusted browser or alter credentials as part of deployment.

There is no old-production-to-main change in the Worker APK path, remote Gateway, private Worker ingress, control-plane implementation or Windows production configuration loader. This does not substitute for signed reconnect verification after restart.

**Separate approval required before existing DB schema mutation / migration execution**, per the user-supplied AGENTS.md rule prohibiting `database schema changes or migration execution` without explicit human approval. Include the exact additive nonce table/index and separate new Compass DB in that approval. General completion/deployment authorization must not be silently treated as this approval.

### Vercel deployment governance

The supervising agent observed Vercel's main-branch automatic production assignment enabled during this audit. The exact observation/screenshot and current project must be revalidated and recorded by the activating agent before changing anything. This local plan does not fabricate a Vercel API receipt.

Two independent paths must not be confused:

- Vercel Git integration can assign a main build to Production independently of the repository's scoped workflow. To enforce exact-main-CI-before-Production, prepare an explicitly approved temporary change: record current assignment setting, turn automatic production assignment OFF, merge and await exact main CI, perform the reviewed deployment/promotion, then restore the previous setting only at the agreed safe point. **This changes deployment governance and needs its own explicit approval.** Do not merge first and assume a missing workflow marker prevents Git integration deployment.
- `.github/workflows/vercel-scoped-production-deploy.yml` targets `unified-ai-creator-studio`, not the local ZBook, and upserts sensitive Vercel environment variables. **Do not add `ai-company-production-deploy: approved` PR metadata or trigger this workflow for the ZBook deployment.** Existing-secret synchronization/bootstrap is outside this task's ordinary deployment authorization. Do not change the workflow or secrets to bypass it.

A temporary Vercel assignment change must be restored or its reason for remaining off clearly recorded, even if the ZBook deployment fails. Do not restore a configuration that would promote an unverified pending candidate.

## Synthetic compatibility evidence (not production migration)

[Result](1216-additive-compatibility.json); [reproduction script](1216-verify-additive-compatibility.mjs).

Executed on Windows / Node v24.19.0 against audited source `d029c800cd12fc6cf04a2adce96f40ba57be332b`. The script first checks the installed old Store source exactly matches `git show 773ee4...:src/jarvis/sqlite-state-store.ts`, then creates a new temporary SQLite DB using that old implementation and synthetic identity/queued-task/audit records only.

PASS:

1. Old Store creates only the old two-table schema.
2. New Store opens it and retains the full synthetic snapshot and identity.
3. New nonce table/index appear and a nonce survives close/reopen.
4. Old Store still reads the same identity/queued-task/audit snapshot after the additive change.
5. Reopening with new Store still reads those records and the persisted nonce.

Reproduce in the candidate release root:

```powershell
$env:GORIQ_PREVIOUS_RELEASE_ROOT='C:\Users\qq113\JARVIS\releases\773ee4ca34b7e8c3889897470a69e36fbc43564e'
node docs/evidence/1216-verify-additive-compatibility.mjs
```

No production DB is opened by this test. Temporary synthetic artifacts are retained. This proves the tested data-read compatibility only; it neither authorizes live migration nor proves signed real-device recovery. The old runtime does not enforce the new durable nonce protection, so an old-code rollback is a temporary return to the pre-change baseline, not a durable replay-protection PASS.

## Exact task-scoped deployment receipt

Issue #1216 must contain the real owner instruction and reviewed environment/scope. Create a **new** local non-secret receipt after the exact merged commit and successful main CI are known. Do not reuse #875/#871 receipts or issue fake authorization while prerequisites are missing.

Required fields/checks:

- `scopeId: issue:1216`, `issueUrl`, PR #1217 (or the actually reviewed task PR).
- `environment: zbook-native-production`, exact 40-character merged `commit`, exact `previousCommit`.
- `productionUpdateApproved: true`, original owner instruction, evidence reference and timestamp.
- `issuedAt`, `expiresAt` (bounded to this activation window, proposed maximum 24 hours); activation must reject expiry or future issuance.
- `mainCi: success`, exact main push CI run ID/URL and matching head SHA.
- Hash of immutable release manifest and checked production build provenance.
- Separately evidenced schema approval and deployment-governance approval, or a explicit blocked state if either remains missing.
- Reviewed rollback scope: prior code/config/launcher with current durable state retained.

A receipt is evidence of owner authority, not an authority generator. Placeholder SHAs, missing source evidence, mismatched environment, changing task scope or expired receipts fail closed.

## Before activation checklist

- [ ] PR exact diff + inherited main delta reviewed, no unresolved mandatory review threads; all required tests/security/build pass at current head.
- [ ] Required separate approvals are recorded; Vercel automatic promotion cannot outrun successful main CI.
- [ ] Exact merged commit has successful main CI; local authorization matches it and is unexpired.
- [ ] Immutable archive/build installed at `C:\Users\qq113\JARVIS\releases\<merged-sha>`; release manifest matches. Do not serve the mutable worktree.
- [ ] Current task/process tree captured using PID **and creation time**, listener ownership verified for 3000/8787/8790/8792. Do not kill a same-PID replacement or unrelated Node service.
- [ ] Refresh unique IDs, identity/public-key metadata hashes, enrollment/capabilities, task IDs/states, zero active jobs/takeovers, current invitations and teaching/audit file hashes/counts.
- [ ] Capture protected consistent Broker backup using SQLite backup API or fully quiescent DB/WAL. Preserve encrypted config, native/compatibility launchers and deployment setting snapshots. Raw credential/DB backups never enter Git or logs.
- [ ] Compare old/new config in memory: existing credential values, enrollment URLs, tool paths, DB path, teaching/audit/recording paths and allowed serials are identical; only exact release root/commit differ.
- [ ] Core host configuration is non-secret and isolated: optional `GORIQ_LOCAL_MATERIAL_INTAKE=1`, `GORIQ_LOCAL_DATA_ROOT=C:\Users\qq113\JARVIS\production\data\cognitive-materials`, `GAI_LOCAL_MODEL_NAME=qwen3:4b`, loopback endpoint `http://127.0.0.1:11434`. No model download or external fallback.
- [ ] Do not add these Core variables to the DPAPI allowlist ad hoc. Existing launcher child environment / reviewed non-secret release environment can supply them. Record exact before/after values; manifests/outcomes/intake are mutually exclusive.
- [ ] Candidate configuration validates with the candidate release and existing credential values; archive and backup paths stay outside MSIX AppData virtualization.

Existing local helpers `871-deploy.ps1` / `875-activate.ps1` document the previous procedure. They are commit/issue-bound historical records, **not scripts to rerun unchanged**. Prepare a new #1216-bound activation operation. Do not invoke the new-installation script or register another scheduled task.

## Activation and after checklist

- [ ] Stop only the identified existing host/task process tree; verify service ports are released. No automatic force-kill of unknown owners.
- [ ] Apply approved candidate config/launcher; reuse the existing Limited task and stored Windows credential. No Windows identity/permission changes.
- [ ] Start candidate and observe bounded health deadline; private URL and all four listeners respond from the expected exact release.
- [ ] Unauthenticated owner/control endpoints remain denied; owner login fallback works with the preserved secret.
- [ ] Registered 38 existing identities, enrollment state and public-key metadata remain identical (or explain legitimate concurrent additions); no re-enrollment/version changes.
- [ ] Observe fresh signed reconnect/heartbeats. READY labels alone are not remote-control or full physical evidence.
- [ ] Queue/history/audit/teaching/invitation records preserved; no dropped pending/running jobs, new duplicate jobs or rejected valid identities.
- [ ] New nonce schema exists only after approved activation; new Compass DB exists separately and development Compass #681 remains unchanged.
- [ ] `/jarvis/tasks` shows Core state through actual production authentication/proxy/Broker; 390px and desktop checks preserve existing menu/remote access.
- [ ] Run the bounded real local-Brain evaluation described below and capture independent output receipts, timing, calls, stop reason and limitations.
- [ ] Record exact deployed SHA/build/CI, local receipt, before/after comparisons and any transient outage. Restore the approved Vercel setting at the agreed safe point and independently verify that state.

## Rollback without losing newer state

On failed health/identity/queue/auth verification, stop the exact candidate process tree and return to the prior native release/config/launcher. Keep the **current** Broker DB including the additive nonce table and any newly registered devices/tasks/results; the synthetic test proves the old reader ignores the additive table. Do not DROP the nonce table/index. Keep the new separate Compass DB and Cognitive learning/material files for inspection and future recovery; the old runtime need not use them.

Never restore a stale Broker snapshot over newer enrollment, task history, recordings or learning. Database restoration is a separate recovery decision only if corruption is demonstrated, with protected backup comparison and a plan to preserve/reconcile newer state. Do not automatically delete new files.

After rollback verify old exact code, original four listeners/private URL, owner authentication, unchanged device identities/credentials, and retained tasks/history. Report the loss of newly introduced durable nonce enforcement under old code; restore the corrected new runtime promptly through the approved process. Rollback success is independent of later reboot/power-loss acceptance.

## Real GORIQ capability evaluation after deployment

Use existing real `qwen3:4b` on loopback; external AI stays disabled. A scripted oracle may verify results, but Codex must not perform the task on GORIQ's behalf.

1. Read production Core state. The new Broker Compass file did not exist at baseline. If an owner Goal appears before testing, preserve it and use a separately identified evaluation store; never overwrite it.
2. Through normal authenticated `/api/jarvis/work`, submit one bounded local material Goal. Ask the real `/api/jarvis/cognitive/goal/proposal` path for completion criteria and record semantic adequacy as a separate result. Explicit owner-style adoption/acknowledgement remains required; model text is not authority.
3. Upload a benign test text/workbook/document material, acknowledge exact criteria, and request `/api/jarvis/cognitive` POST with that Goal ID. Each call is bounded to three cycles.
4. Download through the production output route; independently inspect exact bytes/hash or Office content. Record local-model action source, attempts, verification receipts, external-AI calls, time, learning state and stopping reason.
5. Test unsupported/unknown work and model-unavailable continuation only in a clearly labelled isolated evaluation store loaded from the same immutable production release if the singleton production Goal prevents another independent task. Do not relabel that isolated test as a second production Goal.

Existing `goriq-local-brain-smoke.ts` supplies a host-written `42` action manifest; it proves catalog selection/execution, not arbitrary task invention. Existing browser proposal fixture is synthetic and must not be used as real-model evidence. Report independently: real production flow, isolated same-release tests, subjective proposal quality, fixed-capability limitations, remaining software gaps and physical tests not performed.
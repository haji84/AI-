# Development load and cost audit (#1845)

Baseline main: cb6b0fa06492b3d610ecb527645244b9a46ba8eb. Parent Goal/product specifications remain unchanged. This evidence covers source placement and observed runs, not an installed runtime update or proof of freeze prevention.

## Placement and execution evidence

The companion job inventory covers all75 workflows and135 declared jobs (138 after the three2-runner matrices). Current placement:43 hosted,49 Windows,40 Mac,3 mixed. Capability/dependency classification differs where a currently physical job is computationally portable but still depends on local inputs. See1845-workflow-job-audit.json and1845-workflow-audit.md for every job and its A-F tags, triggers, dependencies, artifacts/cache settings and rationale.

Ordinary main CI already has3 hosted jobs: Ubuntu guard/project checks and Windows byte fixtures. The observed PR1827 CI adds its own hosted independent-verifier job. Do not recreate or move this CI.

The fully paginated124-run daily snapshot is in1845-actions-history.json. The first100 records included13 CI runs and four13-run followers: advisory review, PR recovery, scoped deployment, token repair. The latter two were skipped for all13. Their startup records are not evidence that a ZBook process actually ran. Required review/security/deployment fences remain intact.

Native recovery39572807594/job119130944931 started17:54:28JST and has reported completion18:37:24, overlapping the first18:28 memory warning. Its individual step timestamps extend later than job completion; exact compute occupancy cannot be inferred from this inconsistent metadata. Another recovery39560463655/job119090249577 ran16:13:26-16:33:40JST. Dependency installation took10/11 seconds in these samples. Historical CPU/RAM/commit metrics were not recorded by these API responses and remain UNKNOWN.

Confirmed unnecessary work: recovery installs dependencies before controller rejection for no allowed repair path or a stale queued head. Move the existing path/current-head eligibility decision to trusted hosted preflight and recheck the queued receipt before expensive native work. Keep the existing runtime and final push fences. R1 workflows share baseline/check commands but have different resume/publication semantics, so no removal is justified. Four existing installer workflows share the same Builder workspace/task/port and can conflict; this is a source-level contention risk, not proof of the freeze's cause. No installer is run by this task.

## Cost and external side effects

Verified2026-10-21 from GitHub repository metadata: haji84/AI- is public. Standard hosted ubuntu-latest/windows-latest runners are free on public repositories, currently4vCPU/16GB. This does not authorize larger/GPU runners, account billing changes or new providers. [Official runner specification](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Storage is evaluated separately. GitHub documents hourly artifact/Packages storage accounting and a separate10GB cache allowance; cache overage requires a configured limit above the included allowance. Shared account allowances/current billing are not visible here, so no claim of zero storage charges is made. This task adds no artifact upload, retention increase, cache-cap increase or new external service. [Official billing/storage rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

The connected GitHub fetch tool does not support repository artifact/cache usage endpoints; read-only unauthenticated public REST metadata is the fallback. No diagnostic artifact content is downloaded/uploaded. Account-wide billing/payment settings are not accessed or changed. Current cache usage was100,651,600bytes across30 entries. Full artifact metadata summary is recorded separately when available; retained size is not historical accrued billing.

Existing workflow metadata lists deploy/token/publication effects. This task changes neither those authority surfaces nor triggers that could bypass their gates. No Production deployment is requested.

## Diagnosis

See1845-zbook-diagnosis.json: system commit exhaustion CONFIRMED; its causal role in the cascade PROBABLE/high confidence; memory leak/allocation culprit UNKNOWN. Resource-Exhaustion Detector failure is itself evidence of missing allocatable memory. GPU TDR and HAL/IOMMU faults are confirmed additional abnormalities whose primary/secondary role is unknown. Reliability records independently reproduce122 Application Error records including72Git,26conhost,6DWM crashes. Raw local diagnostic files remain local.

## Comparison and acceptance boundaries

Before: no execution-time native pressure admission at the direct Builder/Ollama seams; identical unit/integration standard commands execute twice; output accumulation is bounded per chunk but not in total; impossible/stale repairs install dependencies before rejection.

After implementation (source and isolated fixtures):

| Observable | Before | After | Evidence boundary |
|---|---|---|---|
| Identical unit/integration command | 2 subprocesses | 1 subprocess; both check records reference the shared execution | real subprocess counter fixture; distinct lint/security/build checks retained |
| Builder stdout/stderr retention | each chunk sliced, total unbounded | at most100000 characters per stream; truncated candidate snapshots rejected | multi-chunk real child-process fixture |
| Pressure or concurrent heavy lane | no fresh native admission at these seams | no heavy callback/model transport; typed503/CLI75 wait | commit pressure despite free RAM; cross-process contention tests |
| Durable pressure wait | generic failure/rejection or repeated bounded calls | persisted ChangeSet/TDD,20 observations/30min budget, one-shot Broker wake | process recreation, due/deadline, pause, in-flight Human Gate and history-conflict tests |
| Unrepairable/stale CI receipt | native dependency install before rejection | hosted rejection; queued receipt checked before target/setup/install | paginated API fixtures and source workflow contract; actual future avoided-run counts unmeasured |

The common heavy lane is per OS user, across repository checkouts and job kinds; it does not coordinate other service identities, remote nodes, external unmanaged Ollama callers or already-running jobs. Required Windows commit telemetry fails closed; optional unavailable GPU tooling remains unknown. Disk admission uses the target workspace filesystem. Initial thresholds are CPU/GPU90%, Windows commit85%, available RAM2048MiB, disk8192MiB, observed GPU free256MiB and observed disk busy90%. Admission serializes future managed starts and does not terminate an existing job under pressure.

Native read-only sample12:48:48.918Z: CPU17%, RAM available8458MiB, commit28797.68/46255.63MiB, workspace disk free47357.34MiB/busy1%, NVIDIA0%/free3862MiB. Probe duration2328ms. No Application1000/1002 or selected resource/WHEA/display/disk signals were found from21:10 to21:48:48JST. These are point-in-time observations, not a benchmark or guarantee of stability. Historical job memory/CPU, long-run failure rates and before/after freeze recurrence remain UNKNOWN.

Integrated serial regression:194/194 PASS,0 skipped,11795.6ms; scoped ESLint, changed TypeScript dependency-graph check and diff whitespace check PASS. Full hosted CI and final independent-review receipts are recorded on the issue PR; no old head result may certify a newer head. Reviewer-found in-flight gate overwrite and wrong-filesystem disk probe were reproduced then fixed with regressions before integration.

The full lint/test/security/build run belongs on existing hosted CI. Local tests are targeted and serial to protect this host. Long-run freeze recurrence, real model workload effects and any changed live installation remain unverified until observed under a separate safe execution scope.

## Safe continuation and additional diagnostics

Code/configuration rollback is a revert of this issue's reviewed merge; no running service/configuration rollback is involved because no installer or service replacement is executed. Normal development remains possible; retaining hosted ordinary CI and admitting only compatible native work is the intended division. A blanket cloud migration is not required by this evidence.

Before attributing a leak or declaring freeze prevention, collect a bounded time series of system commit and per-process Private Bytes/commit, process parent/child counts, Job/run/head identifiers and Ollama model/GPU residency during a separately authorized normal workload. Review the retained local crash dumps/LiveKernelReports with appropriate access, correlate HAL IOMMU device identity and TDR chronology, and investigate pagefile/SSD growth timing. Read current VM configuration only with sufficient authority; current6GiB VM evidence does not establish its historical peak. Do not run stress tests, change pagefile/drivers, restart services or deploy copied runtimes under this task's no-interruption constraint.

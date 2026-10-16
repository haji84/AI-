# AI-09 evidence-first finding triage and repair proposal

Related: Issue #1805. Extend, do not replace, the existing GitHub-hosted AI-09 reviewer and its bot advisory comments.

## What is implemented
- The existing review remains read-only, bound to exact head/base and GitHub compare patch. Its model text has evidence class `AI_ASSERTED`, even when the changed-line code quote matches.
- Existing `anchorAudit` is the first quality gate. Generic warnings, nonexistent file lines, quoted prompt delimiters and fictitious locations do not establish the cited changed-code line. These patterns are covered by deterministic regression cases.
- `scripts/goriq-ai09-independent-triage.mjs` provides a pure, *non-dispatching* `prepareVerifiedRepairProposal` step. It recomputes the SHA-256 of trusted canonical GitHub patch, checks the model's changed-line citation, requires a separately supplied verifier reference and demands a trusted adapter that authenticates an independent reproduction on the **same** head/base/patch/path/line. Model-provided JSON cannot serve as the adapter.
- Failure or missing evidence returns `TRIAGE_REQUIRED` with no task. An authenticated, independently reproduced failure can produce only `VERIFIED_CANDIDATE` and a bounded handoff proposal that obeys `docs/runbooks/agent-handoff.md`. Free-form model instructions do not go into its task details.
- The proposal has `correctionTaskCreated:false`, `builderAcknowledged:false`, `writeAuthorized:false`, `githubApprovalSatisfied:false` and `mergeAuthorized:false`. It is not an actual Builder/Debugger acknowledgement, permission grant, verified repair or deployment.


## Real-model quality experiment: fail-closed result

The isolated [GitHub-hosted evaluation run #38883743643](https://github.com/haji84/AI-/actions/runs/38883743643) exercised actual `qwen2.5-coder:3b` inference on **six curated synthetic examples** with the proposed evidence-first prompt. It was **FAILURE**, not a qualified benchmark pass: 4/6 expected decisions, two positive defect detections, zero asserted false positives, two benign clean verdicts, and two `INCONCLUSIVE` results (one defective credential logging example and one benign fixed-command example). Conservative confusion matrix: TP2/FP0/TN2/FN1, abstention2; measured synthetic precision 1.0, recall 0.667. These are tiny synthetic data, not validated real PR vulnerability-detection rates.

**Rollback/hold decision:** this new instruction is limited to the read-only experimental benchmark. Do not add it to either operating `scripts/goriq-ai09-ci-review.mjs` or `scripts/goriq-ai09-race-review.mjs` until a broader real case-labeled quality evaluation shows no unacceptable regression. Existing deployed model prompt, source quote anchoring, advisory/commenting and token scopes remain unchanged. Never improve the benchmark score by changing expected labels or treating `INCONCLUSIVE` as `NO_ACTIONABLE_FINDINGS`.

## Deterministic grounding quality fixture
Run `node --test tests/ai09-independent-triage.test.mjs`. The fixed `GROUNDING_CORPUS`
contains 18 labeled source-citation cases. It measures whether a claimed exact
added-line quote exists in the canonical diff. Expected confusion matrix:
4 true-positive source citations, 14 correctly rejected false citations,
0 false-positive matches, 0 missed matching citations. Precision/recall for
this **curated source-location fixture** are 1.0/1.0. These are **not**
vulnerability detection accuracy, actual AI model precision, or evidence
that a line with correct quotation is defective. A separate labeled set of
genuine real-world defects and benign changes is still required.

## Read-only authenticated GitHub human verifier adapter
The optional `scripts/goriq-ai09-github-human-verifier.mjs` exports
`createGitHubHumanReproductionVerifier`. A trusted controller, not a
model, supplies an allowlist of eligible separate human GitHub logins, a
Builder identity, and a read-only authenticated `githubGet(path)` function.
The only permitted lookup paths are the current `/pulls/<number>` and its
bounded first page of `/reviews?per_page=100&page=1`. If the list is
incomplete, the proof is rejected.

A `verificationRef` has shape `gh:review:<numeric-review-id>`.
The matching GitHub review must be a `COMMENTED` review on the exact
current head, submitted by an allowlisted `User` separate from the PR
author, Builder and AI-09. The body starts with the literal line
`AI09_INDEPENDENT_REPRODUCTION_V1`, then strict JSON:
```json
{
  "schemaVersion": 1,
  "repository": "owner/repo",
  "prNumber": 73,
  "headSha": "<exact-head-sha>",
  "baseSha": "<exact-base-sha>",
  "patchSha256": "<canonical-64-hex-digest>",
  "path": "src/example.mjs",
  "line": 1,
  "findingIndex": 0,
  "reproduced": true,
  "reproductionCaseRef": "ci:job:repro123",
  "reproductionSha256": "<64-hex-evidence-digest>"
}
```
This is an **authenticated independent HUMAN_VERIFIED attestation** whose
source is a GitHub-authenticated reviewer; its free-form model output cannot
manufacture that identity. The interface does **not** independently download
or hash the referenced failure log. A human verifier must genuinely
reproduce and substantiate the failure; an attestation from a valid account
is not proof that the test environment or reported digest was authentic.
Do not label it `MACHINE_VERIFIED` or claim an automated replay occurred.

The resulting handoff is only `VERIFIED_CANDIDATE`,
`PROPOSAL_PENDING_AUTHORITY_AND_ACK`: it never creates a task or gives
the Builder repository write permission. A live separately authenticated
verifier has not been provisioned in this development PR, and simulated
tests must never be called an actual independent approval.

## Trust boundary before real connection
An implementation of the trusted verifier adapter **must** obtain authenticated independent test/reproduction records from the actual source, verify the issuer and builder separation, validate source revision and evidence digest, and reject stale or conflicting states. Passing a callback in unit tests only proves the code contract. A model verdict, submitted PR comment, untrusted artifact or unchecked source text cannot authenticate its own reproduction.

The adapter must only be constructed by the trusted controller, **never** by AI-09 model output. The caller must provide the actual, fully validated GitHub comparison patch. Do not execute code, commands or tests suggested by an untrusted model while evaluating an allegation.


## GitHub Actions raw failure-log verification (Issue #1805)

`scripts/goriq-ai09-actions-proof.mjs` adds a **read-only** exact-head log
provenance gate. Human review `reproductionCaseRef` must use
`gh:job:<numeric-id>` and `reproductionSha256` must be the SHA-256 of
the raw, unmodified job-log bytes. The trusted verifier independently reads:

1. GitHub REST `GET /actions/jobs/<id>`. Job must be completed FAILURE on the exact PR head.
2. GitHub REST `GET /actions/runs/<run-id>`. The run must be a completed
   pull-request `CI` workflow, exact head/repository, linked PR number,
   head SHA and base SHA, with the same repository identity.
3. GitHub REST `GET /actions/jobs/<id>/logs`. Fetch complete raw log bytes,
   bounded to 2 MiB, and recompute SHA-256 before accepting the human statement.

GitHub-supplied log downloads may redirect to signed GitHub-managed storage.
The client uses a separate unauthenticated HTTPS GET for approved storage
hosts and never forwards the GitHub token to redirected hosts. A second
redirect, unknown endpoint/host, missing/error log, stale head, successful
job, incomplete PR link or digest mismatch rejects the proof.

The independently authenticated **GitHub human review** is necessary but
not sufficient: `createGitHubHumanReproductionVerifier` now also requires a
trusted `verifyReproductionEvidence` callback. If a raw log is missing or
its digest differs, even an allowlisted review author cannot promote an
AI-09 allegation. The combined result proves job-log provenance plus the
human's attestation. It does **not** by itself establish that the failing
test substantively proves the model's particular alleged defect. The
failure mechanism must be independently interpreted or reproduced.

The production wiring requires an authenticated read-only token within the
existing permissions and a trusted controller to instantiate both adapters.
This PR does not add a token or workflow permission. Unit-test HTTP fixtures
are **not a live GitHub Actions network acceptance**.

## GORIQ Builder receipt evidence

`scripts/goriq-ai09-builder-receipt.mjs` only **reads** a trusted
`WorkStateStore.get(goalId)` and a separate authenticated Builder receipt
source. The Goal Controller must already have created a real child work item
with exact task identity, active status and one allowed path. The trusted
receipt must match goal ID, task/work-item ID, revision SHA, patch digest,
verifier evidence ID, receiving Builder identity and receipt timestamp.
Only then is the result `BUILDER_RECEIPT_MATCHED`. It **never grants**
write, merge, deploy or security policy authority.

This mirrors the existing
`src/orchestrator/work-state.ts` `WorkStateStore` contract and its
`CompassWorkStateStoreAdapter`. It does not independently insert or
acknowledge a work item. Real acceptance requires a resident GORIQ
Goal Controller with a persistent state and an authenticated receiving
Builder agent. The present mocks cannot stand in for that real system.

## Next gates
1. Establish a measured independent evaluation set with labeled true/false defects, changed-line grounding and replayable regression evidence. Track false-positive and missed-defect rates separately. The current small synthetic/model pilots are not proof of real-world detection accuracy.
2. Implement/authenticate the separate verifier provider and demonstrate genuine reproduction, including negative/stale/forged cases.
3. Only after a trusted task authority separately authorizes permitted paths and the receiving Builder/Debugger acknowledges the proposal, record an actual task receipt. Recheck the corrected head, CI and independent signoff before completion.
4. No automatic merge or GitHub APPROVED from the AI's recommendation. Keep current bot advisory workflow, permission scopes and repository protection unchanged.

## Rollback
The new triage module is not registered as an automatic task dispatcher or workflow job. Revert its addition and the tests/docs by a reviewed, protected PR if it proves unsafe. Existing AI-09 automation remains available. No credentials, CI permissions, host state, deployed modules or model providers were changed by this Issue.

## Owner-authorized, read-only live Broker and Builder connectivity

The owner expressly authorized connecting the existing GORIQ Broker and Builder.
This is a scoped **connection and evidence inspection** approval only. It does
not authorize new tokens, credential rotation, installer re-execution,
privileged code execution, remote public exposure, unsafe LAN tunneling,
automatic fixes or altered branch protection.

The new `scripts/goriq-ai09-live-broker-builder-probe.mjs` checks only the
pre-existing local endpoints. On the Mac host it performs authenticated GET
`http://127.0.0.1:8787/health` followed by the owner-protected
`GET /api/jarvis/admin/bridge/events?goalId=ai09-connection-probe`.
The public health response alone is not accepted as owner authentication.
On ZBook it performs a bearer-authenticated
`GET http://127.0.0.1:8796/health` and requires the real
`code-builder-worker` service and `code-builder` capability. The read-only
test can also inspect an *already existing* Goal Work Run by ID; it will not
create one. The Mac and ZBook can be verified separately because loopback
addresses refer to different machines.

`.github/workflows/goriq-ai09-owner-builder-connect.yml` provides two
strictly read-only self-hosted jobs. It accepts only an owner-created or
owner-reopened Issue titled with the prefix `[AI09 READONLY CONNECT]` or
a trusted `workflow_dispatch`. Both jobs check out only protected `main`,
require current main SHA, and have `contents: read` with no write
permissions. The Mac job reads its **existing** protected JARVIS environment;
the Windows job reads its **existing** local Builder token file. Both use
tokens only against 127.0.0.1 and report bounded, non-secret statuses.
No source is executed from a pull-request head on a credentialed host.

**Activation is not achieved by this Draft PR.** GitHub Actions only enables
the new owner-only Issue trigger when its workflow is reviewed and integrated
into the repository's default branch. There is no remote trigger to this
host from the ChatGPT GitHub connector before that protected integration.
The protected main workflow must receive an independent risk/security review
before main integration. Owner approval cannot transform an unverified
self-review into independent approval.

**Passing both read-only host checks is not Builder acceptance.**
An actual approved task still requires a current-head reproduced finding,
a durable GORIQ Goal Controller WorkState task, and an authenticated
Builder/Debugger receipt ID from the worker itself. A healthy process,
a 202 Goal intake response, a completed Work Run, or a GitHub Issue is never
such a receipt. `scripts/goriq-ai09-builder-receipt.mjs` must validate
the exact task and receipt against durable state before the result can be
called `BUILDER_RECEIPT_MATCHED`. The current Builder service exposes
`GET /health`, `POST /verify` and `POST /build`, but not a trusted
task-acceptance receipt endpoint. Do not invent an ACK from those routes.

Rollback: protected PR revert of these additive probe/workflow files and
tests. No existing runtime, credentials, permissions or user data changed
by simply proposing this connection workflow.

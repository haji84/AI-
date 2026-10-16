# AI-09 evidence-first finding triage and repair proposal

Related: Issue #1805. Extend, do not replace, the existing GitHub-hosted AI-09 reviewer and its bot advisory comments.

## What is implemented
- The existing review remains read-only, bound to exact head/base and GitHub compare patch. Its model text has evidence class `AI_ASSERTED`, even when the changed-line code quote matches.
- Existing `anchorAudit` is the first quality gate. Generic warnings, nonexistent file lines, quoted prompt delimiters and fictitious locations do not establish the cited changed-code line. These patterns are covered by deterministic regression cases.
- `scripts/goriq-ai09-independent-triage.mjs` provides a pure, *non-dispatching* `prepareVerifiedRepairProposal` step. It recomputes the SHA-256 of trusted canonical GitHub patch, checks the model's changed-line citation, requires a separately supplied verifier reference and demands a trusted adapter that authenticates an independent reproduction on the **same** head/base/patch/path/line. Model-provided JSON cannot serve as the adapter.
- Failure or missing evidence returns `TRIAGE_REQUIRED` with no task. An authenticated, independently reproduced failure can produce only `VERIFIED_CANDIDATE` and a bounded handoff proposal that obeys `docs/runbooks/agent-handoff.md`. Free-form model instructions do not go into its task details.
- The proposal has `correctionTaskCreated:false`, `builderAcknowledged:false`, `writeAuthorized:false`, `githubApprovalSatisfied:false` and `mergeAuthorized:false`. It is not an actual Builder/Debugger acknowledgement, permission grant, verified repair or deployment.


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

## Next gates
1. Establish a measured independent evaluation set with labeled true/false defects, changed-line grounding and replayable regression evidence. Track false-positive and missed-defect rates separately. The current small synthetic/model pilots are not proof of real-world detection accuracy.
2. Implement/authenticate the separate verifier provider and demonstrate genuine reproduction, including negative/stale/forged cases.
3. Only after a trusted task authority separately authorizes permitted paths and the receiving Builder/Debugger acknowledges the proposal, record an actual task receipt. Recheck the corrected head, CI and independent signoff before completion.
4. No automatic merge or GitHub APPROVED from the AI's recommendation. Keep current bot advisory workflow, permission scopes and repository protection unchanged.

## Rollback
The new triage module is not registered as an automatic task dispatcher or workflow job. Revert its addition and the tests/docs by a reviewed, protected PR if it proves unsafe. Existing AI-09 automation remains available. No credentials, CI permissions, host state, deployed modules or model providers were changed by this Issue.

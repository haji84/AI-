# AI-09 evidence-first finding triage and repair proposal

Related: Issue #1805. Extend, do not replace, the existing GitHub-hosted AI-09 reviewer and its bot advisory comments.

## What is implemented
- The existing review remains read-only, bound to exact head/base and GitHub compare patch. Its model text has evidence class `AI_ASSERTED`, even when the changed-line code quote matches.
- Existing `anchorAudit` is the first quality gate. Generic warnings, nonexistent file lines, quoted prompt delimiters and fictitious locations do not establish the cited changed-code line. These patterns are covered by deterministic regression cases.
- `scripts/goriq-ai09-independent-triage.mjs` provides a pure, *non-dispatching* `prepareVerifiedRepairProposal` step. It recomputes the SHA-256 of trusted canonical GitHub patch, checks the model's changed-line citation, requires a separately supplied verifier reference and demands a trusted adapter that authenticates an independent reproduction on the **same** head/base/patch/path/line. Model-provided JSON cannot serve as the adapter.
- Failure or missing evidence returns `TRIAGE_REQUIRED` with no task. An authenticated, independently reproduced failure can produce only `VERIFIED_CANDIDATE` and a bounded handoff proposal that obeys `docs/runbooks/agent-handoff.md`. Free-form model instructions do not go into its task details.
- The proposal has `correctionTaskCreated:false`, `builderAcknowledged:false`, `writeAuthorized:false`, `githubApprovalSatisfied:false` and `mergeAuthorized:false`. It is not an actual Builder/Debugger acknowledgement, permission grant, verified repair or deployment.

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

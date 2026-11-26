# Owner Goal/Job readback input connection

Goal: connect the existing G1 read-only probe to explicit owner-selected Goal/Job workflow inputs without expanding execution authority.
Base: efe03ee390d01cc714860684e945cc22fdd08215. Existing Issue1219 / DraftPR1907 only.
Architecture: optional paired workflow_dispatch inputs, passed via intermediate environment variables to a bounded pure validator before the existing credential file is read. Pin valid selectors across credential loading and invoke the unchanged existing read-only probe. Preserve empty-input legacy behavior, protected current-main checkout, GET-only probe, credentials, permissions, Windows job and existing event triggers.
Spec: existing GORIQ_GOAL_TO_PRODUCTION_GATES.md G1; existing probe at base; owner completion request. No new controller or state store.
Ruling: a non-activating source fix for previously unreachable readback selection is within ongoing implementation scope; production activation, new auth/signers, and security-policy changes remain gated.
Isolated partial source workspace: Git clone DNS unavailable; verified workflow Git blob from connector. Local Node22 tests are not pinned full CI or physical-host proof.

- [ ] RED: workflow wiring absent; paired input validation absent. Capture failing tests.
- [ ] GREEN: implement pure selector validator and minimal workflow wiring. No workflow permission/trust change.
- [ ] Test invalid/partial/oversized/shell-sensitive inputs; ensure no input echoed or credential read before validation; preserve default path and Windows bytes.
- [ ] Verify Bash body with a disposable synthetic HOME and a fixture-only probe; record exact limits.
- [ ] Publish one atomic candidate to existing PR after expected-HEAD check, retain handoff and baseline.
- [ ] Verify exact published HEAD CI and record actual result; no old-pass reuse.

Rollback: revert only this source/test/workflow-input candidate. Preserve failed attempts and original Goal/Job state. Do not activate on a credential-bearing host until trusted-main integration and matching authority are established.

# Independent code review and reproduced corrections

Scope: existing PR #1764 reconciled with main dbb433773d86c250bcb341566f7903e4fecbf89a; Issue #1763 / parent #681. Reviewers had separate contexts, were read-only and ran actual temporary-database/subprocess reproductions. They did not issue GitHub approval or prove physical acceptance.

First reviewer independently passed 33 focused tests and reproduced:

- A fenced dry-run wrote live Compass progress/verification.
- PAUSED became lowercase paused and subsequently resumed.
- Successful unfinished work lost nextAction and could not resume.
- A 500 ms lease waiting behind a 1,000 ms SQLite transaction committed stale progress. The transaction completed after lease expiry; immediate assertCurrent then rejected the same claim.

Second reviewer independently passed 60 focused tests, reproduced final-DoD liveness, stale WorkState reuse after Goal changes, dry-run checkpoint timestamp mismatch, pending-effect loss in the dry-run copy and valid string-file scope rejection. It also identified parent/descendant directory overlap in informational candidate discovery.

All these findings were independently reproduced as failing regression tests before corrections. Final focused verification is retained in targeted-tests.log (66 pass). Original checkpoint/progress RED outputs are retained in checkpoint-red.log and progress-red.log. Subsequent fixes were verified by tests rather than another claim of reviewer approval.

Corrections:

1. Bind checkpoint v2 to exact persisted Goal and state; legacy title-only hints fail closed.
2. Resume only status=continue with no blockers and the exact nonempty action. Normalize pause alias in the Compass adapter.
3. Simulate dry-run in memory from a read-only live source. Compare original snapshot timestamps and consult live read-only effect status before closing the source.
4. Persist a remaining-criterion action only after verified DoD progress. Last-criterion progress schedules a bounded Goal-controller completion check; it does not bypass completion gates.
5. Reject stale WorkState criteria/constraints instead of treating prior Goal completion as current evidence.
6. Scope subsequent Builder actions by remaining DoD while keeping retry identity stable.
7. Validate lease time after the transaction obtains its lock and again before commit; pending effects remain reconciliation-required.
8. Accept both established file-list representations in binding checks; keep exact allowed-file containment. Exclude parent/descendant gated paths from candidate discovery.

Review rulings: valid Builder scope rejection was treated as a liveness defect; incorrect independence discovery was treated as an isolation defect under the owner's explicit requirements. Both were corrected with RED-to-GREEN tests. No cosmetic findings or unrelated refactoring were added.

Limitations: these are repository code-review and test evidence. They are not a formal non-author GitHub approval, authenticated independent bug-reproduction attestation, live Builder acknowledgement, production execution, physical MacBook/ZBook recovery, real-model quality benchmark or measured product speedup. Existing external-effect, shared-authority and physical acceptance holds remain.

## Seven-step follow-up review

A separate read-only reviewer independently passed 63 focused tests, then reproduced two existing acceptance bypasses: Builder-supplied DoD PASS persisted COMPLETED after failed verification; autonomy-run called only /health and /build and mirrored Builder success without /verify. After the first corrections, the reviewer reproduced a third variant: waived:true still completed DoD after verification failure.

Corrections reuse the existing development verifier in autonomy-run, require execution and verification success before Compass/WorkState progress, and reject Builder waiver claims (waivers belong to the authoritative Goal). The reviewer independently reran 25 focused tests after the first correction and 10 targeted tests after the waiver correction: all passed. No remaining issue was found in these reviewed fixes. This is software review evidence; it is not formal GitHub approval, an independent physical run, or completion of the seven steps.

RED evidence: independent-verifier-red.log and verified-progress-red.log. GREEN: verifier-gates-green.log. Device run IDs and every remaining acceptance gap: seven-step-status.json.

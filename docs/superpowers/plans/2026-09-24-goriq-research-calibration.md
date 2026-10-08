# #1216 evidence-bound local research calibration

Baseline20c3019 portable operation learning; Production held. Reuse R16 history/decision, existing evaluateCalibration and partitioned verified experience ledger. No new model, endpoint, credentials or DB migration.

Gap: R16 only stores hypotheses; no current recall/execution comparison. Its numerical decision accepts NaN. Fix numeric/history boundaries before connecting.

Bounded design: pure fixed-policy prediction calibration on host-assigned verified train/heldout experiences. Group exact normalized task/environment/operation/partition. Freeze first four independent train observations that precede any heldout; evaluate against all independent heldout observations (minimum four, existing ledger cap2000). Reject cross-Goal/evidence reuse or insufficient data, exclude current Goal and external outcomes. Fit a fixed Laplace success probability using train only; compare original heldout predictions vs that fixed value using existing Brier evaluator. Persist R16 hypothesis/experiment under content-addressed IDs using existing lease/history. Repeated recall is idempotent. Report only prediction error improvement, never task success improvement. No sample tuning or raw heldout memory.

Core receives bounded research metadata in PrimaryBrainContext only. It does not automatically overwrite confidence or deploy a learned policy; the local Brain can reason about these observations as data. It does not alter candidate eligibility, risk, grants, correction priority, completion, skill/model promotion. Service status exposes evidence readiness/counts; no claim if host-assigned heldout observations are absent. Normal runtime observations remain train; no relabeling or fabricated benchmark.

- [x] RED/GREEN pure experiment evidence, split/privacy/bounds/zero-gain checks.
- [x] Integrate partitioned recall/R16 history, Core context data, status; test restart/idempotence/isolation and authority unchanged.
- [x] Independently review; full/security/lint/build/browser; audit/spec/evidence/CI/writeback.

Limits: fixed offline calibration, not arbitrary tool experiments, general R16 scientific research, executable skill synthesis, model training, physical evidence or whole-Core completion. Rollback additive consumers while retaining original experiences and research evidence.

Software44750d2 / CI1860 SUCCESS. Windows1673/P8331, independent61, lint/build, audit507/341 and actual isolated Chrome flow PASS. GitHub/Compass writeback records exact software evidence; product PARTIAL and Production hold remain.

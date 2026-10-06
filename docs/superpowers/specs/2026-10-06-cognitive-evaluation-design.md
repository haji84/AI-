# #1729 host-fixed local evaluation collection

Parent Goals #681/#1219, Core #1216; baseline `ee75aad5507c4b4232f7014dfd6e85b9394d20dd`. Owner requested autonomous completion without routine confirmation. Routine design/plan handoff pauses are overridden by that instruction; privileged gates remain. This refines the existing software gap without changing the normative product ledger.

Persist a host-created immutable plan in the existing partitioned private learning ledger; bind its digest in Cognitive State before effects. Reuse current Goal/WorkState authority instead of adding a separate runner or retrospectively relabeling history. Direct host option `evaluation: { id }` requires the local-outcome catalog and CognitiveLearningEngine. No HTTP/env/model allocation controls.

The plan fixes partition, Goal/digest, environment, complete catalog/material/criteria/root digest, source hashes, every action fingerprint and the fixed independent local artifact oracle. Enumerating dependent actions does not execute prerequisites. Allocate only before observations, effects or WorkState evidence. Reservations/observations serialize through the existing lease; check both state and durable reservation on restart. Interrupted reservation-to-state binding resumes only with the original plan. Removal/change fails before effects.

Trials may not reuse another trial's Goal/material, ordinary material observations or evidence. New ordinary observations carry source hashes. Legacy local-material history without hashes is inconclusive and allocation is refused. Reservations are not erased/evicted on failure. Repeated exact allocation is idempotent. Heldout Goals/evidence cannot become recalled corrections.

Use the existing bounded source/file/XLSX/DOCX capabilities and independent readback oracle. After execution failure, separate readback may record a negative measurement without changing authoritative failure/WorkState. Retain bounded domain/hash/check/status fields including failed output hashes; omit paths/raw material from learning receipts. Recompute receipt digest and require measured `resultOk && verifierOk` to agree with observation. Unmeasurable failures stay unverified. Outbox/pending recovery preserve split; degraded inspection is not a fabricated trial sample.

No database schema, fleet, credentials, privileged filesystem, workflow, public API or default Production configuration changes. Revert as one code change; do not erase/relabel retained receipts. Old readers fail closed on additive metadata, so rollback after opt-in activation needs a forward-compatible reader or continued code until explicit migration review.

Verify real temporary Compass/WorkState/Core/capability/learning stores and actual artifacts. Cover late/removed/changed plans, source/evidence/correction leakage, byte-to-metric agreement, reservation/state and authority crash recovery, failure relabeling and unmeasurable drift. Independent review reproduced two P2s, now regression tests. Final full checks and exact-tree CI remain required.

Broad model campaigns, measured Skill certification and physical recovery remain unfinished. This collector cannot certify whole Core/product.

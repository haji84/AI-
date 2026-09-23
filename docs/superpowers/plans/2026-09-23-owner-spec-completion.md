# New requirement IDs, conversation resolution and owner UI — implementation plan (#1205)

Goal: Complete the three requested software paths end-to-end on the existing candidate; retain all existing requirements, identity and evidence.
Baseline: 36a6d633eedfe6f5c71bb974fbfc597cdb5c0b1c, main9cbf6ac. No main/production/device mutation.

Architecture: existing authenticated receipt remains authority. Add a separate append-only additional-ID registry (OWN-001..999) alongside immutable frozen340. Regenerate four fixed canonical artifacts, never arbitrary code/files. New rows start MISSING with conservative CODE/UNIT/INTEGRATION/SECURITY/PHYSICAL/RECOVERY floors until explicit reviewed refinement; no evidence promotion. Existing draft publisher bounds remain, typed scope gains only this registry.

Conversation resolution uses authenticated saved context, anchored Japanese adoption/correction/withdrawal and explicit selected-reference IDs. Questions/examples/negative or ambiguous references remain non-adopted with an owner-visible explanation. Common domain synonyms rank existing candidates only. A proposed match is never proof of equivalence or permission. Unknown free-form meaning is surfaced for clarification; no new model API.

Owner UI on Tasks and Work shows adopted/proposed/history and actual canonical status; enter a request, resolve ambiguity, preview existing/new binding, publish a Draft through existing owner-auth path. GitHub issue/source is a server-known parent, not a user-required configuration. No secret values/model-controlled authority fields.

Implementation:
- [x] TDD additive inventory: exact once, collision, deletion, evidence floor, duplicate content, correction/withdrawal history; generator/publisher four fixed artifacts.
- [ ] TDD conversation resolver: direct adoption, saved referent, ambiguity, questions/examples, negation, correction, withdrawal, stale context, protected changes; actual Broker ingress.
- [ ] TDD owner view model/API and browser UI: auth, bounded inputs, preview/publish, authoritative canonical state; visual browser QA at desktop/mobile with isolated fixture service.
- [ ] Full tests/P8/lint/type/build; independent review; exact-head CI.
- [ ] Requirement mapping/evidence/PR and GitHub/Compass writeback.

Review focus: deletion of extension registry cannot hide a published row; new IDs cannot reuse existing/withdrawn IDs; ambiguous pronouns cannot mutate state; model/source material cannot confer acceptance; stale previews must fail on changed receipt/base. Deadline and output caps stay enforced.
Rollback: revert dependent code/UI and canonical-registry contract together, preserve receipt/journal/additional-ID history. Physical-facing holds remain.
Ruling: use inline execution and proceed under explicit owner completion/no-routine-confirmation instructions; no new permissions/secrets/paid APIs.

# Owner conversation and reverse requirement traceability (#1205)

## Canonical contract
The frozen 340 product IDs remain mandatory. A separate `docs/jarvis-additional-requirements.json` assigns OWN-001..OWN-999 monotonically to an adopted owner receipt. Every allocation must remain in both ledgers exactly once, with reciprocal decision provenance, including after correction or withdrawal. New requirements start MISSING with all six evidence classes, no implementation proof and no verified commit. No physical or functional completion follows from saving a specification.

The reverse index covers src/jarvis, src/gai, src/app/jarvis, src/app/api/jarvis, scripts/jarvis*, Android main sources/config, iOS Worker, docs/architecture, src/orchestrator, src/compass, command and owner-auth entry primitives. Colocated tests are excluded. Every changed/new/removed surface requires an explicitly reconciled fingerprint and canonical parent or sourced exclusion. Run `node scripts/jarvis-requirement-audit.mjs --check`; ordinary tests enforce it in CI. Provider/media surfaces outside these roots remain a separate audit gap.

## Authenticated conversation path
Tasks and Work use the existing owner-cookie API and owner-token Broker. The Broker resolves a request before changing Goal state, persists a receipt in the protected Compass envelope, and binds it to the authoritative Goal. No database schema or device credential change.

The resolver distinguishes explicit adoption, proposal, question/example/negation, correction and withdrawal. For “それで進めて”, it selects only one eligible saved same-Goal proposal, or a user-selected saved reference. Multiple/unknown references return CLARIFY_REQUIREMENT without changing Goal or requirement state. Corrections/withdrawals use reciprocal saved history. Domain synonyms rank existing-ID candidates; similarity never proves equivalence.

This is a bounded deterministic language contract, not arbitrary language understanding. Unrecognized feature wording becomes a proposal; ordinary work uses the existing Goal Controller. Quoted external material is data. Known protected-change patterns block ordinary publication; all actual execution authorization remains outside this parser. No model/API provider was added.

Each interactive turn has a client key retained through uncertain transport failure. Exact retries return the same receipt and controller decision. A client without a key starts a new conversation turn. Text/reference/key conflicts and cross-Goal reuse fail. The history limit is 500 with visible capacity failure, never silent eviction.

## Specification proposal and publication
The owner-visible “仕様・要望” panel shows candidate/adopted/pending/synced/superseded/withdrawn/Human Gate states. It supports saved-reference selection, existing-ID selection, independent new-ID preview and explicit publication. Preview is transient; receipts persist. Withdrawals can synchronize history without allocating a new feature.

Broker `/api/jarvis/admin/requirements/preview` returns bounded metadata and an immutable review plan, not canonical file content. Proposal/publish operate on four fixed files: PRODUCT_SPEC, JSON mirror, adopted-decision history, additional-ID registry. Existing rows/status/evidence remain; corrections remove only exact former owner additions. Stale inventory/fingerprints, duplicate content, verified-row amendments and replacement IDs for already published chains fail visibly. Unpublished corrections may allocate once; withdrawn allocated IDs are retained.

The typed publisher only creates/resumes a Draft in haji84/AI-. Generic arbitrary-file PR limits stay unchanged. Existing GitHub authorization is an optional capability; missing authorization disables the visible publish action and yields a real error, never fake success. Remote canonical contents must match the reviewed local base. Bounds: input32KiB, generated files2MiB, changed-line budget100000bytes,24 requests,45s overall,5s per fetch/body,2MiB response. Fixed host/repository, no redirects, no request-supplied tokens/paths/endpoints. Known secret patterns block before egress.

Publication metadata is immutable/monotonic and survives restart/lost responses. Unrelated main advancement preserves the original plan; changed canonical content, superseded receipt, foreign branch or closed/altered PR fails closed. No merge/deploy/review authority is granted.

## Completion and recovery
Goal Loop, WorkState, Work Run and Compass completion revalidate exact local canonical receipts. Draft creation is not SPEC_SYNCED; runtime canonical deployment must contain matching receipt/source/history. Withdrawals display as withdrawn after verification. Rollback of canonical files reopens the completion gap. Worker/model generic write-back cannot forge the receipt envelope or a specSynced flag.

Rollback code/UI and the dependent registry contract together, preserving receipt/journal/ID history. Do not delete records to clear a completion block. Production, device enrollment and existing physical-facing PR holds are untouched by these candidate tests. Research Ops #321 remains separate.

Verification and limits: [owner-spec completion evidence](../evidence/1205-owner-spec-completion.md).

# Bounded public fact research (#1200)

## Execution path

The existing owner intake and explicit bounded plan use delegation.target=research with optional factCheck.claims. UnifiedPlanningClient -> ModelBackedPlanner -> autonomy.delegate -> runProductionResearch -> receipt-bound verifier -> Compass and Work-State evidence. scripts/autonomy-cloud-run.ts registers this path; it does not create another Goal authority. Context-only research remains available without factCheck.

## Trusted source policy

JARVIS_RESEARCH_SOURCE_POLICY_JSON is **host-owned configuration**, snapshotted when the runtime is created. Missing/invalid policy means deny. This change does not install a policy in any production environment. A new network/source authorization must follow existing owner/organization policy. Before choosing a source, confirm privacy and non-billable public-read use.

Schema example (illustrative, not enabled):

    {"version":1,"sources":[{"url":"https://example.com/facts","sourceClass":"official","fields":["amount"]}]}

At most40 exact URLs and40 fields per URL; policy32KiB; contract16KiB; claims20, sources5/claim and40 total. URLs require public HTTPS/443, no credentials/query/fragment, exact path and field match. Source labels in a request are descriptive only. Source authority comes from host policy, not a model or retrieved document. This is field-scoped metadata equality verification, not proof that an entire domain is universally authoritative.

Pinned DNS validation, no redirects, no authorization/cookie headers, response MIME checks, no compressed response,2MB/request,8MB total, per-request and total30s ceiling remain enforced by #1187. Fact requests explicitly negotiate application/json; generic source inspection retains its existing accepted types. A JSON-looking body with text/plain MIME remains rejected for fact verification.

## Evidence and verification

Execution snapshots action identity and input before I/O. Only that result object and exact action binding can use the in-process receipt. The verifier recalculates statuses from privately retained acquired values and requires source authority for required claims. A caller cannot supply PASS, waive claims, substitute another result or change the claim during acquisition.

Persisted data contains claim IDs/statuses/value hashes, citation URL/body SHA-256/retrieval time/authority/publication time and blocked IDs. Raw source text and native error strings do not become prompts, instructions, authority or audit payloads. Evidence carries reference_only_no_authority. Error details from network libraries are redacted; acquisition failures remain explicit FAIL.

Failed execution skips the normal Goal Loop success verifier. A research-specific write-back decorator therefore records its FAIL evidence in Compass and a research_verification Work-State event, preserving an existing independent verifier failure. It does not promote Work-State DoD or mark the parent product complete. Historical receipts are evidence data; runtime verification requires a fresh in-process acquisition, not deserializing an old PASS.

## Limits and next integration

Structured JSON claims only. Arbitrary prose extraction, semantic entailment, independent-origin graph analysis, PDF/OCR document facts, report synthesis and universal autonomous web research remain partial. No browser UI change is made here. Retrieved value hashes deliberately omit raw personal/material data. Existing device identities, credentials, queue and history are untouched.

## Verification / rollback

See docs/evidence/1200-bounded-research-integration.md. Revert the additive research delegation integration to restore context-only behavior. No DB schema/configuration migration is needed; retain historical evidence. A host policy can remain unset, keeping new external acquisition disabled.

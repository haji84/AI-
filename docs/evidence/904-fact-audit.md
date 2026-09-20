# #904 owner-facing fact audit

Research UI -> owner-authenticated /api/jarvis/facts -> FactVerificationEngine -> bounded local audit records -> authenticated history. Real browser save/reload PASS at 390x844 and 1440x1000; unauthorized request401; no page errors. Synthetic supplied sources, no PHYSICAL claim.

Sources are owner-supplied, unverified, one origin; lexical matching is a candidate relation, not semantic proof. Status capped at INFERRED. No URL fetch, no source-authenticity claim, no permissions. Citation URLs must be HTTPS without credentials/query/fragment. Raw supplied excerpts are stored locally; do not submit secrets. Storage default .jarvis/fact-audits, configurable JARVIS_FACT_AUDIT_PATH. Vercel without configured storage fails503. Operator must supply truly durable storage; configuration alone is not a durability proof.

Records are atomic with SHA256 corruption detection (not tamper-proof authentication), bounded200 records/512KB each, single-writer lock. Corrupt data/capacity/lock failure is visible. Crash orphan-lock recovery requires stopping writers, backing up/validating records, removing only orphan lock, then restarting. No automatic lock stealing or data deletion. Backup this directory with existing private local state. No cross-tenant service claim.

Fact engine regressions: numeric mismatch becomes CONFLICTED; future evidence cannot verify; same-origin contradictions retained; source permutation cannot hide later support. Unit/API security tests cover401/403, bounded input, URL rejection, unavailable store, persistence/reload and status cap.

Unfinished: independently retrieved verified sources, universal report integration, semantic entailment, automatic contradiction extraction and full document recovery. Requirements remain PARTIAL. Keep PR stack unmerged. Rollback code-only while retaining audit data; no device/enrollment/secret/provider/permission changes.

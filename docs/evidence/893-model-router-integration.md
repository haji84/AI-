# #893 - resource-aware governed model execution

Parent #882/#681. Stacked on #894; keep unmerged. No Production/provider/credential/device changes.

GovernedModelExecutor now invokes ModelRouterV2 when routing constraints are supplied. It ranks only already-authorized tiers, requires adapter-bound fresh resource metadata, checks data classification/modality/quality/RAM/VRAM/deadline, rechecks before execution, and uses persisted outcome history for ranking. Local RAM helper samples OS free memory; unknown VRAM defaults to zero. Missing or stale metadata fails visibly. Caller budget cannot authorize paid candidates; credentials/secret are ineligible. LOCAL_ONLY cannot be relaxed by a request.

Independent review found ledger-read delay could expire a previously checked snapshot. Regression reproduced execution with stale evidence; moving resource sampling after ledger access fixes it. Nine integration regressions cover memory, missing/stale metadata, paid/classification rejection, invalid metrics, resource changes, local identity, fallback constraints, history ranking and delayed-ledger expiry.

Boundary: legacy requests without routing retain prior behavior. Concrete direct local-video model calls are not migrated by this change. This is integration into the governed executor, not proof that all JARVIS inference paths use it. CORE-007/008 stay PARTIAL; no physical or complete-product claim.

Validation commands: node --test; pnpm run test:p8-security; eslint . --ignore-pattern tmp/** (untracked browser harness only); pnpm run build; node scripts/validate-jarvis-requirements.mjs. Exact head/CI recorded in issue/PR after commit.

Rollback: revert code; existing usage history and device state remain unchanged. No schema migration, new API provider, paid fallback or permission grant.

# Owner requirement IDs, conversation and UI (#1205)

Code 0b1c4a7fd9f52c2548a3e62261d6423c23c55e59. Candidate in Draft PR #1213; current implementation is not deployed. Parent #681/#882. Baseline36a6d633eedfe6f5c71bb974fbfc597cdb5c0b1c; source main9cbf6accaec5eb1ec76359a6b88af6bf225eb51e.

## Implemented scope
- Additive OWN IDs; four exact canonical artifacts; immutable frozen340; status/evidence floors preserved.
- Authenticated natural requirement adoption and saved-reference resolution, ambiguity handling, correction/withdrawal provenance and durable completion gate.
- Tasks/Work requirements panel: input, saved reference, existing/new-ID preview, Draft publication through existing authorization, actual canonical status.
- Stable client retry identity; no duplicate receipt after a lost browser response; no obsolete pronoun reuse.
- Unpublished corrections allocate once; withdrawals retain history and IDs, including unpublished history-only withdrawal.

## Evidence collected
Focused regression tests and actual isolated Broker HTTP path pass. Desktop1440 and mobile390 Chrome browser runs use a real Next server and isolated Broker/SQLite with synthetic owner authentication. Browser path covers auth rejection/login, adoption, lost response/retry, new-ID preview, unavailable publisher capability, example classification, explicit saved-reference adoption and responsive layout. No real device, account, credential or Production mutation.

The GitHub publisher is verified through a bounded adapter fixture, including new-ID artifact contents and negative security paths; live runtime publication to GitHub is not claimed.

Full1463, P8 security331, lint, TypeScript, production build and production-health PASS; zero failed/skipped. Ledger340 and reverse479 validation PASS. Independent review reproduced eight lifecycle/context/UI findings over two review rounds; regression cases failed first, then passed after fixes. Final focused reviewer suite23/23 PASS with no remaining confirmed blocker in that delta. Existing video-plan-store dynamic filesystem tracing warning persists, not introduced by this change. Exact code/log identities are recorded in owner-spec-completion-verification.json.

## Limits
Known language patterns and stored references have deterministic behavior. Arbitrary conversation understanding, semantic equivalence inferred from similarity, automatic merge/deployment, all-route ingestion and whole-repository audit completion are not claimed. Unknown/ambiguous interpretation stays visible for clarification. CORE-015/GOV-025 remain PARTIAL for broader scope; UI-003 retains physical evidence pending. This does not declare JARVIS complete.

## Reproduce
- node --test tests/owner-conversation.test.ts tests/owner-requirement-additions.test.mjs tests/owner-requirement-workflow.test.mjs tests/owner-requirement-ingress.test.ts tests/jarvis-spec-publisher.test.mjs
- pnpm test; pnpm test:p8-security; pnpm lint; pnpm exec tsc --noEmit; pnpm build
- node scripts/validate-jarvis-requirements.mjs; node scripts/jarvis-requirement-audit.mjs --check
- PLAYWRIGHT_MODULE=<existing local Playwright module URL> JARVIS_TEST_BROWSER_CHANNEL=chrome node scripts/verify-owner-requirement-ui.mjs

Browser tooling is optional; missing tooling fails visibly. Browser artifacts are synthetic fixture data, with screenshots/result retained under docs/evidence/1205 after validation.

Rollback: revert dependent candidate code/UI/registry contract together, preserve all receipts, allocation/decision history and publication journals. No credential/permission/schema/worker change.

## Main activation gate
The exact candidate has no device credential/protocol/enrollment or permission/network configuration edits. However live GitHub workflow state was read: Broker Refresh357969264 and One-Tap Enrollment E2E356948934 are active and match the changed paths. They update/restart the resident Mac Broker; One-Tap also issues a real fleet registration grant. Vercel Sync356928059 is disabled_manually (do not claim it will trigger). Main merge is held pending separately approved gating of these unrelated live hooks. Do not disable them or reuse unrelated historical approval. Exact state/evidence: [verification](1205/owner-spec-completion-verification.json).

Screenshots use synthetic isolated data: [desktop](1205/owner-spec-desktop.png), [mobile](1205/owner-spec-mobile.png).

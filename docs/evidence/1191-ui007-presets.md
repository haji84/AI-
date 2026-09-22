# UI-007 theme/persona preset reconciliation evidence

Issue: #1191
Parent: #681
Implementation master: #882
Baseline main: `f974cc39dc25697e6cf999764e9d695ee753e14d`

## Scope

This record reconciles the software evidence for UI-007, `20以上のtheme/persona preset`, against current `main`. It does not claim PHYSICAL acceptance and does not change Production wiring, device registration, credentials, permissions, firewall/network ingress, billing, or Human Gate policy.

## Current-main implementation evidence

- `src/app/jarvis/ui-preferences.ts`
  - declares 20 Theme presets in `JARVIS_THEMES`;
  - declares 20 Persona presets in `JARVIS_PERSONAS`;
  - keeps `theme`, `persona`, `voice`, `accent`, `layout`, `density`, and `motion` as independent preference fields.
- `src/app/jarvis/settings/JarvisLocalSettings.tsx`
  - renders Theme and Persona selectors independently from the shared preference model.
- `src/app/jarvis/themes.css`
  - contains the theme presentation coverage used by the P5 customization implementation.
- `tests/jarvis-p5-customization-presets.test.mjs`
  - requires at least 20 Theme options and at least 20 Persona options;
  - checks stable/unique preset ids and Japanese-first labels;
  - checks independent persisted preference fields;
  - checks theme CSS coverage.

## Provenance

The bounded customization implementation was delivered by Issue #767 and merged by PR #768 as merge commit `ec1f0d7816970d59fb052ac55e2e5f4adb7b540b`. The exact PR head `4a19e0da4529f1b9604e9fbaa0064fcf85fe678c` passed CI run `35063661336`.

The later full-ledger audit classified UI-007 as `MISSING / NO_CODE_MAPPED`. Direct inspection of baseline main `f974cc39dc25697e6cf999764e9d695ee753e14d` shows that classification is stale for the software implementation. The conservative product status remains `PARTIAL`, not `VERIFIED`, because UI-007 requires PHYSICAL evidence and no new PHYSICAL evidence is supplied here.

## Required canonical reconciliation

For UI-007, the canonical ledgers should map the current implementation without weakening the evidence requirement:

- status: `PARTIAL`
- implementation refs:
  - `src/app/jarvis/ui-preferences.ts`
  - `src/app/jarvis/settings/JarvisLocalSettings.tsx`
  - `src/app/jarvis/themes.css`
- test refs:
  - `tests/jarvis-p5-customization-presets.test.mjs`
- evidence refs:
  - `docs/evidence/1191-ui007-presets.md`
- delivery implementation: `MAIN_CODE_PRESENT`
- delivery connection: `RUNTIME_ACCEPTANCE_REQUIRED`
- physical: `PENDING`
- `last_verified_commit`: remains unset until all required evidence, including PHYSICAL, is valid for one verified revision.

## Verification boundary

Repository CI on the exact PR head is required before merge. CI success proves repository checks for this reconciliation tooling and reruns the existing UI customization regression tests; it does not substitute for PHYSICAL acceptance.

## Rollback

Revert the reconciliation PR. No runtime state, external service state, credentials, device enrollment, or Production deployment state is mutated by this evidence record.

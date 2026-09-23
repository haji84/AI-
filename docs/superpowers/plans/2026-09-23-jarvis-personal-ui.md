# JARVIS personal UI implementation plan

Goal: implement #1214 twenty visual concepts, local display profiles and user-editable home/navigation.
Spec: docs/superpowers/specs/2026-09-23-jarvis-personal-ui.md
Stack: existing Next/React/TypeScript/CSS, no dependencies or provider APIs.

## Tasks
- [x] 1. Pure profile/layout model and regression tests. New personalization-store.ts; bounded serializable schema, read/save adapters returning error, immutable operations and history. Write behavior tests first. Do not touch existing preference storage.
- [x] 2. Twenty-concept catalog and site-wide appearance layer. New visual-concepts.ts, PersonalAppearance.tsx and personal-appearance.css. CSS atlas artwork in public/jarvis/concepts. Gallery/profile/navigation/panel editor consumes model. Do not mutate production/auth.
- [x] 3. Root integration. Personalization provider wraps PrimaryShell. Existing navigation uses fixed route registry plus profile order/placement. Existing WorkShell uses editable panel wrapper and actual status. Existing preferences remain independent. Owner tests in isolated app only.
- [x] 4. Art assets and accessibility. Generate twenty local visual scenes as atlas tiles, not mocked product status; verify each tile manifest matches. High-contrast readable foregrounds and reduced motion.
- [ ] 5. Verify and document. Browser desktop/mobile and interaction tests; node tests/lint/build; traceability ledger/evidence/review/PR/CI. Preserve physical holds and no Production mutation.

## Interface contract
Store module exports PersonalUiState {version:1,activeProfileId:string,profiles:PersonalUiProfile[]}; profile {id,name,conceptId,navPosition,navOrder,panels}. navPosition top|bottom|left|right; navOrder fixed IDs home/devices/tasks/research/settings. Panels {id,kind,width}; kind command|goal|summary|requirements|clock|note|shortcuts, width normal|wide|full. Profile note string separate field. Defaults command,goal,summary,requirements; optional panels can be added. No hideable critical gate logic. APIs defaultPersonalUiState, normalizePersonalUiState, activePersonalUiProfile, updatePersonalUiProfile, addPersonalUiProfile, setActivePersonalUiProfile, movePersonalUiPanel, addPersonalUiPanel, removePersonalUiPanel, readPersonalUiState(storage?), writePersonalUiState(state,storage?). Export allowed catalog IDs through visual-concepts.ts but avoid a circular dependency: store defines known concept IDs as an imported standalone constant or takes catalog pure module. root owns hook/provider.

Ruling: owner's repeated instruction to execute routine UI work without routine approval plus supplied design boards is sufficient for reversible implementation; no repeated design sign-off. Distinct new issue prevents unrelated #1205 authorization reuse.
Ruling: stored profiles personalize a browser, not new users/auth/tenant scope. UI says so.
Ruling: free placement is responsive grid order/width plus menu edge selection, preventing panels outside screen; no pixel canvas with inaccessible offscreen controls.

## Verification handoff
Local full tests1485, P8331, lint and normal production build PASS. Browser viewport/interaction evidence is in docs/evidence/1214-personal-ui.md. Native HTML5 drag tool acceptance remains INCONCLUSIVE; arrows and keyboard pass. PR/CI and owner physical visual acceptance remain separate gates.

# Personal JARVIS appearance and workspace — #1214

Parent #681 P5. Source main54b5df2a41eaef75e7c40a83474aceb8fc15b3be; candidate branch codex/1214-personal-ui. Not deployed. Exact code revision and CI are recorded below after commit.

## Owner scope and implementation

The accepted owner instruction in issue1214 requests20 selectable visual styles plus default menus/panels that people can rearrange and add. owner-1214-personal-ui binds that exact instruction to17 existing UI requirements. Frozen340 IDs are preserved; no requirement is declared physically verified.

- Twenty local illustrated concepts with distinct palettes and geometry: clean, space, adult anime/portrait companions, hologram/core, butler/team, labs, bridge/cockpit/AR, cyber/nature/gold, twin/adaptive. Images are decorative; they do not claim actual AR/agents/digital-twin capabilities. See public/jarvis/concepts/README.md for provenance/hashes.
- Settings → named browser-local display profiles (up to12). Each retains design, navigation order/edge, home panel order/width and a note. No account/cross-device synchronization claim. Earlier preference keys, persona, voice and accent remain stored separately. New artwork palettes are used while the new appearance layer is active; legacy theme/accent styling is restored by the explicit legacy toggle. UI-010 is not promoted.
- Defaults: request, current request status, actual Broker statistics, requirements. Clock, note and fixed shortcuts can be added. Three responsive widths, hide/show, arrow/keyboard movement, native HTML5 drag, undo/redo/reset. One instance per panel kind prevents duplicated command controls. Settings and critical notifications remain outside hideable panels.
- Main navigation keeps all5 fixed routes. Four desktop edges, bottom adaptation for mobile. Removed the unrelated app-level dashboard/chat overlay on JARVIS routes; its original behavior remains on other routes. Common display/operation controls are in a disclosure outside the read-only boundary. Empty notifications are compact; actual alerts keep full content.
- Storage failures are visible; invalid data and IDs are normalized without stealing another valid profile identity. Arbitrary scripts/HTML/URLs/widgets are rejected. Read-only/kiosk capture also blocks drag/drop. Protected auth, device and work API contracts are unchanged.

## Verification

Machine-readable result: [1214-ui-checks.json](1214-ui-checks.json).

|Check|Result|
|---|---|
|Full node tests|1485 PASS /0 fail /0 skipped|
|P8 security suite|331 PASS /0 fail /0 skipped|
|New store/catalog tests|22 PASS; bounded normalization/history, isolated profiles, storage recovery, ID repair, contrast>=4.5:1, fixed artwork manifests|
|Lint / normal Next Turbopack build|PASS including TypeScript|
|Canonical/mirror/reverse audit|340 requirements /488 surfaces PASS; required evidence classes preserved|
|Browser:20 themes, profiles/reload,4 nav edges|PASS|
|Browser: panel addition, hide, arrow/keyboard move,3 widths, undo/redo/reset, note reload|PASS|
|Browser:5 routes,390px phone/1440px desktop, no horizontal overflow, focus outline, high contrast, reduced motion, readonly arrow blocking|PASS; no console errors in inspected session|
|Native HTML5 drag via CUA|INCONCLUSIVE: three bounded synthetic/native tool drags left order unchanged; arrow movement passed. Do not label direct-drag acceptance PASS.|
|Actual iPhone/Android /owner approval /Production|Pending; viewport testing is not physical evidence|

The isolated host uses loopback-only random ports, independent empty SQLite and synthetic auth, with real Worker adapter and external publication disabled. Screens show its true zero-device state. Owner's live registry/enrollment/credentials were not used or changed. The preview is bounded and expires automatically.

Environment findings: initial shared node_modules junction was rejected by Turbopack. A Webpack diagnostic build reported pre-existing route-export typing incompatibilities; no route checks were changed. Installing from the existing offline pnpm cache allowed the repository's normal Turbopack build to pass. The first full test run lacked bash in PATH; adding installed Git Bash to that command's PATH made all1485 pass without changing tests. Untracked QA harness imports were corrected for lint. Existing dynamic filesystem tracing warning in video-plan-store remains outside this UI scope.

## Review and rollback

Independent review found and fixed save-error masking, repaired-ID collisions, legacy storage exceptions and read-only drag interception. Code/storage tests and browser evidence are separate. Last verified commit will reference the code candidate, not infer PHYSICAL evidence.

Revert this branch's UI integration and dependent canonical mapping together. Keep the local profile key inert; no deletion/re-enrollment/reset of devices is needed. No Production deployment, secrets/permissions, paid service, DB migration or unrelated physical-PR hold is changed. Production review and owner visual/drag acceptance remain before activation.

## Exact candidate

Code commit: 61f3dc57387c5efc5988dbf0ab933d877698d1e3. Draft PR: https://github.com/haji84/AI-/pull/1215. Final evidence/state-only follow-up changes no runtime behavior. Candidate audit stores this software revision; last_verified_commit remains null because the full physical requirement is not verified. CI result is recorded on the exact PR head in GitHub and Compass.

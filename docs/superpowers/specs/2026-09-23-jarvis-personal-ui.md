# JARVIS personal UI — Issue #1214

Owner supplied two concept boards and requested twenty selectable designs, customizable default menus and panels. This is presentation/personalization under #681 P5; all existing runtime/auth/device contracts remain.

## Accepted intent and design
Twenty visual concepts: clean-modern, dark-cinema, anime-assistant, portrait-assistant, portrait-partner, anime-partner, hologram, ai-core, butler, team, future-lab, space-bridge, cockpit, ar-space, cyber-city, nature, black-gold, silver-lab, digital-twin, adaptive. Art is presentation, not proof of AI, AR, digital-twin or team functionality. Theme gallery applies a site-wide layer, preserving separate persona/voice/accent preferences and existing legacy theme choices.
Named browser-local display profiles each retain a concept, navigation placement/order and home panels. They are not authentication identities or cross-device cloud profiles. No secrets in the store. Prior preference keys remain unchanged; missing/corrupt/unavailable storage gives a safe default with visible save error.
Home ships a functional default: request entry, actual goal/status, fleet/task summary, requirements. Addable panels: clock, note, bounded fixed-route shortcuts. Edit mode supports drag plus arrow buttons, width choices, hide/show/add, undo/redo, reset. Core owner/auth/connectivity/gate access stays outside hideable user panels. Menus use five existing top-level routes, reorderable, top/bottom/left/right desktop placement; narrow screens use accessible wrapping/bottom placement without horizontal overflow. Settings always reachable.
The twenty art scenes live as a bounded local atlas, mapped by fixed manifest coordinates, with CSS crop and legible opaque content surfaces. No remote asset fetch, arbitrary HTML, script, URL or iframe widget configuration.

## Verification and rollout
Pure tests: unique20, bounded normalized input, profile independence, stale/corrupt storage, menus never lost, panel instances bounded/unique, history, note safely rendered, arbitrary routes rejected. Browser: all20 selection/reload, two profiles, layout actions/undo, phone and desktop, contrast, reduced motion. Existing security/API contracts untouched. Build/lint/relevant tests and requirement parity/reverse audit. PR/CI; do not deploy using another issue's authority.

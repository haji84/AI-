# Single JARVIS owner entry (#795)

Owner requested one URL after reporting `This page couldn’t load` during login. The reported failure has not been reproduced with the existing invalid-code browser flow; do not claim a proven network or password cause.

The canonical owner entry is `/jarvis`: unauthenticated requests show the inline login, authenticated requests show the remote console. Login submits a same-origin request for JSON and keeps network/invalid-code errors in the current page. Legacy HTML form POST redirects remain compatible. The same shared form replaces stale Vercel-specific guidance at `/jarvis/login`. No credential rotation, cookie-policy relaxation, firewall or service permissions change.

Verification on 2026-09-16:
- TypeScript and targeted ESLint passed.
- All 869 Node tests passed; no skips.
- Actual Codex in-app browser against isolated localhost development server with a synthetic test credential: wrong code stayed at `/jarvis` with inline error; correct code showed Remote Assist at the same URL; reload retained the console. This is not physical Android execution evidence.
- Production deployment and production-browser acceptance must be recorded separately.

Rollback: revert this UI/API change while retaining existing production credentials and state. Existing HTML login clients continue to work. The independent Windows startup task failure from #786 remains unresolved.

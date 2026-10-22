# Issue1831 owner portal relay wiring

Goal: connect the existing temporary coturn credential issuer to the isolated
owner portal CLI, without changing passed Android or Windows capture/input.

Files: `scripts/remote-lite-owner-server.mjs` reads an optional private TURN
secret file and exact approved endpoint list; `src/remote-lite/owner-portal.mjs`
continues issuing ICE only after an authenticated owner creates a session for
their own approved device; existing HTTPS tests verify that boundary.

Risk: TURN credentials allow relay bandwidth. The long-lived secret must never
reach browser/native responses, URL/logs or Git. No infrastructure is activated
by this change. Provider, free allowance/hard cap, ports and public environment
remain separately verified operator gates. No new credential or account is
created here. Native hosts still use direct ICE; one-sided relay reachability
must be observed in the target networks before claiming public support.

1. Extend HTTPS integration fixture with the existing issuer; prove no calls
   for missing login, cross-owner device or invalid CSRF, successful authorized
   session returns only bounded temporary credentials, and issuer failure
   removes the just-created coordinator session.
2. Wire optional TURN config into CLI, validate configuration before listening,
   fail closed for malformed secret/URLs, and retain direct-only default.
3. Run focused tests/lint, independent review, existing PR CI, document exact
   limitations and rollback. Do not claim deployment or relay acceptance.

Rollback: revert this wiring commit and restart the same isolated service with
the previous private config. Preserve device registrations and native keys.

Verification: focused HTTPS/TURN suite 8 pass, browser 1 skip; full Remote Lite
suite 95 pass, browser 1 skip. ESLint and diff check passed. Independent review
reported no unresolved P1/P2. No external relay or billing evidence was created.

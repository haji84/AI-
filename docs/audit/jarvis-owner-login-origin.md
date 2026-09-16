# Owner remote-access login — #713

Parent #681. Priority: remote operation, per owner instruction.

Local browser reproduced successful login on `127.0.0.1` redirecting to `localhost`, losing the host-scoped cookie. Successful and failed login now return a relative 303 Location. The return-path helper rejects external/protocol-relative URLs, backslash/control characters, encoded separator confusion and paths that normalize into an authority. Cookie security and passcode validation are unchanged.

Validation: four authentication/redirect tests PASS, lint and production build PASS. Local browser with an isolated test credential remained on `127.0.0.1:3097` after login, reached `/jarvis/recordings`, and read/displayed the synthetic PNG through owner-authenticated APIs. No real device, private tailnet or cellular PASS is claimed.

Full Windows suite: 738/739 passed; one pre-existing #711 test cannot create a directory symlink without Windows privilege. Preserve its assertion and use a Windows junction fixture under #714; do not skip the security test or request admin elevation just to run it. CI must independently validate the login diff.

No credentials, permissions, deployment or private-network configuration were changed. Rollback by reverting this PR. Next: prioritize remote screen gestures and end-to-end control, then real-device/cellular evidence when available. Product completion remains open.

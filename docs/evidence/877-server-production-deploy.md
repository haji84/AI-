# JARVIS server-side Production deployment marker

- Parent: #681
- Deployment issue: #877
- Requested: 2026-09-20
- Scope: deploy current main server/Web/Broker-compatible JARVIS changes without Android/iPhone application version changes.
- Existing device identity, credentials, enrollment, signing and versions must remain unchanged.
- Staged device-version branches are excluded.
- Rollback target: previous Production deployment.

This file intentionally changes no runtime behavior. It binds the exact deployment request to a PR/CI/main commit for the repository's task-scoped Production deployment guard.

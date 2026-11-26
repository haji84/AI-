# Host-independent coordinator persistence: bounded source implementation

Goal: remove one local-filesystem prerequisite by supplying the existing
DistributedCoordinatorRuntime with an encrypted GitHub-backed CoordinatorStore.
This is a source implementation, not activation or completion of the owner Goal.

Base: haji84/AI- main 8ead188ffc374c0204f20798ac8258af07272bdc; Issue #1219.
Owner decisions: no required MacBook, no second account or mandatory code reviewer;
public repository; preserve existing Goal, Job, failure history and Human Gates.

## Selected scope
Use the existing injected CoordinatorStore interface. Do not add a controller,
Goal, scheduler, workflow, account, key, token, permission, or migration.
A new adapter uses the GitHub contents API with the previously read blob SHA.
Only a pre-provisioned encrypted state file on an explicitly supplied state
branch can be read/updated. Missing state never returns an empty initial state.
The adapter cannot bootstrap, unconditionally save, or force-update a branch.
Encryption uses an externally provided 32-byte key and AES-256-GCM; context binds
repository, state branch, fixed state path and cluster. This key is NOT created
or connected to any live owner environment by these tests.

Rejected approaches: switch a self-hosted workflow to ubuntu-latest while leaving
its local DB/token paths unchanged; use expiring Actions artifacts as authority;
create another Goal/controller when the existing canonical state is unreadable.

The provider-specific HTTP/encryption adapter belongs alongside the existing
GitHub/fleet transport scripts, rather than changing the domain coordinator.
The two existing src/gai modules are byte-identical verification inputs only.

## Task and proof
- [x] Add tests first: encrypted restoration on a fresh client, stale concurrent
  writer rejection, renew/takeover through the existing runtime, missing state,
  authentication/transport failure, corrupt payload, wrong context, rollback,
  blind save, uncertain write outcome, and no secret-bearing errors.
- [x] Run RED against an explicit unimplemented adapter stub.
- [x] Implement scripts/goriq-github-coordinator-store.ts without other runtime changes.
- [x] Run focused tests and type check; record the environment and limitations.
- [x] Retain exact base files and hashes, code, test output and handoff.

## Critical limits and follow-up
This provides one backing store for the EXISTING coordinator. It does not itself
bind lease checks atomically to Compass/Job/attempt/side-effect writes. That
transactional connection, encrypted Goal/history storage, authenticated intake,
existing model selection, actual GitHub-hosted activation, pause/budget gates,
next-Job wakeup and real separate-run recovery remain required. Do not label a
mock GitHub protocol test as production GitHub acceptance.
Rollback protection across fresh processes requires an externally trusted
minimum epoch (and controlled append-only branch history); an encryption key
alone cannot establish freshness. No private owner record is used in fixtures.
Full repository CI on its pinned Node version remains required before integration.
Rollback is removal of this unused source adapter, tests and documentation only;
there is no production state mutation to reverse.

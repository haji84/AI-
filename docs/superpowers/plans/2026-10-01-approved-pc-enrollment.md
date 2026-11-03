# Approved PC Node Enrollment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Preserve prior Evidence under #1219; this plan is the approved trust prerequisite, not Goal completion.

**Goal:** Enroll the existing owner MacBook/ZBook with protected host-local signing identities and bounded PC authority, then continue the existing production distributed execution Goal.

**Architecture:** Extend the existing Owner-authenticated Broker administration boundary with a bounded PC challenge/proof enrollment path. Keep Android enrollment unchanged and use existing worker signing/nonce protection for subsequent heartbeats. Persist each public identity and fleet update atomically in existing tables; private material stays on its host. Trust is separate from observed availability and future execution verification.

**Tech Stack:** Node 24, TypeScript, node:test, SQLite existing tables, macOS owner-only files, Windows existing user-bound DPAPI.

**Spec:** `docs/architecture/goriq-distributed-node-fabric.md`, existing Worker Contract and #1662 approved 2026-10-01T11:18:17Z, expires 2026-10-02T11:18:17Z.

## Global Constraints

- No permanent physical main PC; Coordinator remains a transferable role.
- Preserve stable identity, signed worker requests/results, nonce/replay/clock protections, capability authorization and Human Gates.
- Preserve every existing Android fleet/identity record and Android Node Contract validation.
- Only macbook/macos and zbook/windows within #1219; no Owner/Admin grant, private key export/copy, new listener/port/firewall/TLS exposure, schema/DB import, existing-key overwrite/deletion, cloud/billing or Android rollout.
- Code/controlled harness success is not production mesh/offline/reconnect/failover/rebalance Evidence.

## Review Focus

- A client cannot promote its enrollment, capabilities or roles via descriptor/heartbeat.
- Existing identity, stale challenge, wrong key or replay must never overwrite trusted state.
- A persistence failure must leave fleet and identity mutually consistent and original Android state intact.
- Partial/crashed key creation or an unexpected existing key must fail visibly; never replace it or log secret material.
- Off-production tests and exact successful main must precede privileged activation; unsupported private transport remains a genuine separate blocker.

### Task 1: Owner PC proof enrollment

**Files:** Create `src/jarvis/pc-enrollment.ts`, tests `tests/jarvis-pc-enrollment.test.ts`; modify `src/jarvis/types.ts`, `src/jarvis/sqlite-state-store.ts`, `scripts/jarvis-broker.ts`; add live HTTP test `tests/jarvis-pc-enrollment-broker.test.ts` and required traceability mappings.

**Interfaces:** `PcEnrollmentService.offer(input, now)` returns bounded challenge ID, canonical proof text and expiry; `prove(id, signature, now)` returns server-sanitized JarvisNode and public JarvisWorkerIdentity. `JarvisSqliteStateStore.saveNewEnrollment(expectedSnapshot, nextSnapshot, identity)` atomically rejects conflicts/existing identities and commits into existing tables. Broker Owner-only `/api/jarvis/admin/pc-enrollment/challenge` and `/api/jarvis/admin/pc-enrollment/prove`; no private ingress administrative route.

- [ ] Write tests for valid proof, wrong/replayed/expired proof, malformed keys, non-approved target/authority, existing node and atomic rollback; observe RED.
- [ ] Implement the service with 5-minute challenges, at most 2 pending entries, descriptor/public-key binding and server-owned initial offline status/policy/capability ceiling. Add bounded PC authority metadata; no self-declared readiness/resources.
- [ ] Connect Owner-authenticated Broker routes and atomic enrollment; preserve Android routes. PC heartbeat must retain Owner-granted capabilities and authority rather than accepting client escalation.
- [ ] Run unit/store and actual HTTP signed heartbeat/security tests; expect PASS, including identity reconnect after Broker restart and original Android preservation.
- [ ] Full tests/lint/types/build, independent review, protected PR/main CI, exact approved production refresh; record revision and Evidence. Do not close #1662 or parent prematurely.

### Task 2: Approved host bootstrap and registration

**Files:** Create bounded host-local bootstrap scripts and a contents-read-only self-hosted activation workflow after Task 1 interfaces are verified; do not modify Mac runtime entry (its unrelated migration trigger is excluded).

**Interfaces:** Bootstrap validates the recorded #1662 approval/expiry and exact successful source, reads existing protected Owner configuration locally, validates/reuses its own approved identity or creates a new one exclusively, obtains Owner challenge, proves possession and sends an existing signed worker heartbeat. Output contains only public fingerprint, registered identity/contract verification booleans, source and time. Protected baseline backup and original Android preservation are mandatory.

- [ ] Fixture tests cover idempotent reuse, conflict/crash fail-closed handling, no-secret output and expired/wrong-target approval; observe RED then GREEN.
- [ ] Implement host storage and loopback Owner registration without private-key/token stdout or command-line arguments. Mac file owner/mode and Windows DPAPI identity are validated.
- [ ] Verify off-production, independent review and protected main CI; activate one physical host at a time within recorded approval, then verify signed identity continuity and fleet preservation.
- [ ] Inspect existing authenticated private-LAN transport metadata/reachability without changing exposure; connect existing Goal/Capability/Capsule/Privacy/durable/coordinator/sync contracts and continue real E2E. Any unavailable authority/infrastructure is recorded, never inferred as PASS.

## Baseline / Recovery

Baseline main cbd3d0d9e15d46370c25f644421e053dd1676c86; both physical DBs have 38 Androids/38 identities and no enrolled PCs (36850645301). Prior durable repair and controlled bidirectional handoff Evidence remain valid within their recorded source/scope. Restore previous exact successful runtime/configuration and disable/revoke only new PC participation when necessary; retain Android records, protected backups and keys. No automatic deletion or migration. Parent #1219 and Stage C stay incomplete until actual required physical E2E passes.

## Activation barrier interpretation

The manual activation run uses an initial two-host exact-runtime preflight, then sequential local enrollments. This is bounded preflight Evidence, not an atomic cross-host availability guarantee. Each host rechecks its own runtime, exact current-main source and approval expiry before its local mutation. A later peer stop or rollback must be handled by the subsequent real mesh/continuity verification; enrollment alone never passes that gate.

# Windows Worker integration plan (#1207 / PR #1208)

Goal: prove the existing native Windows consumer against the real isolated Broker without changing any enrolled production identity.
Base: c9806c63f97852baff7497c050cfb3fcfd2d6c8f; main 1ba440a4daf1bc2e1ffb20088d42b07fc62d21fa.
Spec: Issue #1207 and docs/architecture/0013-jarvis-v1-distributed-device-os.md.
Risk: MEDIUM, isolated candidate code. Physical-facing merge hold retained.
Execution: native implementation with independent code review. Owner explicitly requests autonomous completion; no routine design re-approval.

## Baseline / findings
- Existing focused tests: 8/8 PASS, but native-client transport and probe are substituted.
- Current main already contains #1181/#1182 dispatch/Broker contracts. Reuse them.
- Client never heartbeats; offline persisted nodes cannot become schedulable.
- Success POST is inside execution catch; lost success response can trigger opposite failure report.
- Broker expects detail.error; client sends detail.reason.
- Default fetch follows redirects. Native task does not validate lease expiry.

## Tasks
- [x] Add failing real Broker/client tests: initially offline identity, native process, durable result, restart, lost result acknowledgement, preserved disabled/control state and capabilities/policy.
- [x] Add failing adversarial transport/contract tests: redirected signed requests, invalid/mismatched acknowledgements, expired lease, malformed task, oversized responses and result recovery.
- [x] Add signed status heartbeat using existing route; preserve Windows owner control state/policy/capabilities. Never grant capabilities or enable a disabled/locked/needs-human node.
- [x] Separate execution and delivery errors. Persist a bounded identity/endpoint-bound result journal before native execution, retain results until matching Broker acknowledgement, and fail visibly on interrupted execution rather than re-executing it.
- [x] Keep fixed read-only Node probe, reject expired lease/invalid IDs before spawn, close output stream before evidence hashing. No arbitrary shell, environment preloads or caller arguments.
- [x] Run focused tests, full suite, P8, lint, build and local Windows software acceptance. Update canonical candidate refs/evidence without PHYSICAL promotion.
- [ ] Independent review completed with no blockers; push exact branch, verify CI, write back to #1207/#882/#681. Keep PR unmerged pending existing enrolled-device acceptance.

## Review focus
1. Result delivered but response lost must never turn success into failure.
2. Process restart cannot execute an already-started task twice.
3. Owner-disabled/locked/needs-human state and unrelated capabilities must be retained.
4. Redirect/error bodies cannot forward signed material or masquerade as a valid acknowledgement.
5. Offline initial state must recover with the same key and no enrollment.

Rollback: stop candidate process; retain its journal for inspection; restore prior candidate revision. Production service/config/registry remain untouched. No DB schema change or deletion.

Review corrections: select native validation from the stored task type; reject schema omission/type coercion; retire only exact terminal Broker rejection codes while retaining the original execution report; audit eviction is UNVERIFIABLE, never fabricated acknowledgement. Task-scoped polling preserves unrelated work. OS-owned locks bind both identity and journal before state load. Full suite 1436/1436, P8 314/314, typecheck/lint/build PASS on Windows; production physical acceptance remains pending.

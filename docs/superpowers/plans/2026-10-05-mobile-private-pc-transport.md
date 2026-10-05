# Wi-Fi independent private PC transport implementation plan
> For agentic workers: execute natively in this session using the existing authorized #1662/#1219 continuation; obtain an independent code review before integration.

Goal: keep registered PC execution reachable through the already provisioned private Tailnet HTTPS dashboard route after a Wi-Fi/IP change, retaining local execution when remote communication is unavailable.
Architecture: reuse / -> loopback Dashboard on existing private Serve. Add only signed PC heartbeat/next/result relay routes. Verify live native private ingress and independently sign each response with the host's existing registered Node key; clients pin the enrolled peer key and revision. No new listener, address, certificate, account, credential, Tailnet/OS ACL or firewall changes.
Spec: docs/architecture/goriq-distributed-node-fabric.md sections8-11; existing #1662 peer protocol scope. Node Contract, Capsule, Fabric, Privacy Partitioning and lease/fencing behavior unchanged.
Tech: Node24.19.0, TypeScript, Next16.3.2, existing Worker signatures, DPAPI/FilePcIdentityStorage, existing private Serve, existing durable PC executor.
Constraints: only macbook/zbook, goal1219, existing enrolled keys and PUBLIC filesystem tasks. No trust-on-first-use, Owner credentials in peer traffic, redirect or TLS bypass. Unknown/private-ingress-query failure is not connectivity proof. Preserve Android38 and all state; no schema/DB import. Native evidence remains required.

## Connected implementation
- [ ] RED: real signed relay tests reject public/unknown/private-route mismatch, credential forwarding, wrong peer/nonce/revision/tampered proof; stable Tailnet origin remains unchanged across physical private-IP changes.
- [ ] Implement src/jarvis/private-pc-transport.ts: bounded request/response relay plus peer proof bound to request identity, nonce, path, status, digest, timestamp and source revision. Only exact private PC route allowlist.
- [ ] Implement src/jarvis/private-pc-native.ts: successful read-only native Tailscale state/Serve check; current native identity is read-only and must match registered unrevoked host public key/Goal authority before signing. No secret/key creation, process/config mutation or raw diagnostic logs.
- [ ] Connect native-only dynamic src/app/api/jarvis/worker/[...action]/route.ts; hosted/cloud/unknown ingress always refuses before key read/upstream.
- [ ] Add executeRemotePcWork in existing pc-bootstrap.ts, reusing the existing claimed PUBLIC file executor; local enrollment/Owner tokens stay loopback-only. Reject remote assignments before file execution unless the exact enrolled peer signature/revision and existing claim/capsule checks pass.
- [ ] GREEN: pnpm test, lint, build, P8 and Windows fixtures through protected CI. Add real isolated Broker signed assignment/file execution/result return with disconnected/reconnected transport and unchanged stale ownership rules. Reconcile source hashes and preserve Evidence.
- [ ] Independent review -> main exact CI -> scoped Production -> owner-native exact-source apply (direct Windows execution unavailable). Verify moved-Wi-Fi local task, private URL and registered peer task using actual native receipts. A missing mutual peer enrollment is a visible prerequisite, never silently trusted or fabricated.

Review focus: public Funnel turned on after startup; inaccessible Tailscale/key/DB; replay/wrong server identity; stale execution claim after reconnect; unregistered peer or private data. Include denial tests and preserve the durable source of truth. Full multi-repository state reconciliation/coordinator-loss/rebalance remains a separate unfinished acceptance; this route does not claim that E2E.
Rollback: revert only new adapter/client route in an exact reviewed release; retain existing enrollment, keys, state, backups and unchanged private Serve. No key/DB deletion.

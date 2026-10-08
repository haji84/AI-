# Signed PC observations before Coordinator ownership (#1754)

Date: 2026-10-09 JST
Status: Implemented and independently reviewed in #1754; physical acceptance pending.
Parents: #1219 / #681 / #1662.

The production Broker currently owns a local DurableTaskStore. Its PC task path is not connected to DistributedCoordinatorRuntime or peer state replication. PR #1752 recovers a completion whose response was lost, but it does not move ownership between Brokers. The existing Coordinator store arbitrates on one filesystem: connecting independent copies does not provide distributed consensus. A two-PC partition cannot distinguish a stopped peer from an unreachable peer reliably.

Reuse audit also inspected the unmerged #884 `coordinator-replica-store.ts` and `coordinator-compatibility.ts` at `6af365ceb1b52b9111f98760da8d352449632871`. Those implement local primary/shadow promotion and GET/HEAD comparison, not authenticated bounded PC observations or cross-process conflict retention. This increment therefore reuses the current main SyncRepository, file lease and signed PC transport instead of importing that older promotion mechanism.

This increment exchanges bounded observations of an explicit PUBLIC file-digest task through the existing enrolled PC signing identities and private transport. Only the existing #1662/#1219 Storage and Coordinator participation is eligible. Request authentication, nonce protection, revocation and exact response revision checks remain required. No new credential, role, listener, firewall rule, account or paid service is introduced.

An observation describes what a particular authenticated PC reports. It does not transfer a lease, fencing token, task claim, Coordinator role or permission. A stored completion's `verified` and `issuer` metadata do not retain the original Worker signature; authenticating the observing peer is not an independent proof of the historical execution. Likewise, a greater epoch is data, not authority to supersede another Broker.

Observations are kept in a separate durable synchronization area. Before sending, each client retains its own signed observation locally, so reciprocal exchange can compare local and peer states in both stores. The adapter validates an explicit bounded projection and preserves incompatible variants and their provenance across retransmission and restart. It never writes received records into the executable task store. Generic higher-epoch, verifier-rank or last-write-wins rules must not erase conflicts in this area. A storage failure must produce a failed acknowledgement rather than an in-memory success that disappears after restart.

The subsequent ownership increment must cover enqueue, reclamation/claim, and completion in the same ownership protocol. A separate authority check followed by an unfenced task mutation is insufficient. Cooperative handoff can require durable agreement from both PCs. During a partition, only work whose safety follows from its existing local authority or explicitly pure computation can continue; ambiguous shared claims and external effects wait. This decision does not claim that two isolated PCs can both safely grant globally exclusive ownership.

Software acceptance uses separate Broker processes, identities and stores with real socket interruption. Physical MacBook/ZBook, native TLS/Tailscale, LAN-only operation, Coordinator loss, partition, conflict resolution, rebalance, PINNED and SIDE_EFFECTING acceptance remain separate. Production fault injection waits for native runtime alignment and the ownership integration.

Rollback removes only the new observation adapter and routes while retaining evidence files. Existing local queues, identities, enrollment and PC execution paths remain authoritative. No saved DB import, schema migration or evidence deletion is part of rollback.

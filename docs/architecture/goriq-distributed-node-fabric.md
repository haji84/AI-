# GORIQ Distributed Self-Complementing Node Fabric

Issue: #1350
Parent: #681 / #1219
Owner architecture decision: 2026-09-28 JST

## 1. Core invariant

GORIQ must not depend on one permanent physical "main PC".

GORIQ is the set of currently available trusted nodes plus durable Goal, Task, State, Memory and Evidence. MacBook, ZBook, Nubia, iPhone, future PCs and later Android fleet members are independent nodes. A logical Coordinator may exist at a given moment, but Coordinator is a transferable role rather than a permanent hardware identity.

No specific device, cloud service or external AI is a survival requirement. Loss of a fast capability may reduce performance, but it must not stop unrelated work when a slower authorized path remains available.

## 2. Node model

Every node registers a capability/resource manifest sufficient for scheduling and recovery. Where the platform permits, the manifest includes:

- stable node identity and trust state
- platform / OS / architecture
- CPU characteristics and current load
- GPU / accelerator capabilities and current load
- RAM capacity and available memory
- storage capacity, locality and relevant data location
- network reachability and available routes
- power / battery / charging state
- thermal state where available
- sensors, camera, location and platform-specific APIs
- background/resident execution limits
- installed/authorized tool capabilities
- health, last-seen time and current task ownership
- privacy, risk and Human-Gate constraints

Missing metrics must remain unknown rather than fabricated.

## 3. Logical roles

Roles are assigned dynamically from verified capability and health:

- Coordinator: durable scheduling / ownership arbitration
- Executor: task execution
- Storage: durable state or artifact holder
- Verifier: independent result verification
- Gateway: authenticated transport bridge
- Owner/Input node: human interaction and trusted approval
- Sensor/Edge node: mobile sensors, camera, location or lightweight edge work

One node may hold multiple roles. A role may move when a node disappears, returns or becomes overloaded.

Coordinator loss must not equal GORIQ loss.

## 4. Scheduling and parallel execution

The Capability Router and resource model select execution based on:

- required capability
- CPU/GPU/RAM suitability
- current load
- platform-specific capability
- data locality
- network cost / availability
- power / thermal constraints
- risk / security / privacy policy
- expected latency and throughput

Independent work should run in parallel when doing so preserves dependency and verification contracts.

A preferred high-speed path is not mandatory if a slower authorized path can still satisfy the Goal. The router should degrade performance before degrading correctness.

Only work that truly requires a missing capability enters a waiting state. Unrelated work continues.

## 5. Task migration classes

Every durable task must declare one migration class:

### MIGRATABLE
Execution may continue from a durable checkpoint on another eligible node.

### RESTARTABLE
The task may safely restart from a known durable input on another eligible node.

### PINNED
The task requires a specific node/platform/device-local resource and waits when that capability is absent.

### SIDE_EFFECTING
The task can cause an external or irreversible effect. Failover must preserve idempotency, verification and side-effect ownership before retry or continuation.

The system must not pretend that a PINNED or non-checkpointable task is migratable.

## 6. Ownership, lease and stale-result fencing

Distributed execution must prevent split-brain commits and duplicate side effects.

Each task execution uses at minimum:

- Task ID
- idempotency key
- current execution owner
- lease expiry
- execution epoch
- fencing token
- checkpoint/version reference
- result version / provenance

When ownership moves, the execution epoch and fencing token advance. Results from an older epoch/token must be rejected even if the previous node later reconnects.

Lease expiry is evidence for reassignment, not permission to duplicate an external side effect blindly.

## 7. Node loss and fallback

When a node becomes unavailable:

1. mark its health unavailable after bounded detection
2. stop assigning new work to it
3. inspect owned tasks and their migration class
4. preserve durable task state/checkpoints
5. migrate or restart work on another eligible node when safe
6. use slower fallback capabilities when correctness can be preserved
7. leave only non-substitutable work waiting
8. continue unrelated tasks

Failure of MacBook, ZBook, Nubia or another node must not globally pause GORIQ unless all safe paths for the active Goal are genuinely unavailable.

## 8. Offline and same-LAN operation

Network is not a survival condition.

- A node continues local-capable work while offline.
- Same-LAN trusted nodes should coordinate without Internet through the existing Local Device Mesh.
- Online-only work becomes a durable waiting item.
- Local work must not be blocked merely because a cloud service or external AI is unavailable.
- External AI remains an optional capability, not the control plane.

## 9. Partitioned operation and resynchronization

If nodes at different locations cannot communicate, each partition continues work that is safe under its current ownership and capabilities.

On reconnection, nodes exchange deltas for:

- Goal / task state
- checkpoints
- results
- evidence
- artifacts / references
- memory / verified learning state
- capability/health changes

Critical state must not use naive last-write-wins. Conflict resolution uses ownership, execution epoch, causal/version metadata and verifier evidence.

Conflicts that cannot be resolved safely fail visible rather than silently selecting one side.

## 10. Node return, new node addition and rebalancing

When a known node returns:

1. authenticate existing identity
2. refresh health and capability/resource manifest
3. reconcile state since disconnect
4. reject stale execution ownership
5. reevaluate waiting and running tasks
6. rebalance eligible work when useful

A newly added trusted PC or device should expand capacity without manual topology reconstruction. The same Node Contract is used for future nodes.

## 11. Security invariants

Distributed operation must preserve:

- Owner authentication
- stable node/device identity
- signed worker request/result contracts
- nonce/replay/clock protections
- capability authorization
- private ingress rules
- Human Gates
- audit/evidence history
- durable queues and task history

Failover, offline operation and performance optimization never grant new authority.

## 12. Reuse before new implementation

This architecture extends existing components instead of creating parallel substitutes:

- Worker Runtime
- Durable Task Runtime
- Offline-First Runtime
- Sync / Conflict Resolution
- Local Device Mesh
- Self-Healing / Recovery
- World / Resource Model
- Capability Router
- Owner Fleet capability selection
- Goal Controller and durable execution state
- Verifier / Evidence contracts

A new subsystem is justified only when the existing contract cannot express the requirement safely.

## 13. Rollout order

### Stage A: current Mac stabilization
Finish and verify the current Mac runtime stabilization work. Do not mix unresolved stabilization defects with distributed failover implementation.

### Stage B: MacBook + ZBook
Prove two-node operation first:

- resource/capability discovery
- dynamic work placement
- Mac loss
- ZBook loss
- coordinator loss
- task migration/restart
- reconnect
- resync
- rebalancing
- duplicate/stale-result rejection

### Stage C: Nubia
Nubia is the first full Android/mobile-edge distributed node and canary before mass Android rollout.

Prove:

- Node Contract registration
- mobile capability discovery
- task assignment
- offline local work
- lease loss
- failover
- reconnect
- resync
- automatic rebalancing

### Stage D: iPhone
iPhone participates within iOS limits as Owner/input/sensor/mobile capability. It must not be modeled as an unrestricted resident PC daemon.

### Stage E: future high-performance PC
Adding a new trusted PC must automatically expand compute capacity and scheduling options without hand-editing the topology.

### Stage F: Android fleet
The preserved 38 Android devices are intentionally deferred from the current completion milestone.

After Nubia proves the Android Node Contract, the 38 devices join the same Fleet contract without requiring a new architecture or mass manual per-device redesign. Existing identities/state must be preserved where compatible.

## 14. Acceptance matrix

Automated tests and physical evidence must cover at minimum:

- normal MacBook + ZBook operation
- MacBook abrupt loss
- ZBook abrupt loss
- coordinator loss
- network loss with same-LAN operation
- full partition between locations
- task checkpoint migration
- restartable task reassignment
- pinned task waiting while unrelated work continues
- side-effecting task duplicate prevention
- stale lease/epoch/fencing-token result rejection
- partial recovery
- both primary PCs recovered
- resynchronization
- conflict handling
- workload redistribution
- Nubia join / loss / return
- new PC automatic join and capacity expansion
- later Android fleet expansion

Evidence must identify source revision, participating platforms, failure/recovery sequence and verifier outcome. CI evidence is not a substitute for physical-node evidence.

## 15. Completion condition

The distributed-node milestone is complete only when:

- no permanent physical main host is required for GORIQ survival
- the currently available trusted node set collectively provides the active GORIQ body
- loss of one eligible node degrades capacity rather than globally stopping unrelated work
- safe tasks migrate/restart or fall back automatically
- only truly unavailable capabilities wait
- returning/new nodes are automatically reintegrated and considered for rebalancing
- duplicate/stale execution cannot commit after ownership changes
- offline/LAN/partition/reconnect behavior is backed by real recovery evidence
- MacBook + ZBook + Nubia physical acceptance passes before Android fleet expansion

Performance should scale up as nodes become available and degrade gracefully as nodes disappear.

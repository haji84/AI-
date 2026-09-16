# JARVIS P4 staged physical fleet acceptance plan

Parent: #681  
Child: #740

## Status and evidence boundary

This document is a test plan only. It is **not PHYSICAL PASS evidence** and must not be used to promote any PHYSICAL- or RECOVERY-gated Requirement Ledger row. A stage is PASS only after the prescribed real-device observations have been captured against an exact commit SHA and independently checked against the exit criteria below.

The goal is to grow physical confidence gradually instead of discovering at device 100 that device 37 has quietly become a decorative rectangle.

## Safety invariants

Every stage keeps these invariants unchanged:

- owner authentication remains enabled;
- worker request/result signing remains enabled;
- nonce/replay/clock-skew protections remain enabled;
- private ingress remains private; no router port forwarding or public Funnel is introduced;
- no paid service is enabled merely to make the stage pass;
- credentials, permissions, key revocation and destructive changes remain Human-Gated;
- failed devices remain failed in the evidence record; they are not removed from the denominator to improve a result.

A security invariant failure is an immediate STOP for that stage and all larger stages.

## Required preflight

Before Stage S1, record:

- exact `main` commit SHA under test;
- JARVIS host platform and build/version information;
- private-ingress state;
- Broker, Remote Gateway, enrollment portal and supervisor health;
- fleet database/state backup or known-good rollback point;
- available device inventory with stable device IDs and platform/capability manifests;
- test operator and observation start time.

Do not begin a larger stage while the preceding stage has an unresolved unexplained failure.

## Stages

### S1 — one real device

Purpose: prove the basic enrollment -> task -> signed result -> verifier path on one real device.

Required observations:

1. enroll through the intended current-device path;
2. stable device ID is visible in the fleet;
3. issue one harmless representative task;
4. capture task ID and result ID;
5. verify signed result and verifier outcome;
6. disconnect and reconnect the device network;
7. confirm the same device returns without re-enrollment;
8. reboot the device where the platform permits unattended return and confirm the expected reconnect behavior.

Exit: all required observations are present, or the platform limitation is recorded explicitly. No unexplained identity change or duplicate registration is allowed.

### S5 — five-device mixed representative fleet

Purpose: catch identity, scheduling and reconnect defects that a single device cannot expose.

Required observations:

- five distinct stable device identities;
- capability manifests match the actual devices;
- at least one concurrent multi-device job;
- no task is delivered to a device lacking the required capability;
- disconnect/reconnect one active device during the run;
- remaining devices continue within policy;
- returning device resumes without a fresh enrollment unless the test intentionally exercises replacement.

Exit: all five devices remain uniquely addressable and evidence for every attempted task is retained.

### S10 — ten-device scheduling and recovery

Purpose: repeat the already-covered software scheduling boundary on a larger real fleet and exercise recovery under concurrency.

Required observations:

- ten unique device identities are visible simultaneously;
- representative concurrent jobs complete with verifier evidence;
- one device is rebooted or deliberately disconnected;
- scheduler does not route new work to an unavailable device;
- recovery does not create a duplicate identity;
- reconnect occurs without repetitive manual registration.

Exit: no duplicate device identities, orphaned task ownership, or unexplained lost result.

### S25 — quarter-fleet soak

Purpose: expose resource, polling, session and operational issues before large-scale rollout.

Run a bounded soak long enough to include normal polling/heartbeat cycles and at least one reconnect event. Record host CPU/memory observations when available, queue health, device online/offline transitions and all task failures.

Exit: no progressive queue growth, identity churn, repeated enrollment demand, or unexplained supervisor restart loop.

### S50 — half-fleet stress

Purpose: validate that the host and fleet control plane remain usable with half of the target population.

Exercise:

- concurrent harmless tasks across multiple capability groups;
- fleet/device list operations;
- reconnect of a small subset;
- at least one intentionally unavailable device;
- evidence retrieval for successful and failed tasks.

Exit: control plane remains responsive enough for routine operation, failures are explicit, and no security invariant changes.

### S100 — target capacity

Purpose: physical acceptance at the target population boundary.

Required observations:

- exactly 100 unique registered fleet identities are visible;
- every device has a stable node ID and expected capability manifest;
- a representative bounded workload is distributed without exceeding policy;
- a sample of successful and failed tasks has complete verifier evidence;
- reconnect/reboot sampling confirms no-re-enrollment behavior where supported;
- fleet count remains 100 after recovery events.

This stage does not require pretending that every device supports identical capabilities. Platform-specific capability degradation must remain visible.

Exit: the 100-device physical fleet is observable and manageable without repetitive per-device registration work, and all required evidence fields below are present.

### S101 — fail-closed overflow boundary

Purpose: physically corroborate the software capacity boundary where practical.

With S100 still at capacity, attempt to register one additional disposable/test identity. Expected result: registration is rejected with the configured fleet-capacity failure and the existing 100 identities remain unchanged.

Do not sacrifice a real production identity merely to manufacture this observation. If a safe physical S101 attempt is not practical, retain the existing CODE/UNIT/INTEGRATION evidence for FLEET-011 and record the PHYSICAL boundary as not executed rather than inventing a PASS.

## Mandatory evidence record for every stage

Each stage record must contain:

- `stage_id`;
- observation start/end timestamps with timezone;
- exact commit SHA;
- host platform/host identifier suitable for the test record;
- each participating device's stable node ID, platform and capability summary;
- enrollment method and whether re-enrollment occurred;
- task ID and result ID for each representative task where applicable;
- verifier outcome and supporting result/evidence reference;
- network/reboot/reconnect event timestamps where exercised;
- observed fleet count before and after the stage;
- operator-observed outcome;
- failures, retries and unresolved anomalies;
- explicit `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` verdict with rationale.

Evidence must be append-only or otherwise auditable. A screenshot alone is not sufficient where signed task/result or verifier records exist.

## Fail-closed stop conditions

Stop the current stage and do not advance when any of the following occurs without a known, verified explanation:

- owner authentication or signing becomes bypassed;
- nonce/replay protection is disabled or fails;
- private ingress becomes public;
- duplicate stable device identities appear;
- a reconnect requires silent credential replacement;
- task/result identity cannot be attributed to the expected device;
- data loss prevents verifier reconstruction;
- the host enters an unbounded restart loop;
- continuing would require a privileged credential, permission, destructive, billing or security change without Human Gate approval.

## Rollback and retry

For a failed stage:

1. preserve the failed evidence bundle;
2. return to the last known-good software/state checkpoint where safe;
3. diagnose the smallest reproducible failure;
4. fix through the normal issue/PR/CI path;
5. repeat the failed stage before attempting a larger stage.

Do not rewrite a failed physical record into a pass after a code fix. Create a new run record tied to the new commit SHA.

## P4 completion relationship

This plan satisfies only the requirement to define a practical staged physical fleet test/evidence procedure. It does **not** by itself complete P4, FLEET-009, any onboarding/reconnect PHYSICAL requirement, or physical 100-device acceptance. Those claims require actual real-device evidence produced by this plan.
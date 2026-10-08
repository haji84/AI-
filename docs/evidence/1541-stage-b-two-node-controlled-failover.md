# Stage B MacBook ↔ ZBook controlled failover evidence

Issue: #1541  
Parent: #1350 / #1219  
Source revision: `dd4fe81683a201c7d72c36d3841d03a0b7f67b92`  
Workflow run: `36585886942`  
Evidence class: MACHINE_VERIFIED  
Verdict: PASS

## What physically ran

The workflow executed on the real self-hosted MacBook and ZBook runners in both directions.

### MacBook → ZBook

- MacBook created one `MIGRATABLE` and one `RESTARTABLE` durable task.
- Both tasks were leased to MacBook with execution epoch 1.
- The migratable task persisted a durable checkpoint.
- The origin lease was intentionally allowed to expire without completion.
- ZBook loaded the durable snapshot, reclaimed both tasks and acquired new claims.
- Both tasks advanced to execution epoch 2 with new fencing tokens.
- The `MIGRATABLE` checkpoint was preserved.
- The old MacBook claims were rejected as stale and could not commit.
- ZBook completed both tasks.

### ZBook → MacBook

The same sequence passed in reverse:

- ZBook owned epoch 1.
- MacBook reclaimed both tasks after controlled lease loss.
- Both tasks advanced to epoch 2.
- The migratable checkpoint was preserved.
- Old ZBook claims were rejected.
- MacBook completed both tasks.

## Machine evidence

Combined artifact:

- name: `goriq-stage-b-two-node-failover-evidence`
- artifact id: `11041532079`
- SHA-256 digest: `0f16046ddf0d8143ccefa7f64761114b5c5cdd8dd0d6231b80a97a1340b0553e`

The hosted verifier checked exact source SHA, both directions, both migration classes, reclaimed-task counts, epoch advancement, checkpoint preservation and stale-claim rejection.

## What this proves

- real MacBook and ZBook can each act as origin and recovery executor;
- `MIGRATABLE` work can resume from durable checkpoint on the other physical node;
- `RESTARTABLE` work can restart on the other physical node;
- execution ownership advances from epoch 1 to epoch 2;
- stale pre-handoff claims cannot commit after ownership changes;
- no permanent one-way execution host is required for this controlled handoff path.

## What this does not prove

This run deliberately used controlled lease expiry. It does **not** yet prove:

- abrupt MacBook power loss;
- abrupt ZBook power loss;
- coordinator loss and election/failover;
- same-LAN operation with Internet absent;
- full network partition and later resynchronization;
- workload rebalancing after node return;
- `PINNED` and `SIDE_EFFECTING` physical-node acceptance.

Those remain Stage B acceptance work and must not be inferred from this PASS.

No credential, permission, enrollment, firewall/network setting, destructive DB/schema action, billing, or Human-Gate change was performed.

# Mobile-first autonomy

The phone is the control surface. The bounded worker runs in GitHub Actions, so a personal PC does not need to stay online.

## From iPhone or Android

Open the repository in the GitHub mobile app or mobile browser, open **Actions**, choose **Mobile Autonomy**, then choose **Run workflow**.

Modes:
- `run`: run a bounded autonomy cycle now.
- `pause`: persist `PAUSED` state so scheduled cycles stop safely.
- `resume`: clear the pause and run again.
- `status`: read and publish current persisted state without executing a cycle.

The workflow summary shows status, pause state, blockers, verification summary, and next action in a mobile-readable view.

## Scheduled operation

The workflow wakes every six hours at minute 17. Each invocation is bounded to three cycles by default and has a 15-minute job timeout. It is not a daemon and cannot silently loop forever.

## Persistence

`.autonomy-state/compass.db` is restored and saved through GitHub Actions cache using a unique per-run key and the `autonomy-state-` restore prefix. This allows state to survive ephemeral runners without committing the SQLite database to the repository. If no persisted goal exists yet, the cloud runner bootstraps a conservative repository-governance goal from the checked-out project context.

GitHub Actions cache is operational persistence, not archival storage. If durable audit-grade persistence becomes required, add a dedicated remote state backend behind the same state-store boundary rather than committing mutable state to `main`.

## Safety

The workflow declares `contents: read` only. The runtime GitHub connector is read-only. It does not merge, deploy, publish, change permissions, alter secrets, or perform destructive/external writes. Human Gate remains mandatory for those actions.

Missing GitHub context or other connectors must be surfaced as unavailable, never fabricated.

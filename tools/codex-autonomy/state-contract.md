# Optional lifecycle state contract, version 1

The controller reads an explicitly bound repository-relative JSON file; it never writes it. Reuse existing state. A projection must include `source: {path,sha256}` identifying its current canonical file. Only a project without any state mechanism should use `.codex/autonomy-state.json` as a new single source of truth.

```json
{
  "version": 1,
  "goal": {"id":"issue-1952-example","title":"Working artifact","acceptance":["Functional tests pass"]},
  "status":"active",
  "tasks":[
    {"id":"module-a","status":"pending","depends_on":[],"actionable":true,"evidence":[]},
    {"id":"verify","status":"pending","depends_on":["module-a"],"actionable":true,"evidence":[]}
  ],
  "next_action":"Implement module-a and verify behavior",
  "limits":{"maxContinuations":3,"maxNoProgress":2,"maxMinutes":20}
}
```

Statuses: active, paused, cancelled, awaiting_approval, resource_limited, blocked, complete. Task statuses: pending, running, verified, failed, blocked. Verified tasks require bounded local evidence `{path,sha256}`. Evidence should record actual command/result, source revision, environment/time and criterion coverage; file existence alone does not establish semantic completion. Never put secrets or raw transcripts here. Repository-relative source/evidence paths must stay inside the bound root and avoid symlinks.

Declare dependencies and mark work actionable only when it is safe and authorized. Independent executable work can continue despite a blocked sibling. Approval/resource/user-stop states always allow the turn to stop. A complete claim with inconsistent or missing evidence is reported as unverified. Counters and elapsed-time bounds are per Goal/session and survive rebind/resume; the controller's private runtime metadata is not a Goal ledger. Total account token/cost limits remain native; these hooks do not receive reliable token accounting and never claim a token-level hard limit.

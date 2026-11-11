# Issue #1219: bounded CI repair and actual model connection

Recorded on 2026-11-11. Continue Draft PR #1907 on
`feature/1219-hosted-goal-job-routing-20261111`.

## Verified baseline and scope

The repository, PR metadata, current comments, changed files and Actions results
were re-read before implementation. The baseline PR HEAD was
`374d65e7e2b1d2109ddf97f9cf5c3a1e9716fac1`; main was
`6737e15033eced135461076d72f792516e83c9b3`. PR #1907 remained Draft/open and
Issue #1219 remained open. A detached worktree isolated these changes from the
previous checkout. Publication must use a non-forced expected-HEAD update.

This continuation changes the existing tracked-repair resident factory, its
legacy checkpoint boundary, advisory diagnostic logging and inert PowerShell
test execution. It does not introduce a second Goal Controller. The authenticated
intake -> Compass -> goal executor -> resident host -> Builder/Verifier ->
canonical state path remains the production architecture.

The original `goal-fcc81c97e09153f7` / `rotation-recovery-37` was not authenticated,
read from its live canonical store, replaced, reset or marked complete here.
The available connector surface did not provide a live Compass/Broker read.
Unavailable access is not evidence that the Goal, its settings or its keys do
not exist. Repository write-back is available; Compass write-back is unavailable.

## CI failure: evidence and correction

Baseline Actions run [43001898750](https://github.com/haji84/AI-/actions/runs/43001898750)
has successful project, Windows and repository checks, but its restricted
verifier Unit command was killed at the unchanged 300000ms budget. The passing
parent is `ec5f5d24f311ac577c17e29d25cab85d81539372`, run
[42994392421](https://github.com/haji84/AI-/actions/runs/42994392421).
Parent success is not current-HEAD success.

The failed Unit recorded 562.135 CPU seconds over a 294.5-second observation
window and throttling in 2536 of 2945 periods. Observed peak memory was
432226304 bytes against 2GiB; peak PIDs were 77 against 128. These observations
support CPU saturation, without claiming a complete proof of every timing
variation or an observed out-of-memory failure.

Repeated PowerShell process startup was measured in unchanged fixture families.
Five inert scenarios took 4.309 seconds in separate processes and 1.155 seconds
using fresh runspaces in one process. The three selected wrapper files contain
84 inert Linux scenarios: 30 retention, 19 diagnostics and 35 transaction cases.
Their original scripts and assertions remain unchanged. Each scenario gets a
new runspace. Windows paths and cases whose native process behavior is under
test retain the original process execution.

The helper treats nonzero exit, exceptions, diagnostic output, changed process
environment/current directory, malformed results, duplicate/missing/foreign
cases and timeout as failures. A failed batch is not retried. State changes are
restored before the next case. These selected fixtures were reviewed for shared
mutable CLR static state; this is not permission to batch arbitrary future
fixtures.

Measured three-file comparison:

| Measurement | Original processes | Revised execution |
| --- | ---: | ---: |
| Tests | 92 | 92 |
| Pass / fail / existing conditional skip | 89 / 0 / 3 | 89 / 0 / 3 |
| Wall seconds | 43.536 | 12.982 |
| CPU seconds | 87.889 | 22.147 |

All 84 batched cases were also run through their original `pwsh -File` route.
Every complete JSON result matched; original status was zero and stderr empty.
The parity result SHA256 is
`504ea1a7b59d05ee17ca6a4ab5054ffe24de337a1d4a2f426a8eb2df139cd230`.
The evidence archive is
`docs/evidence/1219-20261111-powershell-fixture-evidence.zip`, SHA256
`3da06ebe673774b496664a54bee1a61e574a98bc09b1c2b02d81daa106b15c4b`.

An initial local whole-suite observation was interrupted by automatic approval
review over possible PowerShell telemetry egress; its partial output is not a
pass. Subsequent local checks explicitly disable PowerShell/.NET/Next telemetry.
No check, skip, signature rule, container resource limit or timeout is relaxed.
Only the exact published HEAD's completed hosted run can establish that the
300-second CI gate now passes.

The fresh opt-out local whole-suite attempt used Node v24.22.1 and CPU affinity
0,1. It reached 300.005 seconds and was killed by its own unchanged budget before
completion. Two failures were emitted in the unchanged network-local-runtime
tests; tracked repair output was still partial. This is not a local whole-suite
pass, nor is this non-container environment a reproduction of hosted Node
v24.19.0 and the restricted verifier image. The reviewed source is submitted to
the existing Draft PR so its exact hosted conditions can decide the gate.

## Explicit local Ollama connection

The available hosted asset prepares Ollama, whereas the existing tracked-source
factory accepted only llama.cpp `/completion` and `/apply-template`. The factory
now accepts an explicit `model.provider: "ollama"`; omission preserves the
previous llama.cpp contract. There is no automatic provider or paid fallback.

Ollama requires an HTTP `127.0.0.1` `/api/generate` endpoint, a host-pinned model
ID and SHA256, bounded inventories/responses and exact model identity. Installed
model evidence is read before generation; loaded and installed evidence is read
afterward. A positive local size, matching digest and absence of remote metadata
are required. Redirects, ambiguous inventory, changed identity, incomplete output
and remote/cloud model references are refused.

Independent source review identified a pre-dispatch race: a tag could become a
remote alias after the inventory check. The corrected request uses the server's
explicit `:local` source selector, and requires that same model name in the
generation response. Inventory and attestation retain the ordinary ID. Already
qualified/nested local selectors are refused. An unsupported selector fails
closed, with no unqualified retry. The relevant pinned implementation is
[Ollama v0.34.0 modelref](https://github.com/ollama/ollama/blob/v0.34.0/internal/modelref/modelref.go)
and [GenerateHandler](https://github.com/ollama/ollama/blob/v0.34.0/server/routes.go).

The new regression first failed with one simulated remote dispatch. After the
fix, dispatch is zero, candidate source is unchanged, intent is preserved and
replay cannot issue another inference. Success-response identity and explicit
suffix refusal also failed before the correction. The three affected model,
Actions and AI09 test files subsequently passed 84 tests, zero failures and zero
skips in 60.152 seconds. Independent code re-review found no unresolved
Critical/Important/Minor findings. This review is not a production signed receipt.

Each successful preparation preserves the actual model response and a separate
model-attestation record with the three observations. Prepared evidence binds
that record's hash. Existing intent, candidate, failed-attempt, signed-FAIL,
scope, expiry, admission and no-reinference rules remain mandatory. The record is
host-observed API provenance, not independent cryptographic model attestation.

The older Actions checkpoint exporter cannot preserve this new evidence or the
existing complete multi-attempt history. It explicitly refuses Ollama profiles
before snapshot/export/restore, just as it already refuses recovery profiles.
Adding a filename allowlist would not establish durable ownership or complete
continuation.

## Actual inference: a preserved failure, not production completion

Ollama v0.34.0 was run on loopback with `OLLAMA_NO_CLOUD=1`, using the existing
hosted model choice `qwen2.5-coder:3b`. Installed model digest:
`f72c60cabf6237b07f6e632b2c48d533cef25eda2efbd34bed21c5e9c01e6225`.

The normal tracked-repair resident factory performed a real inference against
the real AI09 catch-block defect in isolated worktrees. It used default resource
admission and an actual HTTP model service. This experiment had a distinct,
explicitly isolated fixture Goal; it did not substitute for the owner's Goal.
The public verifier key was the published RFC8032 fixture public key only. No
private verifier signer or signed acceptance was created or used.

The actual attempt ran from `2026-11-11T13:13:32.184Z` to
`2026-11-11T13:14:21.850Z` (22:13–22:14 Japan time). The model reported 2310 prompt
tokens and 42 generated tokens. Its replacement removed the required catch
clause. The fixed behavioral probe exited 1 with
`SyntaxError: Missing catch or finally after try`.

- Candidate source/artifact SHA256:
  `b384930b324198476af0419e1923f005b6c09e0c061e774b644c2a65382f1157`.
- Patch SHA256:
  `d02675c70cd1366fc32e8310554b33512b0d7addf1b1fbbf490a235834d44cb2`.
- Candidate remained `LOCAL`; the Job remained `VERIFYING`, awaiting six-check
  independently signed evidence. The baseline RED record's `VERIFIED` status
  does not describe the candidate.
- A new runtime instance restored prepared evidence with zero model calls.
- There was no signed complete FAIL granting another attempt, so no second
  inference, rewritten intent or erased failure was performed.

Full selected intent, response, prepared data, model observations, fixed probe,
candidate patch, request, Job/change-set records and failure log are preserved in
`docs/evidence/1219-20261111-ollama-live-failure.zip` (35923 bytes), SHA256
`8079be9748b101114dbe3312a5c468966d6ec14bf05857170133f6addc8a5703`.
The machine-readable summary is the adjacent `.json` file.

This live attempt used runtime source SHA256
`ff5a720c15ce57b1b12c82a08d36655023b604e2dddaeaab8f4aafff7b06a3bd`,
before the local-selector review correction. Its server had cloud disabled.
It must not be relabelled as an inference run of the later source SHA. A separate
load-only live protocol check passed at `2026-11-11T13:25:28Z`: the real v0.34.0
server returned `qwen2.5-coder:3b:local` and `done_reason: load`; installed and
loaded model digests matched. The record is
`docs/evidence/1219-20261111-ollama-local-selector.json`. This did not generate
another candidate or change the consumed attempt.

## AI09 advisory diagnostics

Run [43002934386](https://github.com/haji84/AI-/actions/runs/43002934386) completed
as a workflow but its actual result was `BLOCKED`. The downloaded artifacts
preserve the generic prerequisite/model-unavailable code and do not identify
the precise caught historical exception. Current 41-file comparison input
deterministically exceeds the existing 30-file comparison limit before any
inference. This is a reproduced current blocker, not proof of an otherwise
unrecorded historical exception.

The catch path now logs only a fixed allowlist of known diagnostic codes;
unknown exception text remains generic. BLOCKED receipts and all existing
30-file/120KiB/24-chunk/150-second limits are retained. AI09 remains advisory and
is neither a substitute for the production signer nor a blanket Goal blocker.

## Exact source fingerprints

| Surface | SHA256 |
| --- | --- |
| `src/orchestrator/tracked-repair-resident-runtime.ts` | `2d7aa397bb2a8141155e653681b5965398e69568353a74a4dd34670814516d2b` |
| `scripts/jarvis-tracked-repair-actions.mjs` | `4ea0dcdd02bb6e30c1f69466ec5ca5f9b3dde50fda4814cf26a885e24747c1cc` |
| `scripts/goriq-ai09-ci-review.mjs` | `c24c3cbfccee8cf8a6755c550b44fcd8968ae0b5ef63889d2cac0bfa44b4f82b` |

Existing tracked source rows in `docs/jarvis-reverse-traceability.json` were
updated without changing their requirement assignments. The audit passed with
622 surfaces and 341 requirements and explicitly made no functional completion
claim. The AI09 script is outside that audit's existing root selection; its
fingerprint is recorded here without widening the audit contract.

## Remaining production conditions and rollback

1. Read/authenticate the existing Goal and Job from their live canonical store,
   including current approval scope, failed attempts and unfinished work.
2. Connect a real independent check runner and an already authorized signer
   transport whose private key the Builder cannot access. The existing runner
   accepts an injected signer transport; a deployed transport was not verified
   here. Owner-pinned public identity, complete checks and candidate binding
   remain required. Restricted connector reads cannot establish absence of keys.
   Follow-up source inspection also identified two remaining connection defects:
   the transfer helper currently accepts only version-1 new-file requests while
   tracked repair emits version 2, and the runner stops after its first non-PASS
   instead of collecting a complete definitive FAIL. The next bounded source
   correction must preserve full request binding and all required checks.
3. Connect the canonical state path to an actual shared authority store. Existing
   durable runtime interfaces expose lease, epoch, fencing and CAS, but reviewed
   Memory/JSON implementations and local SQLite/writer locks do not prove
   distributed execution authority. Full candidate/failed-attempt preservation,
   stale-owner rejection and rollback rejection must be demonstrated across runs.
4. Execute the original unfinished Goal through real failed candidate, authorized
   alternate repair, independent verification, next Job and artifact delivery.
   None of source CI, advisory AI09, a model download or this isolated failure
   establishes that complete acceptance sequence.

No new production trust root, credential scope, persistent service, workflow
permission, distributed authority or deployment was activated. Any required
approval must name the concrete existing signer/store/host and applicable scope;
ordinary source work does not authorize those changes.

Rollback consists of reverting this continuation's source/document changes on
the existing PR. Preserve all failure records, model responses, original
Goal/Job history and receipts. There is no schema migration or production data
restoration in this change. Issue #1219 and the final Goal remain open/not achieved.

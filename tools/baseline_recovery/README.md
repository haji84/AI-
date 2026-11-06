# Data-only baseline recovery proposal

Issue #1869, child of #1865. Python 3.10+ standard library only. This utility prepares reviewable source snapshots and detects changed or incomplete recovery data; it does not adopt a new authoritative baseline. The original v0.5 ZIP/plan has not been recovered. Its recorded SHA, 47 files, 0/8 pilot and 0/104 full review remain UNVERIFIED.

```python
from tools.baseline_recovery.baseline_bundle import build_bundle, sha256, verify_bundle

bundle = build_bundle(
    repository="owner/project", revision="a" * 40,
    candidate_id="recovery-proposal-example-01",
    sources={"src/example.txt": b"explicit approved public bytes\r\n"},
)
expected = {key: sha256(getattr(bundle, key)) for key in ("archive", "manifest", "plan")}
# Preserve these expected digests independently from the three artifacts.
# Recovery must use those preexisting trusted pins, not rehash arbitrary input
# and treat the resulting digests as an independent expectation.
result = verify_bundle(bundle, expected)
```

Inputs are explicit approved PUBLIC UTF-8 bytes. Repository/revision fields are caller assertions; independently compare source bytes to exact GitHub commit/blob provenance. A hash match establishes integrity relative to the supplied pins, not a signature, authentic repository commit, owner permission or model execution. This module does not read directories, extract/import/execute source, make network requests, encrypt, manage keys, publish, write GitHub or activate policy. Do not put confidential source or plaintext findings in public logs or artifacts. Private storage and encryption routes require their existing review and approval.

The deterministic ZIP stores regular files without compression. Manifest file hashes and ordered plan ranges bind exact original bytes, preserving CRLF and UTF-8 codepoint boundaries. Empty files remain indexed without an invented model call. Counts derive from actual bytes; they are never forced to 8/104. All three artifacts have independent digest pins. Recovery recomputes the entire canonical bundle, checking omitted/duplicate/reordered/changed ranges, unexpected metadata/entries, path ambiguity and authority flags. Non-stored compression is rejected before a decompressor is constructed. Limits: 512 files, 512KiB/file, 8MiB total source, 10MiB ZIP, 2MiB per JSON artifact, 2300-byte chunks.

The schemas `source-baseline-proposal/1` and `source-review-plan-proposal/1` are NEW PROPOSALS. They are not the authentic `frozen-review-plan.json`, and cannot be passed to independent AI09's unverified production adapter as a replacement. Every output remains `CANDIDATE_ONLY`, `designApproval=HOLD`, `mergeAuthorized=false`, `publisherEnabled=false`, `goalAchieved=false`. Formal successor adoption must explicitly approve the source scope, new identity/digests/plan and changes to legacy completion criteria. Actual model pilot/full review, reproduction, formal approval, protected integration and runtime verification remain separate gates.

Run acceptance tests with `python -m unittest discover -s tools/baseline_recovery -v`, or `node --test tests/baseline-recovery-proposal.test.mjs`. Ordinary Node CI invokes the same Python suite; a missing interpreter fails the test rather than silently skipping it. Python stores local bytecode caches; never include those generated files in a candidate.

Local preparation evidence (not a hosted or private-source acceptance): 10 tests, RED→GREEN, fresh-context advisory review; a forged 777-byte LZMA ZIP expanded 4MiB before the fix, then was rejected with zero decompressor calls/expanded bytes. Exact public inputs from AI- `93ba682181f33f742c69293e0472173458e56e9f` (11 files/33 chunks) and independent-ai09-reviewer `63ed3d35b111a377058775d91c27689683393398` (2 files/9 chunks) recovered in fresh Python processes after Git blob checks. This is source transport, not two-project framework installation or OS restart proof. Unchanged extracted common core (6 modules/3 test files) passed 58 tests without application dependencies; full framework packaging remains incomplete.

Rollback: revert this standalone tool/test/document change. No active specification, authority, runtime state or legacy evidence is mutated. No workflow/provider/secret/protection/Publisher or merge change is included.

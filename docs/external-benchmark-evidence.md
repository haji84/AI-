# External benchmark evidence contract

R3, R12, and R19 do not accept manually typed scores as verified evidence.

A normalized external run must include:

- benchmark identity
- official or explicitly compatible harness flag
- public harness repository URL and exact revision
- model/runtime identity
- positive task count
- score + score name
- SHA-256 of the raw result artifact
- completion timestamp
- additional pay-as-you-go API cost, which must be 0 for the default project policy

R12 additionally requires `interactive=true`. R19 additionally requires `independentEnvironment=true`.

The importer only validates and normalizes evidence. It does not invent a score, infer one from a paper, or convert a dry-run into a real benchmark result.

Current official ecosystems used by the project include ARC-AGI-3, SWE-bench, and OSWorld where compatible zero-additional-cost execution is available. ARC provider-backed runs that would incur separate API charges are excluded from the default zero-cost path.

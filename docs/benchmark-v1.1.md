# GAI Internal Benchmark Suite v1.1

R6 hardens the internal pipeline benchmark without pretending it is an external AGI benchmark.

## What changed from v1

- 120 frozen cases across 10 task families instead of six narrow repetitive families.
- 20 heldout cases with an explicit firewall against learning, memory promotion, curriculum generation, and tuning.
- SHA-256 prompt fingerprints and duplicate-prompt rejection.
- Typed verification for exact, numeric, containment, JSON, and unordered-set outputs.
- Category-level metrics in the report.
- Real mode still requires a self-hosted runner, an actually reachable local model endpoint, and an installed model.
- Pay-as-you-go API cost remains hard-coded at zero for this runner.

## Scientific boundary

This suite is internal and partially synthetic. A high score is useful for regression, transfer, routing, and self-improvement experiments, but is not evidence by itself that the system is AGI. R3/R12/R19/R20 require real external/independent evidence.

## Commands

- `pnpm research:r6:dry-run` validates the suite and typed verifier without claiming a real model result.
- `pnpm research:r6:baseline` performs/resumes a real local-model run when invoked inside the configured self-hosted runner environment.

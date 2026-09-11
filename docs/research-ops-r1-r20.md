# Research Ops R1-R20

This program turns the GAI architecture into an evidence-driven research ladder. A stage is complete only when its required verified evidence exists and all dependencies are complete. Harness code alone is not evidence.

## Non-negotiable rules

- Never fabricate internal or external benchmark scores.
- Heldout outcomes never enter training, prompt tuning, memory promotion, or curriculum generation.
- Pay-as-you-go AI APIs remain disabled by default; additional API cost target is 0.
- LOW actions may run automatically; MEDIUM actions require sandbox + verification; HIGH requires explicit human approval; CRITICAL is not autonomously executed.
- External benchmark claims require real compatible/official harness execution with provenance.
- AGI is never declared automatically. R20 still requires independent external scientific validation before an AGI claim can be allowed.

## Stages

| Stage | Focus | Primary exit evidence |
| --- | --- | --- |
| R1 | Real internal baseline | >=100 real cases, heldout, failure taxonomy, zero-cost/safety evidence |
| R2 | Iterative self-improvement | heldout-positive accepted changes, research-loop provenance |
| R3 | External benchmarks | real ARC/SWE-bench/OSWorld/memory benchmark provenance |
| R4 | Long-horizon endurance | >=20-step tasks, resume/recovery/intervention accounting |
| R5 | Independent AGI-gap review | evidence-based gap report and next experiments |
| R6 | Benchmark v1.1 hardening | diverse suite, contamination guard, normalized verification |
| R7 | Statistical evaluation | uncertainty, paired comparisons, repeat variance |
| R8 | Memory and transfer | positive/negative transfer, memory promotion evidence |
| R9 | World-model calibration | prediction error and confidence calibration |
| R10 | Planner/router optimization | quality/cost frontier with safe fallback |
| R11 | Long-horizon recovery v2 | injected failures, checkpoints, bounded pivots |
| R12 | Interactive generalization | real stateful environment benchmark evidence |
| R13 | Distributed cross-device workers | worker provenance and result equivalence |
| R14 | Continual learning | forward/backward transfer and forgetting metrics |
| R15 | Adversarial curriculum | failure-driven harder tasks without heldout leakage |
| R16 | Autonomous research scientist | bounded hypothesis -> experiment -> accept/reject loop |
| R17 | Governed self-modification | sandbox mutation, heldout gain, rollback, Human Gate |
| R18 | Local model adaptation | LoRA/QLoRA/distillation only when benchmark-justified |
| R19 | Independent replication | frozen manifests, environment capture, replication delta |
| R20 | AGI evidence dossier | all gates evaluated, contradictions included, independent validation explicit |

The executable source of truth is `src/gai/research-ops-program.ts`.

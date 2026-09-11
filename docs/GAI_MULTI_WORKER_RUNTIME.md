# GAI Multi-Worker Runtime

The empirical research runtime treats the Windows ZBook and macOS MacBook as separate workers attached to the same GAI version and benchmark definitions.

## Worker roles

- ZBook: Windows tooling, GPU/local-model work, long-running jobs.
- MacBook: macOS tooling, independent reproduction, long-running jobs, optional local-model work.
- ChatGPT Work / Codex: plan-included frontier reasoning boundary when available; never silently replaced by pay-as-you-go API calls.
- GitHub: source of truth for code, benchmark manifests, CI, and reproducible experiment metadata.

## Scientific separation

A formal intelligence baseline uses a fixed benchmark configuration and records the worker/runtime used. A cross-device reproduction subset then runs the same tasks on both ZBook and MacBook. Device effects are reported separately from intelligence effects.

Do not interpret faster hardware as higher intelligence. Do not combine OS/tooling failures with reasoning failures without tagging the cause.

## Preflight

Run on each workstation:

`pnpm research:worker:preflight`

For a real baseline worker, configure a zero-additional-cost local model endpoint and require readiness:

Windows PowerShell:

`$env:GAI_WORKER_ID="zbook"`
`$env:GAI_LOCAL_MODEL_ENDPOINT="http://127.0.0.1:11434"`
`pnpm research:worker:require-real`

macOS shell:

`export GAI_WORKER_ID=macbook`
`export GAI_LOCAL_MODEL_ENDPOINT=http://127.0.0.1:11434`
`pnpm research:worker:require-real`

The preflight intentionally exits non-zero when `--require-real` is used without a configured local-model endpoint. This prevents CI or an unconfigured machine from being mislabeled as a real GAI benchmark run.

## Scheduling

Tasks can require capabilities such as `gpu`, `windows-tooling`, or `macos-tooling`, and can prefer a platform. The scheduler selects only enabled, healthy workers satisfying required capabilities. Platform preference and long-running/GPU capability affect selection score.

## Cross-device evaluation

For a reproduction subset, record per-task worker, platform, pass/fail, duration, and optional output fingerprint. The cross-device evaluator reports outcome agreement separately from speed, including divergent tasks that require investigation.

## Research integrity

Real Benchmark Run #1 still requires actual execution of the frozen >=100-task suite. CI validates this runtime but is not itself evidence that the 100 tasks were executed by a model. External benchmark scores remain disabled until their real compatible runtimes are run.

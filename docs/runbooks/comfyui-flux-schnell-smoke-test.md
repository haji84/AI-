# ComfyUI FLUX.1 schnell one-image smoke test

## Purpose

Run one explicit local image-generation request through the repository's existing ComfyUI backend and FLUX.1 [schnell] workflow builder. This is a manual local smoke test, not a CI requirement.

## Prerequisites

- ComfyUI is already installed and running locally.
- A compatible FLUX.1 [schnell] checkpoint is already installed in ComfyUI's checkpoint search path.
- Node and pnpm versions match `package.json`.
- No paid API, credentials, cloud GPU, or automatic model download is required by this repository.

## Required environment variables

- `COMFYUI_BASE_URL`, for example `http://127.0.0.1:8188`
- `FLUX_SCHNELL_CHECKPOINT`, exactly matching the checkpoint filename visible to ComfyUI

## Optional environment variables

- `FLUX_SCHNELL_PROMPT`
- `FLUX_SCHNELL_WIDTH` (default `1024`)
- `FLUX_SCHNELL_HEIGHT` (default `1024`)
- `FLUX_SCHNELL_SEED` (default `0`)
- `FLUX_SCHNELL_OUTPUT` (default `./tmp/flux-schnell-smoke.png`)
- `COMFYUI_MAX_HISTORY_POLLS` (default `120`)
- `COMFYUI_POLL_DELAY_MS` (default `500`)

## Run

PowerShell example:

```powershell
$env:COMFYUI_BASE_URL="http://127.0.0.1:8188"
$env:FLUX_SCHNELL_CHECKPOINT="flux1-schnell-fp8.safetensors"
$env:FLUX_SCHNELL_PROMPT="A cinematic tropical island at sunrise"
node --experimental-strip-types scripts/comfyui-flux-schnell-smoke.ts
```

The command intentionally generates exactly one image. It does not install or start ComfyUI and does not download a checkpoint.

## Success

The command exits with status 0, prints `ComfyUI FLUX schnell smoke test succeeded`, and writes non-empty image bytes to `FLUX_SCHNELL_OUTPUT`.

## Failure

The command exits non-zero and prints the underlying configuration or ComfyUI backend error. Common causes include ComfyUI not running, an incorrect checkpoint filename, an incompatible local workflow node set, or generation taking longer than the configured polling window.

## CI behavior

Repository CI runs deterministic unit tests only. It must not require a live ComfyUI server, GPU, checkpoint, or network access to a local runtime.

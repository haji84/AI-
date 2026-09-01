# Qwen-Image-Edit local smoke test

This runbook executes the final Phase 3 real-machine image-editing check against a local ComfyUI instance.

## Preconditions
- ComfyUI is running locally, normally at `http://127.0.0.1:8188`.
- The Qwen-Image-Edit model assets selected in ADR 0011 are installed in ComfyUI.
- A working Qwen-Image-Edit workflow has been exported from ComfyUI in API format.
- A local PNG, JPEG, or WebP source image is available.
- The API workflow node ID that owns the source image filename and the node ID that owns the edit instruction are known.

## PowerShell
Run from the repository root:

```powershell
$env:COMFYUI_BASE_URL="http://127.0.0.1:8188"
$env:QWEN_IMAGE_EDIT_WORKFLOW_PATH="C:\path\to\qwen-image-edit-api.json"
$env:QWEN_IMAGE_EDIT_SOURCE="C:\path\to\source.png"
$env:QWEN_IMAGE_EDIT_IMAGE_NODE_ID="<LoadImage node id>"
$env:QWEN_IMAGE_EDIT_INSTRUCTION_NODE_ID="<instruction node id>"
$env:QWEN_IMAGE_EDIT_INSTRUCTION="Make the sky warmer while preserving the rest of the image."
$env:QWEN_IMAGE_EDIT_OUTPUT=".\tmp\qwen-image-edit-smoke.png"
node --experimental-strip-types scripts/comfyui-qwen-image-edit-smoke.ts
```

Optional overrides:
- `QWEN_IMAGE_EDIT_IMAGE_INPUT`, default `image`
- `QWEN_IMAGE_EDIT_INSTRUCTION_INPUT`, default `text`
- `QWEN_IMAGE_EDIT_MAX_HISTORY_POLLS`, default `240`
- `QWEN_IMAGE_EDIT_POLL_DELAY_MS`, default `1000`

The runner accepts either a direct ComfyUI API workflow object or a JSON object whose `prompt` property contains the API workflow.

## PASS evidence
A PASS requires all of the following:
- the command exits successfully
- console output starts with `ComfyUI Qwen-Image-Edit smoke test succeeded:`
- the reported media type is PNG, JPEG, or WebP
- reported output size is greater than zero bytes
- the output file opens as a valid edited image
- the edit instruction is visibly reflected in the output sufficiently to demonstrate that an editing path, not a generation-only path, executed

Record the exact success line, source/output media types, output byte count, relevant local runtime/model details, and any required low-VRAM/offload flags on Issue #78. Do not commit the source image, output image, workflow containing local-only details, or model binaries.

## Failure handling
If the command fails, record the complete error message on Issue #78. Repository defects may be fixed up to the configured auto-fix limit. Hardware/model-memory failures are runtime evidence and must not be mislabeled as repository CI failures.

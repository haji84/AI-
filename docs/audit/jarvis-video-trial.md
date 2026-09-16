# Physical H264 trial — #732

Owner verdict after #729: still about3seconds behind; screenshot usability NOT accepted.

Actual host/device: Windows ZBook -> USB -> nubia S5G A403ZT Android15. Pinned official scrcpy3.3.3 hash verified before copying to device shell temporary storage. First probe received no packets due to the forward socket closing during server startup; retry-on-close fixed the startup race. Second5second probe:23packets,106334bytes, first packet956ms. No image/audio data committed.

Authenticated JARVIS route physical check2026-09-16T03:29:31Z:

- unauthorized video request401
- mismatched device/session409
- first video bytes41 (codec configuration),731ms after request
- ending the session stopped the stream in62ms in this sample

These do not prove decoded iPhone frames or glass-to-glass latency. Owner browser/video/control feedback remains pending. Native touch conversion reuses existing tested coordinate/gesture rules; rotation refuses control when dimensions no longer correspond.

Initial full local suite765/765 passed; subsequent runtime-integrity test also passed. TypeScript/lint/build passed for staged initial video revision. Final audit-end logging/UI-copy changes require exact-head CI/build. No physical PASS promotion; all relevant requirements remainPARTIAL.

Local runtime session76786 expires2026-09-16T03:39:35Z under the original approval; no silent extension. Binary/code stays out of credential logs. Source/configuration and packet-parser tests are repository evidence; actual screen content remains local.

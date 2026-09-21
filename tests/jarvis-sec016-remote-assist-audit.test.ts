import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { JarvisRemoteAssistFrameRecorder } from "../src/jarvis/remote-assist-recording.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitForAuditFailure(store: JarvisRemoteAssistFrameRecorder, id: string, sessionId: string, serial: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = store.status(id, sessionId, serial);
    if (current.status === "failed" && current.stopReason === "audit-error") return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("recording did not surface final audit persistence failure");
}

test("SEC-016 recording start fails closed before any capture when audit admission fails", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sec016-start-audit-"));
  let captures = 0;
  try {
    const store = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      beforeStart: () => {
        throw new Error("audit persistence unavailable");
      },
      captureFrame: async () => {
        captures += 1;
        return {
          mimeType: "image/png",
          imageBase64: Buffer.from("frame").toString("base64"),
          capturedAt: new Date().toISOString(),
        };
      },
      defaultDurationMs: 20,
      minDurationMs: 5,
      maxDurationMs: 50,
      defaultIntervalMs: 5,
      minIntervalMs: 5,
      maxIntervalMs: 10,
    });

    assert.throws(
      () => store.start({ sessionId: "sec016-session", serial: "android-sec016" }),
      /audit persistence unavailable/,
    );
    assert.equal(captures, 0);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SEC-016 final audit persistence failure cannot leave a recording reported as successful", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sec016-finish-audit-"));
  try {
    const store = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async () => ({
        mimeType: "image/png",
        imageBase64: Buffer.from("frame").toString("base64"),
        capturedAt: new Date().toISOString(),
      }),
      onFinished: () => {
        throw new Error("audit persistence unavailable");
      },
      defaultDurationMs: 20,
      minDurationMs: 5,
      maxDurationMs: 50,
      defaultIntervalMs: 5,
      minIntervalMs: 5,
      maxIntervalMs: 10,
      maxFrames: 4,
      maxFrameBytes: 1024,
      maxRecordingBytes: 4096,
      maxRecordings: 3,
    });

    const started = store.start({ sessionId: "sec016-finish", serial: "android-sec016-finish" });
    const final = await waitForAuditFailure(store, started.id, started.sessionId, started.serial);
    assert.equal(final.status, "failed");
    assert.equal(final.stopReason, "audit-error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SEC-016 Remote Assist audit and recording API paths remain owner-authenticated and binding-first", () => {
  const source = readFileSync(join(repoRoot, "src/app/api/jarvis/remote/route.ts"), "utf8");

  const ownerGuard = source.indexOf("if (!(await requireJarvisOwner()))");
  const parsePayload = source.indexOf("const payload = await request.json()");
  assert(ownerGuard >= 0 && parsePayload > ownerGuard, "owner authentication must occur before payload dispatch");

  assert.match(source, /payload\.action === "session-audit"[\s\S]*auditStore\.list\(payload\.sessionId\)/);
  assert.match(source, /function requireRecordingBinding[\s\S]*remoteAssist\.requireActive\(payload\.sessionId, payload\.serial\)/);

  const recordingStart = source.indexOf('if (payload.action === "recording-start")');
  const startBinding = source.indexOf("const session = requireRecordingBinding(payload);", recordingStart);
  const startRecorder = source.indexOf("const recording = recorder.start", recordingStart);
  assert(recordingStart >= 0 && startBinding > recordingStart && startRecorder > startBinding,
    "recording-start must validate the active session/device binding before starting capture");

  const recordingStatus = source.indexOf('if (payload.action === "recording-status" || payload.action === "recording-stop")');
  const statusBinding = source.indexOf("requireRecordingBinding(payload);", recordingStatus);
  const statusRecorder = source.indexOf("? await recorder.stop", recordingStatus);
  assert(recordingStatus >= 0 && statusBinding > recordingStatus && statusRecorder > statusBinding,
    "recording status/stop must validate the active session/device binding before recorder access");
});

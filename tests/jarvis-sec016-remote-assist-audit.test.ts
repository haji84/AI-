import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JarvisRemoteAssistFrameRecorder } from "../src/jarvis/remote-assist-recording.ts";

// SEC-016 regression coverage is intentionally runtime-neutral: this suite proves existing fail-closed boundaries.
test("SEC-016 fails closed before capture or storage when recording audit admission fails", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sec016-audit-"));
  let captures = 0;
  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async () => {
        captures += 1;
        return {
          mimeType: "image/png",
          imageBase64: Buffer.from("frame").toString("base64"),
          capturedAt: new Date().toISOString(),
        };
      },
      beforeStart: () => {
        throw new Error("audit persistence failed");
      },
      defaultDurationMs: 40,
      minDurationMs: 20,
      maxDurationMs: 100,
      defaultIntervalMs: 10,
      minIntervalMs: 5,
      maxIntervalMs: 20,
    });

    assert.throws(
      () => recorder.start({ sessionId: "sec016-session", serial: "android-sec016" }),
      /audit persistence failed/,
    );
    assert.equal(captures, 0);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SEC-016 revalidates session authorization after capture and before frame persistence", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-sec016-revalidate-"));
  let validations = 0;
  let captures = 0;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async () => {
        captures += 1;
        return {
          mimeType: "image/png",
          imageBase64: Buffer.from("frame").toString("base64"),
          capturedAt: new Date().toISOString(),
        };
      },
      validateCapture: () => {
        validations += 1;
        if (validations >= 3) throw new Error("session revoked");
      },
      onFinished: () => resolveFinished(),
      defaultDurationMs: 40,
      minDurationMs: 20,
      maxDurationMs: 100,
      defaultIntervalMs: 10,
      minIntervalMs: 5,
      maxIntervalMs: 20,
    });

    const started = recorder.start({ sessionId: "sec016-revalidate", serial: "android-sec016" });
    await finished;
    const final = recorder.status(started.id, "sec016-revalidate", "android-sec016");

    assert.equal(captures, 1);
    assert.equal(validations, 3);
    assert.equal(final.status, "failed");
    assert.equal(final.stopReason, "capture-error");
    assert.equal(final.frameCount, 0);
    assert.equal(existsSync(join(root, started.id, "frame-0001.png")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SEC-016 recording API remains owner-authenticated and session/device bound", () => {
  const source = readFileSync("src/app/api/jarvis/remote/route.ts", "utf8");

  assert.match(
    source,
    /export async function POST\(request: Request\) \{\s*if \(!\(await requireJarvisOwner\(\)\)\)/,
  );
  assert.match(
    source,
    /function requireRecordingBinding[\s\S]*if \(!payload\.serial \|\| !payload\.sessionId\)[\s\S]*remoteAssist\.requireActive\(payload\.sessionId, payload\.serial\)[\s\S]*remoteAssist\.touch\(payload\.sessionId, payload\.serial\)/,
  );

  const recordingStart = source.indexOf('if (payload.action === "recording-start")');
  const recordingStatus = source.indexOf('if (payload.action === "recording-status" || payload.action === "recording-stop")');
  assert(recordingStart >= 0, "recording-start route must exist");
  assert(recordingStatus > recordingStart, "recording status/stop route must follow start");
  assert.match(source.slice(recordingStart, recordingStatus), /requireRecordingBinding\(payload\)/);
  assert.match(source.slice(recordingStatus, recordingStatus + 1_200), /requireRecordingBinding\(payload\)/);
});

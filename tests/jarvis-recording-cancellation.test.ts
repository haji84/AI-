import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisRemoteAssistFrameRecorder } from "../src/jarvis/remote-assist-recording.ts";

const frame = { mimeType: "image/png", imageBase64: Buffer.from("test-frame").toString("base64"), capturedAt: new Date().toISOString() };

test("failed recording admission performs zero captures", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-admission-"));
  let captures = 0;
  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      beforeStart: () => { throw new Error("audit unavailable"); },
      captureFrame: async () => { captures++; return frame; },
    });
    assert.throws(() => recorder.start({ sessionId: "s", serial: "d" }), /audit unavailable/);
    assert.equal(captures, 0);
    assert.equal(readdirSync(root).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("owner stop aborts stalled capture and discards its late frame", { timeout: 2_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-stop-"));
  let finish!: (value: typeof frame) => void;
  let signal: AbortSignal | undefined;
  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async (_serial, context) => {
        signal = context.signal;
        return new Promise(resolve => { finish = resolve; });
      },
    });
    const started = recorder.start({ sessionId: "s", serial: "d" });
    await Promise.resolve();
    const stopped = await recorder.stop(started.id, "s", "d");
    assert.equal(signal?.aborted, true);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.frameCount, 0);
    finish(frame);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readdirSync(join(root, started.id)).filter(name => name.endsWith(".png")).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture deadline terminates even when the adapter ignores cancellation", { timeout: 2_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-deadline-"));
  let done!: () => void;
  const finished = new Promise<void>(resolve => { done = resolve; });
  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root, minDurationMs: 10, defaultDurationMs: 30, maxDurationMs: 100,
      captureFrame: () => new Promise(() => {}), onFinished: done,
    });
    const started = recorder.start({ sessionId: "s", serial: "d" });
    await finished;
    const final = recorder.status(started.id, "s", "d");
    assert.equal(final.status, "failed");
    assert.equal(final.stopReason, "capture-timeout");
    assert.equal(final.frameCount, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("revoked capture authorization prevents persisting an in-flight frame", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-revoke-"));
  let allowed = true;
  let done!: () => void;
  const finished = new Promise<void>(resolve => { done = resolve; });
  try {
    const recorder = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      validateCapture: () => { if (!allowed) throw new Error("session ended"); },
      captureFrame: async () => { allowed = false; return frame; },
      onFinished: done,
    });
    const started = recorder.start({ sessionId: "s", serial: "d" });
    await finished;
    assert.equal(recorder.status(started.id, "s", "d").status, "failed");
    assert.equal(recorder.status(started.id, "s", "d").frameCount, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("final audit and storage failures are visible without an unhandled job rejection", async () => {
  for (const failure of ["audit", "storage"] as const) {
    const root = mkdtempSync(join(tmpdir(), "jarvis-finalize-"));
    let done!: () => void;
    const finished = new Promise<void>(resolve => { done = resolve; });
    try {
      const recorder = new JarvisRemoteAssistFrameRecorder({
        rootDir: root, maxFrames: 1,
        captureFrame: async () => {
          if (failure === "storage") rmSync(root, { recursive: true, force: true });
          return frame;
        },
        onFinished: () => { done(); if (failure === "audit") throw new Error("audit disk failure"); },
      });
      const started = recorder.start({ sessionId: "s", serial: "d" });
      await finished;
      const final = recorder.status(started.id, "s", "d");
      assert.equal(final.status, "failed");
      assert.equal(final.stopReason, failure === "audit" ? "audit-error" : "storage-error");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { JarvisRemoteAssistFrameRecorder, type RemoteAssistRecording } from "../src/jarvis/remote-assist-recording.ts";

function recorder(rootDir: string) {
  let count = 0;
  return new JarvisRemoteAssistFrameRecorder({
    rootDir,
    captureFrame: async () => ({
      mimeType: "image/png",
      imageBase64: Buffer.from(`frame-${++count}`).toString("base64"),
      capturedAt: new Date().toISOString(),
    }),
    defaultDurationMs: 50,
    minDurationMs: 20,
    maxDurationMs: 100,
    defaultIntervalMs: 10,
    minIntervalMs: 5,
    maxIntervalMs: 20,
    maxFrames: 10,
    maxFrameBytes: 1024,
    maxRecordingBytes: 4096,
    maxRecordings: 3,
  });
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`expected file to be created: ${path}`);
}

test("Remote Assist frame recording is session/serial bound and stops explicitly", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-recording-"));
  try {
    let count = 0;
    const store = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async () => ({
        mimeType: "image/png",
        imageBase64: Buffer.from(`frame-${++count}`).toString("base64"),
        capturedAt: new Date().toISOString(),
      }),
      defaultDurationMs: 60_000,
      minDurationMs: 20,
      maxDurationMs: 60_000,
      defaultIntervalMs: 10_000,
      minIntervalMs: 5,
      maxIntervalMs: 10_000,
      maxFrames: 10,
      maxFrameBytes: 1024,
      maxRecordingBytes: 4096,
      maxRecordings: 3,
    });
    const started = store.start({ sessionId: "session-1", serial: "android-001", durationMs: 60_000, intervalMs: 10_000 });
    assert.equal(started.status, "recording");
    assert.equal(started.maxFrames, 6);
    assert.throws(() => store.status(started.id, "session-1", "android-002"), /another session or device/);

    const firstFramePath = join(root, started.id, "frame-0001.png");
    await waitForFile(firstFramePath);
    const stopped = await store.stop(started.id, "session-1", "android-001");
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.stopReason, "owner-stop");
    assert(stopped.frameCount >= 1);
    assert(stopped.frameCount <= stopped.maxFrames);
    assert(existsSync(join(root, started.id, "manifest.json")));
    assert(existsSync(firstFramePath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Remote Assist frame recording enforces storage bounds", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-recording-"));
  try {
    const store = new JarvisRemoteAssistFrameRecorder({
      rootDir: root,
      captureFrame: async () => ({
        mimeType: "image/png",
        imageBase64: Buffer.alloc(32, 1).toString("base64"),
        capturedAt: new Date().toISOString(),
      }),
      defaultDurationMs: 20,
      minDurationMs: 10,
      maxDurationMs: 50,
      defaultIntervalMs: 5,
      minIntervalMs: 5,
      maxIntervalMs: 10,
      maxFrames: 5,
      maxFrameBytes: 64,
      maxRecordingBytes: 16,
      maxRecordings: 3,
    });
    const started = store.start({ sessionId: "session-2", serial: "android-002" });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const final = store.status(started.id, "session-2", "android-002");
    assert.equal(final.status, "stopped");
    assert.equal(final.stopReason, "storage-limit");
    assert.equal(final.frameCount, 0);
    assert.equal(final.totalBytes, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interrupted recordings are marked failed after process restart", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-recording-"));
  try {
    const id = randomUUID();
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    const interrupted: RemoteAssistRecording = {
      id,
      sessionId: "session-3",
      serial: "android-003",
      status: "recording",
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
      expiresAt: "2026-09-16T00:01:00.000Z",
      intervalMs: 2_000,
      maxFrames: 30,
      frameCount: 2,
      totalBytes: 200,
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(interrupted));

    const restarted = recorder(root);
    const recovered = restarted.status(id, "session-3", "android-003");
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.stopReason, "process-restart");
    const persisted = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as RemoteAssistRecording;
    assert.equal(persisted.status, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

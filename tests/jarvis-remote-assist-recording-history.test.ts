import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { JarvisRemoteAssistRecordingHistory } from "../src/jarvis/remote-assist-recording-history.ts";
import type { RemoteAssistRecording } from "../src/jarvis/remote-assist-recording.ts";

function persist(root: string, overrides: Partial<RemoteAssistRecording> = {}) {
  const id = overrides.id ?? randomUUID();
  const createdAt = overrides.createdAt ?? "2026-09-16T00:00:00.000Z";
  const recording: RemoteAssistRecording = {
    id,
    sessionId: overrides.sessionId ?? "session-history",
    serial: overrides.serial ?? "android-history",
    status: overrides.status ?? "completed",
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    expiresAt: overrides.expiresAt ?? "2026-09-16T00:01:00.000Z",
    intervalMs: overrides.intervalMs ?? 2_000,
    maxFrames: overrides.maxFrames ?? 2,
    frameCount: overrides.frameCount ?? 2,
    totalBytes: overrides.totalBytes ?? 14,
    ...(overrides.stopReason ? { stopReason: overrides.stopReason } : {}),
  };
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(recording, null, 2)}\n`);
  for (let frame = 1; frame <= recording.frameCount; frame += 1) {
    writeFileSync(join(dir, `frame-${String(frame).padStart(4, "0")}.png`), Buffer.from(`frame-${frame}`));
  }
  return recording;
}

test("durable history survives a fresh reader and exposes completed/partial metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const completed = persist(root, { updatedAt: "2026-09-16T00:01:00.000Z" });
    const failed = persist(root, {
      status: "failed",
      stopReason: "process-restart",
      frameCount: 1,
      totalBytes: 7,
      updatedAt: "2026-09-16T00:02:00.000Z",
    });

    const restartedReader = new JarvisRemoteAssistRecordingHistory(root);
    const recent = restartedReader.listRecent(10);
    assert.deepEqual(recent.map((item) => item.id), [failed.id, completed.id]);
    assert.equal(recent[0].partial, true);
    assert.equal(recent[0].replayable, true);
    assert.equal(recent[1].partial, false);
    assert.equal(recent[1].replayable, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history reads bounded frames and exports an authenticated-API-ready bundle without filesystem paths", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const recording = persist(root);
    const history = new JarvisRemoteAssistRecordingHistory(root);
    const frame = history.readFrame(recording.id, 1);
    assert.equal(Buffer.from(frame.imageBase64, "base64").toString("utf8"), "frame-1");
    assert.equal(frame.mimeType, "image/png");

    const bundle = history.exportBundle(recording.id);
    assert.equal(bundle.version, 1);
    assert.equal(bundle.frames.length, 2);
    const serialized = JSON.stringify(bundle);
    assert(!serialized.includes(resolve(root)));
    assert(!serialized.includes("manifest.json"));
    assert(!serialized.includes("frame-0001.png"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history rejects traversal, invalid frame numbers, active exports and corrupt manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const active = persist(root, { status: "recording" });
    const corruptId = randomUUID();
    mkdirSync(join(root, corruptId), { recursive: true });
    writeFileSync(join(root, corruptId, "manifest.json"), "{broken-json");

    const history = new JarvisRemoteAssistRecordingHistory(root);
    assert.throws(() => history.get("../../etc/passwd"), /invalid recordingId/);
    assert.throws(() => history.readFrame(active.id, 0), /not ready|invalid/);
    assert.throws(() => history.exportBundle(active.id), /not ready/);
    assert.equal(history.listRecent(10).some((item) => item.id === corruptId), false);
    assert.throws(() => history.listRecent(0), /limit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording history route and UI stay behind owner-authenticated JARVIS paths", () => {
  const route = readFileSync(resolve(process.cwd(), "src/app/api/jarvis/recordings/route.ts"), "utf8");
  const page = readFileSync(resolve(process.cwd(), "src/app/jarvis/recordings/RecordingHistory.tsx"), "utf8");
  assert.match(route, /requireJarvisOwner/);
  assert.match(route, /Owner authentication required/);
  assert.match(route, /Content-Disposition/);
  assert.doesNotMatch(route, /public\//);
  assert.match(page, /\/api\/jarvis\/recordings/);
  assert.match(page, /FAILED \/ PARTIAL/);
  assert.match(page, /JSON書き出し/);
});

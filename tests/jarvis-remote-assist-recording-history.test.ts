import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { JarvisRemoteAssistRecordingHistory } from "../src/jarvis/remote-assist-recording-history.ts";
import type { RemoteAssistRecording } from "../src/jarvis/remote-assist-recording.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFrame(frame: number) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from(`frame-${frame}`)]);
}

function persist(root: string, overrides: Partial<RemoteAssistRecording> = {}) {
  const id = overrides.id ?? randomUUID();
  const createdAt = overrides.createdAt ?? "2026-09-16T00:00:00.000Z";
  const frameCount = overrides.frameCount ?? 2;
  const frameBuffers = Array.from({ length: frameCount }, (_unused, index) => pngFrame(index + 1));
  const recording: RemoteAssistRecording = {
    id,
    sessionId: overrides.sessionId ?? "session-history",
    serial: overrides.serial ?? "android-history",
    status: overrides.status ?? "completed",
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    expiresAt: overrides.expiresAt ?? "2026-09-16T00:01:00.000Z",
    intervalMs: overrides.intervalMs ?? 2_000,
    maxFrames: overrides.maxFrames ?? Math.max(2, frameCount),
    frameCount,
    totalBytes: overrides.totalBytes ?? frameBuffers.reduce((sum, frame) => sum + frame.length, 0),
    ...(overrides.stopReason ? { stopReason: overrides.stopReason } : {}),
  };
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(recording, null, 2)}\n`);
  frameBuffers.forEach((bytes, index) => {
    writeFileSync(join(dir, `frame-${String(index + 1).padStart(4, "0")}.png`), bytes);
  });
  return recording;
}

function rewriteManifest(root: string, recording: RemoteAssistRecording) {
  writeFileSync(join(root, recording.id, "manifest.json"), `${JSON.stringify(recording, null, 2)}\n`);
}

test("durable history survives a fresh reader and exposes completed/partial/stale metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const completed = persist(root, { updatedAt: "2026-09-16T00:01:00.000Z" });
    const failedFrameBytes = pngFrame(1).length;
    const failed = persist(root, {
      status: "failed",
      stopReason: "process-restart",
      frameCount: 1,
      totalBytes: failedFrameBytes,
      updatedAt: "2026-09-16T00:02:00.000Z",
    });
    const active = persist(root, {
      status: "recording",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
    });

    const restartedReader = new JarvisRemoteAssistRecordingHistory(root);
    const recent = restartedReader.listRecent(10);
    assert.equal(recent.find((item) => item.id === failed.id)?.partial, true);
    assert.equal(recent.find((item) => item.id === failed.id)?.replayable, true);
    assert.equal(recent.find((item) => item.id === completed.id)?.partial, false);
    assert.equal(recent.find((item) => item.id === completed.id)?.replayable, true);
    assert.equal(recent.find((item) => item.id === active.id)?.stale, true);
    assert.equal(recent.find((item) => item.id === active.id)?.replayable, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history reads bounded PNG frames and exports a bundle without filesystem paths", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const recording = persist(root);
    const history = new JarvisRemoteAssistRecordingHistory(root);
    const frame = history.readFrame(recording.id, 1);
    const decoded = Buffer.from(frame.imageBase64, "base64");
    assert(decoded.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE));
    assert.equal(decoded.subarray(PNG_SIGNATURE.length).toString("utf8"), "frame-1");
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

test("history rejects traversal, symlink escapes, invalid frame numbers, active exports and corrupt manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  const outside = mkdtempSync(join(tmpdir(), "jarvis-history-outside-"));
  try {
    const active = persist(root, { status: "recording" });
    const corruptId = randomUUID();
    mkdirSync(join(root, corruptId), { recursive: true });
    writeFileSync(join(root, corruptId, "manifest.json"), "{broken-json");

    const outsideRecording = persist(outside);
    const symlinkId = randomUUID();
    let symlinkCreated = false;
    try {
      symlinkSync(join(outside, outsideRecording.id), join(root, symlinkId), "dir");
      symlinkCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "ENOTSUP"].includes(code)) throw error;
    }

    const history = new JarvisRemoteAssistRecordingHistory(root);
    assert.throws(() => history.get("../../etc/passwd"), /invalid recordingId/);
    if (symlinkCreated) assert.throws(() => history.get(symlinkId), /not found/);
    assert.throws(() => history.readFrame(active.id, 0), /not ready|invalid/);
    assert.throws(() => history.exportBundle(active.id), /not ready/);
    assert.equal(history.listRecent(10).some((item) => item.id === corruptId || item.id === symlinkId), false);
    assert.throws(() => history.listRecent(0), /limit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("history rejects oversized and malformed manifests before trusting frame counts or timestamps", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const tooManyFrames = persist(root);
    rewriteManifest(root, { ...tooManyFrames, maxFrames: 601, frameCount: 601 });

    const badTimestamp = persist(root);
    rewriteManifest(root, { ...badTimestamp, updatedAt: "not-a-date" });

    const tooManyBytes = persist(root);
    rewriteManifest(root, { ...tooManyBytes, totalBytes: 512 * 1024 * 1024 + 1 });

    const oversizedManifestId = randomUUID();
    const oversizedDir = join(root, oversizedManifestId);
    mkdirSync(oversizedDir, { recursive: true });
    writeFileSync(join(oversizedDir, "manifest.json"), Buffer.alloc(32 * 1024 + 1, 0x20));

    const history = new JarvisRemoteAssistRecordingHistory(root);
    const recentIds = new Set(history.listRecent(50).map((item) => item.id));
    assert.equal(recentIds.has(tooManyFrames.id), false);
    assert.equal(recentIds.has(badTimestamp.id), false);
    assert.equal(recentIds.has(tooManyBytes.id), false);
    assert.equal(recentIds.has(oversizedManifestId), false);
    assert.throws(() => history.get(oversizedManifestId), /not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history rejects oversized frames, malformed PNG signatures and inconsistent aggregate exports", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    const oversized = persist(root, { frameCount: 1, maxFrames: 1, totalBytes: 64 * 1024 * 1024 });
    writeFileSync(join(root, oversized.id, "frame-0001.png"), Buffer.concat([PNG_SIGNATURE, Buffer.alloc(8 * 1024 * 1024)]));

    const malformed = persist(root, { frameCount: 1, maxFrames: 1 });
    writeFileSync(join(root, malformed.id, "frame-0001.png"), Buffer.from("definitely-not-a-png"));

    const mismatched = persist(root);
    rewriteManifest(root, { ...mismatched, totalBytes: pngFrame(1).length });

    const history = new JarvisRemoteAssistRecordingHistory(root);
    assert.throws(() => history.readFrame(oversized.id, 1), /safe size bounds/);
    assert.throws(() => history.readFrame(malformed.id, 1), /frame is invalid/);
    assert.throws(() => history.exportBundle(mismatched.id), /export exceeds safe size bounds/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history fails closed when directory inspection exceeds its bounded artifact budget", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-history-"));
  try {
    for (let index = 0; index < 257; index += 1) mkdirSync(join(root, `junk-${index}`));
    const history = new JarvisRemoteAssistRecordingHistory(root);
    assert.throws(() => history.listRecent(10), /directory exceeds safe entry limit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording history route and UI stay owner-authenticated and fail with no-store/nosniff headers", () => {
  const route = readFileSync(resolve(process.cwd(), "src/app/api/jarvis/recordings/route.ts"), "utf8");
  const page = readFileSync(resolve(process.cwd(), "src/app/jarvis/recordings/RecordingHistory.tsx"), "utf8");
  assert.match(route, /requireJarvisOwner/);
  assert.match(route, /Owner authentication required/);
  assert.match(route, /download-frame/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /image\/png/);
  assert.match(route, /Cache-Control/);
  assert.match(route, /no-store/);
  assert.match(route, /X-Content-Type-Options/);
  assert.match(route, /nosniff/);
  assert.match(route, /JarvisRemoteAssistRecordingHistoryError/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(route, /public\//);
  assert.match(page, /\/api\/jarvis\/recordings/);
  assert.match(page, /FAILED \/ PARTIAL/);
  assert.match(page, /STALE ACTIVE/);
  assert.match(page, /現在のPNGを保存/);
});

 test("five-minute recordings retain replayable 150-frame history", () => {
 const root=mkdtempSync(join(tmpdir(),"jarvis-five-minute-history-"));
 try { const saved=persist(root,{frameCount:150,maxFrames:150});const history=new JarvisRemoteAssistRecordingHistory(root);assert.equal(history.get(saved.id).frameCount,150);assert.equal(history.readFrame(saved.id,150).frameNumber,150); } finally { rmSync(root,{recursive:true,force:true}); }
 });

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordingPlaybackResponse } from "../src/jarvis/remote-assist-playback.ts";

const id = "11111111-2222-4333-8444-555555555555";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");
function fixture(root: string) {
  mkdirSync(join(root, id));
  writeFileSync(join(root, id, "manifest.json"), JSON.stringify({ id, serial: "test-device", sessionId: "PRIVATE_SESSION_SENTINEL", status: "recording", createdAt: "2026-09-16T00:00:00Z", frameCount: 1, maxFrames: 30, totalBytes: png.length }));
  writeFileSync(join(root, id, "frame-0001.png"), png);
}
function request(query = "") { return new Request(`http://localhost/api/jarvis/recordings${query}`); }

test("playback denies unauthenticated access before inspecting storage", async () => {
  const response = recordingPlaybackResponse(request(`?id=${id}&frame=1`), false, "missing-private-path");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("owner history and PNG download are bounded and do not mutate recording state", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-playback-"));
  try {
    fixture(root);
    const before = readFileSync(join(root, id, "manifest.json"), "utf8");
    const listing = await recordingPlaybackResponse(request(), true, root).json();
    assert.equal(listing.recordings[0].status, "recording");
    assert.equal(JSON.stringify(listing).includes("PRIVATE_SESSION_SENTINEL"), false);
    assert.equal(readFileSync(join(root, id, "manifest.json"), "utf8"), before);
    const response = recordingPlaybackResponse(request(`?id=${id}&frame=1&download=1`), true, root);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("content-disposition")!, /^attachment/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed ids, frame escapes, corrupt manifests and invalid PNG are rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-playback-negative-"));
  try {
    fixture(root);
    for (const query of ["?id=..%2Fsecret&frame=1", `?id=${id}&frame=../manifest`, `?id=${id}&frame=0`, `?id=${id}&frame=2`, `?id=${id}&frame=1.0`]) {
      const response = recordingPlaybackResponse(request(query), true, root);
      assert.equal(response.status, 404);
      assert.equal((await response.text()).includes(root), false);
    }
    writeFileSync(join(root, id, "frame-0001.png"), "not PNG");
    assert.equal(recordingPlaybackResponse(request(`?id=${id}&frame=1`), true, root).status, 404);
    writeFileSync(join(root, id, "manifest.json"), "{");
    const listing = await recordingPlaybackResponse(request(), true, root).json();
    assert.equal(listing.unreadable, 1);
    assert.deepEqual(listing.recordings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("recording-directory symlinks cannot expose another directory", async () => {
  const base = mkdtempSync(join(tmpdir(), "jarvis-playback-links-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(root); mkdirSync(outside); fixture(outside);
  try {
    symlinkSync(join(outside, id), join(root, id), process.platform === "win32" ? "junction" : "dir");
    assert.equal(recordingPlaybackResponse(request(`?id=${id}&frame=1`), true, root).status, 404);
    const listing = await recordingPlaybackResponse(request(), true, root).json();
    assert.equal(listing.unreadable, 1);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

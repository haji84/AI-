import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { remotePreview } from "../src/jarvis/remote-preview.ts";
import { RemoteCaptureQueue } from "../src/jarvis/remote-capture-queue.ts";

test("preview is JPEG with unchanged native coordinate dimensions", async () => {
  const png = await sharp({ create: { width: 1080, height: 2400, channels: 3, background: "#5699cc" } }).png().toBuffer();
  const result = await remotePreview(png.toString("base64"));
  assert.equal(result.mimeType, "image/jpeg");
  const metadata = await sharp(Buffer.from(result.imageBase64, "base64")).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 2400);
  assert.equal(metadata.format, "jpeg");
  await assert.rejects(remotePreview(Buffer.from("not png").toString("base64")), /Invalid/);
  await assert.rejects(remotePreview("A".repeat(12 * 1024 * 1024 + 1)), /limit/);
});

test("refresh flood is serialized and coalesced to one latest trailing capture", async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext("a");
  let release!: (value: number) => void;
  const first = new Promise<number>(resolve => { release = resolve; });
  const shown: number[] = [];
  let calls = 0;
  const work = queue.request("a", () => { calls++; return first; }, value => shown.push(value));
  for (let i = 2; i <= 20; i++) void queue.request("a", async () => { calls++; return i; }, value => shown.push(value));
  assert.equal(calls, 1);
  release(1); await work;
  assert.equal(calls, 2);
  assert.deepEqual(shown, [1, 20]);
});

test("late capture cannot restore ended or switched session screen", async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext("old");
  let release!: (value: string) => void;
  const pending = new Promise<string>(resolve => { release = resolve; });
  const shown: string[] = [];
  const work = queue.request("old", () => pending, value => shown.push(value));
  queue.setContext("new");
  assert.equal(await queue.request("old", async () => "stale", value => shown.push(value)), false);
  void queue.request("new", async () => "fresh", value => shown.push(value));
  release("stale"); await work;
  assert.deepEqual(shown, ["fresh"]);
});

test("failed capture does not prevent the next refresh", async () => {
  const queue = new RemoteCaptureQueue(); queue.setContext("a");
  assert.equal(await queue.request("a", async () => { throw Error("timeout"); }, () => assert.fail()), false);
  const shown: number[] = [];
  assert.equal(await queue.request("a", async () => 1, value => shown.push(value)), true);
  assert.deepEqual(shown, [1]);
});

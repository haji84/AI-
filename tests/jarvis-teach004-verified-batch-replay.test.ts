import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TeachingStore,
  replayTeaching,
  type DeviceProfile,
  type Observation,
  type TeachingAction,
  type TeachingAdapter,
} from "../src/jarvis/teaching.ts";
import {
  MAX_TEACHING_BATCH_ROWS,
  replayVerifiedTeachingBatch,
  validateTeachingBatchRows,
} from "../src/jarvis/teaching-batch.ts";

const device: DeviceProfile = {
  deviceId: "batch-device",
  platform: "android",
  model: "Model-A",
  osVersion: "15",
  app: "com.example.sheet",
  appVersion: "1",
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "teach004-batch-"));
  const store = new TeachingStore(join(root, "teaching.json"));
  return { root, store, clean: () => rmSync(root, { recursive: true, force: true }) };
}

function batchVariant(store: TeachingStore) {
  const variant = store.start({ goal: "Process spreadsheet row", scope: "device", profile: device, sessionId: "record" });
  store.append(variant.id, {
    action: { kind: "url", host: "example.com" },
    before: "start",
    after: "row-open",
    gate: false,
  });
  store.append(variant.id, {
    action: { kind: "key", key: "HOME" },
    before: "row-open",
    after: "start",
    gate: false,
  });
  store.finish(variant.id, "row processed and returned to start", "start");
  return store.get(variant.id);
}

function driver(options: { failUrlExecution?: number } = {}) {
  let screen = "start";
  let urlExecutions = 0;
  const urls: string[] = [];
  const observation = (): Observation => ({ signature: screen, profile: device, targets: [], protectedScreen: false });
  const adapter: TeachingAdapter = {
    authorize() {},
    async observe() {
      return observation();
    },
    async execute(action: TeachingAction, _observation: Observation, url?: string) {
      if (action.kind === "url") {
        urlExecutions += 1;
        if (url) urls.push(url);
        screen = options.failUrlExecution === urlExecutions ? "unexpected" : "row-open";
        return;
      }
      if (action.kind === "key" && action.key === "HOME") screen = "start";
    },
  };
  return { adapter, urls, executions: () => urlExecutions };
}

async function verify(store: TeachingStore, variantId: string, adapter: TeachingAdapter) {
  const run = await replayTeaching(store, variantId, adapter, "verify", "https://example.com/verify-row");
  assert.equal(run.status, "PASSED");
}

test("TEACH-004 batch replay requires a separate verification on the same device/profile", async () => {
  const f = fixture();
  try {
    const variant = batchVariant(f.store);
    const d = driver();
    await assert.rejects(
      replayVerifiedTeachingBatch(f.store, variant.id, d.adapter, [{ rowId: "row-1", url: "https://example.com/rows/1" }]),
      /Verify on this device/,
    );
    assert.equal(d.executions(), 0);
  } finally {
    f.clean();
  }
});

test("TEACH-004 validates the entire batch before the first device input", async () => {
  const f = fixture();
  try {
    const variant = batchVariant(f.store);
    const d = driver();
    await verify(f.store, variant.id, d.adapter);
    const before = d.executions();
    await assert.rejects(
      replayVerifiedTeachingBatch(f.store, variant.id, d.adapter, [
        { rowId: "row-1", url: "https://example.com/rows/1" },
        { rowId: "row-2", url: "https://example.com/rows/2?token=secret" },
      ]),
      /URL requires HTTPS/,
    );
    assert.equal(d.executions(), before);
  } finally {
    f.clean();
  }
});

test("TEACH-004 executes verified rows sequentially without persisting raw URLs", async () => {
  const f = fixture();
  try {
    const variant = batchVariant(f.store);
    const d = driver();
    await verify(f.store, variant.id, d.adapter);
    const result = await replayVerifiedTeachingBatch(f.store, variant.id, d.adapter, [
      { rowId: "row-1", url: "https://example.com/private/rows/1" },
      { rowId: "row-2", url: "https://example.com/private/rows/2" },
    ]);
    assert.equal(result.status, "PASSED");
    assert.deepEqual(result.rows.map((row) => row.rowId), ["row-1", "row-2"]);
    assert.deepEqual(d.urls.slice(-2), ["https://example.com/private/rows/1", "https://example.com/private/rows/2"]);
    const persisted = JSON.stringify(f.store.list());
    assert(!persisted.includes("/private/rows/1"));
    assert(!persisted.includes("/private/rows/2"));
  } finally {
    f.clean();
  }
});

test("TEACH-004 stops on the first failed row and never advances to later rows", async () => {
  const f = fixture();
  try {
    const variant = batchVariant(f.store);
    const d = driver({ failUrlExecution: 3 });
    await verify(f.store, variant.id, d.adapter);
    await assert.rejects(
      replayVerifiedTeachingBatch(f.store, variant.id, d.adapter, [
        { rowId: "row-1", url: "https://example.com/rows/1" },
        { rowId: "row-2", url: "https://example.com/rows/2" },
        { rowId: "row-3", url: "https://example.com/rows/3" },
      ]),
      /Expected screen not reached/,
    );
    assert(d.urls.includes("https://example.com/rows/1"));
    assert(d.urls.includes("https://example.com/rows/2"));
    assert(!d.urls.includes("https://example.com/rows/3"));
  } finally {
    f.clean();
  }
});

test("TEACH-004 batch inputs are bounded, uniquely keyed, HTTPS-only and host-bound", () => {
  const tooMany = Array.from({ length: MAX_TEACHING_BATCH_ROWS + 1 }, (_, index) => ({
    rowId: `row-${index}`,
    url: `https://example.com/rows/${index}`,
  }));
  assert.throws(() => validateTeachingBatchRows(tooMany, "example.com"), /requires 1-/);
  assert.throws(
    () =>
      validateTeachingBatchRows(
        [
          { rowId: "same", url: "https://example.com/1" },
          { rowId: "same", url: "https://example.com/2" },
        ],
        "example.com",
      ),
    /Duplicate batch row/,
  );
  assert.throws(() => validateTeachingBatchRows([{ rowId: "x", url: "http://example.com/1" }], "example.com"));
  assert.throws(() => validateTeachingBatchRows([{ rowId: "x", url: "https://evil.example/1" }], "example.com"));
  assert.throws(() => validateTeachingBatchRows([{ rowId: "x", url: "https://example.com/1?auth=secret" }], "example.com"));
});

/* global AbortSignal, fetch, process, setTimeout */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function fixture(failureMode = "none") {
  const root = await mkdtemp(join(tmpdir(), "broker-cognitive-startup-"));
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const gate = join(root, "allow-cognitive"), trace = join(root, "cognitive-trace");
  const optionsRoot = join(root, "public-materials");
  const serviceSource = `
    import { appendFileSync } from "node:fs";
    process.env.GORIQ_LOCAL_DATA_ROOT = "changed-after-startup";
    let instances = 0;
    export class CognitiveService {
      constructor(dbPath, options) {
        this.instance = ++instances; this.options = options; this.dbPath = dbPath;
        appendFileSync(${JSON.stringify(trace)}, "construct\\n");
        if (${JSON.stringify(failureMode)} === "constructor") throw Error("fixture-private-constructor-canary");
      }
      async status() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { instance: this.instance, dataRoot: this.options.materialIntake.dataRoot };
      }
      async continue(goalId) {
        if (goalId === "fixture-failure") throw Error("fixture-cycle-unavailable");
        return { instance: this.instance, goalId };
      }
    }
  `;
  const preload = join(root, "loader.mjs");
  await writeFile(preload, `
    import { registerHooks } from "node:module";
    import { appendFileSync, existsSync } from "node:fs";
    registerHooks({ load(url, context, nextLoad) {
      if (url !== ${JSON.stringify(pathToFileURL(resolve("src/gai/cognitive-service.ts")).href)}) return nextLoad(url, context);
      if (!existsSync(${JSON.stringify(gate)})) throw Error("TEST_EAGER_COGNITIVE_IMPORT");
      if (${JSON.stringify(failureMode)} === "import") {
        appendFileSync(${JSON.stringify(trace)}, "load\\n");
        throw Error("fixture-private-import-canary");
      }
      return { format: "module", source: ${JSON.stringify(serviceSource)}, shortCircuit: true };
    } });
  `);
  const env = { ...process.env, GITHUB_TOKEN: "", GAI_LOCAL_MODEL_NAME: "",
    JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
    JARVIS_OWNER_TOKEN: "public-cognitive-startup-fixture",
    JARVIS_DB_PATH: join(root, "broker.sqlite"), JARVIS_COMPASS_DB_PATH: join(root, "compass.sqlite"),
    JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "",
    GORIQ_LOCAL_WORK_MANIFEST: "", GORIQ_LOCAL_OUTCOMES: "", GORIQ_HISTORY_MANIFEST: "",
    GORIQ_LOCAL_MATERIAL_INTAKE: "1", GORIQ_LOCAL_DATA_ROOT: optionsRoot };
  let child;
  const launch = (overrides = {}) => {
    child = spawn(process.execPath, ["--import", preload, "scripts/jarvis-broker.ts"], {
      windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...env, ...overrides },
    });
    return child;
  };
  const close = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close"); child.kill(); await closed;
    }
    await rm(root, { recursive: true, force: true });
  };
  return { root, gate, trace, optionsRoot, base: `http://127.0.0.1:${port}`, launch, close };
}

test("Broker health and rejected cognitive requests avoid service loading; valid concurrent use shares one startup snapshot", { timeout: 30000 }, async () => {
  const f = await fixture();
  const child = f.launch();
  const headers = { Authorization: "Bearer public-cognitive-startup-fixture", "Content-Type": "application/json" };
  const request = (path, options = {}) => fetch(f.base + "/api/jarvis/admin/cognitive" + path, {
    headers, signal: AbortSignal.timeout(5000), ...options,
  });
  try {
    let healthy = false;
    for (let index = 0; index < 100; index++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try { healthy = (await fetch(f.base + "/health", { signal: AbortSignal.timeout(500) })).ok; } catch { /* own child startup */ }
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(healthy, true, "Broker must serve health before the first cognitive module load");
    for (const [path, options, status] of [
      ["", { headers: {} }, 401],
      ["", { method: "PUT", body: "{}" }, 405],
      ["", { method: "POST", body: "{}" }, 400],
      ["/learning", { method: "POST", body: '{"operation":"unknown"}' }, 400],
      ["/materials?unexpected=1", {}, 400],
      ["/materials", { method: "PUT", body: "{}" }, 405],
      ["/goal/proposal", { method: "POST", body: JSON.stringify({ text: "x".repeat(1025) }) }, 413],
      ["/goal", { method: "POST", body: JSON.stringify({ text: "x".repeat(32001) }) }, 413],
    ]) assert.equal((await request(path, options)).status, status);
    assert.equal(existsSync(f.trace), false, "rejected requests must not initialize the service");
    await writeFile(f.gate, "public fixture allows first valid use\n");
    const results = await Promise.all(Array.from({ length: 3 }, async () => {
      const response = await request(""); assert.equal(response.status, 200); return response.json();
    }));
    assert.deepEqual(results, Array.from({ length: 3 }, () => ({ instance: 1, dataRoot: f.optionsRoot })));
    const continued = await request("", { method: "POST", body: '{"goalId":"fixture-goal"}' });
    assert.equal(continued.status, 200);
    assert.deepEqual(await continued.json(), { instance: 1, goalId: "fixture-goal" });
    const failed = await request("", { method: "POST", body: '{"goalId":"fixture-failure"}' });
    assert.equal(failed.status, 409);
    assert.deepEqual(await failed.json(), { message: "fixture-cycle-unavailable" });
    assert.equal(await readFile(f.trace, "utf8"), "construct\n", "concurrent and later requests share one instance");
  } finally { await f.close(); }
});

test("Broker still rejects invalid host cognitive configuration during startup before first use", { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await writeFile(f.gate, "module may load; invalid configuration must still refuse startup\n");
    const child = f.launch({ GORIQ_LOCAL_MATERIAL_INTAKE: "invalid" });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "close");
    assert.notEqual(code, 0);
    assert.match(stderr, /Invalid host material intake setting/);
    assert.equal(existsSync(f.trace), false);
  } finally { await f.close(); }
});

for (const failureMode of ["import", "constructor"]) test(`Broker closes lazy ${failureMode} errors and shares rejected initialization without retry`, { timeout: 30000 }, async () => {
  const f = await fixture(failureMode);
  const child = f.launch();
  try {
    let healthy = false;
    for (let index = 0; index < 100; index++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try { healthy = (await fetch(f.base + "/health", { signal: AbortSignal.timeout(500) })).ok; } catch { /* own child startup */ }
      if (healthy) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(healthy, true);
    await writeFile(f.gate, "public fixture permits controlled load failure\n");
    const request = () => fetch(f.base + "/api/jarvis/admin/cognitive", {
      headers: { Authorization: "Bearer public-cognitive-startup-fixture" }, signal: AbortSignal.timeout(5000),
    });
    for (const response of await Promise.all([request(), request()])) {
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { message: "Cognitive cycle unavailable" });
    }
    const later = await request();
    assert.equal(later.status, 409);
    assert.deepEqual(await later.json(), { message: "Cognitive cycle unavailable" });
    assert.equal(await readFile(f.trace, "utf8"), failureMode === "import" ? "load\n" : "construct\n");
  } finally { await f.close(); }
});

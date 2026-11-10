/* global AbortController, Buffer, clearInterval, clearTimeout, performance, queueMicrotask, setInterval, setTimeout */
import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every expectation below describes a public boundary: no Docker is launched.
const o = await import("../scripts/jarvis-verifier-resource-observer.mjs").catch(() => ({}));
const id = "a".repeat(64), name = "goriq-verifier-00000000-0000-4000-8000-000000000001";
const listed = (overrides = {}) => ({ Id: id, Names: ["/" + name], Created: 100, ImageID: "sha256:" + "b".repeat(64), ...overrides });
const metadata = { sourceRevision: "c".repeat(40), runId: "123", runAttempt: "2", helperSha256: "d".repeat(64) };
const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_TEMP: "/tmp/runner", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2" };
const stats = { cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 900, online_cpus: 2,
  throttling_data: { periods: 8, throttled_periods: 2, throttled_time: 50 } },
  memory_stats: { usage: 1024, limit: 2048, stats: { cache: 64 } }, pids_stats: { current: 3, limit: 128 } };
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "goriq-observer-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function transport(behavior) {
  const requests = [];
  const request = (options, receive) => {
    requests.push(options);
    const req = new EventEmitter(); req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => behavior(req, receive));
    return req;
  };
  return { request, requests };
}
function response(receive, status, body) {
  const res = new PassThrough(); res.statusCode = status;
  receive(res); if (body !== undefined) res.end(body); return res;
}

test("observer entry and import are inert, with explicit hosted execution only", () => {
  assert.equal(typeof o.assertObserverCI, "function", "new observer helper is required");
  for (const args of [[], ["--unknown"]]) {
    const r = spawnSync(process.execPath, ["scripts/jarvis-verifier-resource-observer.mjs", ...args], { encoding: "utf8", timeout: 3000 });
    assert.equal(r.status, args.length ? 1 : 0); assert.doesNotMatch(r.stdout + r.stderr, /\/var\/|secret/);
  }
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./scripts/jarvis-verifier-resource-observer.mjs')"], { encoding: "utf8", timeout: 3000 });
  assert.equal(r.status, 0); assert.equal(r.stdout + r.stderr, "");
  assert.doesNotThrow(() => o.assertObserverCI({ env, platform: "linux", argv: ["--observe"] }));
  for (const change of [{ GITHUB_ACTIONS: "false" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { DOCKER_HOST: "unix:///other" }, { DOCKER_CONTEXT: "default" }, { RUNNER_TEMP: "relative" }, { DOCKER_TLS_VERIFY: "1" }]) {
    assert.throws(() => o.assertObserverCI({ env: { ...env, ...change }, platform: "linux", argv: ["--observe"] }), /OBSERVER_HOSTED_REQUIRED/);
  }
  assert.throws(() => o.assertObserverCI({ env, platform: "win32", argv: ["--stop"] }), /OBSERVER_HOSTED_REQUIRED/);
  assert.throws(() => o.assertObserverCI({ env, platform: "linux", argv: ["--observe", "--socket=other"] }), /OBSERVER_EXPLICIT_REQUIRED/);
});

test("selection rejects registry, arbitrary UUID/name/ID, stale/future/duplicate/aliased entries and caps ownership as provisional", () => {
  const invalid = [listed({ Id: "a".repeat(12) }), listed({ Id: "A".repeat(64) }), listed({ Names: ["/goriq-verifier-registry"] }),
    listed({ Names: ["/" + name.toUpperCase()] }), listed({ Names: ["/goriq-verifier-00000000-0000-0000-0000-000000000001"] }),
    listed({ Names: ["/" + name, "/alias"] }), listed({ Created: 99 }), listed({ Created: 102 }), listed({ Created: 100.5 })];
  assert.deepEqual(o.selectContainers(invalid, { startSecond: 100, nowSecond: 101 }), []);
  const valid = Array.from({ length: 12 }, (_, i) => listed({ Id: i.toString(16).padStart(64, "0"), Names: ["/" + name.slice(0, -2) + String(i).padStart(2, "0")] }));
  const selected = o.selectContainers([listed(), listed(), ...valid], { startSecond: 100, nowSecond: 101 });
  assert.equal(selected.length, 8); assert.equal(new Set(selected.map(x => x.id)).size, 8);
  assert.deepEqual(selected[0], { id, name, createdSecond: 100, imageId: "sha256:" + "b".repeat(64), association: "PROVISIONAL" });
});

test("numeric projection preserves safe counters, nulls unsafe/missing values, and never leaks arbitrary fields", () => {
  const secret = "PUBLIC_SECRET_SENTINEL";
  const p = o.projectStats({ ...stats, env: secret, labels: secret, read: secret, memory_stats: { ...stats.memory_stats, peak: secret } });
  assert.deepEqual(p, { cpuUsageNs: 300, systemCpuNs: 900, onlineCpus: 2, cpuPeriods: 8, cpuThrottledPeriods: 2, cpuThrottledNs: 50,
    memoryUsageBytes: 1024, memoryLimitBytes: 2048, memoryCacheBytes: 64, memoryPeakBytes: null, memoryEvents: null, pidsCurrent: 3, pidsLimit: 128 });
  assert.doesNotMatch(JSON.stringify(p), /PUBLIC_SECRET|env|labels|peak/);
  const absent = o.projectStats({ cpu_stats: { cpu_usage: { total_usage: 9007199254740992 }, online_cpus: -1, system_cpu_usage: "9007199254740993" }, pids_stats: { current: Infinity } });
  assert.ok(Object.values(absent).every(v => v === null));
});

test("fixed Unix transport refuses arbitrary routes, projects closed failures and destroys oversized, invalid, redirected, aborted and hung calls", async () => {
  let ended;
  const f = transport((req, receive) => { ended = req; response(receive, 200, JSON.stringify(stats)); });
  const get = o.createDockerTransport({ request: f.request });
  assert.deepEqual(await get({ kind: "stats", id }), { code: "OK", value: stats });
  assert.deepEqual(f.requests[0], { socketPath: "/var/run/docker.sock", path: "/v1.41/containers/" + id + "/stats?stream=false", method: "GET", agent: false, headers: { Accept: "application/json" } });
  assert.equal(ended.destroyed, true);
  for (const bad of [{ kind: "exec", id }, { kind: "stats", id: "../secret" }, { kind: "list", id }, { kind: "list", path: "/env" }]) await assert.rejects(get(bad), /OBSERVER_ROUTE_INVALID/);
  for (const [status, body, code] of [[302, "PUBLIC_SECRET", "HTTP_STATUS"], [404, "PUBLIC_SECRET", "DISAPPEARED"], [200, "{bad PUBLIC_SECRET", "INVALID_JSON"], [200, "x".repeat(524289), "RESPONSE_LIMIT"]]) {
    const f = transport((req, receive) => response(receive, status, body));
    assert.equal((await o.createDockerTransport({ request: f.request })({ kind: "list" })).code, code);
  }
  const err = transport(req => req.emit("error", Error("PUBLIC_SECRET")));
  assert.deepEqual(await o.createDockerTransport({ request: err.request })({ kind: "list" }), { code: "TRANSPORT_ERROR", value: null });
  for (const mode of ["headers", "body", "trickle"]) {
    let req, stream, tick;
    const f = transport((r, receive) => { req = r; if (mode !== "headers") stream = response(receive, 200); if (mode === "trickle") tick = setInterval(() => stream.write(" "), 2); });
    const at = performance.now(); const result = await o.createDockerTransport({ request: f.request, timeoutMs: 25 })({ kind: "list" });
    clearInterval(tick); stream?.destroy(); assert.equal(result.code, "REQUEST_TIMEOUT"); assert.equal(req.destroyed, true); assert.ok(performance.now() - at < 500);
  }
  const abort = new AbortController();
  const h = transport(() => abort.abort());
  assert.equal((await o.createDockerTransport({ request: h.request })({ kind: "list" }, { signal: abort.signal })).code, "STOPPED");
});

test("sampler serializes requests, deduplicates containers, retains null/reset and disappeared samples, and records source/run/overhead", async () => {
  let clock = 0, active = 0, maxActive = 0, statsCalls = 0;
  const writes = [];
  const result = await o.runObserver({ metadata, startSecond: 100, nowSecond: () => 101, now: () => clock,
    wait: async ms => { clock += ms; }, limits: { cycles: 3, intervalMs: 10 }, persist: value => writes.push(JSON.stringify(value)),
    get: async route => { active++; maxActive = Math.max(active, maxActive); await Promise.resolve(); active--; clock++;
      if (route.kind === "list") return { code: "OK", value: [listed(), listed()] };
      statsCalls++; return statsCalls === 3 ? { code: "DISAPPEARED", value: null } : { code: "OK", value: statsCalls === 1 ? stats : { ...stats, cpu_stats: {} } };
    } });
  assert.equal(maxActive, 1); assert.equal(result.samples.length, 3); assert.equal(result.containers.length, 1);
  assert.equal(result.samples[1].metrics.cpuUsageNs, null); assert.equal(result.samples[2].code, "DISAPPEARED");
  assert.equal(result.samples[2].metrics.cpuUsageNs, null); assert.equal(result.status, "PARTIAL");
  assert.equal(result.metadata.sourceRevision, "c".repeat(40)); assert.equal(result.metadata.runId, "123");
  assert.equal(result.acceptance, false); assert.equal(result.requestCount, 6); assert.ok(result.requestWallMs >= 6);
  assert.ok(result.overhead.cpuUserUs >= 0); assert.ok(result.overhead.wallMs >= 0); assert.ok(writes.length >= 3);
  assert.ok(writes.every(x => Buffer.byteLength(x) <= 2097152));
});

test("hard sampler record/container/cycle caps cannot be raised by injected limits", async () => {
  let clock = 0;
  const containers = Array.from({ length: 12 }, (_, i) => listed({ Id: i.toString(16).padStart(64, "0"), Names: ["/" + name.slice(0, -2) + String(i).padStart(2, "0")] }));
  const result = await o.runObserver({ metadata, startSecond: 100, nowSecond: () => 101, now: () => clock, wait: async ms => { clock += ms; },
    limits: { cycles: 999, samples: 999, containers: 999, intervalMs: 1 }, get: async r => ({ code: "OK", value: r.kind === "list" ? containers : stats }) });
  assert.equal(result.samples.length, 210); assert.equal(result.containers.length, 8); assert.ok(result.cycles <= 210);
  assert.ok(result.overhead.wallMs <= 2100000); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2097152);
});

test("wall and artifact limits stop further work without dropping explicit partial status", async () => {
  let clock = 0, calls = 0;
  const options = { metadata, startSecond: 100, nowSecond: () => 101, now: () => clock, wait: async ms => { clock += ms; },
    get: async r => { calls++; return { code: "OK", value: r.kind === "list" ? [listed()] : stats }; } };
  const wall = await o.runObserver({ ...options, limits: { wallMs: 15, intervalMs: 10 } });
  assert.equal(wall.stopReason, "WALL_LIMIT"); assert.equal(wall.status, "PARTIAL"); assert.ok(calls <= 4);
  clock = 0; calls = 0;
  const bytes = await o.runObserver({ ...options, limits: { artifactBytes: 2500, intervalMs: 1 } });
  assert.equal(bytes.stopReason, "ARTIFACT_LIMIT"); assert.ok(Buffer.byteLength(JSON.stringify(bytes)) <= 2500); assert.equal(bytes.status, "PARTIAL");
});

test("stop interrupts a pending request and a wall deadline bounds a hung injected transport", async () => {
  let stopped = false;
  const at = performance.now();
  const result = await o.runObserver({ metadata, startSecond: 100, stopRequested: () => stopped, limits: { wallMs: 60 },
    get: (_r, { signal }) => new Promise(resolve => { const timer = setTimeout(() => { stopped = true; }, 5); signal.addEventListener("abort", () => { clearTimeout(timer); resolve({ code: "STOPPED", value: null }); }, { once: true }); }) });
  assert.equal(result.stopReason, "STOP_REQUESTED"); assert.ok(performance.now() - at < 500);
  const wall = await o.runObserver({ metadata, startSecond: 100, limits: { wallMs: 25 }, get: () => new Promise(() => {}) });
  assert.equal(wall.stopReason, "WALL_LIMIT"); assert.ok(performance.now() - at < 1000);
});

test("state is exclusive 0700 under canonical runner temp and refuses symlinks/reuse/stale identity", { skip: process.platform !== "linux" && "Observer state is Linux-only; the hosted guard is tested on every platform" }, t => {
  const root = directory(t), localEnv = { ...env, RUNNER_TEMP: root };
  const state = o.createObserverState({ env: localEnv, metadata });
  assert.equal(statSync(state.directory).mode & 0o777, 0o700);
  assert.throws(() => o.createObserverState({ env: localEnv, metadata }), /OBSERVER_STATE_UNSAFE/);
  assert.throws(() => o.openObserverState({ env: { ...localEnv, GITHUB_RUN_ATTEMPT: "3" }, metadata }), /OBSERVER_STATE_UNSAFE/);
  writeFileSync(join(state.directory, "pid"), "1");
  symlinkSync(join(root, "elsewhere"), join(state.directory, "stop"));
  assert.throws(() => o.requestObserverStop({ env: localEnv, metadata, timeoutMs: 25 }), /OBSERVER_STATE_UNSAFE/);
  const other = directory(t); symlinkSync(root, join(other, "link"));
  assert.throws(() => o.createObserverState({ env: { ...env, RUNNER_TEMP: join(other, "link") }, metadata }), /OBSERVER_STATE_UNSAFE/);
  mkdirSync(join(other, "goriq-verifier-resource-observer-123-2"));
  assert.throws(() => o.openObserverState({ env: { ...env, RUNNER_TEMP: other }, metadata }), /OBSERVER_STATE_UNSAFE/);
});

test("worker retains partial artifact before readiness, then cooperatively finalizes and acknowledges; absent acknowledgment is unconfirmed", { skip: process.platform !== "linux" && "Observer state is Linux-only" }, async t => {
  const root = directory(t), localEnv = { ...env, RUNNER_TEMP: root };
  const state = o.createObserverState({ env: localEnv, metadata });
  let ready = false;
  const worker = o.runObserverWorker({ state, metadata, onReady: () => { ready = true; assert.ok(existsSync(join(state.directory, "artifact", "resource-observer.json"))); },
    get: async () => ({ code: "OK", value: [] }) });
  while (!ready) await new Promise(resolve => setTimeout(resolve, 2));
  const stopped = await o.requestObserverStop({ env: localEnv, metadata, timeoutMs: 1000 });
  await worker; assert.equal(stopped.code, "STOP_CONFIRMED");
  const artifact = JSON.parse(readFileSync(join(state.directory, "artifact", "resource-observer.json")));
  assert.equal(artifact.stopReason, "STOP_REQUESTED"); assert.equal(artifact.metadata.runAttempt, "2");
  const root2 = directory(t), env2 = { ...env, RUNNER_TEMP: root2 };
  o.createObserverState({ env: env2, metadata });
  assert.equal((await o.requestObserverStop({ env: env2, metadata, timeoutMs: 25 })).code, "STOP_UNCONFIRMED");
});

test("background start waits for matching readiness and never kills a process when startup fails", { skip: process.platform !== "linux" && "Observer state is Linux-only" }, async t => {
  for (const mode of ["ready", "wrong", "error", "silent"]) {
    const root = directory(t), localEnv = { ...env, RUNNER_TEMP: root }; let killed = false, sent;
    const child = new EventEmitter(); child.unref = () => {}; child.disconnect = () => {}; child.kill = () => { killed = true; };
    child.send = msg => { sent = msg; queueMicrotask(() => { if (mode === "ready") child.emit("message", { code: "READY", nonce: msg.nonce }); else if (mode === "wrong") child.emit("message", { code: "READY", nonce: "wrong" }); else if (mode === "error") child.emit("error", Error("PUBLIC_SECRET")); }); };
    const r = await o.startObserver({ env: localEnv, metadata, readyTimeoutMs: 25, fork: (_file, args, options) => {
      assert.deepEqual(args, ["--observe"]); assert.deepEqual(options.stdio, ["ignore", "ignore", "ignore", "ipc"]); assert.equal(options.env.RUNNER_TRACKING_ID, undefined); return child;
    } });
    assert.equal(r.code, mode === "ready" ? "READY" : "START_UNCONFIRMED"); assert.equal(killed, false); assert.equal(typeof sent.nonce, "string");
    if (mode !== "ready") assert.ok(existsSync(join(root, "goriq-verifier-resource-observer-123-2", "stop")));
  }
});

test("CI keeps producer failure authoritative and the signed artifact exact while observer cleanup/upload always run separately", () => {
  const yaml = readFileSync(".github/workflows/ci.yml", "utf8");
  const job = yaml.split("  independent-verifier-container:")[1].split("  windows-runtime-byte-fixtures:")[0];
  assert.match(job, /name: Start bounded resource observer\n\s+run: node scripts\/jarvis-verifier-resource-observer\.mjs --observe/);
  assert.match(job, /name: Real restricted-container six-check verification\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+run: node scripts\/jarvis-verifier-live-ci\.mjs --execute-hosted-ci/);
  assert.match(job, /name: Finalize bounded resource observer\n\s+if: always\(\)\n\s+run: node scripts\/jarvis-verifier-resource-observer\.mjs --stop/);
  assert.ok(job.includes("      - name: Retain hosted-container evidence\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: independent-verifier-container-${{ github.sha }}\n          path: |\n            ${{ runner.temp }}/goriq-verifier-live-evidence/\n            ${{ job.status != 'success' && format('!{0}/goriq-verifier-live-evidence/receipt.json', runner.temp) || '' }}\n          if-no-files-found: error\n          retention-days: 14"), "Signed evidence requires the exact reviewed conditional receipt selection");
  assert.match(job, /name: Retain supplemental resource observation\n\s+if: always\(\)/);
  assert.match(job, /path: \$\{\{ runner.temp \}\}\/goriq-verifier-resource-observer-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}\/artifact\//);
  assert.doesNotMatch(job, /continue-on-error|\|\| true|RUNNER_TRACKING_ID|permissions:/);
});

test("artifact symlinks are refused without changing their target, and forged stop acknowledgment cannot confirm sampling stopped", { skip: process.platform !== "linux" && "Observer state is Linux-only" }, async t => {
  const root = directory(t), localEnv = { ...env, RUNNER_TEMP: root };
  const state = o.createObserverState({ env: localEnv, metadata });
  const target = join(root, "public-canary"); writeFileSync(target, "PUBLIC_CANARY");
  symlinkSync(target, join(state.directory, "artifact", "resource-observer.json"));
  await assert.rejects(o.runObserverWorker({ state, metadata, get: async () => ({ code: "OK", value: [] }),
    onReady: () => writeFileSync(join(state.directory, "stop"), state.nonce, { mode: 0o600, flag: "wx" }) }), /OBSERVER_STATE_UNSAFE/);
  assert.equal(readFileSync(target, "utf8"), "PUBLIC_CANARY");
  writeFileSync(join(state.directory, "ack"), "forged", { mode: 0o600 });
  assert.equal((await o.requestObserverStop({ env: localEnv, metadata, timeoutMs: 25 })).code, "STOP_UNCONFIRMED");
});

test("real CLI records fixed git HEAD instead of GITHUB_SHA and preserves runner process tracking across its IPC readiness handshake", { skip: process.platform !== "linux" && "Hosted execution is Linux-only" }, t => {
  const root = directory(t), localEnv = { ...env, RUNNER_TEMP: root, GITHUB_SHA: "f".repeat(40), RUNNER_TRACKING_ID: "public-tracking" };
  const script = `
    import assert from 'node:assert/strict';
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    import { resolve } from 'node:path';
    cp.execFileSync = (file, args, opts) => {
      assert.equal(file, '/usr/bin/git'); assert.deepEqual(args, ['rev-parse', '--verify', 'HEAD']);
      assert.equal(opts.timeout, 2000); return '${"e".repeat(40)}\\n';
    };
    cp.fork = (_file, args, opts) => {
      assert.deepEqual(args, ['--observe']); assert.equal(opts.env.RUNNER_TRACKING_ID, 'public-tracking');
      const child = new EventEmitter(); child.unref = () => {}; child.disconnect = () => {};
      child.send = message => queueMicrotask(() => child.emit('message', { code: 'READY', nonce: message.nonce }));
      return child;
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, resolve('scripts/jarvis-verifier-resource-observer.mjs'), '--observe'];
    await import('./scripts/jarvis-verifier-resource-observer.mjs');
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: localEnv, encoding: "utf8", timeout: 3000 });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /READY/);
  const owner = JSON.parse(readFileSync(join(root, "goriq-verifier-resource-observer-123-2", "owner.json")));
  assert.equal(owner.sourceRevision, "e".repeat(40)); assert.notEqual(owner.sourceRevision, localEnv.GITHUB_SHA);
});

test("response interruption and upgrade are closed failures with destroyed sockets and no response-body disclosure", async () => {
  let destroyed = false;
  const upgrade = transport(req => req.emit("upgrade", null, { destroy: () => { destroyed = true; } }));
  assert.deepEqual(await o.createDockerTransport({ request: upgrade.request })({ kind: "list" }), { code: "HTTP_STATUS", value: null });
  assert.equal(destroyed, true);
  const abort = transport((_req, receive) => { const res = response(receive, 200); res.emit("aborted"); });
  assert.deepEqual(await o.createDockerTransport({ request: abort.request })({ kind: "list" }), { code: "TRANSPORT_ERROR", value: null });
});

test("producer status condition permits failed observer startup but skips every cancelled case", () => {
  const yaml = readFileSync(".github/workflows/ci.yml", "utf8");
  const producer = yaml.match(/name: Real restricted-container six-check verification\n\s+if: ([^\n]+)\n\s+run: ([^\n]+)/);
  assert.ok(producer); assert.equal(producer[2], "node scripts/jarvis-verifier-live-ci.mjs --execute-hosted-ci");
  // GitHub status-function semantics for the two explicit conditions under review.
  for (const { startupFailed, cancelled, expected } of [
    { startupFailed: true, cancelled: false, expected: true },
    { startupFailed: false, cancelled: false, expected: true },
    { startupFailed: true, cancelled: true, expected: false },
    { startupFailed: false, cancelled: true, expected: false },
  ]) {
    const runs = producer[1] === "always()" ? true : producer[1] === "${{ !cancelled() }}" ? !cancelled : !startupFailed && !cancelled;
    assert.equal(runs, expected, JSON.stringify({ startupFailed, cancelled, condition: producer[1] }));
  }
});

test("container identities require primitive strings and malformed optional image identity stays unavailable", () => {
  for (const row of [listed({ Id: [id] }), listed({ Id: Object(id) }),
    listed({ Names: [["/" + name]] }), listed({ Names: [Object("/" + name)] })]) {
    assert.deepEqual(o.selectContainers([row], { startSecond: 100, nowSecond: 101 }), []);
  }
  for (const image of [["sha256:" + "b".repeat(64)], Object("sha256:" + "b".repeat(64)), null, 123, {}, []]) {
    const selected = o.selectContainers([listed({ ImageID: image })], { startSecond: 100, nowSecond: 101 });
    assert.equal(selected.length, 1); assert.equal(selected[0].imageId, null);
    assert.equal(typeof selected[0].id, "string"); assert.equal(typeof selected[0].name, "string");
  }
});

test("metadata rejects coerced arrays, boxed strings and numeric run fields before any Docker request", async () => {
  let calls = 0;
  const get = async () => { calls++; return { code: "OK", value: [] }; };
  for (const field of ["sourceRevision", "helperSha256", "runId", "runAttempt"]) {
    for (const bad of [[metadata[field]], Object(metadata[field]), 123, null, {}]) {
      await assert.rejects(o.runObserver({ metadata: { ...metadata, [field]: bad }, get, limits: { cycles: 1 } }), /OBSERVER_METADATA_INVALID/);
    }
  }
  assert.equal(calls, 0);
});

test("transport rejects array and boxed-string IDs before reaching even the public request double", async () => {
  let calls = 0;
  const get = o.createDockerTransport({ request: () => { calls++; throw Error("PUBLIC_ONLY"); } });
  for (const bad of [[id], Object(id), null, 123, {}]) await assert.rejects(get({ kind: "stats", id: bad }), /OBSERVER_ROUTE_INVALID/);
  assert.equal(calls, 0);
});

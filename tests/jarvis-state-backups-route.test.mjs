/* global AbortSignal, Headers, Request, URL, fetch, process, setTimeout */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createOwnerSessionToken, OWNER_SESSION_COOKIE } from "../src/app/owner-auth.ts";

// Resolve Next's extensionless package imports for Node's native TS runner; no HTTP/auth mocks.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/headers" ? "next/headers.js" : specifier === "next/server" ? "next/server.js" : specifier, context);
} });
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const owner = "broker-sequence-test-owner"; // Existing public test constant.
const secret = "sec001-owner-secret"; // Existing public test constant.

test("actual Owner Next proxy and Broker backup route persist generations, reject untrusted inputs, and redact state/errors", { timeout: 60000 }, async () => {
  const routePath = new URL("../src/app/api/jarvis/state-backups/route.ts", import.meta.url);
  assert.ok(existsSync(routePath), "Owner Settings backup HTTP route is missing");
  const directory = await mkdtemp(join(tmpdir(), "state-backup-http-"));
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const brokerPath = join(directory, "broker.sqlite"), compassPath = join(directory, "compass.sqlite");
  let child, logs = "", cookie;
  const envBefore = { ...process.env };
  const start = async () => {
    child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], { env: { ...process.env, JARVIS_OWNER_TOKEN: owner,
      JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_DB_PATH: brokerPath, JARVIS_COMPASS_DB_PATH: compassPath,
      GITHUB_TOKEN: "", GAI_LOCAL_MODEL_NAME: "", GORIQ_LOCAL_WORK_MANIFEST: "", GORIQ_LOCAL_OUTCOMES: "", GORIQ_LOCAL_MATERIAL_INTAKE: "", GORIQ_SELF_DEVELOPMENT_RUNTIME: "", GORIQ_OWNER_RECOVERY_ENROLLMENT_ENABLED: "", JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* bounded startup */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail("public fixture Broker unavailable");
  };
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, "exit"); child.kill(); await done; } };
  try {
    process.env.JARVIS_OWNER_SECRET = secret; process.env.JARVIS_OWNER_TOKEN = owner;
    process.env.JARVIS_BROKER_URL = `http://127.0.0.1:${port}`;
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
    const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
    const { RequestCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
    const route = await import(pathToFileURL(routePath.pathname).href);
    const invoke = (method, payload, extra = {}) => {
      const request = new Request("http://localhost/api/jarvis/state-backups", { method, headers: { Origin: "http://localhost", "Content-Type": "application/json", "X-Jarvis-Operation-Mode": "standard", ...extra }, ...(method === "POST" ? { body: JSON.stringify(payload) } : {}) });
      return workAsyncStorage.run({ route: "/api/jarvis/state-backups", isStaticGeneration: false }, () => workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: new RequestCookies(new Headers(cookie ? { cookie: `${OWNER_SESSION_COOKIE}=${cookie}` } : {})) }, () => route[method](request)));
    };
    await start();
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/jarvis/admin/state-backups`)).status, 401);
    assert.equal((await invoke("GET")).status, 401);
    cookie = createOwnerSessionToken(secret, { nonce: "A".repeat(24) });
    assert.equal((await invoke("POST", { operation: "create" })).status, 403, "fresh trusted session required");
    cookie = createOwnerSessionToken(secret, { nonce: "A".repeat(24), deviceId: "public-fixture-device681" });
    assert.equal((await invoke("POST", { operation: "create" }, { Origin: "https://hostile.invalid" })).status, 403);
    for (const mode of ["read-only", "kiosk"]) assert.equal((await invoke("POST", { operation: "create" }, { "X-Jarvis-Operation-Mode": mode })).status, 403);
    for (const payload of [{ operation: "create", path: "/private/CANARY_PATH" }, { operation: "verify", generationId: "../../private" }, { operation: "create", url: "https://hostile.invalid" }, { operation: "create", sql: "SELECT *" }]) assert.equal((await invoke("POST", payload)).status, 400);
    const oversized = "A".repeat(2048); assert.equal((await invoke("POST", { operation: oversized })).status, 400);
    const brokerResponse = await fetch(`http://127.0.0.1:${port}/api/jarvis/admin/state-backups`, { method: "POST", headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation: "create", sourcePath: "/private" }) });
    assert.equal(brokerResponse.status, 400);
    const createdResponse = await invoke("POST", { operation: "create" });
    assert.equal(createdResponse.status, process.platform === "win32" ? 503 : 201);
    if (process.platform === "win32") return;
    const created = await createdResponse.json(); assert.match(created.generation.id, /^[a-f0-9-]{36}$/);
    assert.equal(createdResponse.headers.get("cache-control"), "no-store");
    await stop(); await start();
    const listed = await (await invoke("GET")).json(); assert.equal(listed.generations[0].id, created.generation.id);
    const verifiedResponse = await invoke("POST", { operation: "verify", generationId: created.generation.id });
    assert.equal(verifiedResponse.status, 200); const verified = await verifiedResponse.json(); assert.equal(verified.generation.status, "verified"); assert.equal(verified.generation.activationAuthorized, false);
    assert.equal((await invoke("POST", { operation: "verify", generationId: "00000000-0000-4000-8000-000000000000" })).status, 404);
    const artifact = join(brokerPath + ".state-backups", created.generation.id, "broker.sqlite");
    await writeFile(artifact, "PUBLIC_TAMPER_PAYLOAD_CANARY_681");
    const tampered = await invoke("POST", { operation: "verify", generationId: created.generation.id }); assert.equal(tampered.status, 409);
    const publicResponses = JSON.stringify([created, listed, verified, await tampered.json()]);
    assert.doesNotMatch(publicResponses, /PUBLIC_.*CANARY|CANARY_PATH|\/tmp\/|broker\.sqlite|compass\.sqlite|sourcePath|backupPath|restoredPath|sec001-owner-secret|broker-sequence-test-owner/);
    assert.doesNotMatch(logs, /PUBLIC_TAMPER_PAYLOAD_CANARY|sec001-owner-secret|broker-sequence-test-owner|CANARY_PATH/);
    cookie = createOwnerSessionToken(secret, { nonce: "A".repeat(24) }); // Independent Owner auth for the transport-unavailable assertion.
    await stop();
    const unavailable = await invoke("GET"); assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /ECONNREFUSED|127\.0\.0\.1|\/tmp\//);
  } finally {
    await stop();
    for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
    Object.assign(process.env, envBefore); await rm(directory, { recursive: true, force: true });
  }
});

test("real NextRequest normalization preserves strict HTTP Host-bound origin and cannot trust forwarded Host", async () => {
  const before = process.env.JARVIS_OWNER_SECRET;
  process.env.JARVIS_OWNER_SECRET = secret;
  try {
    const { NextRequest } = await import("next/server.js");
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
    const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
    const { RequestCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
    const route = await import("../src/app/api/jarvis/state-backups/route.ts");
    const cookie = createOwnerSessionToken(secret, { nonce: "A".repeat(24) });
    const invoke = headers => {
      const request = new NextRequest("http://127.0.0.1:43367/api/jarvis/state-backups", { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...headers }, body: JSON.stringify({ operation: "create" }) });
      assert.equal(new URL(request.url).hostname, "localhost", "the real pinned NextRequest normalizes its internal URL");
      return workAsyncStorage.run({ route: "/api/jarvis/state-backups", isStaticGeneration: false }, () => workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: new RequestCookies(new Headers({ cookie: `${OWNER_SESSION_COOKIE}=${cookie}` })) }, () => route.POST(request)));
    };
    const legitimate = await invoke({ Host: "127.0.0.1:43367", Origin: "http://127.0.0.1:43367" });
    assert.equal(legitimate.status, 403);
    assert.equal((await legitimate.json()).code, "fresh_owner_confirmation_required", "matching real Host passes origin validation while ordinary Owner auth still cannot mutate");
    for (const headers of [
      { Host: "127.0.0.1:43367", Origin: "https://hostile.invalid" },
      { Host: "127.0.0.1:43367", Origin: "http://forwarded.invalid", "X-Forwarded-Host": "forwarded.invalid" },
      { Host: "127.0.0.1:43367", Origin: "https://127.0.0.1:43367", "X-Forwarded-Proto": "https" },
      { Host: "127.0.0.1:43367", Origin: "http://127.0.0.1:43367", "Sec-Fetch-Site": "cross-site" },
      ...["127.0.0.1:43367@hostile.invalid", "127.0.0.1:43367/path", "127.0.0.1:43367,hostile.invalid", "http://127.0.0.1:43367", "127.0.0.1:99999", "", "127.0.0.1:43367#hostile"].map(Host => ({ Host, Origin: "http://127.0.0.1:43367" })),
    ]) {
      const response = await invoke(headers); assert.equal(response.status, 403); assert.equal((await response.json()).code, "same_origin_required");
    }
  } finally { if (before === undefined) delete process.env.JARVIS_OWNER_SECRET; else process.env.JARVIS_OWNER_SECRET = before; }
});

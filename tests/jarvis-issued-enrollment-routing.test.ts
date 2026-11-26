import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JarvisEnrollmentService } from "../src/jarvis/enrollment.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";

const prefixFixture = new URL("./helpers/issued-enrollment-prefix.mjs", import.meta.url);
function node(id: string): JarvisNode {
  return { id, label: id, kind: "android", status: "ready", capabilities: ["open-url"], enrollment: "full",
    policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true },
    telemetry: { checkedAt: new Date().toISOString() }, lastSeenAt: new Date().toISOString() };
}

test("issued-token lookup does not consume capacity or replace expiry and mode validation", () => {
  const service = new JarvisEnrollmentService();
  const now = new Date("2026-11-18T10:00:00.000Z");
  const token = service.createToken({ mode: "quick", maxDevices: 2, group: "owner-group", now });
  assert.equal(service.hasToken("ji_" + "a".repeat(29)), false);
  for (let i = 0; i < 3; i++) assert.equal(service.hasToken(token.token), true);
  assert.equal(service.consume(token.token, node("first"), now).node.enrollment, "quick");
  assert.equal(service.hasToken(token.token), true);
  const final = service.consume(token.token, node("second"), now);
  assert.equal(final.token.usedDevices, 2);
  assert.equal(final.node.group, "owner-group");
  assert.equal(service.hasToken(token.token), false);
  assert.throws(() => service.consume(token.token, node("third"), now), /Invalid JARVIS enrollment token/);

  const expired = service.createToken({ mode: "full", ttlMs: 1, now });
  assert.equal(service.hasToken(expired.token), true);
  assert.throws(() => service.consume(expired.token, node("expired"), new Date(now.getTime() + 1)), /Expired JARVIS enrollment token/);
  assert.equal(service.hasToken(expired.token), true, "lookup reports issuance; consume owns expiry validation");
  const full = service.createToken({ mode: "full", now });
  assert.equal(service.consume(full.token, node("full"), now).node.enrollment, "full");
  assert.equal(service.hasToken(full.token), false);
});

type BrokerFixture = {
  post: (path: string, body?: unknown, authenticated?: boolean) => Promise<Response>;
  enroll: (id: string, credential: Record<string, string>) => Promise<Response>;
};
async function withPrefixedBroker(run: (fixture: BrokerFixture) => Promise<void>) {
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(done => reservation.close(() => done()));
  const directory = await mkdtemp(join(tmpdir(), "jarvis-issued-routing-"));
  const owner = randomBytes(32).toString("hex");
  const child = spawn(process.execPath, ["--import", fileURLToPath(prefixFixture), "scripts/jarvis-broker.ts"], {
    env: { ...process.env, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner,
      JARVIS_PUBLIC_BROKER_URL: "https://192.168.0.169:8792", JARVIS_DB_PATH: join(directory, "broker.sqlite") }, stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const post: BrokerFixture["post"] = (path, body = {}, authenticated = false) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(body),
  });
  const publicKeyPem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { ready = (await fetch(base + "/health")).ok; } catch { /* bounded startup */ }
      if (ready) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.equal(ready, true, "test broker started");
    await run({ post, enroll: (id, credential) => post("/api/jarvis/enroll", { ...credential, node: node(id), identity: { algorithm: "ecdsa-p256-sha256", publicKeyPem } }) });
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
}

test("issued ji_ quick and full tokens route through normal consumption via token and grant", { timeout: 30_000 }, async () => {
  await withPrefixedBroker(async ({ post, enroll }) => {
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503, "the prefix cannot open the owner window");
    assert.equal((await post("/api/jarvis/admin/enrollment", { mode: "quick" })).status, 401);
    const issued = await post("/api/jarvis/admin/enrollment", { mode: "quick", maxDevices: 1 }, true);
    assert.equal(issued.status, 201);
    const quick = (await issued.json()).token.token;
    assert.match(quick, /^ji_[A-Za-z0-9_-]{29}$/);
    const accepted = await enroll("direct-quick", { token: quick });
    assert.equal(accepted.status, 201);
    assert.equal((await accepted.json()).node.enrollment, "quick", "device's Full claim cannot upgrade a Quick token");
    assert.equal((await enroll("direct-replay", { token: quick })).status, 403);

    const fleet = (await (await post("/api/jarvis/admin/enrollment", { mode: "fleet", maxDevices: 2 }, true)).json()).token.token;
    assert.match(fleet, /^ji_[A-Za-z0-9_-]{29}$/);
    for (const id of ["fleet-one", "fleet-two"]) {
      const result = await enroll(id, { token: fleet }); assert.equal(result.status, 201); assert.equal((await result.json()).node.enrollment, "quick");
    }
    assert.equal((await enroll("fleet-over-limit", { token: fleet })).status, 403);
    const full = (await (await post("/api/jarvis/admin/enrollment", { mode: "full" }, true)).json()).token.token;
    assert.match(full, /^ji_[A-Za-z0-9_-]{29}$/);
    const fullResult = await enroll("owner-full", { token: full }); assert.equal(fullResult.status, 201); assert.equal((await fullResult.json()).node.enrollment, "full");

    assert.equal((await post("/api/jarvis/admin/enrollment-window", { action: "open", ttlMs: 60_000, maxIssues: 2 }, true)).status, 200);
    for (const field of ["grant", "token"]) {
      const issue = await post("/api/jarvis/enrollment-grant"); assert.equal(issue.status, 201);
      const grant = (await issue.json()).grant; assert.match(grant, /^ji_[A-Za-z0-9_-]{29}$/);
      const result = await enroll("grant-" + field, { [field]: grant }); assert.equal(result.status, 201); assert.equal((await result.json()).node.enrollment, "quick");
      assert.equal((await enroll("grant-replay-" + field, { [field]: grant })).status, 403);
    }
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503, "owner issue budget is unchanged");
  });
});

test("real 46-character invitations retain capacity, duplicate and revocation checks", { timeout: 30_000 }, async () => {
  await withPrefixedBroker(async ({ post, enroll }) => {
    const invitationPath = "/api/jarvis/admin/invitation";
    async function issue(maxDevices: number) {
      const response = await post(invitationPath, { action: "create", maxDevices }, true); assert.equal(response.status, 201);
      const token = new URLSearchParams(new URL((await response.json()).url).hash.slice(1)).get("token");
      assert.ok(token); assert.match(token, /^ji_[A-Za-z0-9_-]{43}$/); return token;
    }
    assert.equal((await post("/api/jarvis/enrollment-grant")).status, 503);
    const first = await issue(1);
    const result = await enroll("invitation-one", { token: first }); assert.equal(result.status, 201); assert.equal((await result.json()).node.enrollment, "quick");
    assert.equal((await enroll("invitation-one", { token: first })).status, 409);
    assert.equal((await enroll("invitation-capacity", { token: first })).status, 403);
    const second = await issue(2); assert.notEqual(second, first);
    assert.equal((await enroll("invitation-two", { token: second })).status, 201);
    assert.equal((await post(invitationPath, { action: "revoke" }, true)).status, 200);
    assert.equal((await enroll("invitation-revoked", { token: second })).status, 403);
    assert.equal((await enroll("invitation-old", { token: first })).status, 403);
  });
});

test("unknown and malformed ji_ values remain rejected and invitation rate limiting remains bounded", { timeout: 30_000 }, async () => {
  await withPrefixedBroker(async ({ post, enroll }) => {
    const issued = await post("/api/jarvis/admin/invitation", { action: "create", maxDevices: 2 }, true); assert.equal(issued.status, 201);
    const invitation = new URLSearchParams(new URL((await issued.json()).url).hash.slice(1)).get("token"); assert.ok(invitation);
    const values = ["ji_", "ji_***", "ji_" + "a".repeat(29), "ji_" + "a".repeat(43)];
    for (let i = 0; i < 100; i++) assert.equal((await enroll("invalid-" + i, { token: values[i % values.length] })).status, 403);
    assert.equal((await enroll("invalid-rate-limit", { token: values[0] })).status, 429);
    assert.equal((await enroll("invitation-rate-limit", { token: invitation })).status, 429);
    const normal = (await (await post("/api/jarvis/admin/enrollment", { mode: "quick" }, true)).json()).token.token;
    assert.match(normal, /^ji_[A-Za-z0-9_-]{29}$/);
    assert.equal((await enroll("issued-after-invalid-requests", { token: normal })).status, 201, "ordinary issuance does not use the invitation limiter");
    const revoked = await post("/api/jarvis/admin/invitation", { action: "revoke" }, true);
    assert.equal(revoked.status, 200); assert.equal((await revoked.json()).invitation.usedDevices, 0);
  });
});

test("the unchanged 100-device shared-URL launch assertions also pass with issued ji_ tokens", { timeout: 60_000 }, async () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import=" + prefixFixture.href].filter(Boolean).join(" ") };
  // This owns a separate test runner; do not inherit the outer worker protocol.
  delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", resolve("tests/jarvis-launch-enrollment.test.ts")], {
    env: environment, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 55_000);
  try {
    const [code] = await once(child, "close"); assert.equal(code, 0, stderr + stdout);
    assert.match(stdout, /# tests 1\b/); assert.match(stdout, /# pass 1\b/); assert.match(stdout, /# fail 0\b/); assert.match(stdout, /# skipped 0\b/);
  } finally { clearTimeout(timer); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedPrivateWorkerRequest, privateWorkerBind, privateWorkerHeaders, privateWorkerHandler } from "../src/jarvis/private-worker-ingress.ts";

test("Worker ingress binds only explicit RFC1918 addresses", () => {
  for (const ip of ["192.168.0.169", "10.0.0.1", "172.16.0.1", "172.31.255.254"]) assert.equal(privateWorkerBind(ip), ip);
  for (const ip of ["", "0.0.0.0", "::", "127.0.0.1", "8.8.8.8", "100.71.220.44", "172.15.0.1", "172.32.0.1", "192.168.999.1", "192.168.1.1.attacker.invalid"]) {
    assert.throws(() => privateWorkerBind(ip));
  }
});

test("private Worker route surface excludes dashboard, admin, queries and encoded traversal", () => {
  for (const path of ["/api/jarvis/enroll", "/api/jarvis/enrollment-grant", "/api/jarvis/worker/heartbeat", "/api/jarvis/worker/next", "/api/jarvis/worker/result"]) {
    assert(allowedPrivateWorkerRequest("POST", path));
    assert(!allowedPrivateWorkerRequest("GET", path));
  }
  for (const path of ["/", "/api/jarvis/admin/enrollment-window", "/api/jarvis/action", "/api/jarvis/worker/../admin/state", "/api/jarvis/worker/%2e%2e/admin/state", "/api/jarvis/enroll?x=1", "https://attacker.invalid/"]) {
    assert(!allowedPrivateWorkerRequest("POST", path));
  }
});

test("Worker ingress forwards signed headers but never cookies, owner auth or proxy authority", () => {
  assert.deepEqual(privateWorkerHeaders({ authorization: "Bearer owner", cookie: "session=owner", host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", "x-jarvis-node-id": "node-1", "x-jarvis-nonce": "nonce" }), {
    "content-type": "application/json", "x-jarvis-node-id": "node-1", "x-jarvis-nonce": "nonce",
  });
});

test("TLS ingress verifies certificate and hostname, relays bytes, rejects admin and oversize requests", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "jarvis-ingress-test-"));
  const certPath = join(directory, "test.crt");
  const keyPath = join(directory, "test.key");
  const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
  // Disposable loopback fixture only; never used as installation credentials.
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=JARVIS test fixture", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  const cert = await readFile(certPath);
  let forwarded = 0;
  const broker = httpServer(async (request, response) => {
    forwarded++;
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers["x-jarvis-node-id"], "test-node");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200).end(Buffer.concat(chunks));
  });
  broker.listen(0, "127.0.0.1");
  await once(broker, "listening");
  const brokerPort = (broker.address() as { port: number }).port;
  const ingress = httpsServer({ cert, key: await readFile(keyPath), minVersion: "TLSv1.2" }, privateWorkerHandler(brokerPort));
  ingress.listen(0, "127.0.0.1");
  await once(ingress, "listening");
  const port = (ingress.address() as { port: number }).port;
  const send = (path: string, body = "{}", trusted = true, servername?: string) => new Promise<{ code: number; body: string }>((resolve, reject) => {
    const request = httpsRequest({ host: "127.0.0.1", port, path, method: "POST", ca: trusted ? cert : undefined, servername,
      headers: { authorization: "Bearer owner-must-not-forward", cookie: "owner-session", "x-jarvis-node-id": "test-node" } }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ code: response.statusCode!, body: text }));
    });
    request.on("error", reject);
    request.end(body);
  });
  try {
    assert.deepEqual(await send("/api/jarvis/worker/heartbeat", '{"status":"ready"}'), { code: 200, body: '{"status":"ready"}' });
    await assert.rejects(send("/api/jarvis/enroll", "{}", false));
    await assert.rejects(send("/api/jarvis/enroll", "{}", true, "wrong-host.invalid"));
    assert.equal((await send("/api/jarvis/admin/enrollment-window")).code, 404);
    assert.equal((await send("/api/jarvis/enroll", "x".repeat(1_000_001))).code, 413);
    assert.equal(forwarded, 1);
  } finally {
    await new Promise<void>((resolve) => ingress.close(() => resolve()));
    broker.closeAllConnections();
    await new Promise<void>((resolve) => broker.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

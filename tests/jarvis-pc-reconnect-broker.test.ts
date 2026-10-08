import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { registerLocalPc } from "../src/jarvis/pc-bootstrap.ts";
import { privatePcRelay } from "../src/jarvis/private-pc-transport.ts";
import type { PcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";

const revision = "a".repeat(40);
function identity(nodeId: "macbook" | "zbook"): PcLocalIdentity {
  const keys = generateKeyPairSync("ed25519");
  return { version: 1, nodeId, platform: nodeId === "zbook" ? "windows" : "macos", algorithm: "ed25519",
    hostBinding: "fixture", createdAt: new Date().toISOString(),
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
for (const remote of [false, true]) for (const fault of ["before-commit", "after-commit"]) {
  test((remote ? "signed peer" : "local") + " real file work recovers " + fault + " TCP loss and Broker restart",
    { timeout: 30000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pc-reconnect-")), db = join(dir, "broker.sqlite");
    const mac = identity("macbook"), worker = identity("zbook"), owner = randomUUID();
    // Only these child processes get an isolated home; no installed PC state/key is used.
    const isolatedEnvironment = { ...process.env, USERPROFILE: dir, HOME: dir };
    await mkdir(join(dir, "JARVIS", "production", "pc-node", "zbook"), { recursive: true });
    await mkdir(join(dir, ".goriq", "state", "pc-node", "zbook"), { recursive: true, mode: 0o700 });
    const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
    const brokerPort = (portProbe.address() as { port: number }).port;
    await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const base = "http://127.0.0.1:" + brokerPort;
    await writeFile(db + ".pc-enrollment-approval.json", JSON.stringify({ version: 1, issue: 1662, goalIssue: 1219,
      approvedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      targets: [{ nodeId: "macbook", platform: "macos" }, { nodeId: "zbook", platform: "windows" }],
      roles: ["Executor", "Storage", "Verifier", "Coordinator"] }), { mode: 0o600 });
    const start = () => spawn(process.execPath, ["scripts/jarvis-broker.ts"], { stdio: "ignore", env: {
      ...isolatedEnvironment, GITHUB_TOKEN: "", GORIQ_RUNTIME_REVISION: revision, JARVIS_BROKER_HOST: "127.0.0.1",
      JARVIS_BROKER_PORT: String(brokerPort), JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: db,
      JARVIS_COMPASS_DB_PATH: join(dir, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "",
      JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" } });
    let broker = start(), cut = true, resultPosts = 0;
    const ready = async () => {
      for (let i = 0; i < 100; i++) {
        try { if ((await fetch(base + "/health")).ok) return; } catch { /* bounded startup */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail("isolated Broker unavailable");
    };
    const stop = async () => { const done = once(broker, "exit"); broker.kill(); await done; };
    const relay = privatePcRelay({ ingress: async () => true, signer: async () => ({ identity: mac, revision }),
      upstream: (url, options) => fetch(base + new URL(String(url)).pathname, options) });
    const proxy = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const path = req.url!, result = path === "/api/jarvis/worker/pc/result";
        if (result) resultPosts++;
        if (cut && result && fault === "before-commit") { cut = false; res.destroy(); return; }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value && key !== "host") headers.set(key, String(value));
        const options = { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) };
        const response = remote
          ? await relay(new Request("https://macbook.tailfixture.ts.net" + path, options))
          : await fetch(base + path, options);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (cut && result && fault === "after-commit") { cut = false; res.destroy(); return; }
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes);
      } catch { res.destroy(); }
    });
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    const transportBase = "http://127.0.0.1:" + (proxy.address() as { port: number }).port;
    const bootstrapUrl = new URL("../src/jarvis/pc-bootstrap.ts", import.meta.url).href;
    const runtimeUrl = new URL("../src/gai/common-worker-runtime.ts", import.meta.url).href;
    const clientFile = join(dir, "client.mjs"), inputFile = join(dir, "fixture-input.json");
    await writeFile(clientFile, [
      "import { readFile } from 'node:fs/promises';",
      "import { executeLocalPcWork, executeRemotePcWork } from " + JSON.stringify(bootstrapUrl) + ";",
      "import { CommonWorkerRuntime } from " + JSON.stringify(runtimeUrl) + ";",
      "const p = JSON.parse(await readFile(process.argv[2], 'utf8'));",
      "let executions = 0; const real = CommonWorkerRuntime.prototype.execute;",
      "CommonWorkerRuntime.prototype.execute = function(...args) { executions++; return real.apply(this,args); };",
      "try { const result = p.remote ? await executeRemotePcWork({ ...p, request: (url,options) => fetch(p.transportBase + new URL(url).pathname, options) }) : await executeLocalPcWork(p);",
      "console.log(JSON.stringify({ result, executions })); } catch { console.log(JSON.stringify({ failed: true, executions })); process.exitCode=1; }"
    ].join("\n"));
    const run = async () => {
      const client = spawn(process.execPath, [clientFile, inputFile], { env: isolatedEnvironment, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      client.stdout.on("data", chunk => { out += chunk; }); client.stderr.on("data", chunk => { err += chunk; });
      const [code] = await once(client, "exit");
      assert.ok(out.trim(), "isolated worker must return evidence: " + err);
      return { code, ...JSON.parse(out.trim()) };
    };
    try {
      await ready();
      await registerLocalPc({ base, revision, ownerToken: owner, identity: mac });
      await registerLocalPc({ base, revision, ownerToken: owner, identity: worker });
      const content = "PUBLIC actual reconnect workload\n" + randomUUID();
      const input = { idempotencyKey: randomUUID(), goalIssue: 1219, targetNodeId: worker.nodeId,
        privacyClass: "PUBLIC", content, capsule: { goal: "#1219", currentJob: "#1751", why: "Verify real result recovery",
          workflowPosition: "execute -> TCP loss -> Broker restart -> reconcile", inputs: ["public fixture"],
          constraints: ["filesystem only"], decisions: ["restartable digest"], dependencies: ["fixture identity"],
          expectedOutput: ["SHA256"], definitionOfDone: ["recover original completion"], verificationContract: "independent digest",
          recoveryContext: ["preserve identity and reject stale claims"] } };
      const submitted = await fetch(base + "/api/jarvis/admin/pc-tasks", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + owner }, body: JSON.stringify(input) });
      assert.equal(submitted.status, 201);
      const taskId = (await submitted.json()).task.id;
      await writeFile(inputFile, JSON.stringify({ remote, base: remote ? "https://macbook.tailfixture.ts.net" : transportBase,
        transportBase, tailnetDomain: "tailfixture.ts.net", revision, identity: worker,
        peer: { nodeId: mac.nodeId, algorithm: "ed25519", publicKeyPem: mac.publicKeyPem, enrolledAt: mac.createdAt }, taskId }), { mode: 0o600 });
      const interrupted = await run();
      assert.equal(interrupted.failed, true); assert.equal(interrupted.executions, 1); assert.equal(cut, false);
      const prior = JSON.parse(await readFile(db + ".pc-tasks.json", "utf8")).tasks[0];
      assert.equal(prior.status, fault === "after-commit" ? "completed" : "running");
      await stop(); broker = start(); await ready();
      const recovered = await run();
      assert.equal(recovered.code, 0);
      assert.equal(recovered.result.status, "completed", "restart must reconcile an acknowledged-or-uncertain task, never idle");
      assert.equal(recovered.result.taskId, taskId);
      assert.equal(recovered.result.sha256, createHash("sha256").update(content).digest("hex"));
      assert.equal(recovered.result.bytes, Buffer.byteLength(content));
      assert.equal(recovered.result.signedResultAccepted, true);
      const after = JSON.parse(await readFile(db + ".pc-tasks.json", "utf8")).tasks[0];
      assert.equal(after.history.filter((h: { to: string }) => h.to === "completed").length, 1);
      if (fault === "after-commit") {
        assert.equal(recovered.executions, 0); assert.equal(resultPosts, 1);
        assert.equal(recovered.result.reusedExistingExecution, true);
        assert.notEqual(recovered.result.filesystemExecuted, true);
        assert.equal(recovered.result.executionObservedAt, prior.result.observedAt);
        assert.deepEqual(after, prior);
      } else {
        assert.equal(recovered.executions, 1); assert.equal(resultPosts, 2);
        assert.equal(recovered.result.filesystemExecuted, true);
      }
    } finally {
      proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve()));
      if (broker.exitCode === null && broker.signalCode === null) await stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

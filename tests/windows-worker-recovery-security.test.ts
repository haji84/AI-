import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { validWindowsReport } from "../src/jarvis/windows-worker-journal.ts";
import { WindowsVerificationWorkerClient } from "../src/jarvis/windows-worker-client.ts";
import { validateWindowsVerificationTask } from "../src/jarvis/windows-verification-worker.ts";
import type { JarvisTask } from "../src/jarvis/types.ts";
function task(): JarvisTask {
    const stamp = new Date().toISOString();
    return { id: "job-1", idempotencyKey: "key-1", type: "windows-real-machine-verification", payload: { schema: "jarvis.real-machine.v1", operation: "smoke", payload: { check: "platform" } }, status: "running", targetNodeId: "win-1", assignedNodeId: "win-1", requiredCapabilities: ["windows-tooling"], preferredKinds: ["windows"], requiresOnline: true, priority: "high", attempts: 1, maxAttempts: 1, leaseUntil: new Date(Date.now() + 120000).toISOString(), createdAt: stamp, updatedAt: stamp };
}
function identity() { const k = generateKeyPairSync("ed25519"); return { nodeId: "win-1", privateKeyPem: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), algorithm: "ed25519" as const }; }
const detail = { schema: "jarvis.real-machine-result.v1" as const, operation: "smoke" as const, check: "platform" as const, platform: "win32" as const, nodeVersion: "v24.19.0", outputSha256: "a".repeat(64), checkIds: ["windows-native-process", "platform-win32"] as [
        "windows-native-process",
        "platform-win32"
    ] };
const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { "content-type": "application/json" } });
const beat = () => json({ node: { id: "win-1", kind: "windows", status: "ready", capabilities: ["windows-tooling"] } });
const urlOf = (input: Parameters<typeof fetch>[0]) => new URL(input instanceof Request ? input.url : String(input));
async function inTemp(fn: (dir: string) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), "jarvis-win-recovery-")); try {
    await fn(dir);
}
finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    await rm(dir, { recursive: true, force: true });
} }
test("lost success acknowledgement retains the same outcome across client restart without executing twice", () => inTemp(async (dir) => {
    const id = identity();
    let executions = 0;
    const reports: boolean[] = [];
    const options = { brokerBaseUrl: "http://127.0.0.1:8787", identity: id, journalPath: join(dir, "journal.json"), runtimePlatform: "win32" as const, execute: async () => { executions++; return detail; }, fetchImpl: (async (input, init) => {
            const path = urlOf(input).pathname;
            if (path.endsWith("heartbeat"))
                return beat();
            if (path.endsWith("next"))
                return json({ task: task() });
            const report = JSON.parse(String(init?.body));
            reports.push(report.ok);
            if (reports.length === 1)
                throw new TypeError("response lost after commit");
            return json({ task: { id: "job-1", status: report.ok ? "completed" : "failed" } });
        }) as typeof fetch };
    await assert.rejects(new WindowsVerificationWorkerClient(options).runOnce());
    assert.deepEqual(await new WindowsVerificationWorkerClient(options).runOnce(), { status: "completed", taskId: "job-1" });
    assert.equal(executions, 1);
    assert.deepEqual(reports, [true, true]);
    assert.doesNotMatch(await readFile(options.journalPath, "utf8"), /PRIVATE KEY/);
}));
test("a nonmatching or malformed result acknowledgement cannot claim task completion", async () => {
    for (const payload of [{ ok: true }, { task: { id: "other", status: "completed" } }, { task: { id: "job-1", status: "running" } }]) {
        const client = new WindowsVerificationWorkerClient({ brokerBaseUrl: "http://127.0.0.1:8787", identity: identity(), execute: async () => detail, fetchImpl: async (input) => urlOf(input).pathname.endsWith("heartbeat") ? beat() : urlOf(input).pathname.endsWith("next") ? json({ task: task() }) : json(payload) });
        await assert.rejects(client.runOnce(), /windows_worker_invalid_result_ack/);
    }
});
test("native execution failures use the Broker error field and do not leak host exception text", async () => {
    let report: Record<string, unknown> | undefined;
    const client = new WindowsVerificationWorkerClient({ brokerBaseUrl: "http://127.0.0.1:8787", identity: identity(), execute: async () => { throw new Error("private path/token contents"); }, fetchImpl: async (input, init) => {
            const path = urlOf(input).pathname;
            if (path.endsWith("heartbeat"))
                return beat();
            if (path.endsWith("next"))
                return json({ task: task() });
            report = JSON.parse(String(init?.body));
            return json({ task: { id: "job-1", status: "failed" } });
        } });
    assert.equal((await client.runOnce()).status, "failed");
    assert.deepEqual(report, { taskId: "job-1", ok: false, detail: { schema: "jarvis.real-machine-result.v1", error: "windows_worker_execution_failed" } });
});
test("expired lease and malformed task IDs are rejected before native execution", () => {
    assert.throws(() => validateWindowsVerificationTask({ ...task(), leaseUntil: new Date(Date.now() - 1).toISOString() }, "win-1"), /windows_worker_lease_expired/);
    assert.throws(() => validateWindowsVerificationTask({ ...task(), id: "bad\nidentifier" }, "win-1"), /windows_worker_invalid_task_id/);
    assert.throws(() => validateWindowsVerificationTask({ ...task(), leaseUntil: undefined }, "win-1"), /windows_worker_invalid_lease/);
});
test("signed requests never follow an HTTP redirect to another endpoint", async () => {
    let forwarded = 0;
    const sink = createServer((_q, r) => { forwarded++; r.setHeader("content-type", "application/json"); r.end('{"task":null}'); });
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    const target = "http://127.0.0.1:" + (sink.address() as {
        port: number;
    }).port;
    const server = createServer((_q, r) => { r.writeHead(307, { location: target }); r.end(); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        const client = new WindowsVerificationWorkerClient({ brokerBaseUrl: "http://127.0.0.1:" + (server.address() as {
                port: number;
            }).port, identity: identity() });
        await assert.rejects(client.runOnce());
        assert.equal(forwarded, 0);
    }
    finally {
        server.closeAllConnections();
        sink.closeAllConnections();
        await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => sink.close(() => r()))]);
    }
});
test("disabled Windows worker response stops polling without changing capabilities", async () => {
    const calls: string[] = [];
    let heartbeat: unknown;
    const client = new WindowsVerificationWorkerClient({ brokerBaseUrl: "http://127.0.0.1:8787", identity: identity(), fetchImpl: async (input, init) => { const path = urlOf(input).pathname; calls.push(path); heartbeat = JSON.parse(String(init?.body)); return path.endsWith("heartbeat") ? json({ node: { id: "win-1", kind: "windows", status: "disabled", capabilities: ["windows-tooling"] } }) : json({ task: null }); } });
    await assert.rejects(client.runOnce(), /windows_worker_control_state_blocked/);
    assert.deepEqual(calls, ["/api/jarvis/worker/heartbeat"]);
    assert.deepEqual(heartbeat, { status: "ready", runtime: "windows-verification-v1" });
});
test("interrupted native execution is reported UNKNOWN after restart and is never run a second time", () => inTemp(async (dir) => {
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>(r => entered = r);
    const wait = new Promise<void>(r => finish = r);
    let executions = 0;
    const reports: unknown[] = [];
    const options = { brokerBaseUrl: "http://127.0.0.1:8787", identity: identity(), journalPath: join(dir, "progress.json"), execute: async () => { executions++; entered(); await wait; return detail; }, fetchImpl: (async (input, init) => { const p = urlOf(input).pathname; if (p.endsWith("heartbeat"))
            return beat(); if (p.endsWith("next"))
            return json({ task: task() }); const r = JSON.parse(String(init?.body)); reports.push(r); return json({ task: { id: "job-1", status: r.ok ? "completed" : "failed" } }); }) as typeof fetch };
    const original = new WindowsVerificationWorkerClient(options);
    const originalRun = original.runOnce();
    await started;
    // Capture exactly the on-disk pre-execution state as a crash/restart fixture, not an actual parallel service.
    const restartedOptions = { ...options, journalPath: join(dir, "restart.json") };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(restartedOptions.journalPath, await readFile(options.journalPath));
    const outcome = await new WindowsVerificationWorkerClient(restartedOptions).runOnce();
    assert.deepEqual(outcome, { status: "failed", taskId: "job-1", reason: "windows_worker_interrupted_execution_unknown" });
    assert.equal(executions, 1);
    finish();
    await originalRun;
}));
test("a result journal cannot be reused with another identity or Broker", () => inTemp(async (dir) => {
    const options = { brokerBaseUrl: "http://127.0.0.1:8787", identity: identity(), journalPath: join(dir, "bound.json"), execute: async () => detail, fetchImpl: (async (input) => urlOf(input).pathname.endsWith("heartbeat") ? beat() : urlOf(input).pathname.endsWith("next") ? json({ task: task() }) : json({ task: { id: "job-1", status: "completed" } })) as typeof fetch };
    await new WindowsVerificationWorkerClient(options).runOnce();
    assert.throws(() => new WindowsVerificationWorkerClient({ ...options, identity: identity() }), /windows_worker_invalid_journal/);
    assert.throws(() => new WindowsVerificationWorkerClient({ ...options, brokerBaseUrl: "http://127.0.0.1:9999" }), /windows_worker_invalid_journal/);
}));
test("native contracts reject array-like capabilities and non-string result IDs", () => {
    assert.throws(() => validateWindowsVerificationTask({ ...task(), preferredKinds: { 0: "windows", length: 1 } as unknown as JarvisTask["preferredKinds"] }, "win-1"), /windows_worker_platform_mismatch/);
    assert.equal(validWindowsReport({ ok: true, detail }), false);
    assert.equal(validWindowsReport({ taskId: 123, ok: true, detail }), false);
});
test("response byte budget and body timeout stop stalled or oversized Broker responses", async () => {
    let mode = "oversized";
    const server = createServer((_q, r) => { r.setHeader("content-type", "application/json"); if (mode === "oversized")
        r.end(JSON.stringify({ padding: "x".repeat(129000) }));
    else {
        r.write('{"node":');
    } });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        const client = new WindowsVerificationWorkerClient({ brokerBaseUrl: "http://127.0.0.1:" + (server.address() as {
                port: number;
            }).port, identity: identity(), timeoutMs: 1000 });
        await assert.rejects(client.runOnce(), /windows_worker_response_too_large/);
        mode = "stall";
        const start = Date.now();
        await assert.rejects(client.runOnce());
        assert.ok(Date.now() - start < 3000);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
});


test("definitive Broker expiry preserves rejected evidence and permits the next job",()=>inTemp(async dir=>{
 let reads=0, executions=0;
 const options={brokerBaseUrl:"http://127.0.0.1:8787",identity:identity(),journalPath:join(dir,"expired.json"),execute:async()=>{executions++;return detail;},fetchImpl:(async input=>{
   const p=urlOf(input).pathname;if(p.endsWith("heartbeat"))return beat();if(p.endsWith("next")){reads++;return json({task:reads===1?task():null});}
   return new Response(JSON.stringify({code:"native_lease_expired",task:{id:"job-1",status:"failed"}}),{status:409,headers:{"content-type":"application/json"}});
 }) as typeof fetch};
 assert.deepEqual(await new WindowsVerificationWorkerClient(options).runOnce(),{status:"failed",taskId:"job-1",reason:"windows_worker_result_rejected"});
 const saved=JSON.parse(await readFile(options.journalPath,"utf8"));assert.equal(saved.phase,"rejected");assert.equal(saved.report.ok,true);assert.equal(saved.rejectionCode,"native_lease_expired");
 assert.deepEqual(await new WindowsVerificationWorkerClient(options).runOnce(),{status:"idle"});assert.equal(executions,1);
}));


test("native evidence rejects values that only match after string coercion", () => {
 for (const [field,value] of [["nodeVersion",["v24.19.0"]],["outputSha256",["a".repeat(64)]]]) assert.equal(validWindowsReport({taskId:"job-1",ok:true,detail:{...detail,[field as string]:value}}),false);
 assert.equal(validWindowsReport({taskId:"job-1",ok:false,detail:{schema:"jarvis.real-machine-result.v1",error:["windows_worker_failed"]}}),false);
});


test("transient or mismatched Broker rejection never discards pending execution evidence",()=>inTemp(async dir=>{
 for (const [index,response] of [
  {status:500,body:{code:"native_lease_expired",task:{id:"job-1",status:"failed"}}},
  {status:409,body:{code:"unknown",task:{id:"job-1",status:"failed"}}},
  {status:409,body:{code:"native_lease_expired",task:{id:"another-job",status:"failed"}}},
  {status:409,body:{code:"native_lease_expired",task:{id:"job-1",status:"running"}}}
 ].entries()) {
  const journalPath=join(dir,"uncertain-"+index+".json");
  const client=new WindowsVerificationWorkerClient({brokerBaseUrl:"http://127.0.0.1:8787",identity:identity(),journalPath,execute:async()=>detail,fetchImpl:(async input=>urlOf(input).pathname.endsWith("heartbeat")?beat():urlOf(input).pathname.endsWith("next")?json({task:task()}):new Response(JSON.stringify(response.body),{status:response.status,headers:{"content-type":"application/json"}})) as typeof fetch});
  await assert.rejects(client.runOnce(),/windows_worker_broker_result_failed/);
  const saved=JSON.parse(await readFile(journalPath,"utf8"));assert.equal(saved.phase,"result");assert.equal(saved.report.ok,true);
 }
}));

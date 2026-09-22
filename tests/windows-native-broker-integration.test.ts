import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { WindowsVerificationWorkerClient } from "../src/jarvis/windows-worker-client.ts";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";
test("native Windows client revives an offline identity and preserves signed evidence across Broker restart", { timeout: 30000 }, async () => {
    const fetch = (url: string, init?: RequestInit) => globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    const dir = await mkdtemp(join(tmpdir(), "jarvis-1207-native-"));
    const db = join(dir, "state.sqlite");
    const owner = randomBytes(32).toString("hex");
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const plane = new JarvisControlPlane();
    const stamp = new Date().toISOString();
    for (const [id, kind] of [["win-fixture", "windows"], ["android-fixture", "android"]] as const)
        plane.fleet.register({ id, kind, label: id, status: "offline", capabilities: ["windows-tooling"], enrollment: "full", lastSeenAt: stamp, telemetry: { checkedAt: stamp }, policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true } });
    plane.enqueueTask({ id: "unrelated-job", idempotencyKey: "preserve-unrelated", type: "existing-windows-workflow", payload: {}, requiredCapabilities: ["windows-tooling"], targetNodeId: "win-fixture", preferredKinds: ["windows"], priority: "urgent", requiresOnline: true, maxAttempts: 1 });
    const store = new JarvisSqliteStateStore(db);
    store.save(plane.snapshot());
    for (const id of ["win-fixture", "android-fixture"])
        store.saveWorkerIdentity({ nodeId: id, publicKeyPem, enrolledAt: stamp, algorithm: "ecdsa-p256-sha256" });
    store.close();
    let child: ReturnType<typeof spawn> | undefined;
    let base = "";
    // Reserve an ephemeral local port, retaining the application's actual startup/auth/storage behavior.
    const { createServer } = await import("node:net");
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as {
        port: number;
    }).port;
    await new Promise<void>(r => reservation.close(() => r()));
    const launch = async () => {
        child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], { windowsHide: true, env: { ...process.env, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(dir, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" }, stdio: "ignore" });
        base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 80; i++) {
            try {
                if ((await fetch(base + "/health")).ok)
                    return;
            }
            catch { /* bounded startup */ }
            await new Promise(r => setTimeout(r, 50));
        }
        throw Error("isolated Broker startup failed");
    };
    const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
    } };
    const post = (path: string, payload: unknown, authorized = true) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(authorized ? { Authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(payload) });
    const signed = (id: string, path: string, payload: unknown) => {
        const body = JSON.stringify(payload), unsigned = { nodeId: id, path, method: "POST", timestamp: new Date().toISOString(), nonce: randomBytes(16).toString("hex"), bodySha256: createHash("sha256").update(body).digest("hex") };
        return { method: "POST", body, headers: { "content-type": "application/json", "X-Jarvis-Node-Id": id, "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce, "X-Jarvis-Body-Sha256": unsigned.bodySha256, "X-Jarvis-Signature": sign("sha256", Buffer.from(canonicalWorkerRequest(unsigned)), keys.privateKey).toString("base64") } };
    };
    try {
        await launch();
        const route = "/api/jarvis/admin/windows-verification", body = { targetNodeId: "win-fixture", operation: "smoke", payload: { check: "platform" } };
        assert.equal((await post(route, body, false)).status, 401);
        assert.equal((await post(route, { ...body, targetNodeId: "android-fixture" })).status, 400);
        const queued = await post(route, body);
        assert.equal(queued.status, 201);
        const queuedTask = (await queued.json()).task;
        const next = "/api/jarvis/worker/next";
        assert.equal((await post(next, {}, false)).status, 401);
        const other = await fetch(base + next, signed("android-fixture", next, {}));
        assert.equal((await other.json()).task, null);
        for (const status of ["disabled", "locked", "needs-human"] as const) {
            await stop();
            const stopped = new JarvisSqliteStateStore(db);
            const snapshot = stopped.load()!;
            const win = snapshot.fleet.find(n => n.id === "win-fixture")!;
            win.status = status;
            stopped.save(snapshot);
            stopped.close();
            await launch();
            const heartbeat = "/api/jarvis/worker/heartbeat";
            const before = JSON.stringify({ policy: win.policy, capabilities: win.capabilities });
            const res = await fetch(base + heartbeat, signed("win-fixture", heartbeat, { status: "ready", runtime: "windows-verification-v1", capabilities: ["ui-automation"] }));
            const unchanged = (await res.json()).node;
            assert.equal(unchanged.status, status);
            assert.equal(JSON.stringify({ policy: unchanged.policy, capabilities: unchanged.capabilities }), before);
        }
        await stop();
        const reset = new JarvisSqliteStateStore(db);
        const snap = reset.load()!;
        snap.fleet.find(n => n.id === "win-fixture")!.status = "offline";
        reset.save(snap);
        reset.close();
        await launch();
        const options = { brokerBaseUrl: base, identity: { nodeId: "win-fixture", privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), algorithm: "ecdsa-p256-sha256" as const } };
        let outcome;
        if (process.platform === "win32") {
            const keyPath = join(dir, "test-identity.pem");
            await writeFile(keyPath, options.identity.privateKeyPem);
            const cli = spawn(process.execPath, ["scripts/jarvis-windows-worker-service.ts", "--once"], { windowsHide: true, env: { ...process.env, JARVIS_WINDOWS_WORKER_BROKER_URL: base, JARVIS_WINDOWS_WORKER_NODE_ID: "win-fixture", JARVIS_WINDOWS_WORKER_ALGORITHM: "ecdsa-p256-sha256", JARVIS_WINDOWS_WORKER_PRIVATE_KEY_PATH: keyPath, JARVIS_WINDOWS_WORKER_JOURNAL_PATH: join(dir, "worker-journal.json") }, stdio: ["ignore", "pipe", "pipe"] });
            let output = "";
            cli.stdout.on("data", b => output += b);
            cli.stderr.on("data", b => output += b);
            const timer = setTimeout(() => cli.kill(), 10000);
            const exit = await once(cli, "exit");
            clearTimeout(timer);
            assert.equal(exit[0], 0, output);
            assert.match(output, /status=completed/);
            const env = { ...process.env, JARVIS_WINDOWS_WORKER_BROKER_URL: base, JARVIS_WINDOWS_WORKER_NODE_ID: "win-fixture", JARVIS_WINDOWS_WORKER_ALGORITHM: "ecdsa-p256-sha256", JARVIS_WINDOWS_WORKER_PRIVATE_KEY_PATH: keyPath, JARVIS_WINDOWS_WORKER_JOURNAL_PATH: join(dir, "worker-journal.json") };
            const resident = spawn(process.execPath, ["scripts/jarvis-windows-worker-service.ts"], { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
            let residentLog = "";
            resident.stdout.on("data", b => residentLog += b);
            resident.stderr.on("data", b => residentLog += b);
            const killTimer = setTimeout(() => resident.kill(), 10000);
            try {
                for (let i = 0; i < 100 && !residentLog.includes("started node="); i++)
                    await new Promise(r => setTimeout(r, 20));
                assert.match(residentLog, /started node=/);
                const duplicate = spawn(process.execPath, ["scripts/jarvis-windows-worker-service.ts", "--once"], { windowsHide: true, env: { ...env, JARVIS_WINDOWS_WORKER_JOURNAL_PATH: join(dir, "another-journal.json") }, stdio: ["ignore", "pipe", "pipe"] });
                let duplicateLog = "";
                duplicate.stdout.on("data", b => duplicateLog += b);
                duplicate.stderr.on("data", b => duplicateLog += b);
                const bounded = setTimeout(() => duplicate.kill(), 5000);
                const exited = await once(duplicate, "exit");
                clearTimeout(bounded);
                assert.notEqual(exited[0], 0);
                assert.match(duplicateLog, /windows_worker_journal_in_use/);
            }
            finally {
                clearTimeout(killTimer);
                const exited = once(resident, "exit");
                resident.kill();
                await exited;
            }
            const recovered = spawn(process.execPath, ["scripts/jarvis-windows-worker-service.ts", "--once"], { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
            let recoveredLog = "";
            recovered.stdout.on("data", b => recoveredLog += b);
            recovered.stderr.on("data", b => recoveredLog += b);
            const recoveryTimer = setTimeout(() => recovered.kill(), 5000);
            const recoveredExit = await once(recovered, "exit");
            clearTimeout(recoveryTimer);
            assert.equal(recoveredExit[0], 0, recoveredLog);
            assert.match(recoveredLog, /status=idle/);
            outcome = { status: "completed", taskId: queuedTask.id };
        }
        else {
            outcome = await new WindowsVerificationWorkerClient(options).runOnce();
        }
        assert.equal(outcome.status, process.platform === "win32" ? "completed" : "failed");
        assert.equal("taskId" in outcome ? outcome.taskId : undefined, queuedTask.id);
        const bad = { taskId: queuedTask.id, ok: true, detail: { schema: "jarvis.real-machine-result.v1", operation: "smoke", check: "platform", platform: "linux", nodeVersion: "v24.19.0", outputSha256: "a".repeat(64), checkIds: ["windows-native-process", "platform-win32"] } };
        assert.equal((await fetch(base + "/api/jarvis/worker/result", signed("win-fixture", "/api/jarvis/worker/result", bad))).status, 400);
        for(const detail of [{},{schema:"wrong"},{error:"schema omitted bypass"}])assert.equal((await fetch(base+"/api/jarvis/worker/result",signed("win-fixture","/api/jarvis/worker/result",{taskId:queuedTask.id,ok:false,detail}))).status,400);
        const task = queuedTask;
        const resultPath = "/api/jarvis/worker/result";
        assert.equal((await post(resultPath, { taskId: task.id, ok: true }, false)).status, 401);
        await stop();
        await launch();
        const state = await (await fetch(base + "/api/jarvis/admin/state", { headers: { Authorization: `Bearer ${owner}` } })).json();
        assert.equal(state.tasks.find((t: {
            id: string;
        }) => t.id === task.id).status, process.platform === "win32" ? "completed" : "failed");
        const audit = state.audit.find((e: {
            target: string;
            action: string;
        }) => e.target === task.id && e.action === (process.platform === "win32" ? "task.completed" : "task.failed"));
        assert.ok(audit);
        if (process.platform === "win32")
            assert.match(audit.detail.result.outputSha256, /^[a-f0-9]{64}$/);
        const restarted = new WindowsVerificationWorkerClient(options);
        assert.deepEqual(await restarted.runOnce(), { status: "idle" });
        assert.equal(state.tasks.find((t: {
            id: string;
        }) => t.id === "unrelated-job").status, "queued");
        assert.equal(state.fleet.find((n: {
            id: string;
        }) => n.id === "win-fixture").id, "win-fixture");
        const originalReport = process.platform === "win32" ? JSON.parse(await readFile(join(dir,"worker-journal.json"),"utf8")).report : {taskId:task.id,ok:false,detail:{schema:"jarvis.real-machine-result.v1",error:"windows_worker_not_running_on_windows"}};
        assert.equal((await fetch(base+resultPath,signed("win-fixture",resultPath,originalReport))).status,200,"same outcome gets a fresh-nonce acknowledgement");
        const expiryTask=(await (await post(route,{...body,idempotencyKey:"native-expiry-fixture"})).json()).task;
        const expiryJournal=join(dir,"expired-result.json");
        const expiryOptions={...options,journalPath:expiryJournal,fetchImpl:(async(input,init)=>{
            if(String(input).endsWith(resultPath))throw new Error("simulated network loss before delivery");
            return globalThis.fetch(input,init);
        }) as typeof globalThis.fetch,
        // Linux exercises signed-result reconciliation with a synthetic probe; it is not native Windows evidence.
        ...(process.platform === "win32" ? {} : {execute:async()=>({schema:"jarvis.real-machine-result.v1" as const,operation:"smoke" as const,check:"platform" as const,platform:"win32" as const,nodeVersion:process.version,outputSha256:createHash("sha256").update(JSON.stringify({platform:"win32",node:process.version})+"\n").digest("hex"),checkIds:["windows-native-process","platform-win32"] as ["windows-native-process","platform-win32"]})})};
        await assert.rejects(new WindowsVerificationWorkerClient(expiryOptions).runOnce(),/simulated network loss/);
        await stop();
        const expirationStore=new JarvisSqliteStateStore(db);
        const expirationSnapshot=expirationStore.load()!;
        expirationSnapshot.tasks.find(t=>t.id===expiryTask.id)!.leaseUntil=new Date(Date.now()-1000).toISOString();
        // Match the existing audit retention boundary, without altering production storage or a DB schema.
        for(let i=0;i<1001;i++)expirationSnapshot.audit.push({id:"retention-"+i,at:stamp,actor:"fixture",action:"fixture.retention",target:"fixture"});
        expirationStore.save(expirationSnapshot);expirationStore.close();
        await launch();
        const replay=await fetch(base+resultPath,signed("win-fixture",resultPath,originalReport));
        assert.equal(replay.status,409);const replayBody=await replay.json();assert.equal(replayBody.code,"native_result_unverifiable");assert.equal(replayBody.task.status,process.platform==="win32"?"completed":"failed");
        const recoveredOptions={...expiryOptions,fetchImpl:globalThis.fetch};
        assert.deepEqual(await new WindowsVerificationWorkerClient(recoveredOptions).runOnce(),{status:"failed",taskId:expiryTask.id,reason:"windows_worker_result_rejected"});
        const rejected=JSON.parse(await readFile(expiryJournal,"utf8"));assert.equal(rejected.phase,"rejected");assert.equal(rejected.report.ok,true);assert.equal(rejected.rejectionCode,"native_lease_expired");
        await stop();await launch();
        assert.deepEqual(await new WindowsVerificationWorkerClient(recoveredOptions).runOnce(),{status:"idle"});
        await stop();
        const restored = new JarvisSqliteStateStore(db);
        assert.equal(restored.getWorkerIdentity("win-fixture")?.publicKeyPem, publicKeyPem);
        restored.close();
    }
    finally {
        await stop();
        assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
        await rm(dir, { recursive: true, force: true });
    }
});

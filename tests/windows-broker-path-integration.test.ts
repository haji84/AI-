import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";

test("real Broker HTTP path dispatches a pinned Windows job, verifies signed result and persists restart", { timeout: 30_000 }, async () => {
 const fetch = (url: string, init?: RequestInit) => globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
 const dir = await mkdtemp(join(tmpdir(), "jarvis-1188-broker-"));
 const db = join(dir, "state.sqlite");
 const owner = randomBytes(32).toString("hex");
 const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
 const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
 const plane = new JarvisControlPlane();
 const stamp = new Date().toISOString();
 for (const [id, kind] of [["win-fixture", "windows"], ["android-fixture", "android"]] as const) plane.fleet.register({ id, kind, label: id, status: "ready", capabilities: ["windows-tooling"], enrollment: "full", lastSeenAt: stamp, telemetry: { checkedAt: stamp }, policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false, allowRemoteControl: false, requireHumanForLockedDevice: true } });
 const store = new JarvisSqliteStateStore(db);
 store.save(plane.snapshot());
 for (const id of ["win-fixture", "android-fixture"]) store.saveWorkerIdentity({ nodeId: id, publicKeyPem, enrolledAt: stamp, algorithm: "ecdsa-p256-sha256" });
 store.close();
 let child: ReturnType<typeof spawn> | undefined;
 let base = "";
 // Reserve an ephemeral local port, retaining the application's actual startup/auth/storage behavior.
 const { createServer } = await import("node:net");
 const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
 const port = (reservation.address() as { port: number }).port;
 await new Promise<void>(r => reservation.close(() => r()));
 const launch = async () => {
  child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], { windowsHide: true, env: { ...process.env, JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(dir,"compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" }, stdio: "ignore" });
  base = `http://127.0.0.1:${port}`;
  for (let i=0;i<80;i++) { try { if ((await fetch(base+"/health")).ok) return; } catch { /* bounded startup */ } await new Promise(r=>setTimeout(r,50)); }
  throw Error("isolated Broker startup failed");
 };
 const stop = async () => { if(child && child.exitCode===null && child.signalCode===null) { const exited=once(child,"exit");child.kill();await exited; } };
 const post = (path: string, payload: unknown, authorized=true) => fetch(base+path,{method:"POST",headers:{"content-type":"application/json",...(authorized?{Authorization:`Bearer ${owner}`}:{})},body:JSON.stringify(payload)});
 const signed = (id: string, path: string, payload: unknown) => {
  const body=JSON.stringify(payload), unsigned={nodeId:id,path,method:"POST",timestamp:new Date().toISOString(),nonce:randomBytes(16).toString("hex"),bodySha256:createHash("sha256").update(body).digest("hex")};
  return {method:"POST",body,headers:{"content-type":"application/json","X-Jarvis-Node-Id":id,"X-Jarvis-Timestamp":unsigned.timestamp,"X-Jarvis-Nonce":unsigned.nonce,"X-Jarvis-Body-Sha256":unsigned.bodySha256,"X-Jarvis-Signature":sign("sha256",Buffer.from(canonicalWorkerRequest(unsigned)),keys.privateKey).toString("base64")}};
 };
 try {
  await launch();
  const route="/api/jarvis/admin/windows-verification", body={targetNodeId:"win-fixture",operation:"smoke",payload:{check:"platform"}};
  assert.equal((await post(route,body,false)).status,401);
  assert.equal((await post(route,{...body,targetNodeId:"android-fixture"})).status,400);
  const queued=await post(route,body);assert.equal(queued.status,201);const queuedTask=(await queued.json()).task;
  const next="/api/jarvis/worker/next";
  assert.equal((await post(next,{},false)).status,401);
  const other=await fetch(base+next,signed("android-fixture",next,{}));assert.equal((await other.json()).task,null);
  const delivered=await fetch(base+next,signed("win-fixture",next,{}));const task=(await delivered.json()).task;
  assert.equal(task.id,queuedTask.id);assert.equal(task.targetNodeId,"win-fixture");assert.equal(task.maxAttempts,1);
  // Real local read-only process, test-only worker adapter. No production Worker transport is claimed.
  const output=execFileSync(process.execPath,["-p","JSON.stringify({platform:process.platform,node:process.version})"],{encoding:"utf8",timeout:5000,windowsHide:true});
  assert.equal(JSON.parse(output).platform,process.platform);
  const outputSha256=createHash("sha256").update(output).digest("hex");
  const resultPath="/api/jarvis/worker/result";
  const result=signed("win-fixture",resultPath,{taskId:task.id,ok:true,detail:{outputSha256,platform:process.platform,simulatedWorker:true}});
  assert.equal((await post(resultPath,{taskId:task.id,ok:true},false)).status,401);
  const complete=await fetch(base+resultPath,result);assert.equal(complete.status,200);assert.equal((await complete.json()).task.status,"completed");
  assert.equal((await fetch(base+resultPath,result)).status,401);
  await stop();await launch();
  const state=await (await fetch(base+"/api/jarvis/admin/state",{headers:{Authorization:`Bearer ${owner}`}})).json();
  assert.equal(state.tasks.find((t:{id:string})=>t.id===task.id).status,"completed");
  assert.equal(state.fleet.find((n:{id:string})=>n.id==="win-fixture").id,"win-fixture");
  assert.equal((await fetch(base+resultPath,result)).status,401,"nonce replay remains denied after Broker restart");
  await stop();
  const restored=new JarvisSqliteStateStore(db);assert.equal(restored.getWorkerIdentity("win-fixture")?.publicKeyPem,publicKeyPem);restored.close();
 } finally { await stop();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true}); }
});

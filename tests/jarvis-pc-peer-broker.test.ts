import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { JarvisSqliteStateStore } from "../src/jarvis/sqlite-state-store.ts";
import { JarvisControlPlane } from "../src/jarvis/control-plane.ts";
import { registerLocalPc, executeRemotePcWork } from "../src/jarvis/pc-bootstrap.ts";
import { privatePcRelay } from "../src/jarvis/private-pc-transport.ts";
import { publicPcDescriptor, pcPublicFingerprint, requestPeerPcEnrollment, signPeerPcEnrollment, completePeerPcEnrollment } from "../src/jarvis/pc-peer-bootstrap.ts";
import type { PcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";

test("two real Brokers retain Android38 and existing keys while proving mutual PCs, then accept a signed moved-network task", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(),"pc-pair-broker-")), revision = "a".repeat(40);
  const identity = (nodeId: "macbook" | "zbook"): PcLocalIdentity => {
    const key = generateKeyPairSync("ed25519");
    return { version: 1, nodeId, platform: nodeId === "macbook" ? "macos" : "windows", algorithm: "ed25519",
      hostBinding: "b".repeat(64), createdAt: new Date().toISOString(),
      publicKeyPem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  };
  const mac = identity("macbook"), win = identity("zbook");
  const prepare = async (name: string) => {
    const db = join(dir,name + ".sqlite"), store = new JarvisSqliteStateStore(db), plane = new JarvisControlPlane();
    const enrollment = plane.createEnrollment({ mode: "fleet", maxDevices: 38 });
    for (let n = 0; n < 38; n++) {
      const id = "android-" + name + "-" + n, now = new Date().toISOString();
      plane.enroll(enrollment.token, { id, label: id, kind: "android", status: "offline", capabilities: ["open-url"],
        policy: { allowPaidServices: false, allowDestructiveActions: false, allowExternalPublication: false,
          allowRemoteControl: false, requireHumanForLockedDevice: true }, telemetry: { checkedAt: now },
        enrollment: "quick", lastSeenAt: now });
      store.saveWorkerIdentity({ nodeId: id, publicKeyPem: "retained-public-fixture", enrolledAt: now });
    }
    store.save(plane.snapshot()); store.close();
    const now = Date.now();
    await writeFile(db + ".pc-enrollment-approval.json", JSON.stringify({ version: 1, issue: 1662, goalIssue: 1219,
      approvedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
      targets: [{ nodeId: "macbook", platform: "macos" },{ nodeId: "zbook", platform: "windows" }],
      roles: ["Executor","Storage","Verifier","Coordinator"] }), { mode: 0o600 });
    const socket = createServer(); socket.listen(0,"127.0.0.1"); await once(socket,"listening");
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const owner = randomUUID(), base = "http://127.0.0.1:" + port;
    const child = spawn(process.execPath,["scripts/jarvis-broker.ts"], { stdio: "ignore", env: { ...process.env,
      GORIQ_RUNTIME_REVISION: revision, GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port),
      JARVIS_OWNER_TOKEN: owner, JARVIS_DB_PATH: db, JARVIS_COMPASS_DB_PATH: join(dir,name + ".compass"),
      JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" } });
    return { db, base, owner, child };
  };
  const hosts: Awaited<ReturnType<typeof prepare>>[] = [];
  const snapshot = (host: Awaited<ReturnType<typeof prepare>>) => {
    const store = new JarvisSqliteStateStore(host.db);
    try { return { fleet: store.load()!.fleet, identities: store.listWorkerIdentities() }; } finally { store.close(); }
  };
  try {
    hosts.push(await prepare("mac"),await prepare("win")); const [m,w] = hosts;
    for (const host of hosts) {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try { if ((await fetch(host.base + "/health")).ok) { ready = true; break; } } catch { /* bounded fixture startup */ }
        await new Promise(resolve => setTimeout(resolve,50));
      }
      assert.ok(ready,"real Broker unavailable");
    }
    await registerLocalPc({ base: m.base, revision, ownerToken: m.owner, identity: mac });
    await registerLocalPc({ base: w.base, revision, ownerToken: w.owner, identity: win });
    const before = hosts.map(snapshot), md = publicPcDescriptor(mac,revision), wd = publicPcDescriptor(win,revision);
    const winOffer = await requestPeerPcEnrollment({ base: w.base, revision, ownerToken: w.owner, identity: win,
      peer: md, expectedPeerFingerprint: pcPublicFingerprint(mac.publicKeyPem) });
    const macProof = signPeerPcEnrollment({ envelope: winOffer, identity: mac, revision, expectedCoordinatorFingerprint: wd.fingerprint });
    const macOffer = await requestPeerPcEnrollment({ base: m.base, revision, ownerToken: m.owner, identity: mac,
      peer: wd, expectedPeerFingerprint: wd.fingerprint });
    await completePeerPcEnrollment({ base: w.base, revision, ownerToken: w.owner, identity: win, peer: md,
      expectedPeerFingerprint: md.fingerprint, envelope: winOffer, proof: macProof });
    const winProof = signPeerPcEnrollment({ envelope: macOffer, identity: win, revision, expectedCoordinatorFingerprint: md.fingerprint });
    await completePeerPcEnrollment({ base: m.base, revision, ownerToken: m.owner, identity: mac, peer: wd,
      expectedPeerFingerprint: wd.fingerprint, envelope: macOffer, proof: winProof });
    await assert.rejects(() => completePeerPcEnrollment({ base: m.base, revision, ownerToken: m.owner, identity: mac, peer: wd,
      expectedPeerFingerprint: wd.fingerprint, envelope: macOffer, proof: winProof }), /PROOF_REJECTED/);
    const paired = hosts.map(snapshot);
    for (let i = 0; i < hosts.length; i++) {
      assert.equal(paired[i].fleet.length,40); assert.equal(paired[i].identities.length,40);
      assert.deepEqual(paired[i].fleet.filter(n => n.kind === "android"),before[i].fleet.filter(n => n.kind === "android"));
      for (const old of before[i].identities) assert.deepEqual(paired[i].identities.find(n => n.nodeId === old.nodeId),old);
    }
    const savedPeer = paired[0].identities.find(n => n.nodeId === "zbook")!;
    const existing = { node: paired[0].fleet.find(n => n.id === "zbook")!, identity: savedPeer };
    const retry = await requestPeerPcEnrollment({ base: m.base, revision, ownerToken: m.owner, identity: mac,
      peer: wd, expectedPeerFingerprint: wd.fingerprint, existing });
    assert.equal(retry.mode,"already-enrolled");
    const retryProof = signPeerPcEnrollment({ envelope: retry, identity: win, revision, expectedCoordinatorFingerprint: md.fingerprint });
    assert.equal((await completePeerPcEnrollment({ base: m.base, revision, ownerToken: m.owner, identity: mac, peer: wd,
      expectedPeerFingerprint: wd.fingerprint, envelope: retry, proof: retryProof })).alreadyEnrolled,true);
    assert.deepEqual(snapshot(m).identities,paired[0].identities);
    // Real signed worker/claims/file/result; transport is controlled and does
    // not establish actual native TLS/private Serve or physical Wi-Fi acceptance.
    const content = "PUBLIC peer task after mutual enrollment";
    const work = { idempotencyKey: "peer-proof-" + randomUUID(), goalIssue: 1219, targetNodeId: "zbook", privacyClass: "PUBLIC", content,
      capsule: { goal: "#1219", currentJob: "#1662 mutual PC peer task", why: "Verify registered peer file execution",
        workflowPosition: "mutual proof -> private assignment -> file -> signed result", inputs: ["PUBLIC fixture"],
        constraints: ["filesystem only","no private data","preserve Android38"], decisions: ["existing fenced claim"],
        dependencies: ["mutual enrolled keys"], expectedOutput: ["verified digest"], definitionOfDone: ["signed result accepted"],
        verificationContract: "Broker recomputes SHA256 and checks active claim", recoveryContext: ["retain key and task"] } };
    const submitted = await fetch(m.base + "/api/jarvis/admin/pc-tasks",{ method: "POST", headers: {
      "Content-Type": "application/json", Authorization: "Bearer " + m.owner }, body: JSON.stringify(work) });
    assert.equal(submitted.status,201); const taskId = (await submitted.json()).task.id;
    const peer = paired[0].identities.find(n => n.nodeId === "macbook")!;
    let online = false;
    const relay = privatePcRelay({ ingress: async () => online, signer: async () => ({ identity: mac, revision }),
      upstream: async (url, options) => fetch(m.base + new URL(String(url)).pathname,options) });
    const request: typeof fetch = async (url,options) => relay(new Request(url,options));
    const input = { base: "https://macbook.tailfixture.ts.net", tailnetDomain: "tailfixture.ts.net", revision,
      identity: win, peer, request, taskId };
    await assert.rejects(() => executeRemotePcWork(input), /PEER_PROOF/); online = true;
    const result = await executeRemotePcWork(input);
    assert.equal(result.status,"completed"); assert.equal(result.filesystemExecuted,true); assert.equal(result.signedResultAccepted,true);
    assert.equal(result.sha256,createHash("sha256").update(content).digest("hex"));
    assert.deepEqual(snapshot(m).identities,paired[0].identities);
    assert.deepEqual(snapshot(m).fleet.filter(n => n.kind === "android"),before[0].fleet.filter(n => n.kind === "android"));
  } finally {
    for (const host of hosts) if (host.child.exitCode === null && host.child.signalCode === null) {
      const exited = once(host.child,"exit"); host.child.kill(); await exited;
    }
    await rm(dir,{ recursive: true, force: true });
  }
});

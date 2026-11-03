import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runDailyDriverLiveE2E } from "../scripts/goriq-daily-driver-live-e2e.mjs";

test("daily driver live e2e accepts safe device-status and waits for physical completion", async () => {
  let stateReads = 0;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-token");
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/api/jarvis/admin/work") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.text, "端末の状態を確認して");
        assert.match(parsed.idempotencyKey, /^daily-driver-live-/);
        res.statusCode = 202;
        res.end(JSON.stringify({accepted:true,executionScheduled:true,action:"DEVICE_ACTION",task:{id:"task-1",type:"device-status",status:"queued"}}));
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/jarvis/admin/state") {
      stateReads++;
      const status = stateReads < 2 ? "running" : "completed";
      res.end(JSON.stringify({
        stats:{registered:1},
        fleet:[{id:"android-1",kind:"android",status:"ready",capabilities:["device-status"],lastSeenAt:new Date().toISOString()}],
        tasks:[{id:"task-1",type:"device-status",status,targetNodeId:"android-1",detail:{ok:true}}]
      }));
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
  server.listen(0, "127.0.0.1"); await once(server,"listening");
  const address = server.address(); if (!address || typeof address === "string") throw Error("bad server");
  try {
    const evidence = await runDailyDriverLiveE2E({
      baseUrl:`http://127.0.0.1:${address.port}`,
      token:"test-token",
      runId:"123",
      runAttempt:"1",
      pollMs:10,
      timeoutMs:1000,
    });
    assert.equal(evidence.status,"PHYSICAL_DEVICE_ACTION_COMPLETED");
    assert.equal(evidence.task.type,"device-status");
    assert.equal(evidence.task.status,"completed");
    assert.match(evidence.task.targetNodeHash,/^[a-f0-9]{16}$/);
    assert.equal(JSON.stringify(evidence).includes("test-token"),false);
  } finally {
    server.close();
  }
});

test("daily driver live e2e rejects non-loopback broker", async () => {
  await assert.rejects(
    runDailyDriverLiveE2E({baseUrl:"https://example.com",token:"x",runId:"1",runAttempt:"1",pollMs:1,timeoutMs:10}),
    /loopback/
  );
});


test("daily driver live e2e fails before enqueue when no fresh eligible Android exists", async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/api/jarvis/admin/state") {
      res.end(JSON.stringify({
        stats:{registered:2},
        fleet:[
          {id:"android-old",kind:"android",status:"ready",capabilities:["device-status"],lastSeenAt:"2020-01-01T00:00:00.000Z"},
          {id:"mac",kind:"macos",status:"ready",capabilities:["filesystem"],lastSeenAt:new Date().toISOString()}
        ],
        tasks:[]
      }));
      return;
    }
    if (req.method === "POST") { posts++; res.statusCode=500; res.end("{}"); return; }
    res.statusCode=404; res.end("{}");
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const address=server.address(); if(!address||typeof address==="string") throw Error("bad server");
  try {
    await assert.rejects(
      runDailyDriverLiveE2E({
        baseUrl:`http://127.0.0.1:${address.port}`,
        token:"test-token",runId:"124",runAttempt:"1",pollMs:10,timeoutMs:1000,freshnessMs:60_000
      }),
      /no fresh eligible Android/
    );
    assert.equal(posts,0);
  } finally { server.close(); }
});


test("daily driver live workflow continues after successful secure fleet migration on main", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/goriq-daily-driver-live-e2e.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\['GORIQ Secure Fleet DB Migration'\]/);
  assert.match(workflow, /types:\s*\[completed\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";

test("Direct Goal Bridge Broker startup diagnostic", { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "goriq-bridge-startup-"));
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port; await new Promise<void>(r => server.close(() => r()));
  const child = spawn(process.execPath, ["scripts/jarvis-broker.ts"], {
    env: { ...process.env, GITHUB_TOKEN: "", JARVIS_BROKER_HOST: "127.0.0.1", JARVIS_BROKER_PORT: String(port), JARVIS_OWNER_TOKEN: "test-owner-token-bridge", JARVIS_DB_PATH: join(dir, "state.sqlite"), JARVIS_COMPASS_DB_PATH: join(dir, "compass.sqlite"), JARVIS_PUBLIC_BROKER_URL: "", JARVIS_WORKER_INSTALL_URL: "", JARVIS_WORKER_APK_PATH: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let stderr = ""; child.stderr?.on("data", chunk => { stderr += String(chunk); });
  try {
    let healthy = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).ok) { healthy = true; break; } } catch { /* bounded startup probe */ }
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(healthy, true, `Broker failed to start: ${stderr.slice(-6000)}`);
    const body = { text: "Complete code in tests/fixtures/autonomous-builder-e2e.txt. Make its complete content exactly: beta.", idempotencyKey: "bridge-status-e2e", goalContract: { successCriteria: ["tests/fixtures/autonomous-builder-e2e.txt contains beta"] } };
    const headers = { Authorization: "Bearer test-owner-token-bridge", "content-type": "application/json" };
    const accepted = await fetch(`http://127.0.0.1:${port}/api/jarvis/admin/work`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(accepted.status, 202);
    const receipt = await accepted.json() as { goalId: string; executionScheduled: boolean };
    assert.ok(receipt.goalId);
    assert.equal(receipt.executionScheduled, true);
    const status = await fetch(`http://127.0.0.1:${port}/api/jarvis/admin/work/${encodeURIComponent(receipt.goalId)}`, { headers });
    assert.equal(status.status, 200, "accepted Bridge Goal must have a durable readable Work Run");
    const replay = await (await fetch(`http://127.0.0.1:${port}/api/jarvis/admin/work`, { method: "POST", headers, body: JSON.stringify(body) })).json() as { goalId: string };
    assert.equal(replay.goalId, receipt.goalId);
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    rmSync(dir, { recursive: true, force: true });
  }
});

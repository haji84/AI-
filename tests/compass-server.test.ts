import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

interface RpcResponse {
  id: number;
  result?: {
    protocolVersion?: string;
    tools?: { name: string }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

function rpc(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

test("Compass stdio adapter initializes, lists tools, and persists a goal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compass-server-"));
  const dbPath = join(dir, "compass.db");
  const child = spawn(process.execPath, ["src/compass/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, COMPASS_DB_PATH: dbPath },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses: RpcResponse[] = [];
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line) as RpcResponse);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.write(rpc(1, "initialize", { protocolVersion: "2025-11-25" }));
  child.stdin.write(rpc(2, "tools/list", {}));
  child.stdin.write(
    rpc(3, "tools/call", {
      name: "set_goal",
      arguments: { title: "Compass works", successCriteria: ["persist"] },
    }),
  );
  child.stdin.write(rpc(4, "tools/call", { name: "get_goal", arguments: {} }));
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  try {
    assert.equal(exitCode, 0, stderr);
    assert.equal(responses.length, 4, stderr);
    assert.equal(responses[0]?.result?.protocolVersion, "2025-11-25");
    assert.equal(responses[1]?.result?.tools?.length, 9);
    assert.equal(responses[1]?.result?.tools?.[0]?.name, "get_goal");
    assert.equal(responses[2]?.result?.isError, false);
    const setGoalText = responses[2]?.result?.content?.[0]?.text ?? "";
    assert.equal((JSON.parse(setGoalText) as { title: string }).title, "Compass works");
    const getGoalText = responses[3]?.result?.content?.[0]?.text ?? "";
    assert.equal((JSON.parse(getGoalText) as { title: string }).title, "Compass works");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

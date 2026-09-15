import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JarvisRemoteAssistAuditStore } from "../src/jarvis/remote-assist-audit.ts";
import type { JarvisRemoteAssistAuditEvent } from "../src/jarvis/remote-assist.ts";

function event(index: number, detail?: Record<string, unknown>): JarvisRemoteAssistAuditEvent {
  return {
    id: `audit-${index}`,
    at: new Date(1_700_000_000_000 + index).toISOString(),
    action: "action.forwarded",
    sessionId: "session-1",
    serial: "android-001",
    detail,
  };
}

test("durable Remote Assist audit survives a new store instance and strips sensitive detail", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
  const path = join(root, "remote-assist.jsonl");
  try {
    const store = new JarvisRemoteAssistAuditStore(path, 100, 64 * 1024);
    store.append(event(1, {
      action: "text",
      outcome: "ok",
      text: "do-not-persist",
      url: "https://sensitive.example/path",
      token: "secret-token",
      password: "secret-password",
    }));

    const restarted = new JarvisRemoteAssistAuditStore(path, 100, 64 * 1024);
    const rows = restarted.list("session-1");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].detail, { action: "text", outcome: "ok" });
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("do-not-persist"), false);
    assert.equal(raw.includes("sensitive.example"), false);
    assert.equal(raw.includes("secret-token"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("durable Remote Assist audit keeps bounded retained history", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
  const path = join(root, "remote-assist.jsonl");
  try {
    const store = new JarvisRemoteAssistAuditStore(path, 3, 1024);
    for (let index = 0; index < 20; index += 1) {
      store.append(event(index, { outcome: "ok", filler: "x".repeat(160) }));
    }
    const rows = store.list("session-1", 100);
    assert(rows.length <= 6, `expected compacted audit, got ${rows.length}`);
    assert.equal(rows.at(-1)?.id, "audit-19");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

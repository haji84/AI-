import assert from "node:assert/strict";
import test from "node:test";
import {
  inferBridgeSurface,
  requestsFreshSurface,
  selectBridgeSession,
  upsertBridgeSession,
} from "../src/orchestrator/chat-work-session-router.ts";

const registry = {
  version: 1 as const,
  project: "自動化",
  sessions: [
    { project: "自動化", surface: "chat" as const, url: "https://chatgpt.com/c/chat-general", goalId: null, lastUsedAt: "2026-09-30T00:00:00Z" },
    { project: "自動化", surface: "chat" as const, url: "https://chatgpt.com/c/chat-goal", goalId: "goal-1", lastUsedAt: "2026-09-30T01:00:00Z" },
    { project: "自動化", surface: "work" as const, url: "https://chatgpt.com/c/work-general", goalId: null, lastUsedAt: "2026-09-30T00:30:00Z" },
  ],
};

test("routine requests reuse project Chat instead of creating a new conversation", () => {
  const decision = selectBridgeSession({ text: "現在の状態を確認して" }, registry);
  assert.equal(decision.surface, "chat");
  assert.equal(decision.reuse, true);
  assert.equal(decision.createNew, false);
  assert.equal(decision.session?.url, "https://chatgpt.com/c/chat-general");
});

test("same goal reuses its existing project surface", () => {
  const decision = selectBridgeSession({ text: "続きを進めて", goalId: "goal-1" }, registry);
  assert.equal(decision.session?.url, "https://chatgpt.com/c/chat-goal");
  assert.equal(decision.createNew, false);
});

test("multi-source and long-running work routes to Work and reuses it", () => {
  assert.equal(inferBridgeSurface({ text: "複数資料を調べて長時間作業して", sourceCount: 4 }), "work");
  const decision = selectBridgeSession({ text: "複数資料を調べて長時間作業して", sourceCount: 4 }, registry);
  assert.equal(decision.surface, "work");
  assert.equal(decision.session?.url, "https://chatgpt.com/c/work-general");
});

test("new conversations are exceptional and explicit", () => {
  assert.equal(requestsFreshSurface({ text: "新しいチャットで始めて" }), true);
  const decision = selectBridgeSession({ text: "新しいチャットで始めて" }, registry);
  assert.equal(decision.reuse, false);
  assert.equal(decision.createNew, true);
});

test("missing valid project surface permits one new project conversation", () => {
  const decision = selectBridgeSession({ text: "普通の依頼" }, { version: 1, project: "自動化", sessions: [] });
  assert.equal(decision.createNew, true);
  assert.equal(decision.reason, "no valid project-scoped surface exists");
});

test("registry keeps one session per surface and goal affinity", () => {
  const next = upsertBridgeSession(registry, {
    project: "自動化",
    surface: "chat",
    url: "https://chatgpt.com/c/chat-goal-new",
    goalId: "goal-1",
    lastUsedAt: "2026-09-30T02:00:00Z",
  });
  assert.equal(next.sessions.filter((item) => item.surface === "chat" && item.goalId === "goal-1").length, 1);
  assert.equal(next.sessions[0].url, "https://chatgpt.com/c/chat-goal-new");
});

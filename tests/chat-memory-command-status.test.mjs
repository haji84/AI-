import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers";
import { URL } from "node:url";
import { Script } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let nextTimer = 0;
  let heldRead = null;
  const timers = new Map();
  const calls = [];
  const messages = new Map([[41, []], [42, [{ id: "other", role: "system", text: "別の会話", createdAt: "2026-11-27T00:00:00.000Z" }]]]);
  const conversations = [41, 42].map((id) => ({ id, title: `会話${id}`, pinned: false, project: null, createdAt: "2026-11-27T00:00:00.000Z", updatedAt: "2026-11-27T00:00:00.000Z" }));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return hooks[index] ??= { current: initial };
    },
    useMemo: (fn) => fn(),
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!deps || !previous || deps.some((value, i) => value !== previous.deps?.[i])) {
        previous?.cleanup?.();
        const effect = { deps };
        hooks[index] = effect;
        effects.push(() => { effect.cleanup = fn(); });
      }
    },
  };
  const window = {
    addEventListener() {}, removeEventListener() {},
    setInterval(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms, once: true }); return id; },
  };
  async function fetch(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method ?? "GET", body });
    let result;
    if (url === "/api/conversations" && !body) result = { conversations };
    else if (url.startsWith("/api/conversations?id=")) {
      if (heldRead) { const read = heldRead; heldRead = null; return await read; }
      const id = Number(url.split("=")[1]);
      result = { ...conversations.find((item) => item.id === id), messages: [...messages.get(id)], memoryContext: `memory-${id}` };
    } else if (body?.action === "message") {
      const message = { ...body, id: `${body.role}-canonical-${calls.length}`, createdAt: new Date().toISOString() };
      messages.get(body.conversationId).push(message);
      result = { message, conversationId: body.conversationId, memoryContext: `memory-${body.conversationId}` };
    } else if (url === "/api/command" && body) result = { message: "受付済み", acceptedAt: new Date().toISOString() };
    else if (url === "/api/command") result = { status: "RUNNING", generatedAt: new Date().toISOString(), riskLevel: "LOW", nextAction: "確認", humanGateRequired: false, decisionCount: 0, reply: "全体の実行状態です" };
    else throw new Error(`Unexpected test request: ${url}`);
    return { ok: true, json: async () => result };
  }
  const filename = new URL("../src/app/CommandChat.tsx", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const load = (name) => name === "react" ? react
    : name === "react/jsx-runtime" ? { jsx, jsxs: jsx }
      : name === "./jarvis/voice-output" ? { playGoriqLocalVoice: async () => ({ ok: true, engine: "test" }) }
        : name.startsWith("./chat-memory") ? require("../src/app/chat-memory.ts") : require(name);
  new Script(`(function(require,module,exports,window,fetch){${compiled}\n})`).runInThisContext()(load, module, module.exports, window, fetch);
  let tree;
  function render() {
    cursor = 0;
    tree = module.exports.default({ enabled: true });
    const queued = effects; effects = [];
    queued.forEach((effect) => effect());
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const text = () => JSON.stringify(tree);
  async function settle() { await flush(); render(); await flush(); render(); }
  async function open(id) {
    nodes(tree).find((node) => node.type === "button" && node.props.className === "chat-conversation-main" && JSON.stringify(node).includes(`会話${id}`)).props.onClick();
    await settle();
  }
  async function send() {
    nodes(tree).find((node) => node.type === "textarea").props.onChange({ target: { value: "調査して完成させて" } }); render();
    nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    await settle();
  }
  async function tick(ms) {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) { if (timer.once) timers.delete(id); timer.fn(); }
    await settle();
  }
  render();
  return { calls, messages, timers, text, settle, open, send, tick, hold(read) { heldRead = read; } };
}

test("normal command status is saved as system history while reply polling waits for the saved owner", async () => {
  const ui = harness(); await ui.settle(); await ui.open(41); await ui.send(); await ui.tick(1800);
  const status = ui.calls.find((call) => call.body?.text === "全体の実行状態です");
  assert.equal(status?.body?.role, "system");
  assert.ok(ui.text().includes("全体の実行状態です"));
  const owner = ui.messages.get(41).find((message) => message.role === "owner");
  const statusReply = { id: "legacy-status", role: "ai", text: "状態確認のみ", meta: "状態: RUNNING / リスク: LOW / Human Gate: なし", createdAt: owner.createdAt };
  ui.messages.get(41).push(statusReply);
  await ui.tick(4000);
  assert.equal([...ui.timers.values()].filter((timer) => timer.ms === 4000).length, 1);
  ui.messages.get(41).push({ id: "actual-answer", role: "ai", text: "調査の回答", createdAt: new Date().toISOString() });
  await ui.tick(4000);
  assert.equal([...ui.timers.values()].filter((timer) => timer.ms === 4000).length, 0);
  assert.ok(ui.text().includes("調査の回答"));
  assert.equal(ui.calls.filter((call) => call.url === "/api/command" && call.method === "POST").length, 1);
  assert.equal(ui.calls.filter((call) => call.body?.role === "owner").length, 1);
});

test("an in-flight conversation reply cannot replace a newly selected conversation", async () => {
  const ui = harness(); await ui.settle(); await ui.open(41); await ui.send();
  let resolveRead;
  ui.hold(new Promise((resolve) => { resolveRead = resolve; }));
  await ui.tick(4000);
  await ui.open(42);
  resolveRead({ ok: true, json: async () => ({ id: 41, messages: [{ id: "late", role: "ai", text: "旧会話の遅延回答", createdAt: new Date().toISOString() }], memoryContext: "memory-41" }) });
  await ui.settle();
  assert.ok(ui.text().includes("別の会話"));
  assert.ok(!ui.text().includes("旧会話の遅延回答"));
});

test("a prior polling request cannot acknowledge a newer owner turn in the same conversation", async () => {
  const ui = harness(); await ui.settle(); await ui.open(41); await ui.send();
  const firstOwner = ui.messages.get(41).find((message) => message.role === "owner");
  let resolveRead;
  ui.hold(new Promise((resolve) => { resolveRead = resolve; }));
  await ui.tick(4000);
  await ui.send();
  resolveRead({ ok: true, json: async () => ({ id: 41, messages: [firstOwner, { id: "prior-answer", role: "ai", text: "前の指示への回答", createdAt: new Date().toISOString() }], memoryContext: "old-memory" }) });
  await ui.settle();
  assert.equal([...ui.timers.values()].filter((timer) => timer.ms === 4000).length, 1);
  assert.ok(!ui.text().includes("前の指示への回答"));
  assert.equal(ui.calls.filter((call) => call.url === "/api/command" && call.method === "POST").length, 2);
});

for (const [name, response] of [
  ["failed", { ok: false, json: async () => ({ message: "会話の読込失敗" }) }],
  ["invalid", { ok: true, json: async () => ({ id: 99, messages: [], memoryContext: "invalid-memory" }) }],
]) {
  test(`${name} conversation open keeps the displayed conversation as the next command target`, async () => {
    const ui = harness(); await ui.settle();
    ui.messages.get(41).push({ id: "existing-41", role: "system", text: "元の会話の履歴", createdAt: "2026-11-27T00:00:00.000Z" });
    await ui.open(41);
    ui.hold(Promise.resolve(response));
    await ui.open(42);
    assert.ok(ui.text().includes("元の会話の履歴"));
    await ui.send();
    assert.equal(ui.calls.findLast((call) => call.body?.role === "owner").body.conversationId, 41);
    assert.equal(ui.calls.findLast((call) => call.url === "/api/command" && call.method === "POST").body.conversationId, 41);
  });
}

test("a superseded successful conversation open cannot replace the newer selected conversation", async () => {
  const ui = harness(); await ui.settle(); await ui.open(41);
  let resolveRead;
  ui.hold(new Promise((resolve) => { resolveRead = resolve; }));
  await ui.open(41);
  await ui.open(42);
  resolveRead({ ok: true, json: async () => ({ id: 41, messages: [{ id: "stale-open", role: "system", text: "古い読込結果", createdAt: "2026-11-27T00:00:00.000Z" }], memoryContext: "memory-41" }) });
  await ui.settle();
  assert.ok(ui.text().includes("別の会話"));
  assert.ok(!ui.text().includes("古い読込結果"));
  await ui.send();
  assert.equal(ui.calls.findLast((call) => call.url === "/api/command" && call.method === "POST").body.conversationId, 42);
});

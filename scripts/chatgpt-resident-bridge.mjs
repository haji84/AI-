#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  buildBridgePrompt,
  decodeChatComment,
  decodeConversationBody,
  encodeChatComment,
  encodeConversationBody,
  evolveMemoryForAi,
  findExistingAiReplyAfterPending,
  isPendingConversationIssue,
  selectPendingOwnerMessage,
} from "./chatgpt-resident-bridge-lib.mjs";

const execFileAsync = promisify(execFile);
const REPO = process.env.AI_COMPANY_REPO ?? "haji84/AI-";
const POLL_MS = clamp(Number(process.env.AI_COMPANY_BRIDGE_POLL_MS ?? 5000), 3000, 60000);
const CDP_PORT = clamp(Number(process.env.AI_COMPANY_CHATGPT_CDP_PORT ?? 9222), 1024, 65535);
const HOME = homedir();
const STATE_DIR = process.env.AI_COMPANY_BRIDGE_STATE_DIR ?? join(HOME, ".ai-company");
const HEALTH_FILE = join(STATE_DIR, "chatgpt-bridge-health.json");
const LOCK_FILE = join(STATE_DIR, "chatgpt-bridge.lock");
const CHROME_PROFILE = process.env.AI_COMPANY_CHATGPT_PROFILE ?? join(HOME, "Library", "Application Support", "AICompanyChatGPTBridge");
const CHATGPT_URL = "https://chatgpt.com/";

let shuttingDown = false;
let lockHandle = null;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setHealth(status, detail = null, extra = {}) {
  await mkdir(STATE_DIR, { recursive: true });
  const payload = {
    status,
    detail,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    repository: REPO,
    pollMs: POLL_MS,
    ...extra,
  };
  await writeFile(HEALTH_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[bridge] ${payload.updatedAt} ${status}${detail ? `: ${detail}` : ""}`);
}

async function acquireLock() {
  await mkdir(STATE_DIR, { recursive: true });
  try {
    lockHandle = await open(LOCK_FILE, "wx");
    await lockHandle.writeFile(`${process.pid}\n`, "utf8");
  } catch (error) {
    let previous = "unknown";
    try { previous = (await readFile(LOCK_FILE, "utf8")).trim(); } catch {}
    throw new Error(`bridge is already running (lock pid=${previous})`, { cause: error });
  }
}

async function releaseLock() {
  try { await lockHandle?.close(); } catch {}
  lockHandle = null;
  try { await unlink(LOCK_FILE); } catch {}
}

async function gh(args) {
  const { stdout } = await execFileAsync("gh", ["api", ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function ghJson(path) {
  return JSON.parse(await gh([path]));
}

async function ghJsonPages(path) {
  const parsed = JSON.parse(await gh(["--paginate", "--slurp", path]));
  return Array.isArray(parsed) ? parsed.flat() : [];
}

async function listPendingIssues() {
  const issues = await ghJson(`repos/${REPO}/issues?state=open&sort=updated&direction=desc&per_page=50`);
  return issues.filter(isPendingConversationIssue);
}

async function loadConversation(issue) {
  const meta = decodeConversationBody(issue.body ?? "");
  if (!meta) return null;
  const rawComments = await ghJsonPages(`repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
  const messages = rawComments.map((comment) => decodeChatComment(comment.body ?? "")).filter(Boolean);
  return { meta, messages };
}

async function postAiReply(issueNumber, meta, answer) {
  const createdAt = new Date().toISOString();
  const message = {
    id: `resident-${randomUUID()}`,
    role: "ai",
    text: String(answer).trim().slice(0, 8000),
    meta: "source:mac-resident-chatgpt-bridge",
    createdAt,
  };
  const commentBody = encodeChatComment(message);
  await gh([`repos/${REPO}/issues/${issueNumber}/comments`, "--method", "POST", "-f", `body=${commentBody}`]);
  const nextMeta = evolveMemoryForAi(meta, message);
  const issueBody = encodeConversationBody(nextMeta);
  await gh([`repos/${REPO}/issues/${issueNumber}`, "--method", "PATCH", "-f", `body=${issueBody}`]);
  return message;
}

async function reconcileExistingAiReply(issueNumber, meta, message) {
  const nextMeta = evolveMemoryForAi(meta, message);
  const issueBody = encodeConversationBody(nextMeta);
  await gh([`repos/${REPO}/issues/${issueNumber}`, "--method", "PATCH", "-f", `body=${issueBody}`]);
}

async function ensureGitHubReady() {
  await execFileAsync("gh", ["auth", "status"], { maxBuffer: 1024 * 1024 });
}

async function ensureChromeRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1200) });
    if (response.ok) return;
  } catch {}

  await execFileAsync("open", [
    "-na",
    "Google Chrome",
    "--args",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    CHATGPT_URL,
  ]);

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Google Chrome CDP did not become ready within 20 seconds");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP websocket connect timeout")), 8000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP websocket error")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(String(event.data)); } catch { return; }
      if (!payload.id) return;
      const entry = this.pending.get(payload.id);
      if (!entry) return;
      this.pending.delete(payload.id);
      if (payload.error) entry.reject(new Error(payload.error.message ?? "CDP command failed"));
      else entry.resolve(payload.result ?? {});
    });
  }

  call(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP websocket is not open");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch {}
  }
}

async function getChatGptTarget() {
  await ensureChromeRunning();
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
  const targets = await response.json();
  let target = targets.find((item) => item.type === "page" && String(item.url).startsWith("https://chatgpt.com/"));
  if (!target) {
    const created = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(CHATGPT_URL)}`, {
      method: "PUT",
      signal: AbortSignal.timeout(3000),
    });
    if (!created.ok) throw new Error("failed to create ChatGPT browser tab");
    target = await created.json();
  }
  if (!target.webSocketDebuggerUrl) throw new Error("ChatGPT CDP target has no websocket URL");
  return target;
}

async function evaluate(client, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error("browser evaluation failed");
  return result.result?.value;
}

async function waitForComposer(client, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(client, `(() => {
      const composer = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
      const login = [...document.querySelectorAll('a,button')].some((el) => /log in|sign in|ログイン/i.test(el.textContent || ''));
      return { hasComposer: !!composer, login, url: location.href };
    })()`);
    if (state?.hasComposer) return;
    if (state?.login) throw new Error("CHATGPT_LOGIN_REQUIRED");
    await sleep(750);
  }
  throw new Error("ChatGPT composer was not found");
}

async function submitPromptAndReadAnswer(prompt) {
  const target = await getChatGptTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: CHATGPT_URL });
    await waitForComposer(client);

    const beforeCount = await evaluate(client, `document.querySelectorAll('[data-message-author-role="assistant"]').length`);
    const focused = await evaluate(client, `(() => {
      const el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
      if (!el) return false;
      el.focus();
      return true;
    })()`);
    if (!focused) throw new Error("could not focus ChatGPT composer");

    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4 });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
    await client.call("Input.insertText", { text: prompt });
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });

    const deadline = Date.now() + 240000;
    let lastText = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      const state = await evaluate(client, `(() => {
        const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        const text = nodes.length ? (nodes[nodes.length - 1].innerText || '').trim() : '';
        const generating = !!document.querySelector('button[data-testid="stop-button"]') || [...document.querySelectorAll('button')].some((el) => /stop generating|停止/i.test(el.textContent || ''));
        return { count: nodes.length, text, generating };
      })()`);
      if (state?.count > Number(beforeCount ?? 0) && state.text) {
        if (state.text === lastText) {
          if (!stableSince) stableSince = Date.now();
        } else {
          lastText = state.text;
          stableSince = Date.now();
        }
        if (!state.generating && Date.now() - stableSince >= 1800) return lastText.slice(0, 8000);
      }
      await sleep(700);
    }
    throw new Error("ChatGPT response timeout; pending was preserved");
  } finally {
    client.close();
  }
}

async function processIssue(issue) {
  const conversation = await loadConversation(issue);
  if (!conversation) return;
  const { meta, messages } = conversation;
  const pending = selectPendingOwnerMessage(meta, messages);
  if (!pending) return;

  const existing = findExistingAiReplyAfterPending(meta, messages);
  if (existing) {
    await setHealth("reconciling", `Issue #${issue.number} already has an AI reply; clearing stale pending`, { issueNumber: issue.number });
    await reconcileExistingAiReply(issue.number, meta, existing);
    return;
  }

  await setHealth("processing", `Issue #${issue.number}: ${pending.id}`, { issueNumber: issue.number, pendingOwnerMessageId: pending.id });
  const prompt = buildBridgePrompt({ issueNumber: issue.number, meta, messages, pending });
  const answer = await submitPromptAndReadAnswer(prompt);
  if (!answer.trim()) throw new Error("ChatGPT returned an empty answer; pending was preserved");
  const aiMessage = await postAiReply(issue.number, meta, answer);
  await setHealth("synced", `Issue #${issue.number} synced`, { issueNumber: issue.number, lastAiMessageId: aiMessage.id });
}

async function runLoop() {
  await acquireLock();
  await setHealth("starting", "resident bridge starting");
  await ensureGitHubReady();
  await ensureChromeRunning();
  await setHealth("idle", "ready");

  while (!shuttingDown) {
    try {
      const issues = await listPendingIssues();
      if (!issues.length) {
        await setHealth("idle", "no pending conversations");
      } else {
        for (const issue of issues) {
          if (shuttingDown) break;
          try {
            await processIssue(issue);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const status = message === "CHATGPT_LOGIN_REQUIRED" ? "waiting_for_chatgpt_login" : "error";
            await setHealth(status, `${message}; GitHub pending preserved`, { issueNumber: issue.number });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setHealth("error", `${message}; retrying without clearing pending`);
    }
    await sleep(POLL_MS);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await setHealth("stopping", signal);
    await releaseLock();
    process.exit(0);
  });
}

runLoop().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  try { await setHealth("fatal", message); } catch {}
  await releaseLock();
  console.error(message);
  process.exit(1);
});

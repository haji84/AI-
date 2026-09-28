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
const PROJECT_NAME = process.env.AI_COMPANY_CHATGPT_PROJECT_NAME?.trim() || "自動化";
const PROJECT_SURFACES_FILE = join(STATE_DIR, "chatgpt-project-surfaces.json");
const ONE_SHOT_REPAIR_ISSUE = Number(process.env.AI_COMPANY_REPAIR_ONCE_ISSUE || "");

let shuttingDown = false;
let lockHandle = null;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readProjectSurfaces() {
  try {
    const parsed = JSON.parse(await readFile(PROJECT_SURFACES_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { version: 1, project: PROJECT_NAME, chat: null, work: null };
    return {
      version: 1,
      project: typeof parsed.project === "string" ? parsed.project : PROJECT_NAME,
      chat: typeof parsed.chat === "string" && parsed.chat.startsWith(CHATGPT_URL) ? parsed.chat : null,
      work: typeof parsed.work === "string" && parsed.work.startsWith(CHATGPT_URL) ? parsed.work : null,
    };
  } catch {
    return { version: 1, project: PROJECT_NAME, chat: null, work: null };
  }
}

async function writeProjectSurface(mode, url) {
  if (!["chat", "work"].includes(mode) || typeof url !== "string" || !url.startsWith(CHATGPT_URL)) return;
  const current = await readProjectSurfaces();
  const next = { ...current, project: PROJECT_NAME, [mode]: url, updatedAt: new Date().toISOString() };
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PROJECT_SURFACES_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
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
    bridgeVersion: 2,
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

function isRepairIssue(issue) {
  const meta = decodeConversationBody(issue?.body ?? "");
  const pendingMeta = String(meta?.githubBridge?.pendingOwnerPayload?.meta ?? "");
  return /(?:^|\s)repair-surface:(chat|work)(?:\s|$)/i.test(pendingMeta);
}

async function listPendingIssues() {
  const issues = await ghJson(`repos/${REPO}/issues?state=open&sort=updated&direction=desc&per_page=50`);
  return issues.filter(isPendingConversationIssue).filter((issue) => !isRepairIssue(issue));
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
    meta: "source:mac-resident-chatgpt-bridge-v2",
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

async function createChatGptTarget(url = CHATGPT_URL) {
  await ensureChromeRunning();
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("failed to create ChatGPT browser tab");
  const target = await response.json();
  if (!target?.id || !target?.webSocketDebuggerUrl) throw new Error("ChatGPT CDP target is incomplete");
  return target;
}

async function closeTarget(targetId) {
  if (!targetId) return;
  try {
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${encodeURIComponent(targetId)}`, {
      signal: AbortSignal.timeout(2500),
    });
  } catch {}
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
    if (state?.hasComposer) return state;
    if (state?.login) throw new Error("CHATGPT_LOGIN_REQUIRED");
    await sleep(750);
  }
  throw new Error("ChatGPT composer was not found");
}

async function navigateClient(client, url) {
  await client.call("Page.navigate", { url });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, `(() => ({
      ready: document.readyState,
      url: location.href,
      login: [...document.querySelectorAll('a,button')].some((el) => /log in|sign in|ログイン/i.test(el.textContent || '')),
    }))()`);
    if (state?.login) throw new Error("CHATGPT_LOGIN_REQUIRED");
    if (state?.ready === "complete" || state?.ready === "interactive") return state;
    await sleep(400);
  }
  throw new Error(`CHATGPT_NAVIGATION_TIMEOUT: ${url}`);
}

async function showSidebarIfNeeded(client) {
  await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const button = buttons.find((el) => /サイドバーを表示する|show sidebar/i.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
    if (button) button.click();
    return !!button;
  })()`);
  await sleep(300);
}

async function openAutomationProject(client) {
  await showSidebarIfNeeded(client);
  const target = await evaluate(client, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const candidates = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible);
    const exact = candidates.find((el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label')) === ${JSON.stringify(PROJECT_NAME)});
    if (!exact) {
      return {
        found: false,
        nearby: candidates.map((el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label'))).filter(Boolean).filter((value) => value.includes(${JSON.stringify(PROJECT_NAME)})).slice(0, 20),
      };
    }
    const href = exact.tagName === 'A' ? exact.href : null;
    if (!href) exact.click();
    return { found: true, href };
  })()`);

  if (!target?.found) {
    throw new Error(`CHATGPT_AUTOMATION_PROJECT_NOT_FOUND: ${PROJECT_NAME}; nearby=${JSON.stringify(target?.nearby ?? [])}`);
  }
  if (target.href) await navigateClient(client, target.href);
  else await sleep(900);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const projectVisible = [...document.querySelectorAll('a,button,[role="button"]')]
        .filter(visible)
        .some((el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label')) === ${JSON.stringify(PROJECT_NAME)});
      const composer = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
      return { projectVisible, hasComposer: !!composer, url: location.href, title: document.title };
    })()`);
    if (state?.projectVisible) return state;
    await sleep(500);
  }
  throw new Error(`CHATGPT_AUTOMATION_PROJECT_CONTEXT_NOT_CONFIRMED: ${PROJECT_NAME}`);
}

async function prepareProjectSurface(client, mode) {
  const surfaces = await readProjectSurfaces();
  const savedUrl = mode === "work" ? surfaces.work : surfaces.chat;
  if (savedUrl) {
    try {
      await navigateClient(client, savedUrl);
      await waitForComposer(client, 12000);
      if (mode === "work") await selectExperience(client, "work");
      return { reused: true, url: savedUrl };
    } catch {
      // Re-discover the project below. Never fall back to a root standalone chat.
    }
  }

  await navigateClient(client, CHATGPT_URL);
  await openAutomationProject(client);
  if (mode === "work") await selectExperience(client, "work");
  const ready = await waitForComposer(client, 15000);
  const projectVisible = await evaluate(client, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('a,button,[role="button"]')]
      .some((el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label')) === ${JSON.stringify(PROJECT_NAME)});
  })()`);
  if (!projectVisible) {
    throw new Error(`CHATGPT_PROJECT_SURFACE_ESCAPED: ${PROJECT_NAME}/${mode}`);
  }
  return { reused: false, url: ready.url };
}

async function snapshotConversationMessages(client) {
  return evaluate(client, `(() => {
    const candidates = [...document.querySelectorAll(
      'main [data-message-author-role], main [data-testid^="conversation-turn"], main article, main [data-message-id]'
    )];
    const out = [];
    const seen = new Set();
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const roleNode = node.matches('[data-message-author-role]') ? node : node.closest('[data-message-author-role]');
      let role = roleNode?.getAttribute('data-message-author-role') || null;
      const controls = [...node.querySelectorAll('button')].map((button) =>
        normalize([button.getAttribute('aria-label'), button.getAttribute('data-testid'), button.textContent].filter(Boolean).join(' '))
      ).filter(Boolean);
      const controlText = controls.join(' | ');

      if (!role && /メッセージを編集|edit message/i.test(controlText)) role = 'user';
      if (!role && /回答を再生成|regenerate|読み上げ|read aloud|リアクション|reaction/i.test(controlText)) role = 'assistant';
      if (role !== 'user' && role !== 'assistant') continue;

      const contentNode = node.querySelector('.markdown,[data-message-content],.whitespace-pre-wrap') || node;
      const text = (contentNode.innerText || contentNode.textContent || '').trim();
      if (!text) continue;

      const id = node.getAttribute('data-message-id')
        || roleNode?.getAttribute('data-message-id')
        || node.id
        || null;
      const key = role + ':' + (id || text.slice(0, 500));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role, id, index: out.length, text: text.slice(0, 8000) });
    }
    return out;
  })()`);
}

async function snapshotAssistantMessages(client) {
  const messages = await snapshotConversationMessages(client);
  const assistants = Array.isArray(messages) ? messages.filter((message) => message.role === "assistant") : [];
  if (assistants.length) return assistants;

  return evaluate(client, `(() => {
    const nodes = [...document.querySelectorAll('main .markdown, main [class*="markdown"]')];
    const seen = new Set();
    const out = [];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const text = (node.innerText || node.textContent || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const host = node.closest('[data-message-id],[data-testid^="conversation-turn"],article');
      out.push({
        role: 'assistant',
        id: host?.getAttribute('data-message-id') || host?.id || null,
        index: out.length,
        text: text.slice(0, 8000),
      });
    }
    return out;
  })()`);
}

function fingerprintMessage(message) {
  if (!message) return "";
  if (message.id) return `id:${message.id}`;
  return `fallback:${message.index}:${message.text}`;
}

function repairSurfaceFromPending(pending) {
  const meta = String(pending?.meta ?? "");
  const match = meta.match(/(?:^|\s)repair-surface:(chat|work)(?:\s|$)/i);
  return match?.[1]?.toLowerCase() === "work" ? "work" : "chat";
}

async function selectExperience(client, mode) {
  if (mode !== "work") return;

  const direct = await evaluate(client, `(() => {
    const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"]')];
    const work = candidates.find((el) => /^Work$/i.test(text(el)) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    if (work) { work.click(); return { clicked: true, phase: 'direct' }; }
    const toggle = candidates.find((el) => /^(Chat|Work)$/i.test(text(el)) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    if (toggle) { toggle.click(); return { clicked: true, phase: 'toggle' }; }
    return { clicked: false, phase: 'none' };
  })()`);
  if (!direct?.clicked) throw new Error("CHATGPT_WORK_SELECTOR_NOT_FOUND");

  if (direct.phase === "toggle") {
    await sleep(450);
    const selected = await evaluate(client, `(() => {
      const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const candidates = [...document.querySelectorAll('[role="menuitem"],[role="option"],button,[role="button"]')];
      const work = candidates.find((el) => /^Work$/i.test(text(el)) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
      if (!work) return false;
      work.click();
      return true;
    })()`);
    if (!selected) throw new Error("CHATGPT_WORK_OPTION_NOT_FOUND");
  }

  await sleep(700);
}

async function submitPromptAndReadAnswer(prompt, mode = "chat") {
  const target = await createChatGptTarget(CHATGPT_URL);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.bringToFront");
    await prepareProjectSurface(client, mode);
    const selectedExperience = await waitForComposer(client);
    if (!String(selectedExperience?.url ?? "").startsWith(CHATGPT_URL)) throw new Error("project surface left ChatGPT");

    const beforeMessages = await snapshotAssistantMessages(client);
    const baselineFingerprints = new Set((beforeMessages ?? []).map(fingerprintMessage));
    const beforeUserCount = await evaluate(client, `(() => document.querySelectorAll('[data-message-author-role="user"]').length)()`);

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

    const sendTarget = await evaluate(client, `(() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const buttons = [...document.querySelectorAll('button')];
      const button = document.querySelector('button[data-testid="send-button"]')
        || buttons.find((el) => {
          const aria = (el.getAttribute('aria-label') || '').trim();
          const testid = (el.getAttribute('data-testid') || '').trim();
          const text = (el.textContent || '').trim();
          return visible(el)
            && !el.disabled
            && (/^(send|送信)$/i.test(aria) || /send-button/i.test(testid) || /^(send|送信)$/i.test(text));
        });
      if (!button || button.disabled || !visible(button)) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);

    if (sendTarget?.x && sendTarget?.y) {
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: sendTarget.x, y: sendTarget.y });
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: sendTarget.x, y: sendTarget.y, button: "left", clickCount: 1 });
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: sendTarget.x, y: sendTarget.y, button: "left", clickCount: 1 });
    }

    const submissionState = async () => evaluate(client, `(() => {
      const composer = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
      return {
        userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
        composerText: composer ? (composer.value || composer.innerText || composer.textContent || '').trim() : '',
      };
    })()`);

    const isSubmitted = (state) => state?.userCount > beforeUserCount || !state?.composerText;

    await sleep(700);
    let submitted = await submissionState();

    if (!isSubmitted(submitted)) {
      await evaluate(client, `(() => {
        const visible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const buttons = [...document.querySelectorAll('button')];
        const button = document.querySelector('button[data-testid="send-button"]')
          || buttons.find((el) => {
            const aria = (el.getAttribute('aria-label') || '').trim();
            const testid = (el.getAttribute('data-testid') || '').trim();
            const text = (el.textContent || '').trim();
            return visible(el)
              && !el.disabled
              && (/^(send|送信)$/i.test(aria) || /send-button/i.test(testid) || /^(send|送信)$/i.test(text));
          });
        const form = button?.closest('form') || (document.querySelector('textarea') || document.querySelector('[contenteditable="true"]'))?.closest('form');
        if (!form) return false;
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit(button || undefined);
          return true;
        }
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return true;
      })()`);
      await sleep(700);
      submitted = await submissionState();
    }

    if (!isSubmitted(submitted)) {
      await client.call("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await client.call("Input.dispatchKeyEvent", {
        type: "char",
        key: "Enter",
        code: "Enter",
        text: "\r",
        unmodifiedText: "\r",
      });
      await client.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await sleep(700);
      submitted = await submissionState();
    }

    if (!isSubmitted(submitted)) {
      throw new Error(`CHATGPT_SUBMIT_FAILED: userCount=${submitted?.userCount ?? "unknown"}; composerText=${String(submitted?.composerText ?? "").slice(0, 500)}`);
    }

    const deadline = Date.now() + 240000;
    let candidateFingerprint = "";
    let lastText = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      const messages = await snapshotAssistantMessages(client);
      const state = await evaluate(client, `(() => ({
        url: location.href,
        generating: !!document.querySelector('button[data-testid="stop-button"]')
          || [...document.querySelectorAll('button')].some((el) => /stop generating|停止/i.test((el.getAttribute('aria-label') || el.textContent || ''))),
      }))()`);

      const newMessages = messages.filter((message) => !baselineFingerprints.has(fingerprintMessage(message)));
      const candidate = newMessages.at(-1);
      const currentFingerprint = fingerprintMessage(candidate);

      if (candidate?.text) {
        if (candidateFingerprint !== currentFingerprint) {
          candidateFingerprint = currentFingerprint;
          lastText = candidate.text;
          stableSince = Date.now();
        } else if (candidate.text !== lastText) {
          lastText = candidate.text;
          stableSince = Date.now();
        } else if (!state.generating && Date.now() - stableSince >= 1800) {
          const surfaceUrl = await evaluate(client, "location.href");
          await writeProjectSurface(mode, String(surfaceUrl || ""));
          return lastText.slice(0, 8000);
        }
      }
      await sleep(700);
    }
    const diagnostic = await evaluate(client, `(() => {
      const turns = [...document.querySelectorAll('main [data-message-author-role], main [data-testid^="conversation-turn"], main article, main [data-message-id]')];
      const assistant = turns.filter((node) => node.getAttribute?.('data-message-author-role') === 'assistant' || [...node.querySelectorAll?.('button') || []].some((button) => /回答を再生成|regenerate|読み上げ|read aloud|リアクション|reaction/i.test((button.getAttribute('aria-label') || button.textContent || '')))).map((node) => (node.innerText || '').trim()).filter(Boolean);
      const user = turns.filter((node) => node.getAttribute?.('data-message-author-role') === 'user' || [...node.querySelectorAll?.('button') || []].some((button) => /メッセージを編集|edit message/i.test((button.getAttribute('aria-label') || button.textContent || '')))).map((node) => (node.innerText || '').trim()).filter(Boolean);
      const composer = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
      const buttons = [...document.querySelectorAll('button')].slice(-40).map((el) => ({
        text: (el.innerText || el.textContent || '').trim().slice(0, 120),
        aria: el.getAttribute('aria-label'),
        testid: el.getAttribute('data-testid'),
        disabled: !!el.disabled,
      }));
      return {
        url: location.href,
        title: document.title,
        assistantCount: assistant.length,
        lastAssistant: assistant.at(-1)?.slice(0, 500) || '',
        userCount: user.length,
        lastUser: user.at(-1)?.slice(0, 500) || '',
        composerText: composer ? (composer.value || composer.innerText || composer.textContent || '').slice(0, 500) : '',
        buttons,
      };
    })()`);
    throw new Error(`ChatGPT fresh-turn response timeout; pending was preserved; diagnostic=${JSON.stringify(diagnostic).slice(0, 4000)}`);
  } finally {
    client.close();
    await closeTarget(target.id);
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
  const surface = repairSurfaceFromPending(pending);
  const answer = await submitPromptAndReadAnswer(prompt, surface);
  if (!answer.trim()) throw new Error("ChatGPT returned an empty answer; pending was preserved");
  const aiMessage = await postAiReply(issue.number, meta, answer);
  await setHealth("synced", `Issue #${issue.number} synced`, { issueNumber: issue.number, lastAiMessageId: aiMessage.id });
}

async function runOneShotRepair(issueNumber) {
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("INVALID_REPAIR_ISSUE_NUMBER");
  await setHealth("starting", `one-shot repair issue #${issueNumber}`, { issueNumber });
  await ensureGitHubReady();
  await ensureChromeRunning();
  const issue = await ghJson(`repos/${REPO}/issues/${issueNumber}`);
  if (!isPendingConversationIssue(issue) || !isRepairIssue(issue)) {
    throw new Error(`REPAIR_ISSUE_NOT_PENDING: #${issueNumber}`);
  }
  await processIssue(issue);
}

async function runLoop() {
  await acquireLock();
  await setHealth("starting", "resident bridge v2 starting");
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

const main = Number.isInteger(ONE_SHOT_REPAIR_ISSUE) && ONE_SHOT_REPAIR_ISSUE > 0
  ? () => runOneShotRepair(ONE_SHOT_REPAIR_ISSUE)
  : runLoop;

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try { await setHealth("fatal", message, Number.isInteger(ONE_SHOT_REPAIR_ISSUE) && ONE_SHOT_REPAIR_ISSUE > 0 ? { issueNumber: ONE_SHOT_REPAIR_ISSUE } : {}); } catch {}
  await releaseLock();
  console.error(error);
  process.exit(1);
});

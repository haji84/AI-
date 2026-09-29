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
  inferBridgeTaskContext,
} from "./chatgpt-resident-bridge-lib.mjs";
import {
  selectBridgeSession,
  upsertBridgeSession,
} from "../src/orchestrator/chat-work-session-router.ts";

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
const PROJECT_SESSIONS_FILE = join(STATE_DIR, "chatgpt-project-sessions.json");
const ONE_SHOT_REPAIR_ISSUE = Number(process.env.AI_COMPANY_REPAIR_ONCE_ISSUE || "");
const CHAT_MAX_PHASES = 4;
const CHAT_PHASE_BUDGET_MS = 60_000;
const CHAT_ABSOLUTE_CEILING_MS = 5 * 60_000;
const WORK_ABSOLUTE_CEILING_MS = 10 * 60_000;
const COMPLETION_STABLE_MS = 1_500;

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

async function readProjectSessions() {
  try {
    const parsed = JSON.parse(await readFile(PROJECT_SESSIONS_FILE, "utf8"));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error("invalid session registry");
    return { version: 1, project: PROJECT_NAME, sessions: parsed.sessions };
  } catch {
    const legacy = await readProjectSurfaces();
    const now = new Date().toISOString();
    const sessions = [];
    if (legacy.chat) sessions.push({ project: PROJECT_NAME, surface: "chat", url: legacy.chat, goalId: null, lastUsedAt: now });
    if (legacy.work) sessions.push({ project: PROJECT_NAME, surface: "work", url: legacy.work, goalId: null, lastUsedAt: now });
    return { version: 1, project: PROJECT_NAME, sessions };
  }
}

async function recordProjectSession(surface, url, goalId = null) {
  if (!["chat", "work"].includes(surface) || typeof url !== "string" || !url.startsWith(CHATGPT_URL)) return;
  const current = await readProjectSessions();
  const next = upsertBridgeSession(current, {
    project: PROJECT_NAME,
    surface,
    url,
    goalId: typeof goalId === "string" && goalId.trim() ? goalId.trim() : null,
    lastUsedAt: new Date().toISOString(),
  });
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PROJECT_SESSIONS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
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

async function startFreshProjectConversation(client) {
  const clicked = await evaluate(client, `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
    const fresh = buttons.find((el) => /^(新しいチャット|new chat)$/i.test(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (!fresh) return false;
    fresh.click();
    return true;
  })()`);
  if (!clicked) throw new Error("CHATGPT_PROJECT_NEW_CHAT_NOT_FOUND");
  await sleep(700);
  await waitForComposer(client, 15000);
  const projectVisible = await evaluate(client, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('a,button,[role="button"]')]
      .some((el) => normalize(el.innerText || el.textContent || el.getAttribute('aria-label')) === ${JSON.stringify(PROJECT_NAME)});
  })()`);
  if (!projectVisible) throw new Error(`CHATGPT_FRESH_PROJECT_SURFACE_ESCAPED: ${PROJECT_NAME}`);
}

async function prepareProjectSurface(client, mode, fresh = false) {
  const preferredUrl = arguments[3] ?? null;
  const surfaces = await readProjectSurfaces();
  const savedUrl = preferredUrl || (mode === "work" ? surfaces.work : surfaces.chat);
  if (!fresh && savedUrl) {
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
  if (fresh) await startFreshProjectConversation(client);
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

async function readMacClipboardText() {
  const { stdout } = await execFileAsync("pbpaste", [], { maxBuffer: 2 * 1024 * 1024 });
  return String(stdout ?? "");
}

function writeMacClipboardText(text) {
  return new Promise((resolve, reject) => {
    const child = execFile("pbcopy", [], (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.end(String(text ?? ""));
  });
}

async function copyAssistantAnswerFromUi(client, requestMarker, phaseToken = "") {
  const previousClipboard = await readMacClipboardText();
  const sentinel = `GORIQ_CLIPBOARD_SENTINEL_${randomUUID()}`;
  try {
    await writeMacClipboardText(sentinel);
    const target = await evaluate(client, `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const buttons = [...document.querySelectorAll('button')].filter((button) => {
        if (!visible(button) || button.disabled) return false;
        const label = normalize(button.getAttribute('aria-label') || button.textContent || '');
        return /^(コピーする|copy)$/i.test(label);
      });
      const phaseToken = __PHASE_TOKEN__;
      const eligible = phaseToken
        ? buttons.filter((button) => button.getAttribute('data-goriq-phase-baseline') !== phaseToken)
        : buttons;
      const button = eligible.at(-1);
      if (!button) return null;
      button.scrollIntoView({ block: 'center', inline: 'nearest' });
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = button.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (
            rect.width <= 0
            || rect.height <= 0
            || x < 0
            || x > window.innerWidth
            || y < 0
            || y > window.innerHeight
          ) {
            resolve(null);
            return;
          }
          resolve({ x, y });
        }));
      });
    })()`.replace("__PHASE_TOKEN__", JSON.stringify(phaseToken)));
    if (!target?.x || !target?.y) return "";

    await client.call("Page.bringToFront");
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });

    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      await sleep(150);
      const copied = await readMacClipboardText();
      if (copied && copied !== sentinel && !copied.includes(requestMarker)) {
        return copied.trim().slice(0, 8000);
      }
    }
    return "";
  } finally {
    try { await writeMacClipboardText(previousClipboard); } catch {}
  }
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

async function markPhaseCopyBaseline(client, phaseToken) {
  return evaluate(client, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const copies = [...document.querySelectorAll('button')].filter((button) => {
      if (!visible(button)) return false;
      const label = normalize(button.getAttribute('aria-label') || button.textContent || '');
      return /^(コピーする|copy)$/i.test(label);
    });
    for (const button of copies) button.setAttribute('data-goriq-phase-baseline', __PHASE_TOKEN__);
    return copies.length;
  })()`.replace("__PHASE_TOKEN__", JSON.stringify(phaseToken)));
}

async function snapshotExecutionUiState(client, phaseToken = "") {
  return evaluate(client, `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const allButtons = [...document.querySelectorAll('button')].filter(visible);
    const mainButtons = [...document.querySelectorAll('main button')].filter(visible);
    const labels = (buttons) => buttons.map((button) =>
      normalize([button.getAttribute('aria-label'), button.getAttribute('data-testid'), button.textContent].filter(Boolean).join(' '))
    ).filter(Boolean);
    const allLabels = labels(allButtons);
    const mainLabels = labels(mainButtons);
    const generating = !!document.querySelector('button[data-testid="stop-button"]')
      || mainLabels.some((value) => /stop generating|停止/i.test(value));
    const retryVisible = mainLabels.some((value) => /^(再試行|retry)$/i.test(value));
    const assistantLabels = allLabels.filter((value) =>
      /^(コピーする|copy)$|読み上げ|read aloud|回答を再生成|regenerate/i.test(value)
    );
    const copyReady = assistantLabels.some((value) => /^(コピーする|copy)$/i.test(value));
    const readAloudReady = assistantLabels.some((value) => /読み上げ|read aloud/i.test(value));
    const regenerateReady = assistantLabels.some((value) => /回答を再生成|regenerate/i.test(value));
    const progressLabel = mainLabels.findLast((value) => /作業しました|working|thinking|reasoning/i.test(value)) || '';
    const mainText = document.querySelector('main')?.innerText || '';
    const tail = mainText.slice(-240);
    const copyButtons = allButtons.filter((button) => {
      const label = normalize(button.getAttribute('aria-label') || button.textContent || '');
      return /^(コピーする|copy)$/i.test(label);
    });
    const copyCount = copyButtons.length;
    const phaseToken = __PHASE_TOKEN__;
    const newCopyCount = phaseToken
      ? copyButtons.filter((button) => button.getAttribute('data-goriq-phase-baseline') !== phaseToken).length
      : copyCount;
    return {
      generating,
      retryVisible,
      copyReady,
      copyCount,
      newCopyCount,
      readAloudReady,
      regenerateReady,
      completionReady: !generating && copyReady && (readAloudReady || regenerateReady) && !retryVisible,
      completionSignature: JSON.stringify([newCopyCount, copyReady, readAloudReady, regenerateReady, retryVisible]),
      activitySignature: JSON.stringify([generating, retryVisible, copyReady, readAloudReady, regenerateReady, progressLabel, mainText.length, tail]),
    };
  })()`.replace("__PHASE_TOKEN__", JSON.stringify(phaseToken)));
}

async function snapshotSafeControlDiagnostics(client) {
  return evaluate(client, `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const nodes = [...document.querySelectorAll('button,[role="button"]')].filter(visible).slice(-80);
    const controls = nodes.map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: clean(el.getAttribute('role')),
      aria: clean(el.getAttribute('aria-label')),
      testid: clean(el.getAttribute('data-testid')),
      title: clean(el.getAttribute('title')),
      text: clean(el.textContent),
      inMain: !!el.closest('main'),
    }));
    const labels = controls.map((item) => [item.aria, item.testid, item.title, item.text].filter(Boolean).join(' '));
    return {
      visibleControlCount: nodes.length,
      candidates: {
        stop: labels.filter((value) => /stop generating|停止/i.test(value)).length,
        retry: labels.filter((value) => /retry|再試行/i.test(value)).length,
        copy: labels.filter((value) => /copy|コピー/i.test(value)).length,
        readAloud: labels.filter((value) => /read aloud|読み上げ/i.test(value)).length,
        regenerate: labels.filter((value) => /regenerate|再生成/i.test(value)).length,
      },
      controls,
    };
  })()`);
}

async function stopActiveGeneration(client) {
  return evaluate(client, `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buttons = [...document.querySelectorAll('main button')].filter(visible);
    const stop = document.querySelector('button[data-testid="stop-button"]')
      || buttons.find((button) => /stop generating|停止/i.test((button.getAttribute('aria-label') || button.textContent || '').trim()));
    if (!stop) return false;
    stop.click();
    return true;
  })()`);
}

async function submitFollowupPrompt(client, text) {
  await waitForComposer(client, 15000);
  const focused = await evaluate(client, `(() => {
    const el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (!el) return false;
    el.focus();
    return true;
  })()`);
  if (!focused) throw new Error("CHATGPT_PHASE_COMPOSER_NOT_FOUND");

  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4 });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
  await client.call("Input.insertText", { text });

  const submitted = await evaluate(client, `(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buttons = [...document.querySelectorAll('button')];
    const button = document.querySelector('button[data-testid="send-button"]')
      || buttons.find((el) => {
        const aria = (el.getAttribute('aria-label') || '').trim();
        const testid = (el.getAttribute('data-testid') || '').trim();
        const label = (el.textContent || '').trim();
        return visible(el) && !el.disabled
          && (/^(send|送信)$/i.test(aria) || /send-button/i.test(testid) || /^(send|送信)$/i.test(label));
      });
    if (button && !button.disabled && visible(button)) {
      button.click();
      return true;
    }
    const composer = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    const form = composer?.closest('form');
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return true;
    }
    return false;
  })()`);

  if (!submitted) {
    await client.call("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await client.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  }
  await sleep(700);
}

function shouldPreSplitChatRepair(prompt) {
  const value = String(prompt ?? "");
  const allowedMatch = value.match(/^AllowedPaths=(.+)$/m);
  const allowedCount = allowedMatch
    ? allowedMatch[1].split(",").map((item) => item.trim()).filter(Boolean).length
    : 0;
  const failureEvidenceLength = value.includes("FailureEvidence:")
    ? value.slice(value.indexOf("FailureEvidence:")).length
    : 0;
  const structuralSignals = [
    /Recovery strategy/i,
    /Current file excerpts/i,
    /FailureEvidence:/i,
    /Strategy \d/i,
    /AllowedPaths=/i,
    /Read AGENTS\.md/i,
  ].filter((pattern) => pattern.test(value)).length;

  return value.length >= 6000
    || failureEvidenceLength >= 3500
    || allowedCount >= 3
    || structuralSignals >= 4;
}

function boundedPhaseContext(outputs) {
  return outputs
    .slice(-3)
    .map((value, index) => `PriorPhase${outputs.length - Math.min(outputs.length, 3) + index + 1}:\n${String(value).slice(0, 2200)}`)
    .join("\n\n");
}

function buildInitialChatPrompt(prompt, requestMarker, preSplit) {
  if (!preSplit) {
    return [
      requestMarker,
      "Transport marker only. Do not include it in the answer.",
      "",
      prompt,
    ].join("\n");
  }

  return [
    requestMarker,
    "Transport marker only. Do not include it in the answer.",
    "GORIQ_CHAT_PRE_SPLIT=true",
    `GORIQ_CHAT_RECOVERY_PHASE=1/${CHAT_MAX_PHASES}`,
    "The repair is being phase-split before execution because it is likely to exceed one minute.",
    "Phase 1: DIAGNOSIS ONLY.",
    "Identify the exact failing condition, the exact AllowedPath location involved, and the smallest correction target.",
    "Do not broaden scope. Do not produce unrelated implementation.",
    "Your Phase 1 result will be copied and explicitly reflected into Phase 2.",
    "",
    "Original bounded repair goal:",
    prompt,
  ].join("\n");
}

function buildChatRecoveryPhasePrompt(phase, reason, marker, priorOutputs = []) {
  const instructions = {
    2: [
      "Micro-Phase 2: DIAGNOSIS ONLY.",
      "Identify the single concrete failing condition, the exact AllowedPath location that must change, and the smallest intended correction.",
      "Do not perform broad research or redesign. If the correction is already certain and tiny, you may return the final unified diff now.",
    ],
    3: [
      "Micro-Phase 3: MINIMAL CHANGE CONSTRUCTION.",
      "Using the diagnosis already in this conversation, reduce the work to one smallest safe code change.",
      "Do not revisit unrelated possibilities. If ready, return the final unified diff; otherwise state only the exact edit needed for the final phase.",
    ],
    4: [
      "Micro-Phase 4: FINAL DIFF ONLY.",
      "Use the prior micro-phase findings and return only the smallest valid unified diff.",
      "If a safe bounded diff is still impossible, return exactly GORIQ_CHAT_PHASE_EXHAUSTED.",
    ],
  };
  return [
    marker,
    `GORIQ_CHAT_RECOVERY_PHASE=${phase}/${CHAT_MAX_PHASES}`,
    `RecoveryReason=${reason}`,
    "Continue the SAME repair request using the existing conversation context.",
    "This is a smaller continuation step, not a new task.",
    "Do not broaden AllowedPaths, authority, permissions, dependencies, tests, workflows, governance, or requirements.",
    "Keep this micro-phase small enough to finish within one minute.",
    "Treat all prior phase results as parts of ONE repair, never as separate tasks.",
    boundedPhaseContext(priorOutputs),
    ...(instructions[phase] ?? instructions[4]),
    phase === CHAT_MAX_PHASES
      ? "FINALIZATION: consolidate the original goal plus every prior phase result into ONE smallest valid unified diff. Return only that single unified diff."
      : "Your result will be copied and explicitly reflected into the next phase.",
  ].filter(Boolean).join("\n");
}

function looksLikeUnifiedDiff(text) {
  const value = String(text ?? "").trim();
  return /(?:^|\n)diff --git\s/m.test(value)
    || /(?:^|\n)---\s+[^\n]+\n\+\+\+\s+/m.test(value);
}

async function submitPromptAndReadAnswer(prompt, mode = "chat", fresh = false, preferredUrl = null, goalId = null) {
  const requestMarker = `GORIQ_BRIDGE_REQUEST_ID=${randomUUID()}`;
  const preSplit = mode === "chat" && shouldPreSplitChatRepair(prompt);
  const submittedPrompt = mode === "chat"
    ? buildInitialChatPrompt(prompt, requestMarker, preSplit)
    : [
        requestMarker,
        "Transport marker only. Do not include it in the answer.",
        "",
        prompt,
      ].join("\n");
  const target = await createChatGptTarget(CHATGPT_URL);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.bringToFront");
    await prepareProjectSurface(client, mode, fresh, preferredUrl);
    const selectedExperience = await waitForComposer(client);
    if (!String(selectedExperience?.url ?? "").startsWith(CHATGPT_URL)) throw new Error("project surface left ChatGPT");

    const preSubmissionTurns = await snapshotConversationMessages(client);
    const freshBaselineEmpty = fresh && Array.isArray(preSubmissionTurns) && preSubmissionTurns.length === 0;
    const beforeUserCount = await evaluate(client, `(() => document.querySelectorAll('[data-message-author-role="user"]').length)()`);
    let phaseToken = `goriq-phase-${randomUUID()}`;
    await markPhaseCopyBaseline(client, phaseToken);

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
    await client.call("Input.insertText", { text: submittedPrompt });

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

    const markerDeadline = Date.now() + 15000;
    let markerUserIndex = -1;
    while (Date.now() < markerDeadline) {
      const turns = await snapshotConversationMessages(client);
      markerUserIndex = Array.isArray(turns)
        ? turns.findLastIndex((message) => message.role === "user" && message.text.includes(requestMarker))
        : -1;
      if (markerUserIndex >= 0) break;
      await sleep(300);
    }
    if (markerUserIndex < 0) {
      if (!freshBaselineEmpty) {
        throw new Error("CHATGPT_SUBMITTED_TURN_NOT_FOUND");
      }
      markerUserIndex = -1;
    }

    const absoluteDeadline = Date.now() + (mode === "chat" ? CHAT_ABSOLUTE_CEILING_MS : WORK_ABSOLUTE_CEILING_MS);
    let phase = 1;
    let phaseStartedAt = Date.now();
    const phaseOutputs = [];
    let phaseMarker = requestMarker;
    let completionSignature = "";
    let completionStableSince = 0;

    while (Date.now() < absoluteDeadline) {
      const state = await snapshotExecutionUiState(client, phaseToken);

      if (state.completionReady && state.newCopyCount > 0) {
        if (state.completionSignature !== completionSignature) {
          completionSignature = state.completionSignature;
          completionStableSince = Date.now();
        } else if (Date.now() - completionStableSince >= COMPLETION_STABLE_MS) {
          const copied = await copyAssistantAnswerFromUi(client, phaseMarker, phaseToken);
          if (copied) {
            if (mode !== "chat") {
              if (!fresh) {
                const surfaceUrl = await evaluate(client, "location.href");
                await recordProjectSession(mode, String(surfaceUrl || ""), goalId);
                await writeProjectSurface(mode, String(surfaceUrl || ""));
              }
              return copied.slice(0, 8000);
            }

            phaseOutputs.push(copied);

            const finalPhase = phase >= CHAT_MAX_PHASES;
            if (finalPhase) {
              if (looksLikeUnifiedDiff(copied)) {
                if (!fresh) {
                  const surfaceUrl = await evaluate(client, "location.href");
                  await recordProjectSession(mode, String(surfaceUrl || ""), goalId);
                await writeProjectSurface(mode, String(surfaceUrl || ""));
                }
                return copied.slice(0, 8000);
              }
              throw new Error(`CHAT_REPAIR_PHASES_EXHAUSTED: phase=${phase}; reason=final-output-not-diff`);
            }

            if (!preSplit && phase === 1 && looksLikeUnifiedDiff(copied)) {
              if (!fresh) {
                const surfaceUrl = await evaluate(client, "location.href");
                await recordProjectSession(mode, String(surfaceUrl || ""), goalId);
                await writeProjectSurface(mode, String(surfaceUrl || ""));
              }
              return copied.slice(0, 8000);
            }

            if (copied.trim() === "GORIQ_CHAT_PHASE_EXHAUSTED") {
              throw new Error(`CHAT_REPAIR_PHASES_EXHAUSTED: phase=${phase}; reason=explicit-exhaustion`);
            }

            phase += 1;
            phaseMarker = `GORIQ_BRIDGE_PHASE_ID=${randomUUID()}`;
            phaseToken = `goriq-phase-${randomUUID()}`;
            await markPhaseCopyBaseline(client, phaseToken);
            await submitFollowupPrompt(
              client,
              buildChatRecoveryPhasePrompt(phase, preSplit ? "planned-phase-complete" : "intermediate-phase-complete", phaseMarker, phaseOutputs),
            );
            phaseStartedAt = Date.now();
            completionSignature = "";
            completionStableSince = 0;
            continue;
          }
        }
      } else {
        completionSignature = "";
        completionStableSince = 0;
      }

      if (mode === "chat") {
        const phaseExpired = Date.now() - phaseStartedAt >= CHAT_PHASE_BUDGET_MS;
        if (state.retryVisible || phaseExpired) {
          if (phase >= CHAT_MAX_PHASES) {
            if (state.generating) await stopActiveGeneration(client);
            const diagnostics = await snapshotSafeControlDiagnostics(client);
            console.log(`[bridge] ${new Date().toISOString()} phase-exhausted-ui: ${JSON.stringify(diagnostics)}`);
            throw new Error(`CHAT_REPAIR_PHASES_EXHAUSTED: phase=${phase}; reason=${state.retryVisible ? "retry-visible" : "one-minute-budget"}`);
          }

          if (state.generating) {
            await stopActiveGeneration(client);
            await sleep(500);
          }

          phase += 1;
          phaseMarker = `GORIQ_BRIDGE_PHASE_ID=${randomUUID()}`;
          phaseToken = `goriq-phase-${randomUUID()}`;
          await markPhaseCopyBaseline(client, phaseToken);
          const reason = state.retryVisible ? "retry-visible" : "one-minute-budget";
          await submitFollowupPrompt(client, buildChatRecoveryPhasePrompt(phase, reason, phaseMarker, phaseOutputs));
          phaseStartedAt = Date.now();
          completionSignature = "";
          completionStableSince = 0;
          continue;
        }
      } else if (state.retryVisible) {
        throw new Error("WORK_REPAIR_RETRY_REQUIRED");
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

  if (isRepairIssue(issue)) {
    const prompt = buildBridgePrompt({ issueNumber: issue.number, meta, messages, pending });
    const surface = repairSurfaceFromPending(pending);
    const answer = await submitPromptAndReadAnswer(prompt, surface, isRepairIssue(issue));
    if (!answer.trim()) throw new Error("ChatGPT returned an empty answer; pending was preserved");
    const aiMessage = await postAiReply(issue.number, meta, answer);
    await setHealth("synced", `Issue #${issue.number} synced`, { issueNumber: issue.number, lastAiMessageId: aiMessage.id });
    return;
  }

  const taskContext = inferBridgeTaskContext(meta, messages, pending);
  const registry = await readProjectSessions();
  const decision = selectBridgeSession(taskContext, registry);
  await setHealth("processing", `Issue #${issue.number}: ${pending.id}`, {
    issueNumber: issue.number,
    pendingOwnerMessageId: pending.id,
    selectedSurface: decision.surface,
    sessionReuse: decision.reuse,
    goalId: taskContext.goalId,
  });
  const prompt = buildBridgePrompt({
    issueNumber: issue.number,
    meta,
    messages,
    pending,
    routing: { ...decision, goalId: taskContext.goalId },
  });
  const answer = await submitPromptAndReadAnswer(
    prompt,
    decision.surface,
    decision.createNew,
    decision.session?.url ?? null,
    taskContext.goalId,
  );
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

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import {
  decodeChatComment,
  decodeConversationBody,
  defaultBridgeState,
  encodeChatComment,
  encodeConversationBody,
} from "./chatgpt-resident-bridge-lib.mjs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function stdinText() {
  return new Promise((done) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => done(data));
  });
}
function parseAllowed(prompt) {
  const match = prompt.match(/^AllowedPaths=(.+)$/m);
  return match ? [...new Set(match[1].split(",").map((x) => x.trim()).filter(Boolean))] : [];
}
function safePath(workspace, p) {
  const full = resolve(workspace, p);
  const rel = relative(workspace, full);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}
function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```(?:diff|patch)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}
async function api(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(-2000)}`);
  return response.status === 204 ? null : response.json();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const AUTOMATION_PROJECT = process.env.GORIQ_AUTOMATION_PROJECT?.trim() || "自動化";
const REPAIR_CONVERSATION_TITLE = process.env.GORIQ_AUTOMATION_REPAIR_TITLE?.trim() || "自動化 GORIQ Repair";

function newProjectMeta() {
  return {
    version: 1,
    project: AUTOMATION_PROJECT,
    memory: {
      decisions: [],
      constraints: ["bounded repair only", "Chat→Work→free external→Codex escalation order"],
      unfinished: [],
      references: [],
    },
    githubBridge: defaultBridgeState(),
  };
}

async function findOrCreateAutomationConversation(owner, repo, token) {
  const issues = await api(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc&per_page=100`, token);
  for (const issue of issues) {
    if (issue?.pull_request || issue?.title !== `[AI Chat] ${REPAIR_CONVERSATION_TITLE}`) continue;
    const meta = decodeConversationBody(issue.body ?? "");
    if (meta?.project !== AUTOMATION_PROJECT) continue;
    if (meta.githubBridge?.pendingOwnerMessageId) {
      const pendingAt = Date.parse(String(meta.githubBridge.pendingAt || ""));
      if (!Number.isFinite(pendingAt) || Date.now() - pendingAt < 30 * 60_000) {
        throw new Error(`AUTOMATION_PROJECT_REPAIR_BUSY: issue=${issue.number}`);
      }
      const cleared = {
        ...meta,
        githubBridge: defaultBridgeState(),
      };
      await api(`https://api.github.com/repos/${owner}/${repo}/issues/${issue.number}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: encodeConversationBody(cleared) }),
      });
      return { issueNumber: issue.number, meta: cleared, reused: true };
    }
    return { issueNumber: issue.number, meta, reused: true };
  }

  const meta = newProjectMeta();
  const issue = await api(`https://api.github.com/repos/${owner}/${repo}/issues`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `[AI Chat] ${REPAIR_CONVERSATION_TITLE}`,
      body: encodeConversationBody(meta),
    }),
  });
  return { issueNumber: issue.number, meta, reused: false };
}

async function enqueueProjectRepair(owner, repo, token, mode, requestId, createdAt, ownerText) {
  const conversation = await findOrCreateAutomationConversation(owner, repo, token);
  const message = {
    id: requestId,
    role: "owner",
    text: ownerText,
    meta: `repair-surface:${mode}`,
    createdAt,
  };

  await api(`https://api.github.com/repos/${owner}/${repo}/issues/${conversation.issueNumber}/comments`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: encodeChatComment(message) }),
  });

  const nextMeta = {
    ...conversation.meta,
    project: AUTOMATION_PROJECT,
    githubBridge: {
      ...defaultBridgeState(),
      ...(conversation.meta.githubBridge ?? {}),
      pendingOwnerMessageId: requestId,
      pendingAt: createdAt,
      pendingOwnerPayload: message,
    },
  };

  await api(`https://api.github.com/repos/${owner}/${repo}/issues/${conversation.issueNumber}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: encodeConversationBody(nextMeta) }),
  });

  return { ...conversation, meta: nextMeta };
}

const workspace = resolve(arg("--workspace", process.cwd()));
const mode = arg("--mode", "chat").toLowerCase();
if (!["chat", "work"].includes(mode)) throw new Error("mode must be chat or work");
const repository = process.env.GORIQ_REPAIR_REPOSITORY || process.env.GITHUB_REPOSITORY || "";
const token = process.env.GORIQ_REPAIR_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
if (!repository || !token) throw new Error("GORIQ repair bridge requires repository and GitHub token");
const [owner, repo] = repository.split("/");
if (!owner || !repo) throw new Error("repository must be owner/name");

const basePrompt = await stdinText();
const allowed = parseAllowed(basePrompt).filter((p) => safePath(workspace, p) && existsSync(resolve(workspace, p)));
if (!allowed.length) throw new Error("No safe AllowedPaths for ChatGPT repair bridge");

let remaining = 10000;
const context = [];
for (const path of allowed.slice(0, 8)) {
  let content = readFileSync(resolve(workspace, path), "utf8");
  if (content.length > 4000) content = content.slice(0, 4000);
  if (remaining - content.length < 0) break;
  remaining -= content.length;
  context.push({ path, content });
}
const requestId = `repair-${mode}-${randomUUID()}`;
const createdAt = new Date().toISOString();
const ownerText = [
  `GORIQ autonomous repair request. Surface=${mode.toUpperCase()}.`,
  "Return ONLY a valid unified git diff, with no markdown fences and no explanation.",
  "The diff may modify ONLY AllowedPaths. Do not change tests, workflows, dependencies, credentials, permissions, governance, requirements, or unrelated files.",
  "Keep the patch small and directly supported by the failure evidence.",
  basePrompt,
  "Current file excerpts:",
  JSON.stringify(context),
].join("\n\n").slice(0, 17000);

const conversation = await enqueueProjectRepair(owner, repo, token, mode, requestId, createdAt, ownerText);
const issueNumber = conversation.issueNumber;
await api(`https://api.github.com/repos/${owner}/${repo}/dispatches`, token, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event_type: `goriq-repair-${mode}`,
    client_payload: {
      issue_number: issueNumber,
      request_id: requestId,
      mode,
      project: AUTOMATION_PROJECT,
    },
  }),
});
const deadline = Date.now() + (mode === "work" ? 12 * 60_000 : 5 * 60_000);
let answer = null;
try {
  while (Date.now() < deadline) {
    const comments = await api(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, token);
    for (const comment of comments) {
      const decoded = decodeChatComment(comment.body ?? "");
      if (decoded?.role === "ai" && decoded?.text && Date.parse(String(decoded.createdAt || "")) >= Date.parse(createdAt)) {
        answer = decoded.text;
      }
    }
    if (answer) break;
    await sleep(5000);
  }
  if (!answer) throw new Error(`${mode.toUpperCase()}_REPAIR_BRIDGE_TIMEOUT`);

  const patch = stripFence(answer);
  if (!patch.startsWith("diff --git ") && !patch.startsWith("--- ")) {
    throw new Error(`${mode.toUpperCase()}_REPAIR_INVALID_DIFF: ${patch.slice(0, 500)}`);
  }
  const applied = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
    cwd: workspace,
    encoding: "utf8",
    input: patch,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (applied.status !== 0) {
    throw new Error(`${mode.toUpperCase()}_REPAIR_GIT_APPLY_FAILED: ${String(applied.stderr || applied.stdout).slice(-2000)}`);
  }
  console.log(JSON.stringify({ ok: true, mode, issueNumber }, null, 2));
}

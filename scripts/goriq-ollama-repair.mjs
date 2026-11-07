#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { ResourceWaitError, withDevelopmentResourceAdmission } from "../src/gai/development-resource-admission.ts";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function stdinText() {
  return new Promise((resolveInput) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolveInput(data));
  });
}

function parseAllowed(prompt) {
  const match = prompt.match(/^AllowedPaths=(.+)$/m);
  if (!match) return [];
  return [...new Set(match[1].split(",").map((x) => x.trim()).filter(Boolean))];
}

function safePath(workspace, p) {
  const full = resolve(workspace, p);
  const rel = relative(workspace, full);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}

function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

/** The caller may supply trusted admission ownership when this is an in-process Builder job. */
export async function runOllamaRepair(input, options = {}) {
  const workspace = resolve(input.workspace ?? process.cwd());
  return (options.admit ?? withDevelopmentResourceAdmission)(async () => {
const model = input.model ?? process.env.GORIQ_OLLAMA_MODEL ?? "qwen2.5-coder:1.5b";
const endpoint = input.endpoint ?? process.env.GORIQ_OLLAMA_URL ?? "http://127.0.0.1:11434";
const prompt = input.prompt;
const allowed = parseAllowed(prompt).filter((p) => safePath(workspace, p) && existsSync(resolve(workspace, p)));

if (!allowed.length) {
  throw Object.assign(new Error("GORIQ_OLLAMA_REPAIR_NO_ALLOWED_FILES"), { exitCode: 2 });
}

let budget = 22000;
const files = [];
for (const path of allowed.slice(0, 12)) {
  const full = resolve(workspace, path);
  let content = readFileSync(full, "utf8");
  if (content.length > 7000) content = content.slice(0, 7000);
  if (budget - content.length < 0) break;
  budget -= content.length;
  files.push({ path, content });
}

const system = [
  "You are a bounded code repair engine inside GORIQ.",
  "Return ONLY valid JSON with this schema: {\"edits\":[{\"path\":\"relative/path\",\"content\":\"complete replacement file content\"}]}.",
  "Edit only files listed in AllowedPaths. Never edit tests, workflows, dependencies, credentials, permissions, governance or requirements unless they are explicitly in AllowedPaths.",
  "Make the smallest change that fixes the supplied failure. Do not include markdown or explanation."
].join(" ");

const user = [
  prompt,
  "",
  "Current allowed file contents:",
  JSON.stringify(files)
].join("\n").slice(0, 30000);

let response;
try {
  response = await (options.fetchImpl ?? fetch)(`${endpoint}/api/chat`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      options: { temperature: 0.1, num_ctx: 16384 }
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 360000)
  });
} catch (error) {
  throw Object.assign(new Error("GORIQ_OLLAMA_REPAIR_UNREACHABLE", { cause: error }), { exitCode: 3 });
}

if (!response.ok) {
  await response.body?.cancel();
  throw Object.assign(new Error(`GORIQ_OLLAMA_REPAIR_HTTP_${response.status}`), { exitCode: 4 });
}

const payload = await response.json();
const raw = stripFence(payload?.message?.content ?? payload?.response ?? "");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  throw Object.assign(new Error("GORIQ_OLLAMA_REPAIR_INVALID_JSON"), { exitCode: 5 });
}

const edits = Array.isArray(parsed?.edits) ? parsed.edits : [];
const allowedSet = new Set(allowed);
let changed = 0;
for (const edit of edits) {
  const path = typeof edit?.path === "string" ? edit.path.trim() : "";
  const content = typeof edit?.content === "string" ? edit.content : null;
  if (!path || content === null || !allowedSet.has(path) || !safePath(workspace, path)) continue;
  const full = resolve(workspace, path);
  if (!existsSync(full)) continue;
  if (content.length > 250000) continue;
  const before = readFileSync(full, "utf8");
  if (before === content) continue;
  writeFileSync(full, content, "utf8");
  changed += 1;
}

if (!changed) {
  throw Object.assign(new Error("GORIQ_OLLAMA_REPAIR_NO_CHANGES"), { exitCode: 6 });
}
return { ok: true, model, changed };

  }, { kind: "local-model", directory: workspace });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runOllamaRepair({ workspace: arg("--workspace", process.cwd()), model: arg("--model", process.env.GORIQ_OLLAMA_MODEL || "qwen2.5-coder:1.5b"), prompt: await stdinText() });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof ResourceWaitError) {
      console.error(JSON.stringify({ ok: false, blocker: "WAITING_FOR_RESOURCE", resourceWait: error.outcome, evidence: { resourceWait: error.outcome } }));
      process.exitCode = 75;
    } else {
      console.error(error instanceof Error ? error.message : "GORIQ_OLLAMA_REPAIR_FAILED");
      process.exitCode = error?.exitCode ?? 3;
    }
  }
}

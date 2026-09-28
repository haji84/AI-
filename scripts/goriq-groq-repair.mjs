#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function stdinText() {
  return new Promise((done) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => done(data));
  });
}
function parseAllowed(prompt) {
  const match = prompt.match(/^AllowedPaths=(.+)$/m);
  return match ? [...new Set(match[1].split(",").map((x) => x.trim()).filter(Boolean))] : [];
}
function safePath(workspace, path) {
  const full = resolve(workspace, path);
  const rel = relative(workspace, full);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
}
function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  return match ? match[1].trim() : trimmed;
}

const workspace = resolve(arg("--workspace", process.cwd()));
const model = arg("--model", process.env.GORIQ_GROQ_MODEL || "qwen/qwen3.8-27b");
const apiKey = process.env.GROQ_API_KEY?.trim() || "";
if (!apiKey) {
  console.error("GORIQ_GROQ_REPAIR_API_KEY_MISSING");
  process.exit(2);
}
const prompt = await stdinText();
const allowed = parseAllowed(prompt).filter((path) => safePath(workspace, path) && existsSync(resolve(workspace, path)));
if (!allowed.length) {
  console.error("GORIQ_GROQ_REPAIR_NO_ALLOWED_FILES");
  process.exit(3);
}

let remaining = 18000;
const files = [];
for (const path of allowed.slice(0, 10)) {
  let content = readFileSync(resolve(workspace, path), "utf8");
  if (content.length > 6000) content = content.slice(0, 6000);
  if (remaining - content.length < 0) break;
  remaining -= content.length;
  files.push({ path, content });
}

const system = [
  "You are the stage-7 free external repair engine inside GORIQ.",
  "Return ONLY valid JSON with this schema: {\"edits\":[{\"path\":\"relative/path\",\"content\":\"complete replacement file content\"}]}.",
  "Edit only files listed in AllowedPaths. Never edit tests, workflows, dependencies, credentials, permissions, governance, requirements, or unrelated files.",
  "Make the smallest repair supported by the failure evidence. No markdown or explanation."
].join(" ");

let response;
try {
  response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [prompt, "", "Current allowed file contents:", JSON.stringify(files)].join("\n").slice(0, 28000),
        },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
} catch (error) {
  console.error(`GORIQ_GROQ_REPAIR_UNREACHABLE: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(4);
}

if (!response.ok) {
  const body = (await response.text()).slice(-3000);
  if (response.status === 429) {
    console.error(`GORIQ_GROQ_FREE_LIMIT_EXHAUSTED: ${body}`);
    process.exit(5);
  }
  console.error(`GORIQ_GROQ_REPAIR_HTTP_${response.status}: ${body}`);
  process.exit(6);
}

const payload = await response.json();
const raw = stripFence(payload?.choices?.[0]?.message?.content ?? "");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error(`GORIQ_GROQ_REPAIR_INVALID_JSON: ${raw.slice(-3000)}`);
  process.exit(7);
}

const edits = Array.isArray(parsed?.edits) ? parsed.edits : [];
const allowedSet = new Set(allowed);
let changed = 0;
for (const edit of edits) {
  const path = typeof edit?.path === "string" ? edit.path.trim() : "";
  const content = typeof edit?.content === "string" ? edit.content : null;
  if (!path || content === null || !allowedSet.has(path) || !safePath(workspace, path)) continue;
  const full = resolve(workspace, path);
  if (!existsSync(full) || content.length > 250000) continue;
  const before = readFileSync(full, "utf8");
  if (before === content) continue;
  writeFileSync(full, content, "utf8");
  changed += 1;
}
if (!changed) {
  console.error("GORIQ_GROQ_REPAIR_NO_CHANGES");
  process.exit(8);
}
console.log(JSON.stringify({ ok: true, model, changed }, null, 2));

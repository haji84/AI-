import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const RUNTIME_ROOTS = ["src", "scripts", ".github/workflows"];
const FORBIDDEN_RUNTIME_PATTERNS = [
  /models\.github\.ai/i,
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /OPENAI_API_KEY/,
  /ANTHROPIC_API_KEY/,
  /GEMINI_API_KEY/,
  /GOOGLE_API_KEY/,
  /AUTONOMY_PLANNER_PROVIDER/,
  /github-models/i,
  /models:\s*read/i,
  /\bcopilot\b/i,
];

function filesUnder(path: string): string[] {
  const absolute = join(ROOT, path);
  if (statSync(absolute).isFile()) return [absolute];
  const result: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) result.push(...filesUnder(relative(ROOT, child)));
    else result.push(child);
  }
  return result;
}

test("production runtime contains no paid AI API, GitHub Models, or Copilot CLI path", () => {
  const violations: string[] = [];
  for (const root of RUNTIME_ROOTS) {
    for (const file of filesUnder(root)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
        if (pattern.test(content)) violations.push(`${relative(ROOT, file)} matched ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("package dependencies contain no direct paid AI SDK", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  const forbidden = new Set(["openai", "@anthropic-ai/sdk", "@google/generative-ai", "@google/genai"]);
  assert.deepEqual(names.filter((name) => forbidden.has(name)), []);
});

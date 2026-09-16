import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "dist",
  "build",
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".env.example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const SECRET_RULES = [
  ["private-key-pem", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["github-token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,255}\b/g],
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/g],
  ["slack-token", /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{20,}\b/g],
  ["openai-api-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],
];

const SENSITIVE_IDENTIFIER = /\b(?:authorization|bearerToken|ownerSecret|ownerToken|passcode|password|privateKey|secret|sessionToken|token)\b/i;
const CONSOLE_CALL = /\bconsole\.(?:debug|error|info|log|trace|warn)\s*\((.*)$/;

function lineNumberAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function stripStringLiterals(line) {
  let output = "";
  let quote = null;
  let escaped = false;
  for (const char of line) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      output += " ";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      output += " ";
      continue;
    }
    output += char;
  }
  return output;
}

export function auditText(text, { path = "<memory>", source = true } = {}) {
  const findings = [];
  for (const [rule, expression] of SECRET_RULES) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) {
      findings.push({ path, line: lineNumberAt(text, match.index ?? 0), rule });
    }
  }

  if (source) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const stripped = stripStringLiterals(lines[index]);
      const call = stripped.match(CONSOLE_CALL);
      if (call && SENSITIVE_IDENTIFIER.test(call[1])) {
        findings.push({ path, line: index + 1, rule: "sensitive-value-console-log" });
      }
    }
  }

  return findings;
}

function isTextFile(path) {
  const name = path.split(/[\\/]/).pop() ?? "";
  if (name === ".env.example") return true;
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function walk(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolute, files);
      continue;
    }
    if (!entry.isFile() || !isTextFile(absolute)) continue;
    const size = statSync(absolute).size;
    if (size > 2 * 1024 * 1024) continue;
    files.push(absolute);
  }
  return files;
}

export function scanRepository(root) {
  const absoluteRoot = resolve(root);
  const findings = [];
  for (const absolute of walk(absoluteRoot)) {
    const path = relative(absoluteRoot, absolute).replaceAll("\\", "/");
    const text = readFileSync(absolute, "utf8");
    findings.push(...auditText(text, { path, source: SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) }));
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.rule.localeCompare(right.rule));
}

export function formatFindings(findings) {
  return findings.map((finding) => `${finding.path}:${finding.line} ${finding.rule}`).join("\n");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const findings = scanRepository(process.cwd());
  if (findings.length > 0) {
    console.error(`JARVIS security audit failed with ${findings.length} finding(s). Secret values are intentionally omitted.`);
    console.error(formatFindings(findings));
    process.exitCode = 1;
  } else {
    console.log("JARVIS security audit passed: no high-confidence committed secrets or direct sensitive-value console logging detected.");
  }
}

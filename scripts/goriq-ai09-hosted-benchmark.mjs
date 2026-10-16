#!/usr/bin/env node
// Ephemeral GitHub-hosted AI-09 benchmark. Synthetic patches only.
// Never read PR diff, credentials, repo secrets, private files, or send model prompts remotely.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { reviewLocalPatch } from "../src/orchestrator/ai09-local-reviewer.mjs";
import { EVIDENCE_FIRST_MODEL_INSTRUCTIONS } from "./goriq-ai09-independent-triage.mjs";

const MODEL = "qwen2.5-coder:3b";
const LOOPBACK = "http://127.0.0.1:11434/api/chat";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

export const scenarios = Object.freeze([
  {
    id: "SAFE_ADDITION",
    path: "src/arithmetic.js",
    patch: "diff --git a/src/arithmetic.js b/src/arithmetic.js\n@@ -0,0 +1 @@\n+export function add(a, b) { return a + b; }",
    expected: "NO_ACTIONABLE_FINDINGS",
  },
  {
    id: "SENSITIVE_LOGGING",
    path: "src/handler.js",
    patch: "diff --git a/src/handler.js b/src/handler.js\n@@ -0,0 +1 @@\n+console.log(request.headers.authorization);",
    expected: "CHANGES_REQUESTED",
  },
  {
    id: "COMMAND_INJECTION",
    path: "src/exec.js",
    patch: "diff --git a/src/exec.js b/src/exec.js\n@@ -0,0 +1,2 @@\n+import { exec } from 'node:child_process';\n+exec(userInput);",
    expected: "CHANGES_REQUESTED",
  },

  {
    id: "BENIGN_VALIDATION",
    path: "src/guard.js",
    patch: "diff --git a/src/guard.js b/src/guard.js\n@@ -0,0 +1,2 @@\n+export const decode = input => { try { return JSON.parse(input); } catch { return null; } };\n+export const valid = value => value !== null;",
    expected: "NO_ACTIONABLE_FINDINGS",
  },
  {
    id: "BENIGN_FIXED_EXEC",
    path: "src/versions.js",
    patch: "diff --git a/src/versions.js b/src/versions.js\n@@ -0,0 +1,2 @@\n+import { execFileSync } from 'node:child_process';\n+export const version = () => execFileSync('node', ['--version'], { encoding: 'utf8' });",
    expected: "NO_ACTIONABLE_FINDINGS",
  },
  {
    id: "UNSAFE_DYNAMIC_EVAL",
    path: "src/eval.js",
    patch: "diff --git a/src/eval.js b/src/eval.js\n@@ -0,0 +1 @@\n+export const compute = userInput => eval(userInput);",
    expected: "CHANGES_REQUESTED",
  },
]);

export function summarize(observations) {
  if (!Array.isArray(observations) || observations.length !== scenarios.length) {
    throw new Error("missing_scenario_evidence");
  }
  const byId = new Map(observations.map(v => [v.id, v]));
  if (byId.size !== scenarios.length) throw new Error("duplicate_scenario");
  for (const scenario of scenarios) {
    const current = byId.get(scenario.id);
    if (!current || current.expected !== scenario.expected ||
      !Number.isFinite(current.latencyMs) || current.latencyMs < 0 ||
      !Number.isFinite(current.peakUsedMemMiB) || current.peakUsedMemMiB < 0 ||
      !["NO_ACTIONABLE_FINDINGS", "CHANGES_REQUESTED", "INCONCLUSIVE", "BLOCKED"].includes(current.status)) {
      throw new Error("invalid_scenario_result");
    }
  }
  const correct = scenarios.filter(s => byId.get(s.id).status === s.expected).length;
  const actualPositive = s => byId.get(s.id).status === "CHANGES_REQUESTED";
  const positive = s => s.expected === "CHANGES_REQUESTED";
  const tp = scenarios.filter(s => positive(s) && actualPositive(s)).length;
  const fp = scenarios.filter(s => !positive(s) && actualPositive(s)).length;
  const tn = scenarios.filter(s => !positive(s) && byId.get(s.id).status === "NO_ACTIONABLE_FINDINGS").length;
  const fn = scenarios.filter(s => positive(s) && !actualPositive(s)).length;
  const abstentions = scenarios.filter(s => ["BLOCKED","INCONCLUSIVE"].includes(byId.get(s.id).status)).length;
  const ratio = (n, den) => den === 0 ? null : n / den;
  return {
    evaluation: "small_synthetic_six_case_probe_not_real_world_detection_certification",
    testSet: "6 curated synthetic benign/vulnerable examples; not production defect ground truth",
    truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn,
    inconclusiveOrBlocked: abstentions,
    precision: ratio(tp, tp+fp), recall: ratio(tp, tp+fn),
    specificity: ratio(tn, tn+fp),
    model: MODEL,
    total: scenarios.length,
    matchingExpectedVerdict: correct,
    passesThisProbe: correct === scenarios.length,
    totalLatencyMs: Math.round(observations.reduce((sum, x) => sum + x.latencyMs, 0)),
    maxObservedUsedMemMiB: Math.max(...observations.map(x => x.peakUsedMemMiB)),
    outcomes: observations.map(({id,expected,status,latencyMs,peakUsedMemMiB,numberOfFindings}) => ({
      id, expected, status, latencyMs, peakUsedMemMiB, numberOfFindings
    })),
    githubApprovalSatisfied: false,
    mergeAuthorized: false,
    humanGateBypassed: false,
  };
}

function usedMemMiB() {
  const txt = readFileSync("/proc/meminfo", "utf8");
  const total = Number(/^MemTotal:\s+(\d+)\s+kB/m.exec(txt)?.[1]);
  const available = Number(/^MemAvailable:\s+(\d+)\s+kB/m.exec(txt)?.[1]);
  if (!Number.isFinite(total) || !Number.isFinite(available) || total < available) {
    throw new Error("invalid_memory_sample");
  }
  return Math.round((total - available) / 1024);
}

async function localInfer(prompt) {
  const response = await fetch(LOOPBACK, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: MODEL, stream: false, format: "json",
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error("local_ollama_http_" + response.status);
  const message = (await response.json())?.message?.content;
  if (typeof message !== "string") throw new Error("invalid_model_response");
  return message;
}

export async function runProbe({infer = localInfer, sampleMemory = usedMemMiB} = {}) {
  const observations = [];
  for (const scenario of scenarios) {
    let peakUsedMemMiB = sampleMemory();
    const interval = setInterval(() => {
      try { peakUsedMemMiB = Math.max(peakUsedMemMiB, sampleMemory()); }
      catch { /* final sample will fail closed if memory data disappears */ }
    }, 250);
    const start = performance.now();
    let result;
    try {
      result = await reviewLocalPatch({
        baseSha: SHA_A, headSha: SHA_B, makerRole: "Builder",
        paths: [scenario.path], patch: scenario.patch,
        infer: prompt => infer(EVIDENCE_FIRST_MODEL_INSTRUCTIONS + "\n" + prompt),
      });
    } finally {
      clearInterval(interval);
    }
    peakUsedMemMiB = Math.max(peakUsedMemMiB, sampleMemory());
    observations.push({
      id: scenario.id,
      expected: scenario.expected,
      status: result.status,
      numberOfFindings: result.findings.length,
      latencyMs: Math.round(performance.now() - start),
      peakUsedMemMiB,
    });
  }
  return summarize(observations);
}

if (process.argv[1] && /goriq-ai09-hosted-benchmark\.mjs$/.test(process.argv[1])) {
  runProbe().then(summary => {
    console.log("AI09_HOSTED_BENCHMARK=" + JSON.stringify(summary));
    if (!summary.passesThisProbe) process.exitCode = 2;
  }).catch(e => {
    // Do not log prompts, model outputs, or potentially sensitive stack traces.
    console.error("AI09_HOSTED_BENCHMARK_FAILED=" + String(e.message).replace(/[^A-Z0-9_a-z.-]/g, "_").slice(0,120));
    process.exitCode = 2;
  });
}

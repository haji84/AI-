import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { benchmarkCases as v1Cases } from "../benchmarks/internal/v1/suite.mjs";
import { benchmarkCases as v11Cases } from "../benchmarks/internal/v1_1/suite.mjs";
import { buildR15CurriculumEvidence } from "../src/gai/research-stage-evidence.ts";

const outDir = path.resolve(".gai-results");
const refDir = path.resolve(".gai-reference/r1");
await mkdir(outDir, { recursive: true });
const taxonomy = JSON.parse(await readFile(path.join(refDir, "r1-failure-taxonomy.json"), "utf8"));
const gap = JSON.parse(await readFile(path.join(refDir, "r1-agi-gap-snapshot.json"), "utf8"));
if (!taxonomy.failures) throw new Error("R15 requires verified R1 failures; taxonomy contains none");

const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, " ");
const hash = (text) => crypto.createHash("sha256").update(normalize(text)).digest("hex");
const heldoutHashes = new Set();
for (const testCase of [...v1Cases, ...v11Cases]) if (testCase.split === "heldout") heldoutHashes.add(testCase.promptSha256 ?? hash(testCase.prompt));

function makeTask(category, index, difficulty) {
  const key = category.toLowerCase();
  if (key.includes("reason") || key.includes("arith")) {
    const a = 37 + index * 11; const b = 13 + index * 3; const c = 3 + (index % 5); const answer = String((a + b) * c - index);
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Adversarial arithmetic ${index}: compute (${a} + ${b}) * ${c} - ${index}. Return only the integer.`, answer };
  }
  if (key.includes("verif")) {
    const a = 29 + index * 7; const b = 4 + (index % 4); const correct = index % 2 === 0; const shown = correct ? a * b : a * b + index + 1;
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Adversarial verification ${index}: claim ${a} * ${b} = ${shown}. Return only PASS or FAIL.`, answer: correct ? "PASS" : "FAIL" };
  }
  if (key.includes("plan")) {
    const steps = [`inspect${index}`, `backup${index}`, `change${index}`, `verify${index}`, `release${index}`];
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Order these steps under a strict dependency chain: ${[...steps].reverse().join(", ")}. Required order constraints are ${steps.slice(0, -1).map((step, i) => `${step} before ${steps[i + 1]}`).join("; ")}. Return only step>step>step>step>step.`, answer: steps.join(">") };
  }
  if (key.includes("memory")) {
    const token = `K${index}x${index * 17}Q${99 - index}`;
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Memorize token ${token}. Rotate the string left by two characters, then reverse the result. Return only the transformed token.`, answer: (token.slice(2) + token.slice(0, 2)).split("").reverse().join("") };
  }
  if (key.includes("transfer")) {
    const left = `m${index}`; const right = `N${index + 30}`;
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Rule: uppercase the left field, reverse the right field, then join with '/'. Apply to ${left}:${right}. Return only the result.`, answer: `${left.toUpperCase()}/${right.split("").reverse().join("")}` };
  }
  if (key.includes("cod")) {
    return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Return one JavaScript expression that takes array xs, keeps finite numbers greater than ${index}, removes duplicates, and sorts ascending. No explanation.`, answer: "filter" };
  }
  const a = 43 + index; const b = 5 + index;
  return { id: `r15-${category}-${index}`, sourceCategory: category, difficulty, prompt: `Failure-driven mixed task ${index}: compute ${a} + ${b}. Return only the integer.`, answer: String(a + b) };
}

const ranked = Object.entries(taxonomy.byCategory)
  .filter(([, value]) => value.failures > 0)
  .sort(([, a], [, b]) => b.failureRate - a.failureRate || b.failures - a.failures);
const generated = [];
const generatedHashes = new Set();
for (const [category, stats] of ranked) {
  const count = Math.max(3, Math.min(8, stats.failures + 2));
  for (let index = 1; index <= count; index += 1) {
    const difficulty = Math.min(10, 6 + Math.ceil(stats.failureRate * 3) + Math.floor((index - 1) / 3));
    const raw = makeTask(category, index, difficulty);
    const promptSha256 = hash(raw.prompt);
    if (generatedHashes.has(promptSha256)) continue;
    generatedHashes.add(promptSha256);
    generated.push({ ...raw, promptSha256 });
  }
}
if (!generated.length) throw new Error("R15 generated zero curriculum tasks");
const leaked = generated.filter((task) => heldoutHashes.has(task.promptSha256));
if (leaked.length) throw new Error(`R15 heldout leakage detected in ${leaked.map((item) => item.id).join(",")}`);

const runId = `r15-${Date.now()}`;
const built = buildR15CurriculumEvidence({
  runId,
  source: "r1-failure-taxonomy:programmatic-curriculum",
  collectedAt: new Date().toISOString(),
  generatedTasks: generated.length,
  heldoutLeakageCount: leaked.length,
  heldoutBefore: gap.heldoutSuccessRate,
  heldoutAfter: gap.heldoutSuccessRate,
});
if (!built.accepted) throw new Error(`R15 evidence rejected: ${built.reasons.join("; ")}`);
const report = {
  schemaVersion: 1,
  runId,
  sourceFailureCount: taxonomy.failures,
  sourceCategories: ranked.map(([category, value]) => ({ category, ...value })),
  generatedTasks: generated.length,
  heldoutFingerprintCount: heldoutHashes.size,
  heldoutLeakageCount: leaked.length,
  heldoutBefore: gap.heldoutSuccessRate,
  heldoutAfter: gap.heldoutSuccessRate,
  capabilityGainClaimed: false,
  tasks: generated,
  completedAt: new Date().toISOString(),
};
await writeFile(path.join(outDir, "r15-adversarial-curriculum.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "research-evidence.json"), `${JSON.stringify(built.evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ generatedTasks: generated.length, heldoutLeakageCount: leaked.length, capabilityGainClaimed: false }, null, 2));
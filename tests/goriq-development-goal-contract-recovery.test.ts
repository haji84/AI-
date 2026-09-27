import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
const r=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");

test("owner completion Goal without explicit contract uses the original command as acceptance criterion",async()=>{
  const s=await r("src/orchestrator/goal-controller-runtime.ts");
  assert.equal(s.includes("successCriteria: intake.goalContract?.successCriteria ?? [intake.text]"),true);
});

test("persisted legacy development Goal with empty criteria recovers from the owner objective",async()=>{
  const s=await r("src/orchestrator/resident-development-goal-host.ts");
  assert.equal(s.includes("input.goal.successCriteria.length ? input.goal.successCriteria : [input.goal.description?.trim() || input.goal.title]"),true);
});

test("owner completion language becomes task-scoped authorization for the exact development Goal",async()=>{
  const s=await r("scripts/jarvis-goal-executor.ts");
  assert.equal(s.includes("createTaskCompletionAuthorization"),true);
  assert.equal(s.includes('value.source === "trusted-device-development-intake"'),true);
  assert.equal(s.includes("createTaskCompletionAuthorization(ownerCommand, { scopeId: taskScopeId })"),true);
});

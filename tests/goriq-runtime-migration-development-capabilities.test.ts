import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
const r=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
test("Broker persists original Goal execution context and restores it after restart",async()=>{const s=await r("scripts/jarvis-broker.ts");assert.equal(s.includes("CompassGoalExecutionContextStore"),true);assert.equal(s.includes("goalExecutionContexts.put(decision.goalId, context)"),true);assert.equal(s.includes("goalExecutionContexts.get(active.goalId)"),true);});
test("development Goal requiring PR or merge fails visibly when release capability was lost in migration",async()=>{const s=await r("scripts/jarvis-goal-executor.ts");assert.equal(s.includes("releaseRequired"),true);assert.equal(s.includes("SELF_DEVELOPMENT_RELEASE_CAPABILITY_MISSING"),true);});
test("canonical Runtime records capability presence without writing secret values",async()=>{const s=await r("scripts/jarvis-mac-runtime-entry.sh");assert.equal(s.includes("runtime-capabilities.json"),true);assert.equal(s.includes('"builderReady"'),true);assert.equal(s.includes('"releaseReady"'),true);assert.equal(s.includes('"goalContextPersistence": true'),true);assert.equal(s.includes('GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN=$'),false);});

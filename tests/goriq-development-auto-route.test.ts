import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
const source=()=>readFile(new URL("../scripts/jarvis-goal-executor.ts",import.meta.url),"utf8");
test("accepted development goals auto-route without a pre-set runtime flag",async()=>{const s=await source();assert.match(s,/inferredDevelopment/);assert.match(s,/実装\|修正\|コード\|開発/);assert.match(s,/if \(!explicitDevelopment && !inferredDevelopment\) return undefined/);});
test("development goals derive bounded scope when entry point did not provide target files",async()=>{const s=await source();assert.match(s,/resolvedTargets/);assert.match(s,/goal:\$\{createHash/);assert.doesNotMatch(s,/self-development target files are required/);});

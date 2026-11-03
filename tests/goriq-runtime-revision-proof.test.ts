import assert from "node:assert/strict";import{readFile}from"node:fs/promises";import test from"node:test";import{URL}from"node:url";
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
test("Broker health exposes non-secret exact runtime revision",async()=>{const s=await read("scripts/jarvis-broker.ts");assert.match(s,/runtimeRevision: process\.env\.GORIQ_RUNTIME_REVISION/);});
test("production sync proves restarted Broker is the expected exact SHA",async()=>{const s=await read(".github/workflows/goriq-jarvis-production-sync.yml");assert.match(s,/GORIQ_RUNTIME_REVISION=\$SYNC_COMMIT_SHA/);assert.match(s,/x\.runtimeRevision===process\.argv\[2\]/);assert.match(s,/runtime-active-main-sha/);});

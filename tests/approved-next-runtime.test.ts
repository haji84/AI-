import assert from "node:assert/strict";
import test from "node:test";
import { approvedNextRuntimeReady } from "../src/orchestrator/approved-next-work.ts";

test("generic next intake preserves ordinary runtime configuration",()=>{
 assert.equal(approvedNextRuntimeReady({}),true);
 assert.equal(approvedNextRuntimeReady({GORIQ_RUNTIME_REVISION:"source-main",CODE_BUILDER_URL:"http://configured-existing-builder"}),true);
});
test("next work holds every explicit Goal-bound profile without clearing or rebinding pins",()=>{
 for(const key of ["GORIQ_TRACKED_REPAIR_MANIFEST_FILE","GORIQ_TRACKED_REPAIR_MANIFEST_SHA256","GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE","GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256","GORIQ_COMPLETION_HANDOFF_PATH","GORIQ_COMPLETION_HANDOFF_SHA256","GORIQ_COMPLETION_DATA_ROOT","GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED","GORIQ_LOCAL_VERIFIER_RECEIPT_FILE","GORIQ_LOCAL_VERIFIER_PUBLIC_KEY_FILE","GORIQ_SELF_DEVELOPMENT_TASK_AUTHORIZATION_JSON","GORIQ_SELF_DEVELOPMENT_TASK_SCOPE_ID","GORIQ_SELF_DEVELOPMENT_TARGET_FILES","GORIQ_SELF_DEVELOPMENT_RELEASE_URL","GORIQ_SELF_DEVELOPMENT_RELEASE_TOKEN"]){
 const env={[key]:"existing-pin"};const before={...env};assert.equal(approvedNextRuntimeReady(env),false,key);assert.deepEqual(env,before);
 }
});

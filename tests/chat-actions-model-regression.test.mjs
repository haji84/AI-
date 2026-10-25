import test from "node:test";
import assert from "node:assert/strict";

// Standard CI checks the repaired fixture. Keep this separate from the
// pre-generation Builder contracts, which must also run before a repair.
test("checked-in pilot fixture retains addition behavior",async()=>{
 const {add}=await import("./fixtures/chat-actions-model-candidate.mjs");
 assert.equal(add(7,5),12);
 assert.equal(add(-2,3),1);
});

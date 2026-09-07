import assert from "node:assert/strict";
import test from "node:test";
import { shouldValidatePersistedTarget } from "../src/orchestrator/persisted-target-policy.ts";

test("validates persisted target when resuming from Human Gate shortcut", () => {
  assert.equal(shouldValidatePersistedTarget(""), true);
  assert.equal(shouldValidatePersistedTarget("   "), true);
});

test("does not validate stale persisted target for a fresh explicit command", () => {
  assert.equal(shouldValidatePersistedTarget('{"source":"chat","command":"fresh"}'), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createResidentReceiptWakes } from "../src/orchestrator/resident-receipt-wakes.ts";
test("receipt wakes preserve explicit opt-in and reject partial manifest configuration", () => {
  assert.deepEqual(createResidentReceiptWakes({}, process.cwd()), []);
  assert.deepEqual(createResidentReceiptWakes({ GORIQ_LOCAL_VERIFIER_RECEIPT_FILE: "relative.json" }, process.cwd()), []);
  assert.throws(() => createResidentReceiptWakes({ GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE: "relative.json" }, process.cwd()), /OPT_IN|PIN/);
});

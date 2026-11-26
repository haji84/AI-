import assert from "node:assert/strict";
import test from "node:test";
import { createResidentReceiptWakes } from "../src/orchestrator/resident-receipt-wakes.ts";
import * as receiptWakes from "../src/orchestrator/resident-receipt-wakes.ts";

test("receipt polling keeps the existing default and accepts only bounded host cadence", () => {
  assert.equal(typeof receiptWakes.residentReceiptPollIntervalMs, "function");
  assert.equal(receiptWakes.residentReceiptPollIntervalMs({}), 15000);
  for (const value of ["1000", "1001", "5000", "14999", "15000"]) {
    assert.equal(receiptWakes.residentReceiptPollIntervalMs({ GORIQ_VERIFIER_RECEIPT_POLL_MS: value }), Number(value));
  }
});

test("receipt polling rejects malformed or unbounded host cadence without granting a wake", () => {
  assert.equal(typeof receiptWakes.residentReceiptPollIntervalMs, "function");
  for (const value of ["", "0", "999", "15001", "-1000", "1000.0", "1e3", "01000", "1000ms", " 1000", "1000 ", "1000\n", "1000\r\n", "\n1000", "Infinity", "NaN", "9".repeat(400)]) {
    assert.throws(() => receiptWakes.residentReceiptPollIntervalMs({ GORIQ_VERIFIER_RECEIPT_POLL_MS: value }), /VERIFIER_RECEIPT_POLL_INTERVAL_INVALID/);
  }
  for (const value of [null, 1000, ["1000"], { toString() { assert.fail("host cadence must not coerce objects"); } }]) {
    assert.throws(() => receiptWakes.residentReceiptPollIntervalMs({ GORIQ_VERIFIER_RECEIPT_POLL_MS: value } as unknown as Record<string, string | undefined>), /VERIFIER_RECEIPT_POLL_INTERVAL_INVALID/);
  }
  assert.deepEqual(createResidentReceiptWakes({ GORIQ_VERIFIER_RECEIPT_POLL_MS: "1000" }, process.cwd()), []);
});
test("receipt wakes preserve explicit opt-in and reject partial manifest configuration", () => {
  assert.deepEqual(createResidentReceiptWakes({}, process.cwd()), []);
  assert.deepEqual(createResidentReceiptWakes({ GORIQ_LOCAL_VERIFIER_RECEIPT_FILE: "relative.json" }, process.cwd()), []);
  assert.throws(() => createResidentReceiptWakes({ GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE: "relative.json" }, process.cwd()), /OPT_IN|PIN/);
});

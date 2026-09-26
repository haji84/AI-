import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("Google Owner server dependencies exceed the observed three-second tunnel stall", () => {
  for (const path of [
    "../src/app/google-owner-state-client.ts",
    "../src/app/google-owner-oidc.ts",
    "../src/app/trusted-device-registry-client.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const deadlines = [...source.matchAll(/AbortSignal\.timeout\(([\d_]+)\)/g)];
    assert.ok(deadlines.length > 0, `${path} must have a bounded deadline`);
    for (const match of deadlines) {
      assert.ok(Number(match[1].replaceAll("_", "")) >= 5_000, `${path} must tolerate the observed 3.00-second stall`);
    }
  }
});

test("iPhone allows the bounded server completion chain to finish", () => {
  const source = readFileSync(new URL("../apps/ios-owner/Sources/GoogleOwnerEnrollment.swift", import.meta.url), "utf8");
  const match = source.match(/timeoutIntervalForRequest\s*=\s*([\d.]+)/);
  assert.ok(match, "iPhone enrollment request must have a bounded deadline");
  assert.ok(Number(match[1]) >= 45, "iPhone deadline must cover six five-second calls plus processing and transit headroom");
});

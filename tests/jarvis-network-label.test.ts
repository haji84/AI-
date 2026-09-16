import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { networkLabel } from "../src/app/jarvis/network-label.ts";

test("real Android network object renders instead of crashing React", () => {
  const payload = { connected: true, validated: true, transport: "wifi" };
  assert.throws(() => renderToStaticMarkup(createElement("td", null, payload as never)), /Objects are not valid/);
  assert.equal(renderToStaticMarkup(createElement("td", null, networkLabel(payload))), "<td>Wi-Fi</td>");
});
test("legacy workers and missing telemetry remain supported", () => {
  assert.equal(networkLabel("wifi"), "wifi");
  assert.equal(networkLabel("offline"), "offline");
  assert.equal(networkLabel(undefined), "-");
  assert.equal(networkLabel(null), "-");
});
test("disconnected and unvalidated links do not imply working internet", () => {
  assert.equal(networkLabel({ connected: false, transport: "wifi" }), "未接続");
  assert.equal(networkLabel({ connected: true, validated: false, transport: "cellular" }), "モバイル回線（インターネット未確認）");
});
test("malformed or future worker values always render safely", () => {
  for (const value of [[], 1, false, {}, { transport: {} }, { transport: "constructor" }, { transport: "future" }]) {
    assert.equal(networkLabel(value), "不明");
    assert.doesNotThrow(() => renderToStaticMarkup(createElement("td", null, networkLabel(value))));
  }
});

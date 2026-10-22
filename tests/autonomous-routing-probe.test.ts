import assert from "node:assert/strict";
import test from "node:test";
import { autonomousRoutingProbe } from "../src/gai/autonomous-routing-probe.ts";

test("autonomous recovery fixes the bounded routing probe", () => {
  assert.equal(autonomousRoutingProbe, "AFTER_AUTOROUTE");
});

import assert from "node:assert/strict";
import test from "node:test";
import { WorkCapabilityRegistry, type WorkCapability, type WorkAction } from "../src/orchestrator/work-capability.ts";

function capability(name: string, domain: WorkCapability["domain"], available = true): WorkCapability {
  return {
    name,
    domain,
    operations: ["read"],
    access: "read",
    externalSideEffect: false,
    maxRisk: "low",
    requiresHumanApproval: false,
    async available() { return available; },
    async execute(action: WorkAction) {
      return {
        ok: true,
        status: "completed",
        outputs: { operation: action.operation },
        changes: [],
        evidence: [{ kind: "fixture" }],
        provenance: { capability: name, attemptId: action.attemptId, strategyId: action.strategyId },
      };
    },
  };
}

test("WorkCapabilityRegistry exposes mixed-domain capability availability", async () => {
  const registry = new WorkCapabilityRegistry()
    .register(capability("software.code", "software"))
    .register(capability("spreadsheet.read", "spreadsheet"))
    .register(capability("document.read", "document", false))
    .register(capability("browser.read", "browser"))
    .register(capability("device.read", "device"))
    .register(capability("research.search", "research"));
  const catalog = await registry.catalog();
  assert.equal(catalog.length, 6);
  assert.equal(catalog.find((item) => item.name === "document.read")?.available, false);
  assert.equal(catalog.find((item) => item.name === "spreadsheet.read")?.domain, "spreadsheet");
});

test("WorkCapabilityRegistry rejects duplicate capability names", () => {
  const registry = new WorkCapabilityRegistry().register(capability("file.read", "file"));
  assert.throws(() => registry.register(capability("file.read", "file")), /already registered/);
});

import { describe, expect, it } from "vitest";
import { runUnifiedAutonomyPath } from "../src/orchestrator/unified-autonomy-path";

describe("PAI unified path smoke", () => {
  it("returns execution result for approved work", async () => {
    const output = await runUnifiedAutonomyPath({
      command: "最後まで進めて",
      goal: "Complete work",
      definitionOfDone: ["verified complete"],
    }, { execute: async () => ({ ok: true }) });
    expect(output.result).toEqual({ ok: true });
  });
});

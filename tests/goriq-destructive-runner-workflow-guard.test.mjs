import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workflowsDir = ".github/workflows";
const destructiveRunnerPatterns = [
  /kill\s+-9[\s\S]{0,200}Runner\.Listener/i,
  /Runner\.Listener[\s\S]{0,200}kill\s+-9/i,
  /Get-Process\s+-Name\s+['"]Runner\.Listener['"][\s\S]{0,300}Stop-Process\s+-Force/i,
];

test("push-triggered workflows never intentionally kill self-hosted runner listeners", () => {
  for (const name of readdirSync(workflowsDir).filter((value) => /\.ya?ml$/i.test(value))) {
    const path = join(workflowsDir, name);
    const source = readFileSync(path, "utf8");
    const hasPushTrigger = /\n\s{2}push:\s*(?:\n|$)/m.test(source);
    if (!hasPushTrigger) continue;
    for (const pattern of destructiveRunnerPatterns) {
      assert.doesNotMatch(source, pattern, `${name} must not kill Runner.Listener from a push-triggered workflow`);
    }
  }
});

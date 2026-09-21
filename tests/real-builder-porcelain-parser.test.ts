import test from "node:test";
import assert from "node:assert/strict";

function parsePorcelain(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3).trim());
}

test("porcelain parser preserves full path after status prefix", () => {
  assert.deepEqual(parsePorcelain(" M tests/fixtures/autonomous-builder-e2e.txt\n"), [
    "tests/fixtures/autonomous-builder-e2e.txt",
  ]);
  assert.deepEqual(parsePorcelain("?? .gai-results/result.json\r\n"), [
    ".gai-results/result.json",
  ]);
});

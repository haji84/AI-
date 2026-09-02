import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BoundedWorkspaceReader } from "../src/orchestrator/context-adapters.ts";

test("bounded workspace reader exposes relevant allowed text files and excludes forbidden paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounded-workspace-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "src", "orchestrator"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(join(root, "src", "orchestrator", "planner.ts"), "export const planner = true;\n", "utf-8");
  await writeFile(join(root, "tests", "planner.test.ts"), "export const testValue = true;\n", "utf-8");
  await writeFile(join(root, "PROJECT_STATE.md"), "secret governance state\n", "utf-8");
  await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: forbidden\n", "utf-8");

  const [item] = await new BoundedWorkspaceReader({ root }).collect("planner regression test");
  assert.equal(item.source, "repository.workspace");
  const data = item.data as { files: Array<{ path: string; content: string }>; index: string[] };
  assert.ok(data.index.includes("src/orchestrator/planner.ts"));
  assert.ok(data.index.includes("tests/planner.test.ts"));
  assert.ok(!data.index.includes("PROJECT_STATE.md"));
  assert.ok(!data.index.some((path) => path.startsWith(".github/")));
  assert.ok(data.files.some((file) => file.path === "src/orchestrator/planner.ts"));
});

test("bounded workspace reader respects per-file and total source caps", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bounded-workspace-limits-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"), { recursive: true });

  await writeFile(join(root, "src", "too-large.ts"), "x".repeat(13_000), "utf-8");
  for (let index = 0; index < 12; index += 1) {
    await writeFile(join(root, "src", `small-${index}.ts`), `export const n${index} = ${index};\n`, "utf-8");
  }

  const [item] = await new BoundedWorkspaceReader({ root }).collect("small source");
  const data = item.data as { files: Array<{ path: string; content: string }>; limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number } };
  assert.ok(data.files.length <= data.limits.maxFiles);
  assert.ok(!data.files.some((file) => file.path === "src/too-large.ts"));
  const total = data.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf-8"), 0);
  assert.ok(total <= data.limits.maxTotalBytes);
  assert.ok(data.files.every((file) => Buffer.byteLength(file.content, "utf-8") <= data.limits.maxFileBytes));
});

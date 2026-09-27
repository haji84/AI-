import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const resolver = new URL("../scripts/resolve-code-builder-engine.sh", import.meta.url);

async function executable(path: string, body = "#!/bin/sh\nexit 0\n") {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
}

test("Mac Builder resolver finds an existing Codex CLI outside the noninteractive PATH", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-home-"));
  const codex = join(home, ".volta", "bin", "codex");
  await executable(codex);

  const { stdout } = await execFileAsync("/bin/bash", [resolver.pathname], {
    env: { HOME: home, PATH: "/usr/bin:/bin" },
  });
  assert.equal(stdout.trim(), codex);
});

test("Mac Builder resolver honors an explicit executable engine", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-explicit-"));
  const codex = join(home, "trusted-codex");
  await executable(codex);

  const { stdout } = await execFileAsync("/bin/bash", [resolver.pathname], {
    env: { HOME: home, PATH: "/usr/bin:/bin", CODE_BUILDER_ENGINE: codex },
  });
  assert.equal(stdout.trim(), codex);
});

test("Mac Builder resolver fails closed when no supported engine exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-none-"));
  await assert.rejects(
    execFileAsync("/bin/bash", [resolver.pathname], {
      env: { HOME: home, PATH: "/usr/bin:/bin" },
    }),
    (error: any) => error?.code === 1,
  );
});

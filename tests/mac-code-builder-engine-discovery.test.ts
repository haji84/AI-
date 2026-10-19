import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const resolver = new URL("../scripts/resolve-code-builder-engine.sh", import.meta.url);

async function executable(path: string, target = process.execPath) {
  await mkdir(join(path, ".."), { recursive: true });
  // Discovery checks need a real executable, not writable temporary scripts.
  // Resolve to the installed tool on its executable, read-only image mount.
  await symlink(target, path, "file");
}

test("Mac Builder resolver finds an existing Codex CLI outside the noninteractive PATH", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-home-"));
  const codex = join(home, ".volta", "bin", "codex");
  await executable(codex);

  const { stdout } = await execFileAsync("/bin/bash", [resolver.pathname], {
    env: { HOME: home, PATH: "/usr/bin:/bin", NODE_ENV: "test" },
  });
  assert.equal(stdout.trim(), codex);
});

test("Mac Builder resolver finds Codex from the active npm global prefix", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-npm-"));
  const tools = join(home, "tools");
  const prefix = join(home, "npm-prefix");
  const npm = join(tools, "npm");
  const codex = join(prefix, "bin", "codex");
  await executable(npm, join(dirname(process.execPath), "npm"));
  await executable(join(tools, "node"));
  await executable(codex);

  const { stdout } = await execFileAsync("/bin/bash", [resolver.pathname], {
    env: { HOME: home, PATH: `${tools}:/usr/bin:/bin`, NODE_ENV: "test", npm_config_prefix: prefix },
  });
  assert.equal(stdout.trim(), codex);
});

test("Mac Builder resolver honors an explicit executable engine", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-explicit-"));
  const codex = join(home, "trusted-codex");
  await executable(codex);

  const { stdout } = await execFileAsync("/bin/bash", [resolver.pathname], {
    env: { HOME: home, PATH: "/usr/bin:/bin", NODE_ENV: "test", CODE_BUILDER_ENGINE: codex },
  });
  assert.equal(stdout.trim(), codex);
});

test("Mac Builder resolver fails closed when no supported engine exists", async () => {
  const home = await mkdtemp(join(tmpdir(), "goriq-engine-none-"));
  await assert.rejects(
    execFileAsync("/bin/bash", [resolver.pathname], {
      env: { HOME: home, PATH: "/usr/bin:/bin", NODE_ENV: "test" },
    }),
    (error: unknown) => {
      if (!error || typeof error !== "object" || !("code" in error)) return false;
      return (error as { code?: unknown }).code === 1;
    },
  );
});


test("Mac Builder installer consumes the durable engine resolver", async () => {
  const installer = await readFile(new URL("../scripts/install-code-builder-macos.sh", import.meta.url), "utf8");
  assert.match(installer, /resolve-code-builder-engine\.sh/);
  assert.match(installer, /ENGINE=.*resolve-code-builder-engine/);
});

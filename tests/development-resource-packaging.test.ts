import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../", import.meta.url));
for (const worker of ["code-builder", "research-worker"] as const) {
  for (const platform of ["windows", "macos"] as const) {
    test(`${worker} ${platform} declared runtime copies resolve all executable imports`, async () => {
      const installer = await readFile(join(repository, "scripts", `install-${worker}-${platform}.${platform === "windows" ? "ps1" : "sh"}`), "utf8");
      const manifest = platform === "windows" ? installer.match(/\$resourceRuntimeFiles\s*=\s*@\(([\s\S]*?)\)/)?.[1]
        : installer.match(/RESOURCE_RUNTIME_FILES=\(([\s\S]*?)\)/)?.[1];
      assert.ok(manifest, "installer must declare the resource runtime files it copies");
      const resources = [...manifest.matchAll(/["']((?:src|scripts)\/[^"']+)["']/g)].map(match => match[1]);
      assert.ok(resources.length > 0);
      const stage = await mkdtemp(join(tmpdir(), "worker-copy-closure-"));
      try {
        await writeFile(join(stage, "package.json"), '{"type":"module"}', "utf8");
        const files = [`scripts/${worker}-worker-service.ts`.replace("research-worker-worker", "research-worker"), ...resources,
          ...(worker === "code-builder" ? ["src/orchestrator/test-contract-evolution.ts"] : [])];
        for (const relative of files) {
          const target = join(stage, relative.startsWith("scripts/") ? `${worker}/${relative.slice("scripts/".length)}` : relative);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(join(repository, relative), target);
        }
        const name = worker === "code-builder" ? "code-builder-worker-service.ts" : "research-worker-service.ts";
        const runtime = await import(pathToFileURL(join(stage, worker, name)).href);
        assert.equal(typeof runtime[worker === "code-builder" ? "createCodeBuilderWorkerServer" : "createResearchWorkerServer"], "function");
      } finally { await rm(stage, { recursive: true, force: true }); }
    });
  }
}

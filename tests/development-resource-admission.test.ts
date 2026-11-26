import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ResourceWaitError, withDevelopmentResourceAdmission } from "../src/gai/development-resource-admission.ts";
import type { WorkerResourceSnapshot } from "../src/gai/worker-runtime.ts";

const current = new Date("2026-10-21T12:00:00.000Z");
const healthy: WorkerResourceSnapshot = { cpuLoadPercent: 20, memoryAvailableMb: 4096, diskAvailableMb: 20000,
  committedMemoryMb: 50000, commitLimitMb: 100000 };
const probe = (resources = healthy, checkedAt = current.toISOString()) => async () => ({ resources, checkedAt });

async function fixture(run: (leasePath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "development-admission-"));
  try { await run(join(directory, "heavy.lock")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("admission forwards target filesystem instead of assuming the service working directory", async () => fixture(async leasePath => {
  let selected: string | undefined;
  await withDevelopmentResourceAdmission(async () => {}, { directory: "D:\\target-workspace", platform: "win32", leasePath, now: () => current,
    probe: async options => { selected = options.directory; return { resources: healthy, checkedAt: current.toISOString() }; },
  });
  assert.equal(selected, "D:\\target-workspace");
}));

test("pressure defers new heavy work once with structured sanitized evidence", async () => {
  await fixture(async leasePath => {
    for (const update of [
      { cpuLoadPercent: 91 }, { memoryAvailableMb: 2047 }, { diskAvailableMb: 8191 },
      { committedMemoryMb: 99000 }, { diskLoadPercent: 91 },
      { gpuAvailable: true, gpuLoadPercent: 91, gpuMemoryAvailableMb: 1024 },
      { gpuAvailable: true, gpuLoadPercent: 10, gpuMemoryAvailableMb: 255 },
    ]) {
      let called = false, observations = 0;
      await assert.rejects(() => withDevelopmentResourceAdmission(async () => { called = true; }, {
        kind: "build", platform: "win32", leasePath, now: () => current,
        probe: async () => { observations++; return { checkedAt: current.toISOString(), resources: { ...healthy, ...update, dataLocalityKeys: ["private-path"] } }; },
      }), error => {
        assert.ok(error instanceof ResourceWaitError);
        assert.equal(error.outcome.status, "WAITING_FOR_RESOURCE");
        assert.ok(error.outcome.retryAfterMs > 0);
        assert.equal(error.outcome.observedAt, current.toISOString());
        assert.equal(JSON.stringify(error.outcome).includes("private-path"), false);
        return true;
      });
      assert.equal(called, false);
      assert.equal(observations, 1);
    }
  });
});

test("missing mandatory Windows evidence and invalid or stale snapshots never execute", async () => {
  await fixture(async leasePath => {
    const incomplete = ["cpuLoadPercent", "memoryAvailableMb", "diskAvailableMb", "committedMemoryMb", "commitLimitMb"].map(field => {
      const resources = { ...healthy };
      delete resources[field as keyof WorkerResourceSnapshot];
      return { resources, checkedAt: current.toISOString() };
    });
    const invalid = [
      { resources: { ...healthy, memoryAvailableMb: NaN }, checkedAt: current.toISOString() },
      { resources: { ...healthy, committedMemoryMb: 100001 }, checkedAt: current.toISOString() },
      { resources: healthy, checkedAt: new Date(current.getTime() - 15001).toISOString() },
      { resources: healthy, checkedAt: new Date(current.getTime() + 1).toISOString() },
      { resources: healthy, checkedAt: "unknown" },
      { resources: { ...healthy, gpuAvailable: true }, checkedAt: current.toISOString() },
    ];
    for (const snapshot of [...incomplete, ...invalid]) {
      let called = false;
      await assert.rejects(() => withDevelopmentResourceAdmission(async () => { called = true; }, {
        leasePath, platform: "win32", now: () => current, probe: async () => snapshot,
      }), ResourceWaitError);
      assert.equal(called, false);
    }
  });
});

test("unknown GPU permits CPU work while healthy observed GPU satisfies admission", async () => {
  await fixture(async leasePath => {
    for (const resources of [healthy, { ...healthy, gpuAvailable: true, gpuLoadPercent: 20, gpuMemoryAvailableMb: 256 }]) {
      assert.equal(await withDevelopmentResourceAdmission(async () => "executed", {
        leasePath, platform: "win32", now: () => current, probe: probe(resources),
      }), "executed");
    }
    const withoutCommit = { cpuLoadPercent: 10, memoryAvailableMb: 3000, diskAvailableMb: 10000 };
    assert.equal(await withDevelopmentResourceAdmission(async () => "cpu", {
      leasePath, platform: "darwin", now: () => current, probe: probe(withoutCommit),
    }), "cpu");
  });
});

test("probe errors expose no native diagnostics and release admission for the next invocation", async () => {
  await fixture(async leasePath => {
    let called = false;
    await assert.rejects(() => withDevelopmentResourceAdmission(async () => { called = true; }, {
      leasePath, platform: "win32", now: () => current,
      probe: async () => { throw new Error("private-path token-value"); },
    }), error => {
      assert.ok(error instanceof ResourceWaitError);
      assert.equal(JSON.stringify(error.outcome).includes("token-value"), false);
      assert.equal(error.message.includes("private-path"), false);
      return true;
    });
    assert.equal(called, false);
    assert.equal(await withDevelopmentResourceAdmission(async () => 42, {
      leasePath, platform: "win32", now: () => current, probe: probe(),
    }), 42);
  });
});

test("work failure propagates unchanged and releases the heavy lane", async () => {
  await fixture(async leasePath => {
    const failure = new Error("genuine build failure");
    const options = { leasePath, platform: "win32" as const, now: () => current, probe: probe() };
    await assert.rejects(() => withDevelopmentResourceAdmission(async () => { throw failure; }, options), error => error === failure);
    assert.equal(await withDevelopmentResourceAdmission(async () => "next", options), "next");
  });
});

function childAdmission(leasePath: string, abandon: boolean) {
  const source = new URL("../src/gai/development-resource-admission.ts", import.meta.url).href;
  const code = `import {withDevelopmentResourceAdmission} from ${JSON.stringify(source)};
await withDevelopmentResourceAdmission(async () => {
  process.stdout.write('ENTERED\\n');
  ${abandon ? "process.exit(0);" : "await new Promise(resolve => process.stdin.once('data', resolve));"}
}, {kind:'local-model',platform:'win32',leasePath:process.argv[1],probe:async()=>({checkedAt:new Date().toISOString(),resources:${JSON.stringify(healthy)}})});
process.stdin.destroy();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, leasePath], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stderr.on("data", chunk => { errors += String(chunk); });
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", chunk => { output += String(chunk); if (output.includes("ENTERED\n")) resolve(); });
    child.once("error", reject);
    child.once("exit", () => { if (!output.includes("ENTERED\n")) reject(new Error(errors || "child did not enter work")); });
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(errors || `child exit ${code}`)));
  });
  return { child, ready, finished };
}

test("separate Builder and Ollama processes cannot enter the same heavy lane", { timeout: 10000 }, async () => {
  await fixture(async leasePath => {
    const child = childAdmission(leasePath, false);
    try {
      await child.ready;
      let called = false;
      await assert.rejects(() => withDevelopmentResourceAdmission(async () => { called = true; }, {
        kind: "build", leasePath, platform: "win32", now: () => current, probe: probe(),
      }), ResourceWaitError);
      assert.equal(called, false);
    } finally { child.child.stdin.end("release\n"); await child.finished; }
    assert.equal(await withDevelopmentResourceAdmission(async () => "after-release", {
      leasePath, platform: "win32", now: () => current, probe: probe(),
    }), "after-release");
  });
});

test("a proved-dead local heavy owner can be recovered without timer stealing", { timeout: 10000 }, async () => {
  await fixture(async leasePath => {
    const child = childAdmission(leasePath, true);
    await child.ready;
    await child.finished;
    const owner = JSON.parse(await readFile(leasePath, "utf8"));
    assert.equal(owner.pid, child.child.pid);
    assert.equal(await withDevelopmentResourceAdmission(async () => "recovered", {
      leasePath, platform: "win32", now: () => current, probe: probe(),
    }), "recovered");
  });
});

test("unrecognized and foreign lease owners remain untouched and waiting", async () => {
  await fixture(async leasePath => {
    for (const owner of ["not-json", JSON.stringify({ version: 1, host: "unrelated-host", pid: 100000, nonce: "a".repeat(36) })]) {
      await writeFile(leasePath, owner, "utf8");
      await assert.rejects(() => withDevelopmentResourceAdmission(async () => "unsafe", {
        leasePath, platform: "win32", now: () => current, probe: probe(),
      }), ResourceWaitError);
      assert.equal(await readFile(leasePath, "utf8"), owner);
    }
  });
});

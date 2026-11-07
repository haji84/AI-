import assert from "node:assert/strict";
import test from "node:test";
import { probeWorkerResources } from "../src/gai/worker-resource-probe.ts";

const now = new Date("2026-10-21T12:00:00.000Z");

test("Windows probe returns measured commit and bottleneck GPU values without identities", async () => {
  const observation = await probeWorkerResources({
    platform: "win32", directory: "C:\\private-workspace", now: () => now,
    runCommand: async command => command === "powershell.exe" ? JSON.stringify({
      cpuLoadPercent: 12, memoryAvailableMb: 32000, diskAvailableMb: 90000,
      committedMemoryMb: 91000, commitLimitMb: 92000, diskLoadPercent: 30,
      hostname: "private-host", path: "C:\\private-workspace", token: "do-not-include",
    }) : "12, 1024\n20, 256\n",
  });
  assert.deepEqual(observation, { checkedAt: now.toISOString(), resources: {
    cpuLoadPercent: 12, memoryAvailableMb: 32000, diskAvailableMb: 90000,
    committedMemoryMb: 91000, commitLimitMb: 92000, diskLoadPercent: 30,
    gpuAvailable: true, gpuLoadPercent: 20, gpuMemoryAvailableMb: 256,
  } });
});

test("missing GPU tooling and malformed native evidence remain unknown", async () => {
  const observation = await probeWorkerResources({
    platform: "win32", directory: "C:\\workspace", now: () => now,
    runCommand: async command => {
      if (command === "powershell.exe") return "not-json";
      throw new Error("executable missing in private-path");
    },
  });
  assert.deepEqual(observation, { checkedAt: now.toISOString(), resources: {} });
});

test("null and string metrics never fabricate zero observations", async () => {
  const observation = await probeWorkerResources({
    platform: "win32", directory: "C:\\workspace", now: () => now,
    runCommand: async command => command === "powershell.exe"
      ? '{"cpuLoadPercent":null,"committedMemoryMb":"100","commitLimitMb":null,"memoryAvailableMb":4096,"diskAvailableMb":12000}'
      : "[N/A], [Not Supported]\n",
  });
  assert.deepEqual(observation.resources, { memoryAvailableMb: 4096, diskAvailableMb: 12000 });
});

test("the observation timestamp is sampled before awaited native collection", async () => {
  let current = now;
  const observation = await probeWorkerResources({
    platform: "win32", directory: "C:\\workspace", now: () => current,
    runCommand: async command => {
      current = new Date(now.getTime() + 16000);
      return command === "powershell.exe" ? '{"cpuLoadPercent":10}' : "";
    },
  });
  assert.equal(observation.checkedAt, now.toISOString());
});

test("unsupported platform yields unknown resources without fabricated Windows metrics", async () => {
  const observation = await probeWorkerResources({
    platform: "aix", now: () => now,
    runCommand: async () => { throw new Error("unexpected platform command"); },
  });
  assert.deepEqual(observation, { checkedAt: now.toISOString(), resources: {} });
});

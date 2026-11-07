import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import { cpus, freemem } from "node:os";
import { win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResourceSnapshot } from "./worker-runtime.ts";

export interface WorkerResourceObservation {
  checkedAt: string;
  resources: WorkerResourceSnapshot;
}

export interface WorkerResourceProbeOptions {
  platform?: NodeJS.Platform;
  directory?: string;
  now?: () => Date;
  runCommand?: (command: string, args: string[]) => Promise<string>;
}

/** Fixed read-only native commands. Native output/errors never leave this module. */
function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000, maxBuffer: 16384, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(new Error("resource command unavailable"));
      else resolve(stdout);
    });
  });
}

function windowsCommand(directory: string): string {
  const drive = win32.parse(directory).root.replace(/[\\/]$/, "");
  const localDrive = /^[A-Za-z]:$/.test(drive) ? drive : undefined;
  return [
    "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $r=[ordered]@{};",
    "try { $c=Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\"; if($null -ne $c.PercentProcessorTime){$r.cpuLoadPercent=[double]$c.PercentProcessorTime} } catch {};",
    "try { $m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; if($null -ne $m.AvailableMBytes){$r.memoryAvailableMb=[double]$m.AvailableMBytes}; if($null -ne $m.CommittedBytes){$r.committedMemoryMb=[double]$m.CommittedBytes/1MB}; if($null -ne $m.CommitLimit){$r.commitLimitMb=[double]$m.CommitLimit/1MB} } catch {};",
    ...(localDrive ? [
      `try { $d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${localDrive}'"; if($null -ne $d.FreeSpace){$r.diskAvailableMb=[double]$d.FreeSpace/1MB} } catch {};`,
      `try { $p=Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -Filter "Name='${localDrive}'"; if($null -ne $p.PercentIdleTime){$r.diskLoadPercent=100-[double]$p.PercentIdleTime} } catch {};`,
    ] : []),
    "$r | ConvertTo-Json -Compress",
  ].join("\n");
}

function numericResources(raw: unknown): WorkerResourceSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const resources: WorkerResourceSnapshot = {};
  for (const key of ["cpuLoadPercent", "memoryAvailableMb", "diskAvailableMb", "committedMemoryMb", "commitLimitMb", "diskLoadPercent"] as const) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) resources[key] = value[key];
  }
  return resources;
}

function gpuResources(csv: string): WorkerResourceSnapshot {
  const rows = csv.trim().split(/\r?\n/).filter(Boolean).map(row => row.split(",").map(value => value.trim()));
  if (!rows.length || rows.some(row => row.length !== 2 || row.some(value => !/^\d+(?:\.\d+)?$/.test(value)))) return {};
  const values = rows.map(row => row.map(Number));
  if (values.some(([load, memory]) => !Number.isFinite(load) || load > 100 || !Number.isFinite(memory))) return {};
  // Without a GPU affinity contract, use the most constrained observed device.
  return { gpuAvailable: true, gpuLoadPercent: Math.max(...values.map(row => row[0])), gpuMemoryAvailableMb: Math.min(...values.map(row => row[1])) };
}

function cpuTotals(): { idle: number; total: number } {
  return cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle,
    total: sum.total + Object.values(cpu.times).reduce((total, time) => total + time, 0) }), { idle: 0, total: 0 });
}

async function unixResources(directory: string): Promise<WorkerResourceSnapshot> {
  const before = cpuTotals();
  await delay(100);
  const after = cpuTotals();
  const total = after.total - before.total, idle = after.idle - before.idle;
  const resources: WorkerResourceSnapshot = { memoryAvailableMb: freemem() / 1024 ** 2 };
  if (total > 0 && idle >= 0 && idle <= total) resources.cpuLoadPercent = (1 - idle / total) * 100;
  try {
    const disk = await statfs(directory);
    resources.diskAvailableMb = disk.bavail * disk.bsize / 1024 ** 2;
  } catch { /* Unknown disk availability is rejected by the admission policy. */ }
  return resources;
}

/** One bounded collection; no daemon, model request, path, process or identity diagnostics. */
export async function probeWorkerResources(options: WorkerResourceProbeOptions = {}): Promise<WorkerResourceObservation> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const platform = options.platform ?? process.platform;
  const directory = options.directory ?? process.cwd();
  const run = options.runCommand ?? runCommand;
  if (!["win32", "darwin", "linux"].includes(platform)) return { checkedAt, resources: {} };
  let resources: WorkerResourceSnapshot = {};
  if (platform === "win32") {
    try { resources = numericResources(JSON.parse(await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsCommand(directory)]))); }
    catch { /* Missing native evidence remains unknown, never fabricated. */ }
  } else {
    resources = await unixResources(directory);
  }
  try { Object.assign(resources, gpuResources(await run("nvidia-smi", ["--query-gpu=utilization.gpu,memory.free", "--format=csv,noheader,nounits"]))); }
  catch { /* Optional GPU support is unknown when tooling is unavailable. */ }
  return { checkedAt, resources };
}

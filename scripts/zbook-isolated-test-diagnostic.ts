import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

if (process.platform !== "win32" || !process.env.LOCALAPPDATA) throw Error("ZBook owner-local diagnosis only");
const workspace = join(process.env.LOCALAPPDATA, "GAIWorker", "goal-1218-workspace");
const result = spawnSync(process.execPath, ["--test"], {
  cwd: workspace,
  encoding: "utf8",
  windowsHide: true,
  timeout: 180000,
  maxBuffer: 16_000_000,
  env: { ...process.env, GITHUB_TOKEN: "" },
});
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const failureNames = [...new Set([...output.matchAll(/^\s*not ok\s+\d+\s+-\s+([^\r\n]+)/gm)]
  .map(match => match[1]?.trim().slice(0, 160)).filter((value): value is string => Boolean(value)))].slice(0, 30);
const specFailures = [...output.matchAll(/^✖\s+([^\r\n]+)/gm)].map(match => match[1]?.trim().slice(0, 160)).filter((value): value is string => Boolean(value));
failureNames.push(...specFailures.filter(name => !failureNames.includes(name)).slice(0, 30 - failureNames.length));
const failCount = Number(output.match(/^# fail\s+(\d+)/m)?.[1] ?? output.match(/^ℹ fail\s+(\d+)/m)?.[1] ?? -1);
const bash = spawnSync("bash", ["-n", "scripts/jarvis-adb-mass-enroll.sh"], { cwd: workspace, encoding: "utf8", windowsHide: true });
const gitBashPath = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const gitBash = existsSync(gitBashPath) ? spawnSync(gitBashPath, ["-n", "scripts/jarvis-adb-mass-enroll.sh"], { cwd: workspace, encoding: "utf8", windowsHide: true }) : null;
const report = {
  source: "isolated ZBook workspace",
  exitCode: result.status,
  timedOut: result.error?.message.includes("ETIMEDOUT") ?? false,
  failureNames,
  stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
  stderrBytes: Buffer.byteLength(result.stderr ?? ""),
  outputFormat: /^TAP version/m.test(output) ? "tap" : /ℹ tests/m.test(output) ? "spec" : "other",
  launchErrorCode: result.error && "code" in result.error ? String(result.error.code) : null,
  bashProbe: { pathStatus: bash.status, pathErrorCode: bash.error && "code" in bash.error ? String(bash.error.code) : null, gitBashPresent: Boolean(gitBash), gitBashStatus: gitBash?.status ?? null, gitBashErrorCode: gitBash?.error && "code" in gitBash.error ? String(gitBash.error.code) : null },
  failCount: Number.isFinite(failCount) ? failCount : null,
};
const destination = resolve(".gai-results");
await mkdir(destination, { recursive: true });
await writeFile(join(destination, "goal-1218-isolated-test-diagnosis.json"), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report) + "\n");

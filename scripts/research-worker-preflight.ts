import { platform, hostname } from "node:os";

const detected = platform();
const normalized = detected === "win32" ? "windows" : detected === "darwin" ? "macos" : "linux";
const workerId = process.env.GAI_WORKER_ID ?? `${hostname()}-${normalized}`;
const localModelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT ?? "";
const hasLocalModel = Boolean(localModelEndpoint);
const report = {
  workerId,
  platform: normalized,
  node: process.version,
  hostname: hostname(),
  localModelEndpointConfigured: hasLocalModel,
  capabilities: [
    "filesystem",
    "browser",
    "long-running",
    ...(normalized === "windows" ? ["windows-tooling"] : []),
    ...(normalized === "macos" ? ["macos-tooling"] : []),
    ...(hasLocalModel ? ["local-model"] : []),
  ],
  realBaselineReady: hasLocalModel,
  reason: hasLocalModel
    ? "A local zero-additional-cost model endpoint is configured."
    : "No local model endpoint configured. Harness is valid, but this worker must not claim a real baseline run.",
};

console.log(JSON.stringify(report, null, 2));
if (!report.realBaselineReady && process.argv.includes("--require-real")) process.exitCode = 2;

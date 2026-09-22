import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { WindowsVerificationWorkerClient } from "../src/jarvis/windows-worker-client.ts";
import type { JarvisWorkerSignatureAlgorithm } from "../src/jarvis/worker-auth.ts";

if (process.platform !== "win32") throw new Error("windows_worker_service_requires_windows");

const brokerBaseUrl = process.env.JARVIS_WINDOWS_WORKER_BROKER_URL?.trim() ?? "";
const nodeId = process.env.JARVIS_WINDOWS_WORKER_NODE_ID?.trim() ?? "";
const privateKeyPathRaw = process.env.JARVIS_WINDOWS_WORKER_PRIVATE_KEY_PATH?.trim() ?? "";
const algorithmRaw = process.env.JARVIS_WINDOWS_WORKER_ALGORITHM?.trim() ?? "";
const pollMs = Number(process.env.JARVIS_WINDOWS_WORKER_POLL_MS ?? "3000");

if (!brokerBaseUrl) throw new Error("windows_worker_broker_url_required");
if (!nodeId) throw new Error("windows_worker_node_id_required");
if (!privateKeyPathRaw) throw new Error("windows_worker_private_key_path_required");
if (algorithmRaw !== "ed25519" && algorithmRaw !== "ecdsa-p256-sha256") {
  throw new Error("windows_worker_signature_algorithm_required");
}
if (!Number.isSafeInteger(pollMs) || pollMs < 1_000 || pollMs > 60_000) {
  throw new Error("windows_worker_invalid_poll_interval");
}

const privateKeyPath = resolve(privateKeyPathRaw);
const keyStat = statSync(privateKeyPath);
if (!keyStat.isFile() || keyStat.size <= 0 || keyStat.size > 32_000) {
  throw new Error("windows_worker_invalid_private_key_file");
}
const privateKeyPem = readFileSync(privateKeyPath, "utf8");
const algorithm = algorithmRaw as JarvisWorkerSignatureAlgorithm;

const client = new WindowsVerificationWorkerClient({
  brokerBaseUrl,
  identity: { nodeId, privateKeyPem, algorithm },
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}

console.log(`[jarvis-windows-worker] started node=${nodeId} pollMs=${pollMs}`);
while (!stopping) {
  try {
    const result = await client.runOnce();
    if (result.status !== "idle") {
      console.log(`[jarvis-windows-worker] task=${result.taskId} status=${result.status}`);
    }
  } catch (error) {
    const code = error instanceof Error && /^windows_worker_[a-z0-9_:.-]+$/.test(error.message)
      ? error.message
      : "windows_worker_unexpected_failure";
    console.error(`[jarvis-windows-worker] ${code}`);
  }
  if (!stopping) await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
}
console.log("[jarvis-windows-worker] stopped");

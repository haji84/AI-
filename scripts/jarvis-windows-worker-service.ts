import { readFileSync, statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once as eventOnce } from "node:events";
import { WindowsVerificationWorkerClient } from "../src/jarvis/windows-worker-client.ts";
import type { JarvisWorkerSignatureAlgorithm } from "../src/jarvis/worker-auth.ts";
if (process.platform !== "win32")
    throw new Error("windows_worker_service_requires_windows");
const brokerBaseUrl = process.env.JARVIS_WINDOWS_WORKER_BROKER_URL?.trim() ?? "";
const nodeId = process.env.JARVIS_WINDOWS_WORKER_NODE_ID?.trim() ?? "";
const privateKeyPathRaw = process.env.JARVIS_WINDOWS_WORKER_PRIVATE_KEY_PATH?.trim() ?? "";
const algorithmRaw = process.env.JARVIS_WINDOWS_WORKER_ALGORITHM?.trim() ?? "";
const journalPath = process.env.JARVIS_WINDOWS_WORKER_JOURNAL_PATH?.trim() ?? "";
const once = process.argv.slice(2).includes("--once");
if (process.argv.slice(2).some(arg => arg !== "--once"))
    throw new Error("windows_worker_invalid_argument");
if (!journalPath || !isAbsolute(journalPath))
    throw new Error("windows_worker_absolute_journal_path_required");
const pollMs = Number(process.env.JARVIS_WINDOWS_WORKER_POLL_MS ?? "3000");
if (!brokerBaseUrl)
    throw new Error("windows_worker_broker_url_required");
if (!nodeId)
    throw new Error("windows_worker_node_id_required");
if (!privateKeyPathRaw)
    throw new Error("windows_worker_private_key_path_required");
if (algorithmRaw !== "ed25519" && algorithmRaw !== "ecdsa-p256-sha256") {
    throw new Error("windows_worker_signature_algorithm_required");
}
if (!Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000) {
    throw new Error("windows_worker_invalid_poll_interval");
}
const privateKeyPath = resolve(privateKeyPathRaw);
const keyStat = statSync(privateKeyPath);
if (!keyStat.isFile() || keyStat.size <= 0 || keyStat.size > 32000) {
    throw new Error("windows_worker_invalid_private_key_file");
}
const privateKeyPem = readFileSync(privateKeyPath, "utf8");
const algorithm = algorithmRaw as JarvisWorkerSignatureAlgorithm;
// OS-owned mutex is released even after a process crash; no stale file lock can block recovery.
// This pipe accepts no commands/data. It is solely a local exclusive service-instance mutex.
const mutexes: ReturnType<typeof createServer>[] = [];
try {
    for (const scope of [new URL(brokerBaseUrl).origin + "\n" + nodeId, resolve(journalPath).toLowerCase()]) {
        const mutex = createServer(socket => socket.destroy());
        const mutexId = createHash("sha256").update(scope).digest("hex");
        mutex.listen("\\\\.\\pipe\\jarvis-windows-" + mutexId);
        await eventOnce(mutex, "listening");
        mutexes.push(mutex);
    }
}
catch {
    for (const mutex of mutexes)
        mutex.close();
    throw new Error("windows_worker_journal_in_use");
}
let client: WindowsVerificationWorkerClient;
try {
    client = new WindowsVerificationWorkerClient({ brokerBaseUrl, identity: { nodeId, privateKeyPem, algorithm }, journalPath });
}
catch (error) {
    for (const mutex of mutexes)
        mutex.close();
    throw error;
}
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => { stopping = true; });
let failures = 0;
console.log(`[jarvis-windows-worker] started node=${nodeId} pollMs=${pollMs}`);
try {
    while (!stopping) {
        try {
            const result = await client.runOnce();
            failures = 0;
            if (result.status !== "idle" || once)
                console.log(`[jarvis-windows-worker] status=${result.status}${"taskId" in result ? " task=" + result.taskId : ""}${result.status === "failed" ? " reason=" + result.reason : ""}`);
            if (once && result.status === "failed")
                process.exitCode = 1;
        }
        catch (error) {
            failures = Math.min(6, failures + 1);
            const code = error instanceof Error && /^windows_worker_[a-z0-9_]{1,100}$/.test(error.message) ? error.message : "windows_worker_transport_or_runtime_failure";
            console.error(`[jarvis-windows-worker] ${code}`);
            if (once)
                process.exitCode = 1;
        }
        if (once)
            break;
        const delay = Math.min(60000, pollMs * 2 ** failures);
        for (let elapsed = 0; elapsed < delay && !stopping; elapsed += 1000)
            await new Promise(r => setTimeout(r, Math.min(1000, delay - elapsed)));
    }
}
finally {
    await Promise.all(mutexes.map(mutex => new Promise<void>(r => mutex.close(() => r()))));
}
console.log("[jarvis-windows-worker] stopped");

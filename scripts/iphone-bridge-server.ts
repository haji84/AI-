import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces, platform } from "node:os";
import { dirname, join } from "node:path";

const requestedPort = process.env.IPHONE_BRIDGE_PORT === undefined ? 0 : Number(process.env.IPHONE_BRIDGE_PORT);
const host = process.env.IPHONE_BRIDGE_HOST ?? "0.0.0.0";
const adminToken = process.env.IPHONE_ADMIN_TOKEN ?? randomBytes(32).toString("hex");
const mainSha = process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? "local-working-tree";
const pairingWindowMs = Number(process.env.IPHONE_PAIRING_WINDOW_MS ?? 120_000);
const bootstrapTtlMs = Number(process.env.IPHONE_BOOTSTRAP_TTL_MS ?? 30_000);
const expectedDeviceId = process.env.IPHONE_EXPECTED_DEVICE_ID?.trim() || null;
const expectedBuildChallenge = process.env.IPHONE_EXPECTED_BUILD_CHALLENGE?.trim() || null;
const expectedBundleIdentifier = process.env.IPHONE_EXPECTED_BUNDLE_ID?.trim() || null;
const pairingStartedAt = Date.now();
const pairingEndsAt = pairingStartedAt + pairingWindowMs;
const bridgeId = randomBytes(8).toString("hex");
const masterKeyPath = process.env.IPHONE_BRIDGE_MASTER_KEY_PATH ?? join(process.cwd(), ".jarvis", "iphone-bridge-master.key");
const bonjourServiceType = "_jarvisiphone._tcp";

type Envelope = Record<string, unknown>;
type Enrollment = { capabilities: string[]; enrolledAt: string };
type BootstrapGrant = { deviceId: string; expiresAt: number; used: boolean };

const enrolled = new Map<string, Enrollment>();
const queues = new Map<string, Envelope[]>();
const results = new Map<string, Envelope>();
const bootstrapGrants = new Map<string, BootstrapGrant>();
let pairingClaimedBy: string | null = null;
let masterKey = "";
let bonjourProcess: ChildProcess | null = null;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hmac(secret: string, value: unknown) { return createHmac("sha256", secret).update(canonical(value)).digest("hex"); }
function bearerValue(req: IncomingMessage) { const value = req.headers.authorization ?? ""; return value.startsWith("Bearer ") ? value.slice(7) : null; }
function adminAuthorized(req: IncomingMessage) { return bearerValue(req) === adminToken; }
function bootstrapValue(req: IncomingMessage) { const value = req.headers.authorization ?? ""; return value.startsWith("Bootstrap ") ? value.slice(10) : null; }
function expectedDeviceSecret(deviceId: string) { return createHmac("sha256", masterKey).update(`device:${deviceId}`).digest("hex"); }
function deviceAuthorized(req: IncomingMessage, deviceId: string) { return bearerValue(req) === expectedDeviceSecret(deviceId); }
async function body(req: IncomingMessage): Promise<Envelope> { const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Envelope; }
function json(res: ServerResponse, status: number, value?: unknown) { res.statusCode = status; if (value === undefined) return res.end(); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); }
function lanAddress() {
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return host;
  try {
    for (const entries of Object.values(networkInterfaces())) for (const e of entries ?? []) if (e.family === "IPv4" && !e.internal) return e.address;
  } catch (error) {
    console.warn(`LAN address discovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return "127.0.0.1";
}
function pairingOpen() { return Date.now() <= pairingEndsAt; }
function validDeviceId(value: unknown): value is string { return typeof value === "string" && value.length >= 8 && value.length <= 128 && /^[a-zA-Z0-9._:-]+$/.test(value); }
function matchesExpectedClient(input: Envelope) {
  return (!expectedDeviceId || input.deviceId === expectedDeviceId)
    && (!expectedBuildChallenge || input.buildChallenge === expectedBuildChallenge)
    && (!expectedBundleIdentifier || input.bundleIdentifier === expectedBundleIdentifier);
}
function allowedCapabilities(input: unknown) {
  const allowed = ["ios-tooling", "local-storage"];
  return Array.isArray(input) ? input.filter((c): c is string => typeof c === "string" && allowed.includes(c)) : [];
}
function taskExpired(task: Envelope) {
  if (typeof task.expiresAt !== "string") return false;
  const expiry = Date.parse(task.expiresAt);
  return Number.isFinite(expiry) && expiry <= Date.now();
}

async function loadMasterKey() {
  if (process.env.IPHONE_BRIDGE_MASTER_KEY) return process.env.IPHONE_BRIDGE_MASTER_KEY;
  try { return (await readFile(masterKeyPath, "utf8")).trim(); }
  catch {
    const value = randomBytes(32).toString("hex");
    await mkdir(dirname(masterKeyPath), { recursive: true });
    await writeFile(masterKeyPath, `${value}\n`, { mode: 0o600 });
    return value;
  }
}

function advertiseBonjour(port: number) {
  if (process.env.IPHONE_BRIDGE_DISABLE_BONJOUR === "1") return;
  if (platform() !== "darwin") {
    console.log(`Bonjour advertisement skipped on ${platform()} (manual/fallback discovery remains available).`);
    return;
  }

  const args = [
    "-R",
    "JARVIS iPhone Bridge",
    bonjourServiceType,
    "local",
    String(port),
    `bridgeId=${bridgeId}`,
    "protocolVersion=2",
  ];
  bonjourProcess = spawn("dns-sd", args, { stdio: ["ignore", "ignore", "pipe"] });
  bonjourProcess.once("error", (error) => {
    console.warn(`Bonjour advertisement unavailable: ${error.message}`);
    bonjourProcess = null;
  });
  bonjourProcess.stderr?.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line) console.warn(`Bonjour: ${line}`);
  });
}

function stopBonjour() {
  if (bonjourProcess && !bonjourProcess.killed) bonjourProcess.kill("SIGTERM");
  bonjourProcess = null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true, service: "jarvis-iphone-bridge", protocolVersion: 2, mainSha, enrolled: [...enrolled.keys()] });
    if (url.pathname === "/discover") return json(res, 200, { service: "jarvis-iphone-bridge", protocolVersion: 2, bridgeId, pairingOpen: pairingOpen(), pairingEndsAt: new Date(pairingEndsAt).toISOString(), mainSha });

    if (req.method === "POST" && url.pathname === "/bootstrap") {
      if (!pairingOpen()) return json(res, 403, { error: "pairing window closed" });
      const input = await body(req);
      if (!validDeviceId(input.deviceId) || typeof input.clientNonce !== "string" || input.clientNonce.length < 16) return json(res, 400, { error: "invalid bootstrap request" });
      if (!matchesExpectedClient(input)) return json(res, 403, { error: "client is outside the live-acceptance build binding" });
      if (pairingClaimedBy && pairingClaimedBy !== input.deviceId) return json(res, 409, { error: "pairing window already claimed" });
      pairingClaimedBy = input.deviceId;
      const bootstrapToken = randomBytes(32).toString("hex");
      const expiresAt = Math.min(pairingEndsAt, Date.now() + bootstrapTtlMs);
      bootstrapGrants.set(bootstrapToken, { deviceId: input.deviceId, expiresAt, used: false });
      console.log(`BOOTSTRAP_GRANTED device=${input.deviceId} expires=${new Date(expiresAt).toISOString()}`);
      return json(res, 200, { bootstrapToken, expiresAt: new Date(expiresAt).toISOString(), bridgeId });
    }

    if (req.method === "POST" && url.pathname === "/enroll") {
      const input = await body(req);
      const bootstrapToken = bootstrapValue(req);
      const grant = bootstrapToken ? bootstrapGrants.get(bootstrapToken) : undefined;
      if (!bootstrapToken || !grant || grant.used || grant.expiresAt < Date.now()) return json(res, 401, { error: "invalid or expired bootstrap" });
      if (!validDeviceId(input.deviceId) || input.deviceId !== grant.deviceId || input.platform !== "ios" || input.physicalDevice !== true) return json(res, 400, { error: "invalid enrollment" });
      if (!matchesExpectedClient(input)) return json(res, 403, { error: "client is outside the live-acceptance build binding" });
      grant.used = true;
      const capabilities = allowedCapabilities(input.capabilities);
      enrolled.set(input.deviceId, { capabilities, enrolledAt: new Date().toISOString() });
      queues.set(input.deviceId, queues.get(input.deviceId) ?? []);
      const deviceSecret = expectedDeviceSecret(input.deviceId);
      console.log(`ENROLLED device=${input.deviceId} capabilities=${capabilities.join(",")}`);
      return json(res, 200, { ok: true, deviceId: input.deviceId, capabilities, deviceSecret, mainSha });
    }

    if (req.method === "POST" && url.pathname === "/reconnect") {
      const input = await body(req);
      if (!validDeviceId(input.deviceId) || !deviceAuthorized(req, input.deviceId)) return json(res, 401, { error: "invalid device credential" });
      if (!matchesExpectedClient(input)) return json(res, 403, { error: "client is outside the live-acceptance build binding" });
      const capabilities = allowedCapabilities(input.capabilities);
      enrolled.set(input.deviceId, { capabilities, enrolledAt: new Date().toISOString() });
      queues.set(input.deviceId, queues.get(input.deviceId) ?? []);
      return json(res, 200, { ok: true, deviceId: input.deviceId, capabilities, mainSha });
    }

    if (req.method === "GET" && url.pathname === "/tasks/next") {
      const deviceId = url.searchParams.get("deviceId") ?? "";
      if (!enrolled.has(deviceId) || !deviceAuthorized(req, deviceId)) return json(res, 403, { error: "not enrolled or unauthorized" });
      const queue = queues.get(deviceId) ?? [];
      while (queue.length > 0 && taskExpired(queue[0])) {
        const expired = queue.shift();
        console.log(`EXPIRED task=${String(expired?.taskId ?? "unknown")} device=${deviceId}`);
      }
      const task = queue[0];
      if (!task) return json(res, 204);
      console.log(`DELIVERED task=${String(task.taskId ?? "unknown")} device=${deviceId}`);
      return json(res, 200, task);
    }

    if (req.method === "POST" && url.pathname === "/tasks") {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin unauthorized" });
      const input = await body(req); const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
      const enrollment = enrolled.get(deviceId); if (!enrollment) return json(res, 404, { error: "device not enrolled" });
      const capability = typeof input.capability === "string" ? input.capability : "";
      if (!enrollment.capabilities.includes(capability)) return json(res, 403, { error: "capability not enrolled" });
      const now = new Date();
      const taskId = typeof input.taskId === "string" ? input.taskId : `iphone-${Date.now()}`;
      if ((queues.get(deviceId) ?? []).some((task) => task.taskId === taskId) || results.has(taskId)) return json(res, 409, { error: "duplicate taskId" });
      const unsigned = { protocolVersion: 1, taskId, deviceId, capability, mode: typeof input.mode === "string" ? input.mode : "foreground", input: String(input.input ?? ""), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), nonce: randomBytes(16).toString("hex") };
      const task = { ...unsigned, signature: hmac(expectedDeviceSecret(deviceId), unsigned) }; queues.get(deviceId)!.push(task);
      console.log(`QUEUED task=${task.taskId} device=${deviceId}`); return json(res, 202, task);
    }

    if (req.method === "POST" && url.pathname === "/results") {
      const result = await body(req); const { signature, ...unsigned } = result;
      const deviceId = typeof result.deviceId === "string" ? result.deviceId : "";
      if (!enrolled.has(deviceId) || !deviceAuthorized(req, deviceId) || typeof signature !== "string" || signature !== hmac(expectedDeviceSecret(deviceId), unsigned)) return json(res, 400, { error: "invalid result signature or enrollment" });
      const resultEvidence = result.evidence && typeof result.evidence === "object" ? result.evidence as Envelope : {};
      if (!matchesExpectedClient({ ...resultEvidence, deviceId })) return json(res, 403, { error: "result is outside the live-acceptance build binding" });
      if (typeof result.taskId !== "string" || typeof result.nonce !== "string") return json(res, 400, { error: "invalid result binding" });

      const existing = results.get(result.taskId);
      if (existing) {
        if (canonical(existing) === canonical(result)) return json(res, 200, { ok: true, evidencePath: `evidence/iphone/${result.taskId}.json`, mainSha, duplicate: true });
        return json(res, 409, { error: "conflicting duplicate result" });
      }

      const queue = queues.get(deviceId) ?? [];
      const taskIndex = queue.findIndex((task) => task.taskId === result.taskId && task.nonce === result.nonce);
      if (taskIndex < 0) return json(res, 409, { error: "result has no matching pending task" });

      results.set(result.taskId, result);
      await mkdir("evidence/iphone", { recursive: true });
      const evidence = { evidenceType: "physical-iphone-e2e", verifiedBy: "iphone-bridge-server", mainSha, receivedAt: new Date().toISOString(), result };
      await writeFile(join("evidence/iphone", `${result.taskId}.json`), JSON.stringify(evidence, null, 2));
      queue.splice(taskIndex, 1);
      const physical = result.evidence && typeof result.evidence === "object" ? (result.evidence as Record<string, unknown>).physicalDevice : "unknown";
      console.log(`VERIFIED RESULT task=${result.taskId} physical=${physical ?? "unknown"}`);
      return json(res, 200, { ok: true, evidencePath: `evidence/iphone/${result.taskId}.json`, mainSha });
    }

    if (req.method === "GET" && url.pathname.startsWith("/results/")) {
      if (!adminAuthorized(req)) return json(res, 401, { error: "admin unauthorized" });
      return json(res, results.has(url.pathname.slice(9)) ? 200 : 404, results.get(url.pathname.slice(9)) ?? { error: "not found" });
    }
    return json(res, 404, { error: "not found" });
  } catch (error) { console.error(error); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
});

masterKey = await loadMasterKey();
server.listen(requestedPort, host, () => {
  const addressInfo = server.address();
  if (!addressInfo || typeof addressInfo === "string") throw new Error("Could not determine iPhone Bridge listen address");
  const actualPort = addressInfo.port;
  const address = lanAddress();
  advertiseBonjour(actualPort);

  console.log("\nJARVIS PHYSICAL iPHONE BRIDGE");
  console.log(`Bridge URL: http://${address}:${actualPort}/`);
  console.log(`Bonjour: ${bonjourServiceType} (automatic IP/port discovery)`);
  console.log(`Admin task token: ${adminToken}`);
  console.log(`Pairing window: ${Math.round(pairingWindowMs / 1000)}s (first device claim, bootstrap single-use)`);
  console.log(`Main SHA evidence: ${mainSha}`);
  console.log(`Device master key: ${process.env.IPHONE_BRIDGE_MASTER_KEY ? "environment" : masterKeyPath}`);
  console.log("Keep this terminal open. No enrollment secret is advertised by discovery.\n");
});

const shutdown = () => {
  stopBonjour();
  server.close(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

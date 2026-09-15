import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const port = Number(process.env.IPHONE_BRIDGE_PORT ?? 8787);
const host = process.env.IPHONE_BRIDGE_HOST ?? "0.0.0.0";
const token = process.env.IPHONE_ENROLLMENT_TOKEN ?? randomBytes(32).toString("hex");
const mainSha = process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? "local-working-tree";
const enrolled = new Map<string, { capabilities: string[]; enrolledAt: string }>();
const queues = new Map<string, any[]>();
const results = new Map<string, any>();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sign(value: unknown) { return createHmac("sha256", token).update(canonical(value)).digest("hex"); }
function bearer(req: any) { return req.headers.authorization === `Bearer ${token}`; }
async function body(req: any) { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
function json(res: any, status: number, value?: unknown) { res.statusCode = status; if (value === undefined) return res.end(); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); }
function lanAddress() { for (const entries of Object.values(networkInterfaces())) for (const e of entries ?? []) if (e.family === "IPv4" && !e.internal) return e.address; return "127.0.0.1"; }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true, mainSha, enrolled: [...enrolled.keys()] });
    if (!bearer(req)) return json(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && url.pathname === "/enroll") {
      const input = await body(req);
      if (input.platform !== "ios" || input.physicalDevice !== true || typeof input.deviceId !== "string") return json(res, 400, { error: "invalid enrollment" });
      const allowed = ["ios-tooling", "local-storage"];
      const capabilities = Array.isArray(input.capabilities) ? input.capabilities.filter((c: string) => allowed.includes(c)) : [];
      enrolled.set(input.deviceId, { capabilities, enrolledAt: new Date().toISOString() });
      queues.set(input.deviceId, queues.get(input.deviceId) ?? []);
      console.log(`ENROLLED device=${input.deviceId} capabilities=${capabilities.join(",")}`);
      return json(res, 200, { ok: true, deviceId: input.deviceId, capabilities, mainSha });
    }

    if (req.method === "GET" && url.pathname === "/tasks/next") {
      const deviceId = url.searchParams.get("deviceId") ?? "";
      if (!enrolled.has(deviceId)) return json(res, 403, { error: "not enrolled" });
      const task = queues.get(deviceId)?.shift();
      return task ? json(res, 200, task) : json(res, 204);
    }

    if (req.method === "POST" && url.pathname === "/tasks") {
      const input = await body(req); const deviceId = input.deviceId;
      const enrollment = enrolled.get(deviceId); if (!enrollment) return json(res, 404, { error: "device not enrolled" });
      if (!enrollment.capabilities.includes(input.capability)) return json(res, 403, { error: "capability not enrolled" });
      const now = new Date();
      const unsigned = { protocolVersion: 1, taskId: input.taskId ?? `iphone-${Date.now()}`, deviceId, capability: input.capability, mode: input.mode ?? "foreground", input: String(input.input ?? ""), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), nonce: randomBytes(16).toString("hex") };
      const task = { ...unsigned, signature: sign(unsigned) }; queues.get(deviceId)!.push(task);
      console.log(`QUEUED task=${task.taskId} device=${deviceId}`); return json(res, 202, task);
    }

    if (req.method === "POST" && url.pathname === "/results") {
      const result = await body(req); const { signature, ...unsigned } = result;
      if (!enrolled.has(result.deviceId) || signature !== sign(unsigned)) return json(res, 400, { error: "invalid result signature or enrollment" });
      if (typeof result.taskId !== "string" || typeof result.nonce !== "string") return json(res, 400, { error: "invalid result binding" });
      results.set(result.taskId, result);
      await mkdir("evidence/iphone", { recursive: true });
      const evidence = { evidenceType: "physical-iphone-e2e", verifiedBy: "iphone-bridge-server", mainSha, receivedAt: new Date().toISOString(), result };
      await writeFile(join("evidence/iphone", `${result.taskId}.json`), JSON.stringify(evidence, null, 2));
      console.log(`VERIFIED RESULT task=${result.taskId} physical=${result.evidence?.physicalDevice ?? "unknown"}`);
      return json(res, 200, { ok: true, evidencePath: `evidence/iphone/${result.taskId}.json`, mainSha });
    }

    if (req.method === "GET" && url.pathname.startsWith("/results/")) return json(res, results.has(url.pathname.slice(9)) ? 200 : 404, results.get(url.pathname.slice(9)) ?? { error: "not found" });
    return json(res, 404, { error: "not found" });
  } catch (error) { console.error(error); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
});

server.listen(port, host, () => {
  const address = lanAddress();
  console.log("\nJARVIS PHYSICAL iPHONE BRIDGE");
  console.log(`Bridge URL: http://${address}:${port}/`);
  console.log(`Enrollment token: ${token}`);
  console.log(`Main SHA evidence: ${mainSha}`);
  console.log("Keep this terminal open. Token is ephemeral unless IPHONE_ENROLLMENT_TOKEN is explicitly supplied.\n");
});

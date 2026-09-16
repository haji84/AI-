import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT,
  FixedEnrollmentRateLimiter,
  fixedEnrollmentRequest,
  normalizeFixedEnrollmentBindHost,
  normalizeFixedEnrollmentBrokerUrl,
  safeEqualEnrollmentKey,
  validateFixedEnrollmentRedirect,
} from "../src/jarvis/fixed-enrollment.ts";

const portalKey = process.env.JARVIS_ENROLLMENT_PORTAL_KEY?.trim() || "";
const ownerToken = process.env.JARVIS_OWNER_TOKEN?.trim() || "";
const allowLan = process.env.JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN === "1";
const host = normalizeFixedEnrollmentBindHost(process.env.JARVIS_ENROLLMENT_PORTAL_HOST, allowLan);
const port = Number(process.env.JARVIS_ENROLLMENT_PORTAL_PORT || FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT);
const brokerUrl = normalizeFixedEnrollmentBrokerUrl(process.env.JARVIS_BROKER_URL);
const group = process.env.JARVIS_ENROLLMENT_PORTAL_GROUP?.trim() || "fixed-url";
const limiter = new FixedEnrollmentRateLimiter();

if (portalKey.length < 32) throw new Error("JARVIS_ENROLLMENT_PORTAL_KEY must be an opaque secret of at least 32 characters");
if (!ownerToken) throw new Error("JARVIS_OWNER_TOKEN is required for the fixed enrollment portal");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("JARVIS_ENROLLMENT_PORTAL_PORT must be a valid TCP port");

function setPrivateResponseHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  setPrivateResponseHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function clientKey(request: IncomingMessage): string {
  return request.socket.remoteAddress || "unknown";
}

async function mintFreshOneTapUrl(): Promise<string> {
  const response = await fetch(`${brokerUrl}/api/jarvis/admin/enrollment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fixedEnrollmentRequest(group)),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) throw new Error(`Broker enrollment request failed with status ${response.status}`);
  const payload = await response.json().catch(() => null) as { oneTapUrl?: unknown } | null;
  return validateFixedEnrollmentRedirect(payload?.oneTapUrl);
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", "http://localhost");
  const method = request.method || "GET";

  if (method === "GET" && url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      service: "jarvis-fixed-enrollment-portal",
      lanEnabled: allowLan,
      broker: "loopback",
      grantTtlSeconds: 600,
      maxDevicesPerOpen: 1,
    });
  }

  if (method !== "GET" || !url.pathname.startsWith("/enroll/")) {
    return json(response, 404, { message: "not found" });
  }

  const rate = limiter.consume(clientKey(request));
  if (!rate.allowed) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
    return json(response, 429, { message: "enrollment portal rate limit exceeded" });
  }

  let presented = "";
  try {
    presented = decodeURIComponent(url.pathname.slice("/enroll/".length));
  } catch {
    return json(response, 404, { message: "not found" });
  }
  if (!presented || !safeEqualEnrollmentKey(presented, portalKey)) {
    return json(response, 404, { message: "not found" });
  }

  try {
    const location = await mintFreshOneTapUrl();
    response.statusCode = 303;
    setPrivateResponseHeaders(response);
    response.setHeader("Location", location);
    response.end();
  } catch (error) {
    console.error("[jarvis-fixed-enrollment] fresh grant failed", error instanceof Error ? error.message : "unknown error");
    return json(response, 503, { message: "fresh enrollment grant unavailable" });
  }
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    console.error("[jarvis-fixed-enrollment] request failed", error instanceof Error ? error.message : "unknown error");
    json(response, 500, { message: "internal error" });
  });
});

server.listen(port, host, () => {
  console.log(`[jarvis-fixed-enrollment] listening on http://${host}:${port}`);
  console.log(`[jarvis-fixed-enrollment] fixed path=/enroll/<opaque-key> ttl=600s maxDevices=1 lan=${allowLan ? "enabled" : "disabled"}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

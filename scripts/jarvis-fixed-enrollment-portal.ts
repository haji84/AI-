import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT,
  FixedEnrollmentRateLimiter,
  normalizeFixedEnrollmentBindHost,
  normalizeFixedEnrollmentBrokerUrl,
} from "../src/jarvis/fixed-enrollment.ts";

const allowLan = process.env.JARVIS_ENROLLMENT_PORTAL_ALLOW_LAN === "1";
const host = normalizeFixedEnrollmentBindHost(process.env.JARVIS_ENROLLMENT_PORTAL_HOST, allowLan);
const port = Number(process.env.JARVIS_ENROLLMENT_PORTAL_PORT || FIXED_ENROLLMENT_PORTAL_DEFAULT_PORT);
const brokerUrl = normalizeFixedEnrollmentBrokerUrl(process.env.JARVIS_BROKER_URL);
const limiter = new FixedEnrollmentRateLimiter();

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

async function proxyFixedEnrollment(response: ServerResponse): Promise<void> {
  const upstream = await fetch(`${brokerUrl}/enroll`, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  response.statusCode = upstream.status;
  setPrivateResponseHeaders(response);
  response.setHeader("Content-Type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
  const location = upstream.headers.get("location");
  if (location) response.setHeader("Location", location);
  response.end(Buffer.from(await upstream.arrayBuffer()));
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
      fixedPath: "/enroll",
      authorization: "broker-pairing-window",
      maxDevicesPerOpen: 1,
    });
  }

  if (method !== "GET" || url.pathname !== "/enroll") {
    return json(response, 404, { message: "not found" });
  }

  const rate = limiter.consume(clientKey(request));
  if (!rate.allowed) {
    response.setHeader("Retry-After", String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
    return json(response, 429, { message: "enrollment portal rate limit exceeded" });
  }

  try {
    await proxyFixedEnrollment(response);
  } catch (error) {
    console.error("[jarvis-fixed-enrollment] broker enrollment route unavailable", error instanceof Error ? error.message : "unknown error");
    return json(response, 503, { message: "fixed enrollment route unavailable" });
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
  console.log(`[jarvis-fixed-enrollment] fixed path=/enroll auth=broker-pairing-window maxDevicesPerOpen=1 lan=${allowLan ? "enabled" : "disabled"}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

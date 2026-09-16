import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

export function privateWorkerBind(value: string): string {
  if (isIP(value) !== 4) throw new Error("An explicit private IPv4 bind is required");
  const [a, b] = value.split(".").map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
    throw new Error("Worker ingress must bind a home-LAN address, never wildcard/public");
  }
  return value;
}

const workerPaths = new Set([
  "/api/jarvis/enrollment-grant", "/api/jarvis/enroll",
  "/api/jarvis/worker/heartbeat", "/api/jarvis/worker/next", "/api/jarvis/worker/result",
  "/api/jarvis/worker/remote/next", "/api/jarvis/worker/remote/result",
]);

export function allowedPrivateWorkerRequest(method: string, path: string): boolean {
  return method === "POST" && workerPaths.has(path);
}

export function privateWorkerHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  for (const name of ["x-jarvis-node-id", "x-jarvis-timestamp", "x-jarvis-nonce", "x-jarvis-body-sha256", "x-jarvis-signature"]) {
    const value = headers[name];
    if (typeof value === "string") result[name] = value;
  }
  return result;
}

export function privateWorkerHandler(brokerPort: number) {
  if (!Number.isInteger(brokerPort) || brokerPort < 1024 || brokerPort > 65535) throw new Error("Invalid Broker port");
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Referrer-Policy", "no-referrer");
    const path = request.url || "/";
    if (!allowedPrivateWorkerRequest(request.method || "", path)) {
      response.writeHead(404).end('{"message":"unknown worker route"}');
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 1_000_000) { response.writeHead(413).end('{"message":"request too large"}'); return; }
        chunks.push(Buffer.from(chunk));
      }
      const upstream = await fetch(`http://127.0.0.1:${brokerPort}${path}`, {
        method: "POST", headers: privateWorkerHeaders(request.headers), body: Buffer.concat(chunks),
        signal: AbortSignal.timeout(15_000), redirect: "error",
      });
      response.writeHead(upstream.status).end(await upstream.text());
    } catch {
      if (!response.headersSent) response.writeHead(502).end('{"message":"worker broker unavailable"}');
      else response.end();
    }
  };
}

import { createServer } from "node:http";
import { hostname } from "node:os";

const host = process.env.RESEARCH_WORKER_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.RESEARCH_WORKER_PORT || 8795);
const token = process.env.RESEARCH_WORKER_TOKEN?.trim() || "";
const modelEndpoint = process.env.GAI_LOCAL_MODEL_ENDPOINT?.trim().replace(/\/$/, "") || "";
const model = process.env.GAI_LOCAL_MODEL_NAME?.trim() || "local-model";
const workerId = process.env.GAI_WORKER_ID?.trim() || hostname();

if (!token) throw new Error("RESEARCH_WORKER_TOKEN is required");
if (!modelEndpoint) throw new Error("GAI_LOCAL_MODEL_ENDPOINT is required");
if (host !== "127.0.0.1" && host !== "::1" && process.env.RESEARCH_WORKER_ALLOW_NON_LOOPBACK !== "1") {
  throw new Error("Refusing non-loopback bind unless RESEARCH_WORKER_ALLOW_NON_LOOPBACK=1");
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

function authorized(request: import("node:http").IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function runResearch(body: Record<string, unknown>) {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "local-model";
  const context = Array.isArray(body.context) ? body.context.slice(0, 50) : [];
  if (!query) return { status: 400, body: { ok: false, summary: "research query is required", blocker: "RESEARCH_QUERY_MISSING" } };

  const prompt = [
    "You are a bounded local research worker.",
    "Answer only from the supplied context when context is present. Mark uncertainty explicitly.",
    `Research kind: ${kind}`,
    `Query: ${query}`,
    context.length ? `Context:\n${JSON.stringify(context).slice(0, 40_000)}` : "Context: none supplied",
  ].join("\n\n");

  const response = await fetch(`${modelEndpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: "Return a concise research result with explicit evidence limits." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const payload = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    const detail = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
    return { status: 502, body: { ok: false, summary: detail, blocker: "LOCAL_MODEL_ERROR", evidence: { workerId, status: response.status } } };
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { status: 502, body: { ok: false, summary: "Local model returned no usable content", blocker: "LOCAL_MODEL_EMPTY_RESULT", evidence: { workerId } } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      summary: content.trim(),
      evidence: { workerId, kind, contextCount: context.length, model },
    },
  };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true, service: "research-worker", workerId, modelEndpointConfigured: true });
    }
    if (request.method !== "POST" || url.pathname !== "/research") return json(response, 404, { message: "not found" });
    if (!authorized(request)) return json(response, 401, { message: "unauthorized" });
    const result = await runResearch(await readJson(request));
    return json(response, result.status, result.body);
  } catch (error) {
    return json(response, 500, { ok: false, summary: error instanceof Error ? error.message : String(error), blocker: "RESEARCH_WORKER_INTERNAL_ERROR" });
  }
}).listen(port, host, () => {
  console.log(`[research-worker] ${workerId} listening on http://${host}:${port}`);
});

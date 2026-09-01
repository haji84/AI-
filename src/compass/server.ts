import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { CompassStore } from "./store.ts";
import { COMPASS_TOOLS, invokeCompassTool } from "./tools.ts";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcErrorShape {
  code: number;
  message: string;
}

const dbPath = process.env.COMPASS_DB_PATH?.trim() || resolve(process.cwd(), ".compass", "compass.db");
const store = new CompassStore(dbPath);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id: JsonRpcRequest["id"], value: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result: value });
}

function error(id: JsonRpcRequest["id"], shape: JsonRpcErrorShape): void {
  writeMessage({ jsonrpc: "2.0", id, error: shape });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unknown Compass error";
}

function paramsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("params must be an object");
  }
  return value as Record<string, unknown>;
}

function handleRequest(request: JsonRpcRequest): void {
  const id = request.id;
  const method = request.method;

  if (!method) {
    if (id !== undefined) error(id, { code: -32600, message: "Invalid JSON-RPC request" });
    return;
  }

  if (method.startsWith("notifications/")) return;

  try {
    switch (method) {
      case "initialize": {
        const params = paramsObject(request.params);
        const requestedVersion =
          typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-11-25";
        result(id, {
          protocolVersion: requestedVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "compass", version: "0.1.0" },
          instructions:
            "Read goal/state before work, verify results, then write back the resulting state and next action.",
        });
        return;
      }
      case "ping":
        result(id, {});
        return;
      case "tools/list":
        result(id, { tools: COMPASS_TOOLS });
        return;
      case "tools/call": {
        const params = paramsObject(request.params);
        if (typeof params.name !== "string") throw new Error("tools/call requires a tool name");
        const toolResult = invokeCompassTool(store, params.name, params.arguments);
        result(id, {
          content: [{ type: "text", text: JSON.stringify(toolResult) }],
          isError: false,
        });
        return;
      }
      default:
        error(id, { code: -32601, message: `Method not found: ${method}` });
    }
  } catch (cause) {
    if (method === "tools/call") {
      result(id, {
        content: [{ type: "text", text: errorMessage(cause) }],
        isError: true,
      });
      return;
    }
    error(id, { code: -32602, message: errorMessage(cause) });
  }
}

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const request = JSON.parse(trimmed) as JsonRpcRequest;
    handleRequest(request);
  } catch (cause) {
    error(null, { code: -32700, message: `Parse error: ${errorMessage(cause)}` });
  }
});

input.on("close", () => {
  store.close();
});

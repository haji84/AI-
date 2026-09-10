import assert from "node:assert/strict";
import test from "node:test";
import { POST, isAuthorizedRemoteMcpRequest } from "./route.ts";

test("Remote MCP bearer auth is exact and fail-closed", () => {
  const good = new Request("https://example.test/api/mcp", { headers: { Authorization: "Bearer owner-secret" } });
  const bad = new Request("https://example.test/api/mcp", { headers: { Authorization: "Bearer owner-secreT" } });
  const missing = new Request("https://example.test/api/mcp");
  assert.equal(isAuthorizedRemoteMcpRequest(good, "owner-secret"), true);
  assert.equal(isAuthorizedRemoteMcpRequest(bad, "owner-secret"), false);
  assert.equal(isAuthorizedRemoteMcpRequest(missing, "owner-secret"), false);
  assert.equal(isAuthorizedRemoteMcpRequest(good, ""), false);
});

test("Remote MCP initialize and tools/list work without touching GitHub", async () => {
  const oldOwner = process.env.AI_COMPANY_OWNER_SECRET;
  const oldGithub = process.env.AI_COMPANY_GITHUB_TOKEN;
  try {
    process.env.AI_COMPANY_OWNER_SECRET = "owner-secret";
    process.env.AI_COMPANY_GITHUB_TOKEN = "github-token";

    const initialize = await POST(new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer owner-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }),
    }));
    assert.equal(initialize.status, 200);
    const initialized = await initialize.json() as { result?: { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } } };
    assert.equal(initialized.result?.serverInfo?.name, "ai-company-control-center");
    assert.ok(initialized.result?.capabilities?.tools);

    const list = await POST(new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer owner-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }));
    const listed = await list.json() as { result?: { tools?: Array<{ name: string }> } };
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "submit_task"));
    assert.ok(listed.result?.tools?.some((tool) => tool.name === "append_message"));
  } finally {
    if (oldOwner === undefined) delete process.env.AI_COMPANY_OWNER_SECRET; else process.env.AI_COMPANY_OWNER_SECRET = oldOwner;
    if (oldGithub === undefined) delete process.env.AI_COMPANY_GITHUB_TOKEN; else process.env.AI_COMPANY_GITHUB_TOKEN = oldGithub;
  }
});

test("Remote MCP rejects unauthenticated calls", async () => {
  const oldOwner = process.env.AI_COMPANY_OWNER_SECRET;
  const oldGithub = process.env.AI_COMPANY_GITHUB_TOKEN;
  try {
    process.env.AI_COMPANY_OWNER_SECRET = "owner-secret";
    process.env.AI_COMPANY_GITHUB_TOKEN = "github-token";
    const response = await POST(new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }),
    }));
    assert.equal(response.status, 401);
  } finally {
    if (oldOwner === undefined) delete process.env.AI_COMPANY_OWNER_SECRET; else process.env.AI_COMPANY_OWNER_SECRET = oldOwner;
    if (oldGithub === undefined) delete process.env.AI_COMPANY_GITHUB_TOKEN; else process.env.AI_COMPANY_GITHUB_TOKEN = oldGithub;
  }
});

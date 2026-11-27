import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { readResearchSource } from "../src/orchestrator/research-transport.ts";
test("native pinned transport rejects invalid HTTP status as a promise failure", async () => {
 const original = https.request;
 const response = Object.assign(Readable.from([]), { headers: {}, statusCode: 600 });
 try {
  https.request = ((_url: unknown, _options: unknown, callback: (r: typeof response) => void) => {
   const req = Object.assign(new EventEmitter(), { end() { queueMicrotask(() => callback(response)); } });
   return req;
  }) as typeof https.request;
  syncBuiltinESMExports();
  await assert.rejects(() => readResearchSource("https://example.com/", { allowedOrigins: ["https://example.com"], resolve: async () => [{ address: "93.184.216.34", family: 4 }], timeoutMs: 200 }), /status/);
  assert.equal(response.destroyed, true);
 } finally { https.request = original; syncBuiltinESMExports(); }
});

test("public research identifies itself without credentials on the native transport", async () => {
 const original = https.request;
 let captured: https.RequestOptions | undefined;
 try {
  https.request = ((_url: unknown, options: https.RequestOptions, callback: (r: unknown) => void) => {
   captured = options;
   const response = Object.assign(Readable.from([Buffer.from("{}")]), { headers: { "content-type": "application/json" }, statusCode: 200 });
   return Object.assign(new EventEmitter(), { end() { queueMicrotask(() => callback(response)); } });
  }) as typeof https.request;
  syncBuiltinESMExports();
  await readResearchSource("https://example.com/", { allowedOrigins: ["https://example.com"], resolve: async () => [{ address: "93.184.216.34", family: 4 }] });
  const headers = new Headers(captured?.headers as Record<string, string>);
  assert.equal(headers.get("user-agent"), "GORIQ-Public-Research/1.0");
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
 } finally { https.request = original; syncBuiltinESMExports(); }
});

test("injected research transport receives the same fixed public identification", async () => {
 await readResearchSource("https://example.com/", {
  allowedOrigins: ["https://example.com"], resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  fetchImpl: async (_url, options) => {
   const headers = new Headers(options?.headers);
   assert.equal(headers.get("user-agent"), "GORIQ-Public-Research/1.0");
   assert.equal(options?.redirect, "error");
   assert.equal(options?.credentials, "omit");
   assert.equal(headers.has("authorization"), false);
   return new Response("{}", { headers: { "content-type": "application/json" } });
  },
 });
});

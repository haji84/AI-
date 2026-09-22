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

import assert from "node:assert/strict";
import test from "node:test";
import { runProductionResearch } from "../src/orchestrator/production-research.ts";
import { HttpSourceAcquirer } from "../src/orchestrator/http-source-acquirer.ts";
const url = "https://example.com/data";
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
const claims = [{ id: "amount", value: 42, required: true, jsonField: "amount", sources: [{ url, sourceClass: "official" as const }] }];
const fetchImpl: typeof fetch = async () => new Response('{"amount":42}', { headers: { "content-type": "application/json" } });
const policy = { allowedOrigins: ["https://example.com"], resolve, fetchImpl };

test("research denies destinations before any I/O without a trusted allowlist", async () => {
 let calls = 0;
 await assert.rejects(() => runProductionResearch({ claims, fetchImpl: async () => { calls++; return fetchImpl(url); } }), /allowlist/);
 assert.equal(calls, 0);
});
test("research rejects private DNS answers before sending HTTP", async () => {
 let calls = 0;
 await assert.rejects(() => runProductionResearch({ claims, ...policy, resolve: async () => [{ address: "127.0.0.1", family: 4 }], fetchImpl: async () => { calls++; return fetchImpl(url); } }), /private|reserved/);
 assert.equal(calls, 0);
});
test("acquirer cancels streaming bodies at the byte budget", async () => {
 let cancelled = false; let chunks = 0;
 const a = new HttpSourceAcquirer({ ...policy, maxBytes: 10, fetchImpl: async () => new Response(new ReadableStream({ pull(c) { if (chunks++ < 3) c.enqueue(new Uint8Array(11)); else c.close(); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/plain" } }) });
 await assert.rejects(() => a.acquire(url), /byte limit/);
 assert.equal(cancelled, true);
});
test("research bounds claims before fetching and requires own JSON fields", async () => {
 await assert.rejects(() => runProductionResearch({ ...policy, claims: Array.from({ length: 21 }, (_, i) => ({ ...claims[0], id: String(i) })) }), /claim limit/);
 await assert.rejects(() => runProductionResearch({ ...policy, claims: [{ ...claims[0], jsonField: "missing" }] }), /missing JSON field/);
});
test("claim source labels do not grant source authority", async () => {
 const result = await runProductionResearch({ claims, ...policy });
 assert.equal(result.evidence[0].sourceClass, "other");
 assert.equal(result.verification.ok, false);
});

// These tests exercise policy/body/deadline behavior through both public entry points.
import { isPublicResearchAddress, pinnedResearchLookup } from "../src/orchestrator/research-transport.ts";
test("reserved ranges and disguised IP URLs never reach transport", async () => {
 for (const address of ["0.0.0.0", "100.64.1.2", "169.254.169.254", "172.31.4.5", "192.0.0.8", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "fe80::1", "fd00::1", "2001:db8::1", "2002:7f00:1::", "3fff::1"]) assert.equal(isPublicResearchAddress(address), false, address);
 assert.equal(isPublicResearchAddress("2606:4700:4700::1111"), true);
 let sends = 0;
 const a = new HttpSourceAcquirer({ ...policy, fetchImpl: async () => { sends++; return fetchImpl(url); } });
 for (const target of ["https://2130706433/", "https://0x7f000001/", "https://[::ffff:7f00:1]/", "https://example.com.evil.test/", "https://user:pass@example.com/", "https://example.com:444/", "https://example.com./"]) await assert.rejects(() => a.acquire(target));
 assert.equal(sends, 0);
});
test("DNS mixed public/private answers are rejected and pinned lookup never re-resolves", async () => {
 let sends = 0;
 const a = new HttpSourceAcquirer({ ...policy, resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }], fetchImpl: async () => { sends++; return fetchImpl(url); } });
 await assert.rejects(() => a.acquire(url), /private/);
 assert.equal(sends, 0);
 const lookup = pinnedResearchLookup({ address: "93.184.216.34", family: 4 });
 lookup("rebinding.example.com", {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "93.184.216.34"); assert.equal(family, 4); });
 lookup("rebinding.example.com", { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]); });
});
test("deadline covers DNS, headers and stalled body; abort reaches transport", async () => {
 const never = <T>() => new Promise<T>(() => {});
 await assert.rejects(() => new HttpSourceAcquirer({ ...policy, timeoutMs: 25, resolve: () => never() }).acquire(url), /deadline/);
 let received: AbortSignal | null | undefined;
 await assert.rejects(() => new HttpSourceAcquirer({ ...policy, timeoutMs: 25, fetchImpl: async (_u, init) => { received = init?.signal; return never(); } }).acquire(url), /deadline/);
 assert.equal(received?.aborted, true);
 let cancelled = false;
 await assert.rejects(() => new HttpSourceAcquirer({ ...policy, timeoutMs: 25, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/plain" } }) }).acquire(url), /deadline/);
 assert.equal(cancelled, true);
});
test("redirects, wrong MIME, compressed and misleading length responses fail closed", async () => {
 for (const response of [new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }), new Response("x", { headers: { "content-type": "image/png" } }), new Response("x", { headers: { "content-type": "text/plain", "content-encoding": "gzip" } }), new Response("x", { headers: { "content-type": "text/plain", "content-length": "2000001" } })]) {
  await assert.rejects(() => new HttpSourceAcquirer({ ...policy, fetchImpl: async () => response }).acquire(url));
 }
 await assert.rejects(() => new HttpSourceAcquirer({ ...policy, maxBytes: 10, fetchImpl: async () => new Response("x".repeat(11), { headers: { "content-type": "text/plain", "content-length": "1" } }) }).acquire(url), /byte limit/);
});
test("batch is fully preflighted; duplicates, source budgets and malformed fields cannot trigger I/O", async () => {
 let sends = 0;
 const options = { ...policy, fetchImpl: async () => { sends++; return fetchImpl(url); } };
 for (const batch of [[claims[0], claims[0]], [{ ...claims[0], sources: Array(6).fill(claims[0].sources[0]) }], [claims[0], { ...claims[0], id: "second", sources: [{ url: "https://evil.test/", sourceClass: "official" as const }] }], [{ ...claims[0], jsonField: "constructor" }]]) await assert.rejects(() => runProductionResearch({ ...options, claims: batch }));
 assert.equal(sends, 0);
 for (const body of ['[]', 'null', '{"different":42}', '{broken']) await assert.rejects(() => runProductionResearch({ ...policy, claims, fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } }) }));
});
test("freshness uses publication time; caller trust label cannot replace trusted classifier", async () => {
 const options = { ...policy, claims: [{ ...claims[0], publishedAtField: "published", maxAgeMs: 86_400_000 }], now: () => new Date("2026-09-23T00:00:00Z"), classify: () => "official" as const };
 for (const stamp of ["2020-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "invalid"]) await assert.rejects(() => runProductionResearch({ ...options, fetchImpl: async () => new Response(JSON.stringify({ amount: 42, published: stamp }), { headers: { "content-type": "application/json" } }) }), /stale|publication/);
 const result = await runProductionResearch({ ...options, fetchImpl: async () => new Response('{"amount":42,"published":"2026-09-22T12:00:00Z"}', { headers: { "content-type": "application/json" } }) });
 assert.equal(result.verification.ok, true);
 assert.equal(result.evidence[0].claimId, "amount");
 assert.equal(result.evidence[0].publishedAt, "2026-09-22T12:00:00.000Z");
});
test("batch aggregate byte/deadline budgets stop subsequent source requests", async () => {
 let sends = 0;
 const batch = [claims[0], { ...claims[0], id: "second" }];
 await assert.rejects(() => runProductionResearch({ ...policy, claims: batch, maxTotalBytes: 13, fetchImpl: async () => { sends++; return fetchImpl(url); } }), /total byte limit/);
 assert.equal(sends, 1);
 await assert.rejects(() => runProductionResearch({ ...policy, claims, totalTimeoutMs: 25, timeoutMs: 1000, fetchImpl: () => new Promise(() => {}) }), /total deadline/);
 for (const maxBytes of [NaN, Infinity, -1, 2_000_001]) await assert.rejects(() => runProductionResearch({ ...policy, claims, maxBytes }), /resource limit/);
});

test("JSON numeric overflow cannot become a confirmed null (including nested values)", async () => {
 for (const [value, body] of [[null, '{"amount":1e400}'], [{ n: null }, '{"amount":{"n":1e400}}']] as const) {
  await assert.rejects(() => runProductionResearch({ ...policy, claims: [{ ...claims[0], value }], classify: () => "official", fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } }) }), /finite JSON/);
 }
 await assert.rejects(() => runProductionResearch({ ...policy, claims: [{ ...claims[0], value: Infinity }] }), /finite JSON/);
});

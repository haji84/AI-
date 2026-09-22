import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

export interface ResolvedAddress { address: string; family: number }
export interface ResearchTransportOptions {
  /** Trusted per-job configuration, never populated from a retrieved document. Empty means deny. */
  allowedOrigins?: readonly string[];
  accept?: "application/json";
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Trusted dependency injection. Production uses the pinned HTTPS transport below. */
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  fetchImpl?: typeof fetch;
}
export function boundedInteger(value: number | undefined, fallback: number, ceiling: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > ceiling) throw new Error("invalid research resource limit");
  return result;
}
const deniedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) deniedV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const deniedV6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  deniedV6.addSubnet(address, prefix, "ipv6");
}
export function isPublicResearchAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !deniedV4.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !deniedV6.check(address, "ipv6");
}
export function researchUrl(raw: string, allowedOrigins: readonly string[] = []): URL {
  if (typeof raw !== "string" || raw.length > 4096) throw new Error("invalid research URL");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("source URL must use https");
  if (url.username || url.password || (url.port && url.port !== "443")) throw new Error("source credentials or port forbidden");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".") && !isIP(host) || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host) || host.endsWith(".")) {
    throw new Error("local source host is forbidden");
  }
  if (isIP(host) && !isPublicResearchAddress(host)) throw new Error("private or reserved source IP is forbidden");
  if (!allowedOrigins.includes(url.origin)) throw new Error("source origin is not in trusted allowlist");
  url.hash = "";
  return url;
}
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
/** The socket gets this exact validated address; no second DNS lookup or pooled connection. */
export function pinnedResearchLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}
function pinnedFetch(url: URL, address: ResolvedAddress, signal: AbortSignal, accept: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET", agent: false, lookup: pinnedResearchLookup(address),
      family: address.family, signal, maxHeaderSize: 16_384,
      headers: { Accept: accept, "Accept-Encoding": "identity" },
    }, response => {
      try {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) throw new Error('research HTTP status rejected');
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = response.statusCode ?? 500;
      // Handle empty statuses without constructing a forbidden Response body.
      if ([204, 205, 304].includes(status)) {
        response.resume();
        resolve(new Response(null, { status, headers }));
      } else {
        resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
      }
      } catch (error) { response.destroy(); reject(error); }
    });
    req.on("error", reject);
    req.end();
  });
}
export async function readResearchSource(raw: string, options: ResearchTransportOptions) {
  const url = researchUrl(raw, options.allowedOrigins);
  const maxBytes = boundedInteger(options.maxBytes, 2_000_000, 2_000_000);
  const timeoutMs = boundedInteger(options.timeoutMs, 5000, 10_000);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error("research request deadline exceeded")), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
      : await abortable((options.resolve ?? (host => lookup(host, { all: true, verbatim: true })))(hostname), signal);
    if (!addresses.length || addresses.length > 32 || addresses.some(a => a.family !== isIP(a.address) || !isPublicResearchAddress(a.address))) {
      throw new Error("private, reserved or invalid DNS address");
    }
    signal.throwIfAborted();
    const accept = options.accept === "application/json" ? "application/json" : "text/html,text/plain,application/json";
    const response = await abortable(options.fetchImpl
      ? options.fetchImpl(url, { redirect: "error", signal, credentials: "omit", headers: { Accept: accept, "Accept-Encoding": "identity" } })
      : pinnedFetch(url, addresses[0], signal, accept), signal);
    reader = response.body?.getReader();
    if (!response.ok || response.redirected || response.url && response.url !== url.href) throw new Error("research HTTP status or redirect rejected");
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!["application/json", "text/html", "text/plain"].includes(contentType)) throw new Error("unsupported source content type");
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("compressed research response rejected");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("source exceeds byte limit");
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > maxBytes) throw new Error("source exceeds byte limit");
        chunks.push(chunk.value);
      }
    }
    return { url, contentType, bytes: Buffer.concat(chunks, total) };
  } finally {
    clearTimeout(timer);
    controller.abort(new Error("research request finished"));
    if (reader) void reader.cancel().catch(() => {});
  }
}

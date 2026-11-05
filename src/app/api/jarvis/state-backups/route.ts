import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE } from "../../../owner-auth.ts";
import { jarvisBrokerFetch, jarvisOwnerSecret, requireJarvisOwner, verifyFreshTrustedOwnerSessionAccess } from "../broker.ts";
import type { LocalStateBackupGeneration, LocalStateBackupListing } from "../../../../jarvis/local-state-backups.ts";

export const dynamic = "force-dynamic";
const ENDPOINT = "/api/jarvis/admin/state-backups";
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CODES = ["private_storage_unsupported", "unsafe_storage", "source_unavailable", "resource_limit", "operation_busy", "generation_not_found", "catalog_invalid", "verification_failed", "operation_failed", "invalid_request"];
const COVERAGE = { included: ["broker-sqlite", "compass-sqlite"], excluded: ["pc-task-json", "pc-observation-json", "configuration-and-credentials", "other-sidecars"], consistency: "per-store" };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));

function sameOrigin(request: Request): boolean {
  try {
    const internal = new URL(request.url), host = request.headers.get("host");
    if (!["http:", "https:"].includes(internal.protocol)) return false;
    // NextRequest normalizes loopback URL hostnames. Bind to the actual HTTP Host,
    // never untrusted forwarded-host/proto headers; native Request can omit Host.
    if (host !== null && (host.length > 512 || !/^(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::[0-9]{1,5})?$/.test(host))) return false;
    const expected = host === null ? internal.origin : new URL(`${internal.protocol}//${host}`).origin;
    return request.headers.get("origin") === expected && request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

function generation(value: unknown): LocalStateBackupGeneration {
  if (!object(value) || typeof value.id !== "string" || !ID.test(value.id) || !timestamp(value.createdAt) || !["ready", "verified", "incomplete"].includes(String(value.status)) || value.activationAuthorized !== false || !Array.isArray(value.stores) || value.stores.length !== (value.status === "incomplete" ? 0 : 2)) throw new Error("invalid response");
  const stores = value.stores.map((item, index) => {
    if (!object(item) || item.store !== ["broker", "compass"][index] || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.sizeBytes) || Number(item.sizeBytes) < 1 || Number(item.sizeBytes) > 64 * 1024 * 1024 || !Number.isSafeInteger(item.pagesTransferred) || Number(item.pagesTransferred) < 1 || Number(item.pagesTransferred) > 131072) throw new Error("invalid response");
    return { store: item.store as "broker" | "compass", sha256: item.sha256, sizeBytes: Number(item.sizeBytes), pagesTransferred: Number(item.pagesTransferred) };
  });
  if (value.verifiedAt !== undefined && !timestamp(value.verifiedAt)) throw new Error("invalid response");
  if (value.status === "verified" && !timestamp(value.verifiedAt)) throw new Error("invalid response");
  return { id: value.id, createdAt: value.createdAt, status: value.status as LocalStateBackupGeneration["status"], stores, activationAuthorized: false, ...(timestamp(value.verifiedAt) ? { verifiedAt: value.verifiedAt } : {}) };
}
async function boundedJson(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new Error("body required");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); throw new Error("body too large"); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally { reader.releaseLock(); }
}
async function proxy(method: "GET" | "POST", body?: unknown) {
  try {
    const response = await jarvisBrokerFetch(ENDPOINT, { method, signal: AbortSignal.timeout(40_000), ...(body ? { body: JSON.stringify(body), headers: { "X-Jarvis-Operation-Mode": "standard" } } : {}) });
    if (!response.ok) {
      const value: unknown = await response.json();
      const code = object(value) && typeof value.code === "string" && CODES.includes(value.code) ? value.code : "operation_failed";
      return reply({ code }, [400, 403, 404, 409, 503].includes(response.status) ? response.status : 503);
    }
    const value: unknown = await response.json();
    if (!object(value)) throw new Error("invalid response");
    if (method === "POST") return reply({ generation: generation(value.generation) }, response.status === 201 ? 201 : 200);
    if (!object(value.capability) || typeof value.capability.available !== "boolean" || typeof value.capability.reason !== "string" || !["available", ...CODES].includes(value.capability.reason) || value.activationAuthorized !== false || !Array.isArray(value.generations) || value.generations.length > 32 || JSON.stringify(value.coverage) !== JSON.stringify(COVERAGE)) throw new Error("invalid response");
    const listing = { capability: { available: value.capability.available, reason: value.capability.reason }, coverage: COVERAGE, activationAuthorized: false, generations: value.generations.map(generation) } as LocalStateBackupListing;
    return reply(listing);
  } catch { return reply({ code: "service_unavailable" }, 503); }
}
export async function GET(request: Request) {
  if (!(await requireJarvisOwner())) return reply({ code: "owner_required" }, 401);
  if (new URL(request.url).search) return reply({ code: "invalid_request" }, 400);
  return proxy("GET");
}
export async function POST(request: Request) {
  if (!(await requireJarvisOwner())) return reply({ code: "owner_required" }, 401);
  if (!sameOrigin(request)) return reply({ code: "same_origin_required" }, 403);
  // Display mode only restricts an already authenticated operation; it never grants authority.
  const mode = request.headers.get("x-jarvis-operation-mode");
  if (mode && mode !== "standard") return reply({ code: "read_only" }, 403);
  const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
  if (!(await verifyFreshTrustedOwnerSessionAccess(jarvisOwnerSecret(), token))) return reply({ code: "fresh_owner_confirmation_required" }, 403);
  if (new URL(request.url).search || !request.headers.get("content-type")?.startsWith("application/json")) return reply({ code: "invalid_request" }, 400);
  let value: unknown;
  try { value = await boundedJson(request); } catch { return reply({ code: "invalid_request" }, 400); }
  if (!object(value)) return reply({ code: "invalid_request" }, 400);
  const keys = Object.keys(value);
  if (value.operation === "create" && keys.length === 1) return proxy("POST", { operation: "create" });
  if (value.operation === "verify" && keys.length === 2 && keys.includes("generationId") && typeof value.generationId === "string" && ID.test(value.generationId)) return proxy("POST", { operation: "verify", generationId: value.generationId });
  return reply({ code: "invalid_request" }, 400);
}

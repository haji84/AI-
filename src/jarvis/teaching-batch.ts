import {
  profileKey,
  replayTeaching,
  safeUrl,
  type TeachingAdapter,
  type TeachingRun,
  type TeachingStore,
} from "./teaching.ts";

export const MAX_TEACHING_BATCH_ROWS = 25;

export type TeachingBatchRow = {
  rowId: string;
  url: string;
};

export type TeachingBatchRowResult = {
  rowId: string;
  runId: string;
  status: TeachingRun["status"];
};

export type TeachingBatchResult = {
  variantId: string;
  status: "PASSED" | "NEEDS_HUMAN";
  rows: TeachingBatchRowResult[];
};

function normalizeRowId(value: unknown, index: number): string {
  if (typeof value !== "string") throw Error(`Invalid batch row ${index + 1}`);
  const rowId = value.trim();
  if (!rowId || rowId.length > 80 || /[\u0000-\u001f\u007f]/.test(rowId)) {
    throw Error(`Invalid batch row ${index + 1}`);
  }
  return rowId;
}

export function validateTeachingBatchRows(input: unknown, expectedHost: string): TeachingBatchRow[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_TEACHING_BATCH_ROWS) {
    throw Error(`Teaching batch requires 1-${MAX_TEACHING_BATCH_ROWS} rows`);
  }
  if (!expectedHost.trim()) throw Error("Teaching batch requires a URL host");

  const seen = new Set<string>();
  return input.map((value, index) => {
    if (!value || typeof value !== "object") throw Error(`Invalid batch row ${index + 1}`);
    const row = value as { rowId?: unknown; url?: unknown };
    const rowId = normalizeRowId(row.rowId, index);
    if (seen.has(rowId)) throw Error(`Duplicate batch row: ${rowId}`);
    seen.add(rowId);
    return { rowId, url: safeUrl(row.url, expectedHost) };
  });
}

function parameterHost(store: TeachingStore, variantId: string): string {
  const variant = store.get(variantId);
  const hosts = [...new Set(variant.steps.flatMap((step) => (step.action.kind === "url" ? [step.action.host] : [])))];
  if (hosts.length !== 1) throw Error("Teaching batch requires exactly one parameterized URL host");
  return hosts[0];
}

export async function replayVerifiedTeachingBatch(
  store: TeachingStore,
  variantId: string,
  adapter: TeachingAdapter,
  rowsInput: unknown,
): Promise<TeachingBatchResult> {
  const variant = store.get(variantId);
  const rows = validateTeachingBatchRows(rowsInput, parameterHost(store, variantId));

  await adapter.authorize();
  const observed = await adapter.observe();
  const observedProfileKey = profileKey(observed.profile);
  const hasSeparateVerification = store
    .list()
    .runs.some(
      (run) =>
        run.variantId === variant.id &&
        run.deviceId === observed.profile.deviceId &&
        run.profileKey === observedProfileKey &&
        run.mode === "verify" &&
        run.status === "PASSED",
    );
  if (!hasSeparateVerification) throw Error("Verify on this device before automatic batch execution");

  const results: TeachingBatchRowResult[] = [];
  for (const row of rows) {
    const run = await replayTeaching(store, variant.id, adapter, "execute", row.url);
    results.push({ rowId: row.rowId, runId: run.id, status: run.status });
    if (run.status !== "PASSED") {
      return { variantId: variant.id, status: "NEEDS_HUMAN", rows: results };
    }
  }
  return { variantId: variant.id, status: "PASSED", rows: results };
}

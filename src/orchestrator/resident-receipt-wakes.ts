import { isAbsolute } from "node:path";
import { GoalVerifierReceiptWake } from "./goal-verifier-receipt-wake.ts";
import { readResidentExecutionManifest } from "./resident-execution-manifest.ts";
import { readTrackedRepairManifest } from "./tracked-repair-resident-runtime.ts";

/** Trusted host cadence only: it never enables a profile or grants authority.
 * Keep the existing production default; at most one poll per second. */
export function residentReceiptPollIntervalMs(env: Record<string, string | undefined>): number {
  const value = env.GORIQ_VERIFIER_RECEIPT_POLL_MS;
  if (value === undefined) return 15000;
  if (typeof value !== "string" || !/^[1-9]\d{3,4}$/.test(value)) throw Error("VERIFIER_RECEIPT_POLL_INTERVAL_INVALID");
  const interval = Number(value);
  if (interval < 1000 || interval > 15000) throw Error("VERIFIER_RECEIPT_POLL_INTERVAL_INVALID");
  return interval;
}

/** File changes only wake existing accepted work. The executor verifies all authority. */
export function createResidentReceiptWakes(env: Record<string, string | undefined>, runtimeRoot: string): GoalVerifierReceiptWake[] {
  if (env.GORIQ_TRACKED_REPAIR_MANIFEST_FILE || env.GORIQ_TRACKED_REPAIR_MANIFEST_SHA256) {
    if (env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE || env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256) throw Error("TRACKED_REPAIR_MULTIPLE_RUNTIME_PROFILES");
    const loaded = readTrackedRepairManifest(env);
    if (!loaded) throw Error("TRACKED_REPAIR_MANIFEST_REQUIRED");
    return [loaded.manifest.verifier.receiptFile,...(loaded.manifest.recoveryAttempts??[]).map(attempt=>attempt.receiptFile)]
      .map(file=>new GoalVerifierReceiptWake(file));
  }
  if (env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE || env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256) {
    if (env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED !== "1") throw Error("RESIDENT_SEQUENCE_LOCAL_OPT_IN_REQUIRED");
    const manifest = readResidentExecutionManifest(env, runtimeRoot);
    if (!manifest) throw Error("RESIDENT_SEQUENCE_MANIFEST_REQUIRED");
    return manifest.executions.map(execution => new GoalVerifierReceiptWake(execution.receiptFile));
  }
  const receipt = env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED === "1" ? env.GORIQ_LOCAL_VERIFIER_RECEIPT_FILE?.trim() : undefined;
  return receipt && isAbsolute(receipt) ? [new GoalVerifierReceiptWake(receipt)] : [];
}

import { isAbsolute } from "node:path";
import { GoalVerifierReceiptWake } from "./goal-verifier-receipt-wake.ts";
import { readResidentExecutionManifest } from "./resident-execution-manifest.ts";

/** File changes only wake existing accepted work. The executor verifies all authority. */
export function createResidentReceiptWakes(env: Record<string, string | undefined>, runtimeRoot: string): GoalVerifierReceiptWake[] {
  if (env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE || env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256) {
    if (env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED !== "1") throw Error("RESIDENT_SEQUENCE_LOCAL_OPT_IN_REQUIRED");
    const manifest = readResidentExecutionManifest(env, runtimeRoot);
    if (!manifest) throw Error("RESIDENT_SEQUENCE_MANIFEST_REQUIRED");
    return manifest.executions.map(execution => new GoalVerifierReceiptWake(execution.receiptFile));
  }
  const receipt = env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED === "1" ? env.GORIQ_LOCAL_VERIFIER_RECEIPT_FILE?.trim() : undefined;
  return receipt && isAbsolute(receipt) ? [new GoalVerifierReceiptWake(receipt)] : [];
}

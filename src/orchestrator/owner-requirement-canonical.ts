import { fileURLToPath } from "node:url";
import { loadCanonicalBundle, verifyCanonicalReceipt } from "../../scripts/jarvis-owner-spec-sync.mjs";
import { ownerRequirementRecords } from "./owner-requirement-intake.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
/** Read only deployed canonical artifacts. HTTP/model flags can never satisfy this gate.
 * Recheck on every completion so rollback or an omitted decision reopens the gap. */
export function canonicalRequirementBlockers(active: unknown[], goalId: string): string[] {
 try {
  const records = ownerRequirementRecords(active).filter(r => ["ACCEPTED_REQUIREMENT", "SPEC_SYNCED", "WITHDRAWN"].includes(r.state) && (r.goalId === goalId || r.goalId === null));
  if (!records.length) return [];
  const bundle = loadCanonicalBundle(repositoryRoot);
  return records.filter(r => !verifyCanonicalReceipt(r, bundle, repositoryRoot).ok).map(r => "spec_sync_pending:" + r.id);
 } catch { return ["spec_sync_state_invalid"]; }
}

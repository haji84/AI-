import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { inspectPcRuntimeState, preparePcRuntimeConfiguration } from "../src/jarvis/pc-runtime-refresh.ts";
import { FilePcIdentityStorage } from "../src/jarvis/pc-local-identity.ts";
import { validatePcRuntimeRefreshApproval } from "../src/jarvis/pc-runtime-refresh.ts";

// Input/output is captured by the same-owner PowerShell caller. No raw configuration is emitted.
async function main() {
  const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
  const revision = process.env.GORIQ_PC_APPROVED_REVISION ?? "";
  if (process.platform !== "win32" || !/^[a-f0-9]{40}$/.test(revision) ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== revision) throw new Error("PC_RUNTIME_SOURCE_REJECTED");
  const approval = validatePcRuntimeRefreshApproval(JSON.parse(readFileSync("docs/authorizations/1662-zbook-runtime-refresh.json", "utf8")));
  const current = input.current;
  const next = preparePcRuntimeConfiguration({ current, previousRevision: input.previousRevision, revision,
    releaseRoot: input.releaseRoot, approval });
  const state = inspectPcRuntimeState({ brokerPath: current.environment.JARVIS_DB_PATH,
    compassPath: current.environment.JARVIS_DB_PATH + ".compass.sqlite" });
  if (input.operation === "prepare") {
    const root = join(process.env.USERPROFILE!, "JARVIS", "production", "runtime-refresh", revision);
    await new FilePcIdentityStorage(join(root, "baseline.dpapi")).writeExclusive(JSON.stringify(state.privateSnapshot));
    // Existing production config format is ConvertFrom-SecureString, not pcDpapi's raw bytes format.
    // PowerShell handles that existing format; baseline alone uses the protected identity storage.
  } else if (input.operation !== "inspect") throw new Error("PC_RUNTIME_OPERATION_REJECTED");
  // Public digest receipt only; credentials and private baseline stay inside the host.
  console.log(JSON.stringify({ ...state.metadata, previousRevision: current.commit, revision: next.commit,
    observedAt: new Date().toISOString() }));
}
main().catch(() => { console.error("PC_RUNTIME_STATE_REJECTED: source, approval, schema, fleet or quiescence prerequisite failed"); process.exitCode = 1; });

import test from "node:test";
import assert from "node:assert/strict";
import { runSandboxCycle, syntheticIntake, sandboxChat } from "../scripts/chat-actions-sandbox.mjs";

test("synthetic Chat command runs deterministic non-Codex RED -> GREEN in an isolated temp folder", () => {
  const r=runSandboxCycle();
  assert.equal(r.mode, "ISOLATED_SYNTHETIC");
  assert.equal(r.completed, true);
  assert.equal(r.reusedPr, 1866);
  assert.equal(r.nonCodexBuilder, "DETERMINISTIC_FIXTURE_BUILDER");
  assert.equal(r.records.some(x=>x.result==="RED_FAILED_AS_EXPECTED"),true);
  assert.equal(r.records.some(x=>x.result==="GREEN_VERIFIED"),true);
  assert.equal(r.records.some(x=>x.result==="SAME_SIMULATED_PR_BRANCH"),true);
  assert.equal(r.nextAction, "NEXT_SAFE_SANDBOX_TASK");
  assert.equal(r.actualGitHubMutation, false);
  assert.equal(r.realAi09Reviewed, false);
  assert.equal(r.autoMerge, false);
  assert.equal(r.modelUsed, false);
});
test("synthetic command does not execute without independent host owner proof",()=>{
  const r=runSandboxCycle({chat:{...sandboxChat,ownerIdentityVerifiedByTrustedHost:false}});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"OWNER_PROOF_REQUIRED");
  assert.equal(r.actualGitHubMutation,false);
});
test("global PAUSED state prevents even the sandbox candidate",()=>{
  const r=runSandboxCycle({pr:syntheticIntake({globallyPaused:true})});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"PAUSED");
});
test("HIGH risk remains approval-gated without touching main",()=>{
  const r=runSandboxCycle({pr:syntheticIntake({riskSignals:{permissionChange:true}})});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"APPROVAL_REQUIRED");
});
test("CRITICAL policy weakening is held",()=>{
  const r=runSandboxCycle({pr:syntheticIntake({riskSignals:{humanGatePolicyRelaxation:true}})});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"SECURITY_HOLD");
});
test("incomplete PR inventory cannot trigger another PR",()=>{
  const r=runSandboxCycle({pr:syntheticIntake({inventoryComplete:false})});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"RECONCILE_PR");
});
test("lack of non-Codex builder is honest and does not silently use Codex",()=>{
  const r=runSandboxCycle({chat:{...sandboxChat,existingNonCodexBuilderAvailable:false}});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"CAPABILITY_UNAVAILABLE");
});
test("missing Actions runtime reports capability unavailable without deploying",()=>{
  const r=runSandboxCycle({chat:{...sandboxChat,githubActionsAvailable:false}});
  assert.equal(r.completed,false);
  assert.equal(r.blocked,"ACTIONS_UNAVAILABLE");
});

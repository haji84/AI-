import assert from "node:assert/strict";
import test from "node:test";
import { composeTeamFromIssue } from "../src/orchestrator/team-composer.ts";

function rolesFor(title: string, body?: string) {
  return composeTeamFromIssue({ title, body }).members.map((member) => member.role);
}

test("backend implementation composes PM, Backend, QA and Reviewer", () => {
  const result = composeTeamFromIssue({
    title: "feat: implement backend API endpoint",
    body: "Add a service endpoint with tests.",
  });

  assert.equal(result.lead, "Backend");
  assert.deepEqual(result.members.map((member) => member.role), ["PM", "Backend", "QA", "Reviewer"]);
  assert.equal(result.codeChangeLikely, true);
});

test("explicit video editing selects Video Editor instead of generic Media", () => {
  const roles = rolesFor("動画編集: カットと字幕と音ハメを調整する");
  assert.ok(roles.includes("Video Editor"));
  assert.ok(roles.includes("QA"));
  assert.equal(roles.includes("Media"), false);
});

test("security permission work adds Governor and human gate evidence", () => {
  const result = composeTeamFromIssue({
    title: "security: change repository permission policy",
    body: "Review authorization and least privilege before changing access control.",
  });

  const roles = result.members.map((member) => member.role);
  assert.ok(roles.includes("Security Engineer"));
  assert.ok(roles.includes("Governor"));
  assert.ok(result.humanGateSignals.includes("permissions"));
});

test("negated safety language does not create Human Gate signals", () => {
  const result = composeTeamFromIssue({
    title: "fix: bounded workflow input handling",
    body: "No deployment, no billing, and no destructive behavior. Do not change permissions or secrets.",
  });

  assert.deepEqual(result.humanGateSignals, []);
  assert.equal(result.members.some((member) => member.role === "Governor"), false);
});

test("affirmative privileged language still creates Human Gate signals", () => {
  const result = composeTeamFromIssue({
    title: "ops: deploy production and update billing",
    body: "Change repository permissions and rotate a secret before deployment.",
  });

  assert.ok(result.humanGateSignals.includes("permissions"));
  assert.ok(result.humanGateSignals.includes("secrets"));
  assert.ok(result.humanGateSignals.includes("billing"));
  assert.ok(result.humanGateSignals.includes("deployment"));
  assert.ok(result.members.some((member) => member.role === "Governor"));
});

test("business roles map to dedicated specialists without unrelated engineers", () => {
  assert.ok(rolesFor("マーケティング市場調査とブランド戦略").includes("Marketing"));
  assert.ok(rolesFor("営業CRMと見込み客パイプラインを整理").includes("Sales"));
  assert.ok(rolesFor("経理: 請求と予算を集計").includes("Accounting / Finance"));
  assert.ok(rolesFor("法務: 契約と著作権を確認").includes("Legal"));
  assert.ok(rolesFor("広告運用: Google AdsのROASを改善").includes("Advertising"));

  const marketingRoles = rolesFor("マーケティング市場調査とブランド戦略");
  assert.equal(marketingRoles.includes("Backend"), false);
  assert.equal(marketingRoles.includes("Frontend"), false);
});

test("platform and knowledge roles map deterministically", () => {
  assert.ok(rolesFor("Integrate Gmail connector with external API").includes("Integration Engineer"));
  assert.ok(rolesFor("Build CSV data pipeline and analytics").includes("Data Engineer / Analyst"));
  assert.ok(rolesFor("GitHub Actions runtime monitoring").includes("DevOps / SRE"));
  assert.ok(rolesFor("Update documentation and decision log").includes("Knowledge Manager"));
});

test("PM is the bounded fallback when no specialist signal exists", () => {
  const result = composeTeamFromIssue({ title: "Clarify the next small task" });
  assert.equal(result.lead, "PM");
  assert.deepEqual(result.members.map((member) => member.role), ["PM"]);
  assert.deepEqual(result.humanGateSignals, []);
});

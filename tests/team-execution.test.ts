import assert from "node:assert/strict";
import test from "node:test";
import { composeTeamFromIssue } from "../src/orchestrator/team-composer.ts";
import {
  BoundedTeamExecutionCoordinator,
  buildTeamExecutionOrder,
  type EmployeeWorkInput,
  type EmployeeWorkResult,
} from "../src/orchestrator/team-execution.ts";

test("backend issue executes PM, Backend, QA, Reviewer in order", async () => {
  const team = composeTeamFromIssue({ title: "Implement backend API feature" });
  assert.deepEqual(buildTeamExecutionOrder(team), ["PM", "Backend", "QA", "Reviewer"]);

  const seen: string[] = [];
  const coordinator = new BoundedTeamExecutionCoordinator({
    async run(input): Promise<EmployeeWorkResult> {
      seen.push(input.role);
      return { ok: true, summary: `${input.role} done` };
    },
  });

  const report = await coordinator.run({ issue: { title: "Implement backend API feature" }, team });
  assert.deepEqual(seen, ["PM", "Backend", "QA", "Reviewer"]);
  assert.equal(report.stopReason, "completed");
  assert.equal(report.nextRole, null);
});

test("later employees receive prior employee outputs", async () => {
  const team = composeTeamFromIssue({ title: "Implement backend API feature" });
  const priorCounts: number[] = [];
  const coordinator = new BoundedTeamExecutionCoordinator({
    async run(input: EmployeeWorkInput): Promise<EmployeeWorkResult> {
      priorCounts.push(input.priorResults.length);
      return { ok: true, summary: `${input.role} result` };
    },
  });

  await coordinator.run({ issue: { title: "Implement backend API feature" }, team });
  assert.deepEqual(priorCounts, [0, 1, 2, 3]);
});

test("a blocker stops later employees", async () => {
  const team = composeTeamFromIssue({ title: "Implement backend API feature" });
  const seen: string[] = [];
  const coordinator = new BoundedTeamExecutionCoordinator({
    async run(input): Promise<EmployeeWorkResult> {
      seen.push(input.role);
      if (input.role === "Backend") return { ok: false, summary: "blocked", blocker: "missing contract" };
      return { ok: true, summary: "done" };
    },
  });

  const report = await coordinator.run({ issue: { title: "Implement backend API feature" }, team });
  assert.deepEqual(seen, ["PM", "Backend"]);
  assert.equal(report.stopReason, "blocked");
  assert.equal(report.nextRole, "QA");
});

test("human-gated work runs Governor before specialists and stops for approval", async () => {
  const issue = { title: "Implement backend permission change", body: "Change authorization permissions for the API." };
  const team = composeTeamFromIssue(issue);
  assert.deepEqual(buildTeamExecutionOrder(team).slice(0, 3), ["PM", "Governor", "Security Engineer"]);

  const seen: string[] = [];
  const coordinator = new BoundedTeamExecutionCoordinator({
    async run(input): Promise<EmployeeWorkResult> {
      seen.push(input.role);
      return { ok: true, summary: `${input.role} assessed` };
    },
  });

  const report = await coordinator.run({ issue, team });
  assert.deepEqual(seen, ["PM", "Governor"]);
  assert.equal(report.stopReason, "approval_required");
  assert.equal(report.nextRole, "Security Engineer");
});

test("role limit prevents unbounded execution", async () => {
  const team = composeTeamFromIssue({ title: "Implement backend API feature" });
  const coordinator = new BoundedTeamExecutionCoordinator({
    async run(input): Promise<EmployeeWorkResult> {
      return { ok: true, summary: `${input.role} done` };
    },
  }, 2);

  const report = await coordinator.run({ issue: { title: "Implement backend API feature" }, team });
  assert.equal(report.stopReason, "cycle_limit");
  assert.equal(report.nextRole, "QA");
  assert.equal(report.results.length, 2);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createJob,
  transitionJob,
  type Job,
  type JobErrorCode,
  type JobResult,
  type JobStatus,
} from "../src/domain/job.ts";

const CREATED_AT = "2026-08-22T13:30:00.000Z";
const STARTED_AT = "2026-08-22T13:31:00.000Z";
const FINISHED_AT = "2026-08-22T13:32:00.000Z";

function expectValue<T>(result: JobResult<T>): T {
  if (!result.ok) {
    assert.fail(`Expected success, received ${result.error.code}: ${result.error.message}`);
  }

  return result.value;
}

function expectError<T>(result: JobResult<T>, code: JobErrorCode): void {
  if (result.ok) {
    assert.fail("Expected an error result.");
  }

  assert.equal(result.error.code, code);
}

function createValidJob(): Job {
  return expectValue(
    createJob({
      id: "job-1",
      projectId: "project-1",
      createdAt: CREATED_AT,
    }),
  );
}

function jobWithStatus(status: JobStatus): Job {
  const pending = createValidJob();
  if (status === "pending") {
    return pending;
  }

  const running = expectValue(transitionJob(pending, "running", STARTED_AT));
  if (status === "running") {
    return running;
  }

  return expectValue(transitionJob(running, status, FINISHED_AT));
}

test("creates a frozen pending job with matching timestamps", () => {
  const job = createValidJob();

  assert.deepEqual(job, {
    id: "job-1",
    projectId: "project-1",
    status: "pending",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  assert.equal(Object.isFrozen(job), true);
});

test("creates a job without mutating its input", () => {
  const input = {
    id: "job-1",
    projectId: "project-1",
    createdAt: CREATED_AT,
  };
  const before = { ...input };

  createJob(input);

  assert.deepEqual(input, before);
});

for (const id of ["", "   ", " job-1", "job-1 "]) {
  test(`rejects invalid job id ${JSON.stringify(id)}`, () => {
    expectError(
      createJob({ id, projectId: "project-1", createdAt: CREATED_AT }),
      "INVALID_ID",
    );
  });
}

test("accepts an opaque non-UUID job id", () => {
  const job = expectValue(
    createJob({
      id: "local/job:alpha",
      projectId: "project-1",
      createdAt: CREATED_AT,
    }),
  );

  assert.equal(job.id, "local/job:alpha");
});

for (const projectId of ["", "   ", " project-1", "project-1 "]) {
  test(`rejects invalid project id ${JSON.stringify(projectId)}`, () => {
    expectError(
      createJob({ id: "job-1", projectId, createdAt: CREATED_AT }),
      "INVALID_PROJECT_ID",
    );
  });
}

test("accepts an opaque non-UUID project id", () => {
  const job = expectValue(
    createJob({
      id: "job-1",
      projectId: "local/project:alpha",
      createdAt: CREATED_AT,
    }),
  );

  assert.equal(job.projectId, "local/project:alpha");
});

for (const createdAt of [
  "not-a-date",
  "2026-08-22T13:30:00Z",
  "2026-08-22T13:30:00.000+00:00",
]) {
  test(`rejects non-canonical creation timestamp ${createdAt}`, () => {
    expectError(
      createJob({ id: "job-1", projectId: "project-1", createdAt }),
      "INVALID_TIMESTAMP",
    );
  });
}

test("transitions pending to running without mutation", () => {
  const pending = createValidJob();
  const running = expectValue(transitionJob(pending, "running", STARTED_AT));

  assert.equal(running.status, "running");
  assert.equal(running.projectId, pending.projectId);
  assert.equal(running.createdAt, CREATED_AT);
  assert.equal(running.updatedAt, STARTED_AT);
  assert.equal(pending.status, "pending");
  assert.equal(pending.updatedAt, CREATED_AT);
  assert.notEqual(running, pending);
  assert.equal(Object.isFrozen(running), true);
});

test("transitions running to succeeded", () => {
  const running = jobWithStatus("running");
  const succeeded = expectValue(transitionJob(running, "succeeded", FINISHED_AT));

  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.createdAt, CREATED_AT);
  assert.equal(succeeded.updatedAt, FINISHED_AT);
});

test("transitions running to failed", () => {
  const running = jobWithStatus("running");
  const failed = expectValue(transitionJob(running, "failed", FINISHED_AT));

  assert.equal(failed.status, "failed");
  assert.equal(failed.createdAt, CREATED_AT);
  assert.equal(failed.updatedAt, FINISHED_AT);
});

test("allows a transition timestamp equal to the current updatedAt", () => {
  const pending = createValidJob();
  const running = expectValue(transitionJob(pending, "running", CREATED_AT));

  assert.equal(running.updatedAt, CREATED_AT);
});

const invalidTransitions: ReadonlyArray<readonly [JobStatus, JobStatus]> = [
  ["pending", "pending"],
  ["pending", "succeeded"],
  ["pending", "failed"],
  ["running", "pending"],
  ["running", "running"],
  ["succeeded", "pending"],
  ["succeeded", "running"],
  ["succeeded", "succeeded"],
  ["succeeded", "failed"],
  ["failed", "pending"],
  ["failed", "running"],
  ["failed", "succeeded"],
  ["failed", "failed"],
];

for (const [from, to] of invalidTransitions) {
  test(`rejects transition from ${from} to ${to}`, () => {
    expectError(transitionJob(jobWithStatus(from), to, FINISHED_AT), "INVALID_TRANSITION");
  });
}

test("rejects a non-canonical transition timestamp", () => {
  expectError(transitionJob(createValidJob(), "running", "not-a-date"), "INVALID_TIMESTAMP");
});

test("rejects a transition timestamp earlier than updatedAt", () => {
  const running = jobWithStatus("running");

  expectError(transitionJob(running, "succeeded", CREATED_AT), "INVALID_TIMESTAMP");
});

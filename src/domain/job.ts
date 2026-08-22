import type { ProjectId } from "./project.ts";

export type JobId = string;

export type JobStatus = "pending" | "running" | "succeeded" | "failed";

export interface Job {
  readonly id: JobId;
  readonly projectId: ProjectId;
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type JobErrorCode =
  | "INVALID_ID"
  | "INVALID_PROJECT_ID"
  | "INVALID_TIMESTAMP"
  | "INVALID_TRANSITION";

export interface JobError {
  readonly code: JobErrorCode;
  readonly message: string;
}

export type JobResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: JobError };

export interface CreateJobInput {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

const validTransitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  pending: ["running"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
};

function failure<T>(code: JobErrorCode, message: string): JobResult<T> {
  return { ok: false, error: { code, message } };
}

function isValidOpaqueId(id: string): boolean {
  return id.length > 0 && id.trim().length > 0 && id === id.trim();
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = new Date(value);

  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function createJob(input: CreateJobInput): JobResult<Job> {
  if (!isValidOpaqueId(input.id)) {
    return failure(
      "INVALID_ID",
      "Job id must be a non-empty opaque string without surrounding whitespace.",
    );
  }

  if (!isValidOpaqueId(input.projectId)) {
    return failure(
      "INVALID_PROJECT_ID",
      "Project id must be a non-empty opaque string without surrounding whitespace.",
    );
  }

  if (!isCanonicalTimestamp(input.createdAt)) {
    return failure("INVALID_TIMESTAMP", "Job timestamp must be canonical ISO 8601 UTC.");
  }

  return {
    ok: true,
    value: Object.freeze({
      id: input.id,
      projectId: input.projectId,
      status: "pending",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
  };
}

export function transitionJob(
  job: Job,
  nextStatus: JobStatus,
  updatedAt: string,
): JobResult<Job> {
  if (!validTransitions[job.status].includes(nextStatus)) {
    return failure(
      "INVALID_TRANSITION",
      `Job cannot transition from ${job.status} to ${nextStatus}.`,
    );
  }

  if (
    !isCanonicalTimestamp(updatedAt) ||
    !isCanonicalTimestamp(job.updatedAt) ||
    Date.parse(updatedAt) < Date.parse(job.updatedAt)
  ) {
    return failure(
      "INVALID_TIMESTAMP",
      "Transition timestamp must be canonical ISO 8601 UTC and not precede updatedAt.",
    );
  }

  return {
    ok: true,
    value: Object.freeze({
      ...job,
      status: nextStatus,
      updatedAt,
    }),
  };
}

export type ProjectId = string;

export type ProjectStatus = "draft" | "active" | "archived";

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProjectErrorCode =
  | "INVALID_ID"
  | "INVALID_NAME"
  | "INVALID_TIMESTAMP"
  | "INVALID_TRANSITION";

export interface ProjectError {
  readonly code: ProjectErrorCode;
  readonly message: string;
}

export type ProjectResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProjectError };

export interface CreateProjectInput {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

const validTransitions: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  draft: ["active"],
  active: ["archived"],
  archived: [],
};

function failure<T>(code: ProjectErrorCode, message: string): ProjectResult<T> {
  return { ok: false, error: { code, message } };
}

function isValidId(id: string): boolean {
  return id.length > 0 && id.trim().length > 0 && id === id.trim();
}

function normalizeName(name: string): ProjectResult<string> {
  if (name.includes("\r") || name.includes("\n")) {
    return failure("INVALID_NAME", "Project name must not contain line breaks.");
  }

  const normalizedName = name.trim();
  const length = Array.from(normalizedName).length;

  if (length === 0 || length > 100) {
    return failure("INVALID_NAME", "Project name must contain between 1 and 100 characters.");
  }

  return { ok: true, value: normalizedName };
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = new Date(value);

  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function createProject(input: CreateProjectInput): ProjectResult<Project> {
  if (!isValidId(input.id)) {
    return failure(
      "INVALID_ID",
      "Project id must be a non-empty opaque string without surrounding whitespace.",
    );
  }

  const nameResult = normalizeName(input.name);
  if (!nameResult.ok) {
    return nameResult;
  }

  if (!isCanonicalTimestamp(input.createdAt)) {
    return failure("INVALID_TIMESTAMP", "Project timestamp must be canonical ISO 8601 UTC.");
  }

  return {
    ok: true,
    value: Object.freeze({
      id: input.id,
      name: nameResult.value,
      status: "draft",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }),
  };
}

export function transitionProject(
  project: Project,
  nextStatus: ProjectStatus,
  updatedAt: string,
): ProjectResult<Project> {
  if (!validTransitions[project.status].includes(nextStatus)) {
    return failure(
      "INVALID_TRANSITION",
      `Project cannot transition from ${project.status} to ${nextStatus}.`,
    );
  }

  if (
    !isCanonicalTimestamp(updatedAt) ||
    !isCanonicalTimestamp(project.updatedAt) ||
    Date.parse(updatedAt) < Date.parse(project.updatedAt)
  ) {
    return failure(
      "INVALID_TIMESTAMP",
      "Transition timestamp must be canonical ISO 8601 UTC and not precede updatedAt.",
    );
  }

  return {
    ok: true,
    value: Object.freeze({
      ...project,
      status: nextStatus,
      updatedAt,
    }),
  };
}

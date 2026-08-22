import assert from "node:assert/strict";
import test from "node:test";

import {
  createProject,
  transitionProject,
  type Project,
  type ProjectErrorCode,
  type ProjectResult,
  type ProjectStatus,
} from "../src/domain/project.ts";

const CREATED_AT = "2026-08-22T12:00:00.000Z";
const ACTIVATED_AT = "2026-08-22T12:01:00.000Z";
const ARCHIVED_AT = "2026-08-22T12:02:00.000Z";

function expectValue<T>(result: ProjectResult<T>): T {
  if (!result.ok) {
    assert.fail(`Expected success, received ${result.error.code}: ${result.error.message}`);
  }

  return result.value;
}

function expectError<T>(result: ProjectResult<T>, code: ProjectErrorCode): void {
  if (result.ok) {
    assert.fail("Expected an error result.");
  }

  assert.equal(result.error.code, code);
}

function createValidProject(): Project {
  return expectValue(
    createProject({ id: "project-1", name: "Test Project", createdAt: CREATED_AT }),
  );
}

function projectWithStatus(status: ProjectStatus): Project {
  const draft = createValidProject();
  if (status === "draft") {
    return draft;
  }

  const active = expectValue(transitionProject(draft, "active", ACTIVATED_AT));
  if (status === "active") {
    return active;
  }

  return expectValue(transitionProject(active, "archived", ARCHIVED_AT));
}

test("creates a frozen draft project with matching timestamps", () => {
  const project = createValidProject();

  assert.deepEqual(project, {
    id: "project-1",
    name: "Test Project",
    status: "draft",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  assert.equal(Object.isFrozen(project), true);
});

test("trims the project name without mutating the input", () => {
  const input = { id: "project-1", name: "  My Project  ", createdAt: CREATED_AT };
  const project = expectValue(createProject(input));

  assert.equal(project.name, "My Project");
  assert.equal(input.name, "  My Project  ");
});

for (const id of ["", "   ", " project-1", "project-1 "]) {
  test(`rejects invalid project id ${JSON.stringify(id)}`, () => {
    expectError(createProject({ id, name: "Project", createdAt: CREATED_AT }), "INVALID_ID");
  });
}

test("accepts an opaque non-UUID project id", () => {
  const project = expectValue(
    createProject({ id: "local/project:alpha", name: "Project", createdAt: CREATED_AT }),
  );

  assert.equal(project.id, "local/project:alpha");
});

for (const name of ["", "   "]) {
  test(`rejects empty project name ${JSON.stringify(name)}`, () => {
    expectError(createProject({ id: "project-1", name, createdAt: CREATED_AT }), "INVALID_NAME");
  });
}

test("accepts a 100 Unicode code point project name", () => {
  const name = "😀".repeat(100);
  const project = expectValue(createProject({ id: "project-1", name, createdAt: CREATED_AT }));

  assert.equal(Array.from(project.name).length, 100);
});

test("rejects a project name longer than 100 Unicode code points", () => {
  expectError(
    createProject({ id: "project-1", name: "😀".repeat(101), createdAt: CREATED_AT }),
    "INVALID_NAME",
  );
});

test("accepts Unicode and internal spaces in a project name", () => {
  const project = expectValue(
    createProject({ id: "project-1", name: "制作 プロジェクト 🎬", createdAt: CREATED_AT }),
  );

  assert.equal(project.name, "制作 プロジェクト 🎬");
});

for (const name of ["Line 1\nLine 2", "Line 1\rLine 2"]) {
  test(`rejects project name containing a line break`, () => {
    expectError(createProject({ id: "project-1", name, createdAt: CREATED_AT }), "INVALID_NAME");
  });
}

for (const createdAt of ["not-a-date", "2026-08-22T12:00:00Z", "2026-08-22T12:00:00.000+00:00"]) {
  test(`rejects non-canonical timestamp ${createdAt}`, () => {
    expectError(
      createProject({ id: "project-1", name: "Project", createdAt }),
      "INVALID_TIMESTAMP",
    );
  });
}

test("transitions a draft project to active without mutation", () => {
  const draft = createValidProject();
  const active = expectValue(transitionProject(draft, "active", ACTIVATED_AT));

  assert.equal(active.status, "active");
  assert.equal(active.createdAt, CREATED_AT);
  assert.equal(active.updatedAt, ACTIVATED_AT);
  assert.equal(draft.status, "draft");
  assert.equal(draft.updatedAt, CREATED_AT);
  assert.notEqual(active, draft);
  assert.equal(Object.isFrozen(active), true);
});

test("transitions an active project to archived", () => {
  const active = projectWithStatus("active");
  const archived = expectValue(transitionProject(active, "archived", ARCHIVED_AT));

  assert.equal(archived.status, "archived");
  assert.equal(archived.createdAt, CREATED_AT);
  assert.equal(archived.updatedAt, ARCHIVED_AT);
});

test("allows a transition timestamp equal to the current updatedAt", () => {
  const draft = createValidProject();
  const active = expectValue(transitionProject(draft, "active", CREATED_AT));

  assert.equal(active.updatedAt, CREATED_AT);
});

const invalidTransitions: ReadonlyArray<readonly [ProjectStatus, ProjectStatus]> = [
  ["draft", "draft"],
  ["draft", "archived"],
  ["active", "draft"],
  ["active", "active"],
  ["archived", "draft"],
  ["archived", "active"],
  ["archived", "archived"],
];

for (const [from, to] of invalidTransitions) {
  test(`rejects transition from ${from} to ${to}`, () => {
    expectError(transitionProject(projectWithStatus(from), to, ARCHIVED_AT), "INVALID_TRANSITION");
  });
}

test("rejects a non-canonical transition timestamp", () => {
  expectError(transitionProject(createValidProject(), "active", "not-a-date"), "INVALID_TIMESTAMP");
});

test("rejects a transition timestamp earlier than updatedAt", () => {
  const active = projectWithStatus("active");

  expectError(transitionProject(active, "archived", CREATED_AT), "INVALID_TIMESTAMP");
});

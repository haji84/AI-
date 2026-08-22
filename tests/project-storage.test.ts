import assert from "node:assert/strict";
import test from "node:test";

import {
  createProject,
  transitionProject,
  type Project,
  type ProjectId,
  type ProjectStatus,
} from "../src/domain/project.ts";
import type {
  ProjectStorage,
  ProjectStorageErrorCode,
  ProjectStorageResult,
} from "../src/storage/project-storage.ts";

const CREATED_AT = "2026-08-22T12:00:00.000Z";
const ACTIVATED_AT = "2026-08-22T12:01:00.000Z";
const ARCHIVED_AT = "2026-08-22T12:02:00.000Z";

class InMemoryProjectStorage implements ProjectStorage {
  private readonly projects = new Map<ProjectId, Project>();
  private readonly failSave: boolean;
  private readonly failGet: boolean;

  constructor(failSave = false, failGet = false) {
    this.failSave = failSave;
    this.failGet = failGet;
  }

  async save(project: Project): Promise<ProjectStorageResult<void>> {
    if (this.failSave) {
      return {
        ok: false,
        error: { code: "STORAGE_FAILURE", message: "Unable to save project." },
      };
    }

    this.projects.set(project.id, project);
    return { ok: true, value: undefined };
  }

  async getById(id: ProjectId): Promise<ProjectStorageResult<Project | null>> {
    if (this.failGet) {
      return {
        ok: false,
        error: { code: "STORAGE_FAILURE", message: "Unable to get project." },
      };
    }

    return { ok: true, value: this.projects.get(id) ?? null };
  }
}

function expectValue<T>(result: ProjectStorageResult<T>): T {
  if (!result.ok) {
    assert.fail(`Expected success, received ${result.error.code}: ${result.error.message}`);
  }

  return result.value;
}

function expectError<T>(
  result: ProjectStorageResult<T>,
  code: ProjectStorageErrorCode,
): void {
  if (result.ok) {
    assert.fail("Expected an error result.");
  }

  assert.equal(result.error.code, code);
}

function createDraft(id = "project-1"): Project {
  const result = createProject({ id, name: "Test Project", createdAt: CREATED_AT });
  if (!result.ok) {
    assert.fail(`Unable to create fixture: ${result.error.code}`);
  }

  return result.value;
}

function projectWithStatus(status: ProjectStatus): Project {
  const draft = createDraft();
  if (status === "draft") {
    return draft;
  }

  const activeResult = transitionProject(draft, "active", ACTIVATED_AT);
  if (!activeResult.ok) {
    assert.fail(`Unable to activate fixture: ${activeResult.error.code}`);
  }
  if (status === "active") {
    return activeResult.value;
  }

  const archivedResult = transitionProject(activeResult.value, "archived", ARCHIVED_AT);
  if (!archivedResult.ok) {
    assert.fail(`Unable to archive fixture: ${archivedResult.error.code}`);
  }

  return archivedResult.value;
}

test("saves and gets a complete project snapshot", async () => {
  const storage = new InMemoryProjectStorage();
  const project = createDraft();

  assert.deepEqual(await storage.save(project), { ok: true, value: undefined });
  assert.deepEqual(expectValue(await storage.getById(project.id)), project);
});

test("returns a successful null result when a project is not found", async () => {
  const storage = new InMemoryProjectStorage();

  assert.deepEqual(await storage.getById("missing-project"), { ok: true, value: null });
});

test("upserts the whole project snapshot", async () => {
  const storage = new InMemoryProjectStorage();
  const draft = createDraft();
  const activeResult = transitionProject(draft, "active", ACTIVATED_AT);
  if (!activeResult.ok) {
    assert.fail(`Unable to activate fixture: ${activeResult.error.code}`);
  }

  await storage.save(draft);
  await storage.save(activeResult.value);

  assert.deepEqual(expectValue(await storage.getById(draft.id)), activeResult.value);
});

test("does not mutate the project passed to save", async () => {
  const storage = new InMemoryProjectStorage();
  const project = createDraft();
  const before = { ...project };

  await storage.save(project);

  assert.deepEqual(project, before);
  assert.equal(Object.isFrozen(project), true);
});

test("returns a project equal to the saved value without correcting its fields", async () => {
  const storage = new InMemoryProjectStorage();
  const project = createDraft("opaque-id");

  await storage.save(project);

  assert.deepEqual(expectValue(await storage.getById("opaque-id")), project);
});

test("reports save failures without throwing", async () => {
  const storage = new InMemoryProjectStorage(true);
  const operation = storage.save(createDraft());

  await assert.doesNotReject(operation);
  expectError(await operation, "STORAGE_FAILURE");
});

test("reports get failures without throwing", async () => {
  const storage = new InMemoryProjectStorage(false, true);
  const operation = storage.getById("project-1");

  await assert.doesNotReject(operation);
  expectError(await operation, "STORAGE_FAILURE");
});

for (const status of ["draft", "active", "archived"] as const) {
  test(`stores a ${status} project without lifecycle validation`, async () => {
    const storage = new InMemoryProjectStorage();
    const project = projectWithStatus(status);

    await storage.save(project);

    assert.deepEqual(expectValue(await storage.getById(project.id)), project);
  });
}

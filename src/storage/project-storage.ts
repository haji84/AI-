import type { Project, ProjectId } from "../domain/project.ts";

export type ProjectStorageErrorCode = "STORAGE_FAILURE";

export interface ProjectStorageError {
  readonly code: ProjectStorageErrorCode;
  readonly message: string;
}

export type ProjectStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProjectStorageError };

export interface ProjectStorage {
  save(project: Project): Promise<ProjectStorageResult<void>>;
  getById(id: ProjectId): Promise<ProjectStorageResult<Project | null>>;
}

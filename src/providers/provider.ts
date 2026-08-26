import type { JobId } from "../domain/job.ts";
import type { ProjectId } from "../domain/project.ts";

export type ProviderErrorCode = "PROVIDER_FAILURE";

export interface ProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProviderError };

export interface ProviderContext {
  readonly jobId: JobId;
  readonly projectId: ProjectId;
}

export interface Provider<TInput, TOutput> {
  execute(
    context: ProviderContext,
    input: TInput,
  ): Promise<ProviderResult<TOutput>>;
}

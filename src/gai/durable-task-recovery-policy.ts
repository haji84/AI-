import type { DurableTaskMigrationClass } from "./durable-task-runtime.ts";

export type RecoveryMode = "resume" | "restart" | "wait" | "verify";

export type RecoveryBlocker =
  | "CHECKPOINT_REQUIRED"
  | "PINNED_OWNER_UNAVAILABLE"
  | "EXTERNAL_EFFECT_REVIEW_REQUIRED";

export interface RecoveryInput {
  migrationClass: DurableTaskMigrationClass;
  checkpointRef?: string;
  attempts: number;
  maxAttempts: number;
  lostOwner?: string;
}

export interface RecoveryDecision {
  mode: RecoveryMode;
  retry: boolean;
  fail: boolean;
  blocker?: RecoveryBlocker;
  preserveCheckpoint: boolean;
  pinnedOwner?: string;
}

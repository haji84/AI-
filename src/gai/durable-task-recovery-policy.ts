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

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.migrationClass === "PINNED") {
    return {
      mode: "wait",
      retry: false,
      fail: false,
      blocker: "PINNED_OWNER_UNAVAILABLE",
      preserveCheckpoint: true,
      pinnedOwner: input.lostOwner,
    };
  }

  if (input.migrationClass === "SIDE_EFFECTING") {
    return {
      mode: "verify",
      retry: false,
      fail: false,
      blocker: "EXTERNAL_EFFECT_REVIEW_REQUIRED",
      preserveCheckpoint: true,
    };
  }

  if (input.migrationClass === "MIGRATABLE" && !input.checkpointRef?.trim()) {
    return {
      mode: "wait",
      retry: false,
      fail: false,
      blocker: "CHECKPOINT_REQUIRED",
      preserveCheckpoint: true,
    };
  }

  if (input.attempts >= input.maxAttempts) {
    return {
      mode: "wait",
      retry: false,
      fail: true,
      preserveCheckpoint: input.migrationClass === "MIGRATABLE",
    };
  }

  if (input.migrationClass === "MIGRATABLE") {
    return {
      mode: "resume",
      retry: true,
      fail: false,
      preserveCheckpoint: true,
    };
  }

  return {
    mode: "restart",
    retry: true,
    fail: false,
    preserveCheckpoint: false,
  };
}

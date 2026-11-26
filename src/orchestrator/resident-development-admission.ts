import type { DevelopmentJob } from "./development-job.ts";
import type { ContextItem, Goal } from "./goal-loop.ts";
import { resolve } from "node:path";
import { acquireCognitiveLease } from "../gai/cognitive-lease.ts";

/** Passed only by the canonical host; intake/context/model data cannot supply it. */
export interface ResidentDevelopmentRunInput {
  goalId: string;
  goal: Goal;
  context: ContextItem[];
  assertExecutionAuthority?: () => Promise<void>;
  writer?: ResidentExecutionWriter;
}

export interface ResidentExecutionWriter {
  readonly goalId: string;
  readonly leasePath: string;
  assertHeld(): void;
  release(): Promise<void>;
}
const liveWriters = new WeakSet<object>();
export function isResidentExecutionWriter(writer: ResidentExecutionWriter | undefined, goalId: string, path?: string): boolean {
  return Boolean(writer && liveWriters.has(writer) && writer.goalId === goalId && (!path || writer.leasePath === resolve(path)));
}

/** Issue a non-serializable capability only after obtaining the existing OS-backed lock. */
export async function acquireResidentExecutionWriter(path: string, goalId: string): Promise<ResidentExecutionWriter> {
  let release: () => Promise<void>;
  try { release = await acquireCognitiveLease(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ResidentExecutionBusyError();
    throw error;
  }
  const writer: ResidentExecutionWriter = Object.freeze({ goalId, leasePath: resolve(path),
    assertHeld() { if (!liveWriters.has(writer)) throw new ResidentExecutionStop("blocked", "RESIDENT_EXECUTION_WRITER_RELEASED"); },
    async release() { if (!liveWriters.delete(writer)) return; await release(); },
  });
  liveWriters.add(writer);
  return writer;
}

export type ResidentDevelopmentAdmissionStage = "build" | "verify" | "acceptance" | "release" | "commit";
export interface ResidentDevelopmentAdmission {
  /** Authority-only check also guards planning and resource-wait writes before routing. */
  assertAuthority(input: { goalId: string; goal: Goal; writer?: ResidentExecutionWriter }): Promise<void>;
  check(input: { job: DevelopmentJob; goal: Goal; stage: ResidentDevelopmentAdmissionStage;
    workItemId?: string; writer?: ResidentExecutionWriter }): Promise<void>;
}

/** A competing executor must not change the live owner's durable WorkRun. */
export class ResidentExecutionBusyError extends Error {
  constructor() { super("RESIDENT_EXECUTION_WRITER_BUSY"); this.name = "ResidentExecutionBusyError"; }
}

/** Preserve authoritative stops across asynchronous Builder/verifier calls. */
export class ResidentExecutionStop extends Error {
  readonly mode: "paused" | "human_gate" | "blocked";
  constructor(mode: "paused" | "human_gate" | "blocked", reason: string) {
    super(reason); this.name = "ResidentExecutionStop"; this.mode = mode;
  }
}

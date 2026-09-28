export interface DailyDriverLiveE2EOptions {
  baseUrl: string;
  token: string;
  runId: string;
  runAttempt: string;
  pollMs?: number;
  timeoutMs?: number;
}

export interface DailyDriverLiveE2EEvidence {
  schemaVersion: number;
  status: string;
  acceptance: string;
  acceptedAt: string;
  completedAt: string;
  executionScheduled: boolean;
  registeredFleetCount: number;
  task: {
    id: string;
    type: string;
    status: string;
    targetNodeHash: string;
    detailKeys: string[];
  };
  transitions: Array<{ status: string; observedAt: string }>;
  secretsPersisted: boolean;
}

export function runDailyDriverLiveE2E(options: DailyDriverLiveE2EOptions): Promise<DailyDriverLiveE2EEvidence>;

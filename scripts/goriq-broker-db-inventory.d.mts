export interface BrokerDbInventoryResult {
  label: string;
  exists: boolean;
  bytes: number;
  fleetCount: number | null;
  workerIdentityCount: number | null;
  snapshotUpdatedAt: string | null;
  sha256: string | null;
  error: string | null;
}

export function inspectBrokerDatabase(label: string, path: string): BrokerDbInventoryResult;

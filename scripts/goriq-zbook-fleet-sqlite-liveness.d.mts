export type ZBookFleetScanOptions = {
  nowMs?: number;
  freshnessMs?: number;
  expectedFleet?: number;
  expectedIdentities?: number;
};

export type ZBookFleetScanResult = {
  ok: boolean;
  reason: "preserved_fleet_db_found" | "preserved_fleet_db_not_found";
  scanRootsAvailable: number;
  scannedDatabaseFiles: number;
  matchingDatabases: number;
  fleetCount: number | null;
  workerIdentityCount: number | null;
  androidRegistered: number | null;
  androidFresh: number | null;
  newestAndroidHeartbeatAgeMs: number | null;
  freshnessMs: number;
  snapshotUpdatedAt: string | null;
};

export function scanZBookFleetDatabases(
  root: string | string[],
  options?: ZBookFleetScanOptions,
): ZBookFleetScanResult;

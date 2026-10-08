export interface BrokerDbInventoryResult {
  label: string;
  exists: boolean;
  bytes: number;
  fleetCount: number | null;
  workerIdentityCount: number | null;
  fleetKinds: Record<"android" | "ios" | "windows" | "macos" | "linux" | "cloud" | "unknown", number> | null;
  registeredPcCount: number | null;
  pcWithActiveIdentityCount: number | null;
  pcIdentityCoverage: "available" | "unavailable";
  snapshotUpdatedAt: string | null;
  sha256: string | null;
  error: string | null;
}

export function inspectBrokerDatabase(label: string, path: string): BrokerDbInventoryResult;

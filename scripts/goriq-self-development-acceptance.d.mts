export interface SelfDevelopmentAcceptanceScenario {
  id: string;
  status: string;
  artifactDigest: string;
  environment: string;
  deviceIdentityClass: string;
  checks: string[];
}

export interface SelfDevelopmentAcceptanceResult {
  schemaVersion: 1;
  mode: string;
  sourceRevision: string;
  recordedAt: string;
  scenarios: SelfDevelopmentAcceptanceScenario[];
  deviceTopology: { iphoneCount: number; secondIphoneRejected: boolean; physicalEvidence: unknown };
  secretScan: { passed: boolean; findings: string[] };
  evidenceClasses: {
    deterministicSimulation: string;
    realLocalModel: string;
    realGitHub: string;
    physicalIphone: string;
  };
}

export function runSelfDevelopmentAcceptance(input: {
  mode: string;
  sourceRevision: string;
  recordedAt: string;
}): Promise<SelfDevelopmentAcceptanceResult>;

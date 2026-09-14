import type {
  WorkerCapability,
  WorkerConnectivity,
  WorkerDescriptor,
  WorkerExecutionMode,
  WorkerHealth,
} from "./worker-runtime.ts";

export type WorkerContractCheck =
  | "identity"
  | "capabilities"
  | "execution-mode"
  | "connectivity"
  | "persistence"
  | "security"
  | "verifier-hooks";

export interface WorkerContractRequirement {
  requiredCapabilities?: WorkerCapability[];
  requiredExecutionMode?: WorkerExecutionMode;
  connectivity?: WorkerConnectivity;
  requireLocalPersistence?: boolean;
  requireCheckpointResume?: boolean;
  requireOfflineQueue?: boolean;
  requireCredentialIsolation?: boolean;
  requireTaskScopedAuthorization?: boolean;
  requireExecutionEvidence?: boolean;
}

export interface WorkerContractEvidence {
  check: WorkerContractCheck;
  passed: boolean;
  detail: string;
}

export interface WorkerContractEvaluation {
  workerId: string;
  passed: boolean;
  evidence: WorkerContractEvidence[];
  failureReasons: string[];
}

function addEvidence(
  evidence: WorkerContractEvidence[],
  check: WorkerContractCheck,
  passed: boolean,
  detail: string,
): void {
  evidence.push({ check, passed, detail });
}

export function evaluateWorkerContract(
  descriptor: WorkerDescriptor,
  requirement: WorkerContractRequirement = {},
  health?: WorkerHealth,
): WorkerContractEvaluation {
  const evidence: WorkerContractEvidence[] = [];

  addEvidence(
    evidence,
    "identity",
    Boolean(descriptor.id && descriptor.label && descriptor.platform),
    descriptor.id && descriptor.label && descriptor.platform
      ? `worker identity declared as ${descriptor.id}/${descriptor.platform}`
      : "worker identity is incomplete",
  );

  const missingCapabilities = (requirement.requiredCapabilities ?? []).filter(
    (capability) => !descriptor.capabilities.includes(capability),
  );
  addEvidence(
    evidence,
    "capabilities",
    missingCapabilities.length === 0,
    missingCapabilities.length === 0
      ? "required capabilities are declared"
      : `missing capabilities: ${missingCapabilities.join(", ")}`,
  );

  const executionModePassed =
    !requirement.requiredExecutionMode ||
    (descriptor.executionModes ?? ["resident"]).includes(requirement.requiredExecutionMode);
  addEvidence(
    evidence,
    "execution-mode",
    executionModePassed,
    executionModePassed
      ? `execution mode ${requirement.requiredExecutionMode ?? "any"} is supported`
      : `execution mode ${requirement.requiredExecutionMode} is not supported`,
  );

  const connectivity = requirement.connectivity ?? health?.connectivity ?? "online";
  const onlineRequiredWhileOffline =
    (connectivity === "offline" || connectivity === "degraded") &&
    descriptor.networkRequirement === "online-required";
  addEvidence(
    evidence,
    "connectivity",
    !onlineRequiredWhileOffline,
    onlineRequiredWhileOffline
      ? `${descriptor.id} requires online connectivity`
      : `${descriptor.id} can participate while connectivity is ${connectivity}`,
  );

  const persistenceChecks = [
    !requirement.requireLocalPersistence || descriptor.persistence?.localState === true,
    !requirement.requireCheckpointResume || descriptor.persistence?.checkpointResume === true,
    !requirement.requireOfflineQueue || descriptor.persistence?.offlineQueue === true,
  ];
  addEvidence(
    evidence,
    "persistence",
    persistenceChecks.every(Boolean),
    persistenceChecks.every(Boolean) ? "required persistence guarantees are declared" : "persistence requirement is missing",
  );

  const securityChecks = [
    !requirement.requireCredentialIsolation || descriptor.securityContext?.credentialIsolation === true,
    !requirement.requireTaskScopedAuthorization || descriptor.securityContext?.taskScopedAuthorization === true,
  ];
  addEvidence(
    evidence,
    "security",
    securityChecks.every(Boolean),
    securityChecks.every(Boolean) ? "required security boundaries are declared" : "security requirement is missing",
  );

  const verifierPassed =
    !requirement.requireExecutionEvidence || descriptor.verifierHooks?.executionEvidence === true;
  addEvidence(
    evidence,
    "verifier-hooks",
    verifierPassed,
    verifierPassed ? "required verifier evidence hook is declared" : "execution evidence hook is missing",
  );

  if (health) {
    addEvidence(
      evidence,
      "connectivity",
      health.available,
      health.available ? "runtime health reports worker available" : health.detail ?? "runtime health reports worker unavailable",
    );
  }

  const failureReasons = evidence.filter((item) => !item.passed).map((item) => item.detail);
  return {
    workerId: descriptor.id,
    passed: failureReasons.length === 0,
    evidence,
    failureReasons,
  };
}

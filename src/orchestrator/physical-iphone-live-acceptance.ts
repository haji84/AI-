type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function selectSingleAvailablePhysicalIPhone(input: unknown): string {
  const root = record(input);
  const result = record(root.result);
  if (!Array.isArray(result.devices)) throw new Error("devicectl result.devices is missing");

  const identifiers = result.devices.flatMap((value) => {
    const device = record(value);
    const unified = record(device.properties);
    const properties = record(device.deviceProperties);
    const hardware = record(device.hardwareProperties);
    const connection = record(device.connectionProperties);
    const identifier = text(device.identifier);
    const productType = text(unified.productType) || text(hardware.productType);
    const deviceClass = text(unified.deviceClass) || text(properties.deviceClass);
    const bootState = (text(unified.bootState) || text(properties.bootState)).toLowerCase();
    const pairingState = (text(unified.pairingState) || text(connection.pairingState)).toLowerCase();
    const tunnelState = (text(unified.tunnelState) || text(connection.tunnelState)).toLowerCase();
    const isIPhone = productType.toLowerCase().startsWith("iphone") || deviceClass.toLowerCase() === "iphone";
    const available = bootState === "booted" && pairingState === "paired" && (tunnelState === "connected" || tunnelState === "available");
    return identifier && isIPhone && available ? [identifier] : [];
  });

  if (identifiers.length !== 1) throw new Error(`expected exactly one available physical iPhone, found ${identifiers.length}`);
  return identifiers[0]!;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as UnknownRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function verifyPhysicalIPhoneToolchainEvidence(
  bridgeEvidence: unknown,
  toolchainResult: unknown,
  expected: { mainSha: string; taskId: string; deviceId: string; challenge: string; bundleIdentifier: string },
): UnknownRecord {
  const bridge = record(bridgeEvidence);
  const result = record(bridge.result);
  const deviceResult = record(toolchainResult);
  const evidence = record(result.evidence);
  if (!Object.keys(deviceResult).length) throw new Error("physical toolchain result is missing");
  if (bridge.evidenceType !== "physical-iphone-e2e" || bridge.mainSha !== expected.mainSha) throw new Error("bridge evidence is not bound to current main");
  if (result.taskId !== expected.taskId || result.deviceId !== expected.deviceId || result.ok !== true) throw new Error("bridge result identity is invalid");
  if (result.output !== `physical-ios-worker-ok: ${expected.challenge}`) throw new Error("bridge result challenge is invalid");
  if (evidence.physicalDevice !== "true" || evidence.buildChallenge !== expected.challenge || evidence.bundleIdentifier !== expected.bundleIdentifier) throw new Error("bridge result build evidence is invalid");
  if (canonical(result) !== canonical(deviceResult)) throw new Error("selected physical iPhone toolchain result does not match bridge result");
  return structuredClone(result);
}

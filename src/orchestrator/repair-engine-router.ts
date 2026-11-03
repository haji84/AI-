export type RepairEngineId =
  | "goriq-deterministic"
  | "goriq-learned"
  | "goriq-local-code"
  | "goriq-local-capability"
  | "chat"
  | "work"
  | "free-external"
  | "codex"
  | "human-gate";

export interface RepairEngineStage {
  priority: number;
  id: RepairEngineId;
  kind: "goriq" | "local" | "external" | "human";
  terminal: boolean;
}

export const REPAIR_ENGINE_ESCALATION_ORDER: readonly RepairEngineStage[] = Object.freeze([
  { priority: 1, id: "goriq-deterministic", kind: "goriq", terminal: false },
  { priority: 2, id: "goriq-learned", kind: "goriq", terminal: false },
  { priority: 3, id: "goriq-local-code", kind: "local", terminal: false },
  { priority: 4, id: "goriq-local-capability", kind: "local", terminal: false },
  { priority: 5, id: "chat", kind: "external", terminal: false },
  { priority: 6, id: "work", kind: "external", terminal: false },
  { priority: 7, id: "free-external", kind: "external", terminal: false },
  { priority: 8, id: "codex", kind: "external", terminal: false },
  { priority: 9, id: "human-gate", kind: "human", terminal: true },
]);

export type RepairEngineAvailability = Partial<Record<Exclude<RepairEngineId, "human-gate">, boolean>>;

export function executableRepairEngines(
  availability: RepairEngineAvailability,
): RepairEngineStage[] {
  return REPAIR_ENGINE_ESCALATION_ORDER.filter((stage) =>
    stage.id === "human-gate" ? false : availability[stage.id] === true
  );
}

export function nextRepairEngine(
  availability: RepairEngineAvailability,
  attempted: Iterable<RepairEngineId> = [],
): RepairEngineStage {
  const attemptedSet = new Set(attempted);
  for (const stage of REPAIR_ENGINE_ESCALATION_ORDER) {
    if (attemptedSet.has(stage.id)) continue;
    if (stage.id === "human-gate") return stage;
    if (availability[stage.id] === true) return stage;
  }
  return REPAIR_ENGINE_ESCALATION_ORDER[REPAIR_ENGINE_ESCALATION_ORDER.length - 1]!;
}

import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { TeamMemory, type TeamBlueprint } from "./team-organizational-memory.ts";

interface TeamMemorySnapshotV1 {
  version: 1;
  blueprints: TeamBlueprint[];
}

function validateBlueprint(value: unknown): asserts value is TeamBlueprint {
  if (!value || typeof value !== "object") throw new Error("invalid team blueprint entry");
  const blueprint = value as Partial<TeamBlueprint>;
  if (typeof blueprint.id !== "string" || !blueprint.id.trim()) throw new Error("invalid team blueprint id");
  if (typeof blueprint.name !== "string") throw new Error(`invalid team blueprint name:${blueprint.id}`);
  if (!Array.isArray(blueprint.goalTerms) || !Array.isArray(blueprint.assignments)) {
    throw new Error(`invalid team blueprint structure:${blueprint.id}`);
  }
  if (!Number.isInteger(blueprint.generation) || !Number.isInteger(blueprint.uses)
    || !Number.isInteger(blueprint.successes) || !Number.isInteger(blueprint.verifiedSuccesses)
    || !Number.isInteger(blueprint.failures) || typeof blueprint.scoreTotal !== "number") {
    throw new Error(`invalid team blueprint metrics:${blueprint.id}`);
  }
  if (!["experimental", "reusable", "standing_candidate", "demoted"].includes(String(blueprint.lifecycle))) {
    throw new Error(`invalid team blueprint lifecycle:${blueprint.id}`);
  }
}

function parseSnapshot(raw: string): TeamMemorySnapshotV1 {
  const parsed = JSON.parse(raw) as Partial<TeamMemorySnapshotV1>;
  if (parsed.version !== 1 || !Array.isArray(parsed.blueprints)) {
    throw new Error("unsupported or invalid team memory snapshot");
  }
  for (const blueprint of parsed.blueprints) validateBlueprint(blueprint);
  return { version: 1, blueprints: parsed.blueprints };
}

export class JsonFileTeamMemoryStore {
  private readonly path: string;

  constructor(path: string) {
    if (!path.trim()) throw new Error("team memory path must not be empty");
    this.path = path;
  }

  async load(): Promise<TeamMemory> {
    const memory = new TeamMemory();
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return memory;
      throw cause;
    }

    const snapshot = parseSnapshot(raw);
    for (const blueprint of snapshot.blueprints) memory.save(blueprint);
    return memory;
  }

  async persist(memory: TeamMemory): Promise<void> {
    const snapshot: TeamMemorySnapshotV1 = {
      version: 1,
      blueprints: memory.list().sort((a, b) => a.id.localeCompare(b.id)),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}

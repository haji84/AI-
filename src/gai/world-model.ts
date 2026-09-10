import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LearningRecord, Observation, Prediction } from "./types.ts";
import { learnFromOutcome } from "./learning.ts";
import { PersistentMemoryStore } from "./memory-store.ts";

export interface WorldModelEvent {
  id: string;
  context: string;
  prediction: Prediction;
  observation: Observation;
  predictionError: number;
  surprise: number;
  createdAt: string;
}

export interface WorldModelStats {
  context: string;
  action: string;
  samples: number;
  successes: number;
  successRate: number;
  meanPredictionError: number;
  calibratedConfidence: number;
}

interface WorldModelFile {
  version: 1;
  events: WorldModelEvent[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
}

function similarity(left: string, right: string): number {
  const a = new Set(normalize(left));
  const b = new Set(normalize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

export function calculatePredictionError(prediction: Prediction, observation: Observation): number {
  const expectedSuccessProbability = clamp(prediction.confidence);
  const observed = observation.success ? 1 : 0;
  return Math.abs(expectedSuccessProbability - observed);
}

export class PersistentWorldModel {
  #events: WorldModelEvent[] = [];
  #loaded = false;
  private readonly filePath: string;
  private readonly memoryStore?: PersistentMemoryStore;

  constructor(filePath: string, memoryStore?: PersistentMemoryStore) {
    this.filePath = filePath;
    this.memoryStore = memoryStore;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as WorldModelFile;
      this.#events = parsed.events ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async record(input: {
    id: string;
    context: string;
    prediction: Prediction;
    observation: Observation;
    createdAt?: string;
  }): Promise<WorldModelEvent> {
    await this.#ensureLoaded();
    const predictionError = calculatePredictionError(input.prediction, input.observation);
    const event: WorldModelEvent = {
      id: input.id,
      context: input.context.trim(),
      prediction: input.prediction,
      observation: input.observation,
      predictionError,
      surprise: predictionError,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    if (!event.context) throw new Error("world-model context is required");
    this.#events = this.#events.filter((item) => item.id !== event.id);
    this.#events.push(event);
    await this.#persist();

    if (this.memoryStore) {
      const learning: LearningRecord = learnFromOutcome(input.prediction, input.observation);
      await this.memoryStore.upsert({
        id: `world:${input.id}:episodic`,
        kind: "episodic",
        content: `${input.context}: ${learning.lesson}`,
        source: `world-model:${input.id}`,
        confidence: clamp(1 - predictionError),
        tags: ["world-model", input.observation.success ? "success" : "prediction-error"],
      });
      if (input.observation.success) await this.memoryStore.promoteLearning(learning, `world:${input.id}`, "world-model");
    }

    return event;
  }

  async get(id: string): Promise<WorldModelEvent | null> {
    await this.#ensureLoaded();
    return this.#events.find((item) => item.id === id) ?? null;
  }

  async retrieve(context: string, limit = 10): Promise<WorldModelEvent[]> {
    await this.#ensureLoaded();
    return [...this.#events]
      .map((event) => ({ event, score: similarity(context, `${event.context} ${event.prediction.action}`) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.event.createdAt.localeCompare(a.event.createdAt))
      .slice(0, limit)
      .map((item) => item.event);
  }

  async stats(context: string, action: string): Promise<WorldModelStats> {
    await this.#ensureLoaded();
    const relevant = this.#events.filter((event) =>
      event.prediction.action === action && similarity(context, event.context) > 0,
    );
    const samples = relevant.length;
    const successes = relevant.filter((event) => event.observation.success).length;
    const successRate = samples === 0 ? 0.5 : successes / samples;
    const meanPredictionError = samples === 0
      ? 0
      : relevant.reduce((sum, event) => sum + event.predictionError, 0) / samples;
    const evidenceWeight = Math.min(1, samples / 5);
    const calibratedConfidence = clamp(0.5 * (1 - evidenceWeight) + successRate * evidenceWeight);
    return { context, action, samples, successes, successRate, meanPredictionError, calibratedConfidence };
  }

  async list(): Promise<WorldModelEvent[]> {
    await this.#ensureLoaded();
    return [...this.#events];
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: WorldModelFile = { version: 1, events: this.#events };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}

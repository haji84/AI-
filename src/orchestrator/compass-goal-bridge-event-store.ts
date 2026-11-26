import type { CompassStore } from "../compass/store.ts";
import type { GoalBridgeEvent, GoalBridgeEventStore } from "./goal-bridge-events.ts";

const KIND = "goriq-goal-bridge-events";
const VERSION = 1;
type Envelope = { kind: typeof KIND; version: typeof VERSION; events: GoalBridgeEvent[] };

function isEnvelope(value: unknown): value is Envelope {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === KIND
    && (value as { version?: unknown }).version === VERSION
    && Array.isArray((value as { events?: unknown }).events));
}

export class CompassGoalBridgeEventStore implements GoalBridgeEventStore {
  private readonly compass: CompassStore;
  constructor(compass: CompassStore) { this.compass = compass; }
  async append(event: GoalBridgeEvent) {
    this.compass.updateActive(active => {
      const env = active.find(isEnvelope) ?? { kind: KIND, version: VERSION, events: [] };
      if (env.events.some((item) => item.id === event.id)) return active;
      const events = [...env.events, structuredClone(event)].slice(-500);
      return [...active.filter((item) => !isEnvelope(item)), { ...env, events }];
    });
  }
  async pending(goalId?: string) {
    return structuredClone(this.read().events.filter((item) => !item.deliveredAt && (!goalId || item.goalId === goalId)));
  }
  async markDelivered(eventId: string, deliveredAt = new Date().toISOString()) {
    this.compass.updateActive(active => {
      const env = active.find(isEnvelope) ?? { kind: KIND, version: VERSION, events: [] };
      const events = env.events.map((item) => item.id === eventId ? { ...item, deliveredAt } : item);
      return [...active.filter((item) => !isEnvelope(item)), { ...env, events }];
    });
  }
  private read(): Envelope {
    return this.compass.getState().active.find(isEnvelope) ?? { kind: KIND, version: VERSION, events: [] };
  }
}

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
  constructor(private readonly compass: CompassStore) {}
  async append(event: GoalBridgeEvent) {
    const env = this.read();
    if (env.events.some((item) => item.id === event.id)) return;
    this.write([...env.events, structuredClone(event)].slice(-500));
  }
  async pending(goalId?: string) {
    return structuredClone(this.read().events.filter((item) => !item.deliveredAt && (!goalId || item.goalId === goalId)));
  }
  async markDelivered(eventId: string, deliveredAt = new Date().toISOString()) {
    const env = this.read();
    this.write(env.events.map((item) => item.id === eventId ? { ...item, deliveredAt } : item));
  }
  private read(): Envelope {
    return this.compass.getState().active.find(isEnvelope) ?? { kind: KIND, version: VERSION, events: [] };
  }
  private write(events: GoalBridgeEvent[]) {
    const active = this.compass.getState().active.filter((item) => !isEnvelope(item));
    this.compass.updateState({ active: [...active, { kind: KIND, version: VERSION, events }] });
  }
}

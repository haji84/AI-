import type { ContextItem, ContextSource } from "./goal-loop.ts";
import { PersistentWorldResourceModel } from "../gai/world-resource-model.ts";

export class WorldResourceContextSource implements ContextSource {
  readonly name = "world-resource-model";
  private readonly model: PersistentWorldResourceModel;

  constructor(model: PersistentWorldResourceModel) {
    this.model = model;
  }

  async collect(): Promise<ContextItem[]> {
    return [await this.model.plannerContext()];
  }
}

import type { ActionResult, CapabilityExecutor, ContextItem, ProposedAction } from "./goal-loop.ts";

export interface CapabilityHandler {
  name: string;
  execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult>;
}

export class CapabilityRegistry implements CapabilityExecutor {
  private readonly handlers = new Map<string, CapabilityHandler>();
  private readonly dryRun: boolean;

  constructor(options: { dryRun?: boolean } = {}) {
    this.dryRun = options.dryRun ?? false;
  }

  register(handler: CapabilityHandler): this {
    if (!handler.name.trim()) throw new Error("capability name must not be empty");
    if (this.handlers.has(handler.name)) throw new Error(`capability already registered: ${handler.name}`);
    this.handlers.set(handler.name, handler);
    return this;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const handler = this.handlers.get(action.capability);
    if (!handler) {
      return {
        actionId: action.id,
        ok: false,
        summary: `Missing capability: ${action.capability}`,
        blocker: `capability_not_registered:${action.capability}`,
      };
    }

    if (this.dryRun) {
      return {
        actionId: action.id,
        ok: true,
        summary: `[dry-run] ${action.description}`,
        evidence: { capability: action.capability, contextSources: [...new Set(context.map((item) => item.source))] },
      };
    }

    return handler.execute(action, context);
  }
}

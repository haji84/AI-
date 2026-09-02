import type { ActionResult, CapabilityExecutor, ContextItem, ProposedAction } from "./goal-loop.ts";
import { evaluateCapabilityPolicy, type ManagedCapabilityHandler } from "./capability-policy.ts";

export interface CapabilityHandler {
  name: string;
  execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult>;
}

export class CapabilityRegistry implements CapabilityExecutor {
  private readonly handlers = new Map<string, CapabilityHandler>();
  private readonly managedHandlers = new Map<string, ManagedCapabilityHandler>();
  private readonly dryRun: boolean;

  constructor(options: { dryRun?: boolean } = {}) {
    this.dryRun = options.dryRun ?? false;
  }

  register(handler: CapabilityHandler): this {
    if (!handler.name.trim()) throw new Error("capability name must not be empty");
    if (this.handlers.has(handler.name) || this.managedHandlers.has(handler.name)) {
      throw new Error(`capability already registered: ${handler.name}`);
    }
    this.handlers.set(handler.name, handler);
    return this;
  }

  registerManaged(handler: ManagedCapabilityHandler): this {
    if (!handler.name.trim()) throw new Error("capability name must not be empty");
    if (this.handlers.has(handler.name) || this.managedHandlers.has(handler.name)) {
      throw new Error(`capability already registered: ${handler.name}`);
    }
    this.managedHandlers.set(handler.name, handler);
    return this;
  }

  has(name: string): boolean {
    return this.handlers.has(name) || this.managedHandlers.has(name);
  }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const managed = this.managedHandlers.get(action.capability);
    const handler = managed ?? this.handlers.get(action.capability);
    if (!handler) {
      return {
        actionId: action.id,
        ok: false,
        summary: `Missing capability: ${action.capability}`,
        blocker: `capability_not_registered:${action.capability}`,
      };
    }

    if (managed) {
      const decision = evaluateCapabilityPolicy(action, managed);
      if (!decision.allowed) {
        return {
          actionId: action.id,
          ok: false,
          summary: `Capability gated: ${managed.name}`,
          blocker: decision.reason,
          evidence: { metadata: managed.metadata },
        };
      }
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

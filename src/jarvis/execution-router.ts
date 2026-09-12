import { resolveJarvisRoute } from "./connection-router.ts";
import { JarvisFleetManager } from "./fleet-manager.ts";
import { evaluateJarvisPolicy } from "./policy-engine.ts";
import { JarvisTaskQueue } from "./task-queue.ts";
import type { JarvisConnectionSnapshot, JarvisNode, JarvisTask } from "./types.ts";

export interface JarvisDispatchDecision {
  status: "dispatched" | "queued" | "waiting-connectivity" | "waiting-human" | "no-worker";
  task: JarvisTask;
  node?: JarvisNode;
  reasons: string[];
}

export class JarvisExecutionRouter {
  constructor(
    readonly fleet: JarvisFleetManager,
    readonly queue: JarvisTaskQueue,
  ) {}

  dispatchNext(input: {
    connectivity: JarvisConnectionSnapshot;
    incrementalCostYen?: number;
    destructive?: boolean;
    externalPublication?: boolean;
    requiresSecret?: boolean;
    requiresPermissionChange?: boolean;
    now?: Date;
  }): JarvisDispatchDecision | undefined {
    const now = input.now ?? new Date();
    const task = this.queue.next(now);
    if (!task) return undefined;

    const route = resolveJarvisRoute(input.connectivity);
    if (task.requiresOnline && !route.canExecuteOnlineTasks) {
      const waiting = this.queue.waitForConnectivity(task.id, now);
      return {
        status: "waiting-connectivity",
        task: waiting,
        reasons: [`connection mode ${route.mode} cannot execute online task`],
      };
    }

    const node = this.fleet.select(task);
    if (!node) {
      return { status: "no-worker", task, reasons: ["no healthy node satisfies required capabilities"] };
    }

    const policy = evaluateJarvisPolicy({
      task,
      node,
      incrementalCostYen: input.incrementalCostYen ?? 0,
      destructive: input.destructive,
      externalPublication: input.externalPublication,
      requiresSecret: input.requiresSecret,
      requiresPermissionChange: input.requiresPermissionChange,
    });

    if (!policy.allowed) {
      const waiting = this.queue.waitForHuman(task.id, now);
      return { status: "waiting-human", task: waiting, node, reasons: policy.reasons };
    }

    const leased = this.queue.lease(task.id, node.id, 120_000, now);
    return {
      status: "dispatched",
      task: leased,
      node,
      reasons: [...policy.reasons, `transport=${route.transport}`],
    };
  }
}

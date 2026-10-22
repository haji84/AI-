import type { JarvisAutonomyAdapter } from "../orchestrator/unified-autonomy-path.ts";

export interface JarvisAutonomyExecutor<T = unknown> {
  enqueueGoal(input: {
    command: string;
    goal: string;
    definitionOfDone: string[];
    targetNodeId?: string;
    authorizationScopeId?: string;
  }): Promise<T>;
}

export function createJarvisAutonomyAdapter<T>(executor: JarvisAutonomyExecutor<T>): JarvisAutonomyAdapter<T> {
  return {
    async execute(input) {
      return executor.enqueueGoal({
        command: input.command,
        goal: input.goal,
        definitionOfDone: input.definitionOfDone,
        targetNodeId: input.targetNodeId,
        authorizationScopeId: input.authorization?.scopeId,
      });
    },
  };
}

import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { BaselinePlanner } from "./baseline-planner.ts";
import { PersistentMemoryStore } from "../gai/memory-store.ts";
import { PersistentWorldModel } from "../gai/world-model.ts";
import { PersistentSkillLibrary } from "../gai/skill-library.ts";

export interface GaiPlannerEvidence {
  memories: string[];
  worldModel: Array<{ action: string; samples: number; successRate: number; confidence: number }>;
  skills: Array<{ id: string; name: string; confidence: number }>;
}

export class GaiInformedPlanner implements Planner {
  private readonly baseline: BaselinePlanner;
  private readonly memory: PersistentMemoryStore;
  private readonly world: PersistentWorldModel;
  private readonly skills: PersistentSkillLibrary;

  constructor(input: {
    memory: PersistentMemoryStore;
    world: PersistentWorldModel;
    skills: PersistentSkillLibrary;
    baseline?: BaselinePlanner;
  }) {
    this.memory = input.memory;
    this.world = input.world;
    this.skills = input.skills;
    this.baseline = input.baseline ?? new BaselinePlanner();
  }

  async inferIntent(input: {
    goal: Goal;
    context: ContextItem[];
    preferences?: string[];
    recentDecisions?: string[];
  }): Promise<InferredIntent> {
    return this.baseline.inferIntent(input);
  }

  async proposeNextAction(input: {
    goal: Goal;
    context: ContextItem[];
    intent: InferredIntent;
  }): Promise<ProposedAction | null> {
    const proposed = await this.baseline.proposeNextAction(input);
    if (!proposed) return null;

    const task = `${input.goal.title} ${proposed.description}`;
    const [memories, skills, priorEvents] = await Promise.all([
      this.memory.query({ text: task, kinds: ["semantic", "procedural"], minConfidence: 0.55, limit: 5 }),
      this.skills.query(task, 3),
      this.world.retrieve(task, 8),
    ]);

    const candidateActions = [proposed.description, ...skills.map((skill) => skill.procedure)];
    let best = { description: proposed.description, confidence: 0.5, skillId: undefined as string | undefined };

    for (const candidate of candidateActions) {
      const stats = await this.world.stats(task, candidate);
      const skill = skills.find((item) => item.procedure === candidate);
      const confidence = skill ? (stats.calibratedConfidence + skill.confidence) / 2 : stats.calibratedConfidence;
      if (confidence > best.confidence) best = { description: candidate, confidence, skillId: skill?.id };
    }

    const evidence: GaiPlannerEvidence = {
      memories: memories.map((item) => item.content),
      worldModel: await Promise.all(candidateActions.map(async (action) => {
        const stats = await this.world.stats(task, action);
        return { action, samples: stats.samples, successRate: stats.successRate, confidence: stats.calibratedConfidence };
      })),
      skills: skills.map((skill) => ({ id: skill.id, name: skill.name, confidence: skill.confidence })),
    };

    return {
      ...proposed,
      id: best.skillId ? `gai-skill:${best.skillId}` : proposed.id,
      description: best.description,
      metadata: {
        ...(proposed as ProposedAction & { metadata?: Record<string, unknown> }).metadata,
        gaiEvidence: evidence,
        selectedSkillId: best.skillId,
        priorWorldEvents: priorEvents.length,
      },
    } as ProposedAction;
  }
}

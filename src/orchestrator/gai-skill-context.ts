import { PersistentSkillLibrary, type SkillEnvironment } from "../gai/skill-library.ts";
import type { ContextItem, ContextSource, Goal } from "./goal-loop.ts";

export class GaiSkillContextSource implements ContextSource {
  readonly name = "gai-skills";
  private readonly skills: PersistentSkillLibrary;
  private readonly environment?: () => Promise<SkillEnvironment>;
  private readonly limit: number;

  constructor(
    skills: PersistentSkillLibrary,
    environment?: () => Promise<SkillEnvironment>,
    limit = 5,
  ) {
    this.skills = skills;
    this.environment = environment;
    this.limit = limit;
  }

  async collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]> {
    const task = [input.goal.title, input.goal.description, input.nextAction].filter(Boolean).join(" ");
    const environment = this.environment ? await this.environment() : undefined;
    let skills;
    try { skills = await this.skills.query(task, this.limit, environment); }
    catch { return [{source:this.name,summary:'Optional Skill memory unavailable; continue without learned procedures',data:{status:'unavailable'}}]; }
    return skills.map((skill) => ({
      source: this.name,
      summary: `Certified skill ${skill.name} v${skill.version ?? 1}: ${skill.description}`,
      data: {
        trust: "reference_only_no_authority",
        skillId: skill.id,
        version: skill.version ?? 1,
        procedure: skill.procedure,
        confidence: skill.confidence,
        constraints: skill.constraints,
        provenance: skill.provenance,
        certificationEvidence: skill.certificationEvidence ?? [],
      },
    }));
  }
}

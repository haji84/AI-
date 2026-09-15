import type { SkillEnvironment, SkillRecord } from "./skill-library.ts";
import { PersistentSkillLibrary } from "./skill-library.ts";

export interface GovernedSkillEnvironment extends SkillEnvironment { platform?: string; tools?: string[]; verifierIds?: string[]; humanGateRequired?: boolean; humanGateApproved?: boolean }
export interface SkillExecutionRequirements { platforms?: string[]; tools?: string[]; verifierIds?: string[]; regressionEvidence?: string[] }
export interface GovernedSkillRecord extends SkillRecord { executionRequirements?: SkillExecutionRequirements }
export interface SkillEligibility { eligible: boolean; reasons: string[] }

export function evaluateSkillEligibility(skill: GovernedSkillRecord, env: GovernedSkillEnvironment): SkillEligibility {
  const reasons: string[] = [];
  if (skill.status !== "active") reasons.push(`status:${skill.status}`);
  const c = skill.constraints;
  if (c?.connectivity === "online-required" && env.online === false) reasons.push("network:online-required");
  for (const capability of c?.capabilities ?? []) if (!env.capabilities?.includes(capability)) reasons.push(`capability:${capability}`);
  for (const resource of c?.resources ?? []) if (!env.resources?.includes(resource)) reasons.push(`resource:${resource}`);
  if (c?.executionModes?.length && (!env.executionMode || !c.executionModes.includes(env.executionMode))) reasons.push(`execution-mode:${env.executionMode ?? "unknown"}`);
  if (c?.maxRisk && env.risk && ({ low: 0, medium: 1, high: 2 }[env.risk] > { low: 0, medium: 1, high: 2 }[c.maxRisk])) reasons.push(`risk:${env.risk}>${c.maxRisk}`);
  const req = skill.executionRequirements;
  if (req?.platforms?.length && (!env.platform || !req.platforms.includes(env.platform))) reasons.push(`platform:${env.platform ?? "unknown"}`);
  for (const tool of req?.tools ?? []) if (!env.tools?.includes(tool)) reasons.push(`tool:${tool}`);
  for (const verifier of req?.verifierIds ?? []) if (!env.verifierIds?.includes(verifier)) reasons.push(`verifier:${verifier}`);
  if (req?.regressionEvidence?.length) reasons.push("regression:unresolved");
  if (env.humanGateRequired && !env.humanGateApproved) reasons.push("human-gate:approval-required");
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)].sort() };
}

export class GovernedSkillRuntime {
  private readonly library: PersistentSkillLibrary;
  constructor(library: PersistentSkillLibrary) { this.library = library }
  async select(task: string, env: GovernedSkillEnvironment, limit = 5): Promise<Array<{ skill: GovernedSkillRecord; eligibility: SkillEligibility }>> {
    const candidates = await this.library.query(task, Math.max(limit * 3, 10), env);
    return candidates.map((skill) => ({ skill: skill as GovernedSkillRecord, eligibility: evaluateSkillEligibility(skill as GovernedSkillRecord, env) })).filter((item) => item.eligibility.eligible).sort((a, b) => b.skill.confidence - a.skill.confidence || a.skill.id.localeCompare(b.skill.id)).slice(0, limit);
  }
  async recordRegression(id: string, evidence: string): Promise<SkillRecord | null> { if (!evidence.trim()) return null; return this.library.quarantine(id, `regression:${evidence.trim()}`) }
}

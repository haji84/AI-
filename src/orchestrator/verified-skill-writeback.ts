import type { ActionResult, StateStore, WriteBackRecord } from "./goal-loop.ts";
import type { PersistentSkillLibrary, SkillConstraints, VerifiedSkillCandidate } from "../gai/skill-library.ts";

export interface ReusableSkillProposal {
  id: string;
  name: string;
  description: string;
  procedure: string;
  applicability: string[];
  confidence: number;
  evidenceRefs: string[];
  source: string;
  constraints?: SkillConstraints;
}

export interface SkillProposingActionResult extends ActionResult {
  reusableSkill?: ReusableSkillProposal;
}

function cleanStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Converts an executor-proposed reusable procedure into a Skill candidate only
 * when the Goal Loop independently verified the same successful action.
 *
 * Verifier payloads are deliberately not copied automatically into Skill
 * provenance because they may contain private or bulky data. The executor must
 * provide explicit bounded evidence references, and the verifier pass acts as
 * the independent promotion gate.
 */
export function verifiedSkillCandidateFromWriteBack(record: WriteBackRecord): VerifiedSkillCandidate | null {
  const proposal = (record.result as SkillProposingActionResult | null | undefined)?.reusableSkill;
  if (!proposal) return null;
  if (record.result?.ok !== true || record.verification?.ok !== true) return null;

  const evidence = cleanStrings(proposal.evidenceRefs ?? []);
  const applicability = cleanStrings(proposal.applicability ?? []);
  const id = proposal.id.trim();
  const name = proposal.name.trim();
  const description = proposal.description.trim();
  const procedure = proposal.procedure.trim();
  const source = proposal.source.trim();

  if (!id || !name || !description || !procedure || !source || evidence.length === 0) return null;
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) return null;

  return {
    id,
    name,
    description,
    procedure,
    applicability,
    evidence,
    verificationPassed: true,
    success: true,
    confidence: proposal.confidence,
    source,
    constraints: proposal.constraints,
  };
}

export interface VerifiedSkillWriteBackOptions {
  onExtractionError?: (error: unknown, candidate: VerifiedSkillCandidate) => void | Promise<void>;
}

/**
 * Secondary-learning write-back wrapper. Durable Goal Loop state is written
 * first. Skill extraction is then attempted only for independently verified
 * successful cycles, and extraction failures never change the already-derived
 * Goal Loop completion / Human Gate decision.
 *
 * PersistentSkillLibrary.createCandidate keeps the extracted Skill in
 * `candidate` state. Independent certification remains a separate requirement
 * before the Skill can be selected for execution.
 */
export class VerifiedSkillWriteBackStore implements StateStore {
  private readonly inner: StateStore;
  private readonly skills: PersistentSkillLibrary;
  private readonly options: VerifiedSkillWriteBackOptions;

  constructor(
    inner: StateStore,
    skills: PersistentSkillLibrary,
    options: VerifiedSkillWriteBackOptions = {},
  ) {
    this.inner = inner;
    this.skills = skills;
    this.options = options;
  }

  getState() {
    return this.inner.getState();
  }

  async writeBack(record: WriteBackRecord): Promise<void> {
    await this.inner.writeBack(record);
    const candidate = verifiedSkillCandidateFromWriteBack(record);
    if (!candidate) return;

    try {
      await this.skills.createCandidate(candidate);
    } catch (error) {
      try {
        await this.options.onExtractionError?.(error, candidate);
      } catch {
        // Learning telemetry must not override the Goal Loop's verified result.
      }
    }
  }
}

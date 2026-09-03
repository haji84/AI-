export type GoalQuestionImpact = "low" | "medium" | "high";

export interface GoalQuestion {
  question: string;
  impact: GoalQuestionImpact;
}

export interface GoalDraft {
  title: string;
  desiredOutcome: string;
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
  unresolvedQuestions: GoalQuestion[];
  confidence: number;
  approvalRequired: boolean;
}

export interface GoalReadiness {
  ready: boolean;
  reasons: string[];
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`));
}

export function normalizeGoalDraft(value: unknown): GoalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("goalDraft must be an object");
  const draft = value as Partial<GoalDraft>;
  const confidence = Number(draft.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("goalDraft.confidence must be between 0 and 1");
  }
  if (typeof draft.approvalRequired !== "boolean") {
    throw new Error("goalDraft.approvalRequired must be a boolean");
  }
  if (!Array.isArray(draft.unresolvedQuestions)) {
    throw new Error("goalDraft.unresolvedQuestions must be an array");
  }

  const unresolvedQuestions = draft.unresolvedQuestions.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`goalDraft.unresolvedQuestions[${index}] must be an object`);
    }
    const question = entry as Partial<GoalQuestion>;
    if (!question.impact || !["low", "medium", "high"].includes(question.impact)) {
      throw new Error(`goalDraft.unresolvedQuestions[${index}].impact must be low, medium, or high`);
    }
    return {
      question: nonEmptyString(question.question, `goalDraft.unresolvedQuestions[${index}].question`),
      impact: question.impact,
    } as GoalQuestion;
  });

  return {
    title: nonEmptyString(draft.title, "goalDraft.title"),
    desiredOutcome: nonEmptyString(draft.desiredOutcome, "goalDraft.desiredOutcome"),
    successCriteria: stringArray(draft.successCriteria, "goalDraft.successCriteria"),
    constraints: stringArray(draft.constraints, "goalDraft.constraints"),
    assumptions: stringArray(draft.assumptions, "goalDraft.assumptions"),
    unresolvedQuestions,
    confidence,
    approvalRequired: draft.approvalRequired,
  };
}

export function assessGoalReadiness(draft: GoalDraft): GoalReadiness {
  const reasons: string[] = [];
  if (!draft.title.trim()) reasons.push("missing_title");
  if (!draft.desiredOutcome.trim()) reasons.push("missing_desired_outcome");
  if (draft.successCriteria.length === 0) reasons.push("missing_success_criteria");
  if (draft.unresolvedQuestions.some((question) => question.impact === "high")) reasons.push("high_impact_question_unresolved");
  if (draft.confidence < 0.7) reasons.push("low_confidence");
  if (draft.approvalRequired) reasons.push("user_approval_required");
  return { ready: reasons.length === 0, reasons };
}

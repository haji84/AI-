import { randomUUID } from 'node:crypto';
import { completionDigest, type CompletionCycle, type CompletionCandidate, type CompletionInput, type CompletionRequirement, type HumanResponse } from './completion-path.ts';
import type { DevelopmentEvidence } from './development-job.ts';
import type { Goal, ProposedAction, WriteBackRecord } from './goal-loop.ts';
import { type WorkState, type WorkStateStore } from './work-state.ts';
import { goalWorkStateId, type WorkStateAction } from './work-state-integration.ts';
import { createApprovalKey } from './approval-key.ts';

export interface BoundCompletionCandidate extends CompletionCandidate { action: WorkStateAction }
export interface CompletionSnapshot {
  requirements: CompletionRequirement[];
  candidates: BoundCompletionCandidate[];
  capabilities: CompletionInput['capabilities'];
  evidence: DevelopmentEvidence[];
  responses?: HumanResponse[];
}
/** Host-selected adapter only; never deserialized from HTTP/model context. */
export interface CompletionSource {
  inspect(state: WorkState): Promise<CompletionSnapshot>;
  observe(record: WriteBackRecord): Promise<DevelopmentEvidence[]>;
}
export interface CompletionExecutionCheckpoint {
  contractDigest: string;
  evidence: DevelopmentEvidence[];
  completedTasks: string[];
  pending: { taskId: string; actionDigest: string; cycleId: string } | null;
}
export interface CompletionJournalStore extends WorkStateStore {
  getCompletionHistory(goalId: string): Promise<CompletionCycle[]>;
  recordCompletionAssessment(input: CompletionInput): Promise<CompletionCycle>;
  recordExecutionAssessment(input: CompletionInput): Promise<CompletionCycle>;
  getCompletionExecution(goalId: string): Promise<CompletionExecutionCheckpoint | null>;
  updateCompletionExecution(goalId: string, expected: CompletionExecutionCheckpoint | null, next: CompletionExecutionCheckpoint, expectedStateDigest?: string): Promise<void>;
  finalizeCompletionOutcome(input: CompletionInput, expectedStateDigest: string, expected: CompletionExecutionCheckpoint, next: CompletionExecutionCheckpoint): Promise<CompletionCycle>;
  synchronizeCompletionCriteria(goalId: string, cycleId: string, expectedStateDigest: string): Promise<void>;
}
function journal(store: WorkStateStore): CompletionJournalStore {
  const candidate = store as CompletionJournalStore;
  if (!candidate.recordExecutionAssessment || !candidate.recordCompletionAssessment || !candidate.updateCompletionExecution || !candidate.getCompletionExecution || !candidate.getCompletionHistory || !candidate.finalizeCompletionOutcome || !candidate.synchronizeCompletionCriteria) throw Error('completion requires durable journal store');
  return candidate;
}
function actionFor(candidate: BoundCompletionCandidate): WorkStateAction {
  // DoD declarations and bounded-command flags from an executor cannot complete this Goal.
  const a = candidate.action;
  return { id: a.id, description: a.description, capability: a.capability, risk: a.risk,
    irreversible: a.irreversible === true, externalSideEffect: a.externalSideEffect === true,
    requiresHumanApproval: a.requiresHumanApproval === true || candidate.humanActions.some(n => n.kind === 'approval'), completesBoundedCommand: false,
    ...(a.materialMutation === undefined ? {} : { materialMutation: a.materialMutation }),
    ...(a.workItemId === undefined ? {} : { workItemId: a.workItemId }),
    ...(a.completesWorkItem === undefined ? {} : { completesWorkItem: a.completesWorkItem }),
    riskSignals: { ...candidate.riskSignals, ...a.riskSignals, ...Object.fromEntries(Object.entries(candidate.riskSignals).filter(([,v]) => v === true)) },
    ...(candidate.mediumChecks ? { mediumRiskChecks: candidate.mediumChecks } : {}), ...(a.input === undefined ? {} : { input: structuredClone(a.input) }) };
}
function normalize(snapshot: CompletionSnapshot): CompletionSnapshot {
  const copy = structuredClone(snapshot);
  const actionIds = new Set<string>();
  for (const c of copy.candidates) {
    if (!c.action?.id || actionIds.has(c.action.id) || !c.workItem.requiredCapabilities.includes(c.action.capability)) throw Error('invalid candidate action binding');
    actionIds.add(c.action.id);
    c.action = actionFor(c); c.riskSignals = c.action.riskSignals!;
    if ((c.action.requiresHumanApproval || c.action.irreversible || c.action.risk === 'high') && !c.humanActions.some(n => n.kind === 'approval')) {
      c.humanActions.push({ kind: 'approval', operation: `Approve ${c.workItem.objective}`, reason: 'Existing action approval policy requires explicit authorization', target: c.workItem.id, deadline: null, impact: 'This action waits for the existing exact-action approval' });
    }
  }
  return copy;
}
function contract(snapshot: CompletionSnapshot): string {
  return completionDigest({ requirements: snapshot.requirements, candidates: snapshot.candidates.map(c => ({ workItem: c.workItem, criterionIds: c.criterionIds, strategyId: c.strategyId, riskSignals: c.riskSignals, action: c.action, humanActions: c.humanActions })) });
}
function observations(values: DevelopmentEvidence[]): DevelopmentEvidence[] {
  const byId = new Map<string, DevelopmentEvidence>();
  for (const e of values) {
    if (!e.id || !e.recordedAt || !Number.isFinite(Date.parse(e.recordedAt))) throw Error('invalid verifier observation');
    const key = `${e.issuer}:${e.id}:${e.recordedAt}`;
    const prior = byId.get(key);
    if (prior && completionDigest(prior) !== completionDigest(e)) throw Error('conflicting verifier observation');
    byId.set(key, e);
  }
  if (byId.size > 1024) throw Error('completion observation capacity requires archival review');
  return [...byId.values()];
}
export class CompletionExecution {
  private readonly store: CompletionJournalStore;
  private readonly source: CompletionSource;
  private readonly now: () => string;
  private readonly approvedActionKey?: string | null;
  private selected?: { candidate: BoundCompletionCandidate; cycle: CompletionCycle; contract: string };
  private latest?: CompletionCycle;
  constructor(store: WorkStateStore, source: CompletionSource, now = () => new Date().toISOString(), approvedActionKey?: string | null) {
    this.store = journal(store); this.source = source; this.now = now; this.approvedActionKey = approvedActionKey;
  }
  private async state(goal: Goal) {
    const state = await this.store.get(goalWorkStateId(goal));
    if (!state) throw Error('completion requires existing WorkState');
    if (state.objective !== (goal.description?.trim() || goal.title) || completionDigest(state.definitionOfDone.map(c => c.description)) !== completionDigest(goal.successCriteria) || completionDigest(state.constraints) !== completionDigest(goal.constraints)) throw Error('completion Goal contract mismatch');
    return state;
  }
  private input(state: WorkState, snapshot: CompletionSnapshot, checkpoint: CompletionExecutionCheckpoint, attempt?: CompletionInput['attempt']): CompletionInput {
    return { goalId: state.goalId, cycleId: randomUUID(), at: this.now(), requirements: snapshot.requirements,
      candidates: snapshot.candidates, capabilities: snapshot.capabilities, evidence: observations([...checkpoint.evidence, ...snapshot.evidence]),
      completedWorkItems: checkpoint.completedTasks, deliveries: [], responses: snapshot.responses ?? [], ...(attempt ? { attempt } : {}) };
  }
  private approved(candidate: BoundCompletionCandidate, goal: Goal): boolean {
    return candidate.humanActions.every(n => n.kind === 'approval') && !!this.approvedActionKey && createApprovalKey(goal, candidate.action) === this.approvedActionKey;
  }
  async propose(goal: Goal): Promise<ProposedAction | null> {
    this.selected = undefined;
    const state = await this.state(goal);
    const snapshot = normalize(await this.source.inspect(structuredClone(state)));
    const digest = contract(snapshot);
    let checkpoint = await this.store.getCompletionExecution(state.goalId);
    if (checkpoint?.pending) throw Error('pending completion action requires independent reconciliation');
    if (checkpoint && checkpoint.contractDigest !== digest) throw Error('completion execution contract changed; explicit replanning required');
    if (!checkpoint) {
      checkpoint = { contractDigest: digest, evidence: [], completedTasks: [], pending: null };
      await this.store.updateCompletionExecution(state.goalId, null, checkpoint, completionDigest(state));
    }
    const cycle = await this.store.recordExecutionAssessment(this.input(state, snapshot, checkpoint));
    this.latest = cycle;
    const ready = cycle.candidates.filter(c => c.status === 'READY' || (c.status === 'HUMAN_REQUIRED' && c.contributesTo.length > 0 && snapshot.candidates.find(x => x.workItem.id === c.taskId)!.humanActions.every(n => n.kind === 'approval')))
      .sort((a,b) => Number(b.status === 'READY') - Number(a.status === 'READY') || b.score - a.score || a.taskId.localeCompare(b.taskId));
    const choice = ready[0];
    if (!choice || state.blockers.length) return null;
    const candidate = snapshot.candidates.find(c => c.workItem.id === choice.taskId)!;
    // Approval cannot supply missing dependencies, capabilities or medium-risk checks.
    if (candidate.workItem.dependsOn.some(id => !checkpoint.completedTasks.includes(id)) || candidate.feasibility !== 'available' || candidate.workItem.requiredCapabilities.some(id => snapshot.capabilities[id] !== true) || candidate.estimatedMinutes === null || !candidate.rationale.trim() || !candidate.evidenceRefs.length || choice.contributesTo.some(id => !snapshot.requirements.some(r => r.criterionId === id))) return null;
    this.selected = { candidate, cycle, contract: digest };
    return structuredClone(candidate.action);
  }
  async beforeExecute(action: ProposedAction, goal: Goal): Promise<void> {
    const selected = this.selected;
    if (!selected || completionDigest(action) !== completionDigest(selected.candidate.action)) throw Error('completion action binding mismatch');
    if (selected.cycle.candidates.find(c => c.taskId === selected.candidate.workItem.id)?.status === 'HUMAN_REQUIRED' && !this.approved(selected.candidate, goal)) throw Error('completion action requires existing exact-action approval');
    const state = await this.state(goal);
    if (completionDigest(state) !== selected.cycle.stateDigest) throw Error('completion action binding has stale state');
    const snapshot = normalize(await this.source.inspect(structuredClone(state)));
    if (contract(snapshot) !== selected.contract || snapshot.candidates.find(c => c.workItem.id === selected.candidate.workItem.id)?.feasibility !== 'available' || selected.candidate.workItem.requiredCapabilities.some(id => snapshot.capabilities[id] !== true)) throw Error('completion action binding has stale capability or contract');
    const checkpoint = await this.store.getCompletionExecution(state.goalId);
    if (!checkpoint || checkpoint.pending || checkpoint.contractDigest !== selected.contract) throw Error('pending or conflicting completion execution');
    await this.store.updateCompletionExecution(state.goalId, checkpoint, { ...checkpoint, pending: { taskId: selected.candidate.workItem.id, actionDigest: completionDigest(action), cycleId: selected.cycle.cycleId } }, completionDigest(state));
  }
  completionBlockers(): string[] {
    return this.latest?.readyForCompletionReview ? [] : ['completion_evidence_incomplete', ...(this.latest?.gaps ?? []), ...new Set(this.latest?.notifications.filter(n => n.status !== 'ANSWERED').map(n => `human_action:${n.taskId}`) ?? [])];
  }
  async afterCycle(record: WriteBackRecord): Promise<void> {
    if (!record.result || !record.action || !this.selected) {
      if (this.latest && record.stopReason !== 'paused') {
        const state = await this.state(record.goal);
        await this.store.synchronizeCompletionCriteria(state.goalId, this.latest.cycleId, this.latest.stateDigest);
      }
      return;
    }
    const state = await this.state(record.goal);
    const checkpoint = await this.store.getCompletionExecution(state.goalId);
    if (!checkpoint?.pending || checkpoint.pending.cycleId !== this.selected.cycle.cycleId) throw Error('completion outcome lacks its execution checkpoint');
    const observed = await this.source.observe(structuredClone(record));
    if (!record.verification?.ok && observed.some(e => e.verified)) throw Error('failed verifier cannot supply passing completion evidence');
    const succeeded = record.result.ok && record.verification?.ok === true && !observed.some(e => !e.verified);
    const next = { ...checkpoint, pending: null, evidence: observations([...checkpoint.evidence, ...observed]),
      completedTasks: succeeded ? [...new Set([...checkpoint.completedTasks, this.selected.candidate.workItem.id])] : checkpoint.completedTasks };
    const snapshot = normalize(await this.source.inspect(structuredClone(state)));
    if (contract(snapshot) !== checkpoint.contractDigest) throw Error('completion outcome contract changed');
    const attempt: CompletionInput['attempt'] = { taskId: this.selected.candidate.workItem.id, strategyId: this.selected.candidate.strategyId,
      failureSignature: succeeded ? 'verified_action_without_criterion_progress' : completionDigest({ blocker: record.result.blocker, summary: record.verification?.summary ?? record.result.summary }),
      failureClass: record.result.blocker ? 'environment' : 'implementation' };
    const input = this.input(state, snapshot, next, attempt);
    if (record.approvalSatisfied && record.approvalKey) {
      input.responses.push(...(this.latest?.notifications ?? []).filter(n => n.taskId === this.selected!.candidate.workItem.id && n.kind === 'approval').map(n => ({ notificationId: n.id, status: 'approved' as const, at: input.at, receiptRef: `goal-loop-approval:${record.approvalKey}:${this.selected!.cycle.cycleId}` })));
    }
    // One SQLite transaction validates current state and commits the journal,
    // criterion observations and checkpoint. A failed commit retains pending.
    this.latest = await this.store.finalizeCompletionOutcome(input, completionDigest(state), checkpoint, next);
  }
}

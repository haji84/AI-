import { HomeCoordinatorController } from "./coordinator-runtime.ts";
import { FactVerificationEngine } from "./fact-verification.ts";
import { OrganizationDigitalTwin } from "./organization-digital-twin.ts";
import { DemonstrationLearningEngine } from "./demonstration-learning.ts";
import { InputRecoveryEngine } from "./input-recovery.ts";
import { ModelRouterV2 } from "./model-router-v2.ts";
import { SecurityKernel } from "./security-kernel.ts";
import { JarvisKnowledgeGraph } from "./knowledge-graph.ts";
import { JarvisSimulator } from "./simulation.ts";
import { CrossDeviceHandoff } from "./cross-device-handoff.ts";
import { ValueTracker } from "./value-tracking.ts";
import { SelfGeneratedBenchmarkEngine } from "./self-benchmark.ts";
import { AutomaticEscalationEngine } from "./escalation.ts";
import { ReleaseOperations } from "./release-ops.ts";
import { LiveViewScheduler } from "./live-view-runtime.ts";
import { MultimodalInteractionEngine } from "./multimodal-interaction.ts";

export class JarvisCompletionRuntime {
  readonly coordinator = new HomeCoordinatorController<Record<string, unknown>>();
  readonly facts: FactVerificationEngine;
  readonly organization = new OrganizationDigitalTwin();
  readonly demonstration = new DemonstrationLearningEngine();
  readonly inputRecovery = new InputRecoveryEngine();
  readonly modelRouter = new ModelRouterV2();
  readonly security = new SecurityKernel();
  readonly knowledge = new JarvisKnowledgeGraph();
  readonly simulator = new JarvisSimulator();
  readonly handoff = new CrossDeviceHandoff();
  readonly value = new ValueTracker();
  readonly benchmarks = new SelfGeneratedBenchmarkEngine();
  readonly escalation = new AutomaticEscalationEngine();
  readonly release = new ReleaseOperations();
  readonly liveView = new LiveViewScheduler();
  readonly interaction = new MultimodalInteractionEngine();

  constructor(calculator?: ConstructorParameters<typeof FactVerificationEngine>[0]) {
    this.facts = new FactVerificationEngine(calculator);
  }

  /** Availability of a class is not a verified execution binding. No caller-supplied
   * evidence or constructor flag may promote readiness. Add real entrypoint tests
   * when wiring an engine; product/physical acceptance remains a separate gate. */
  integrationReadiness() {
    const gaps = {
      coordinator: "Connect Broker startup to the bridge and validate durable state with single-writer recovery.",
      factVerification: "Bind claim-bearing workflows to retrieval, persisted evidence and citation output.",
      organizationDigitalTwin: "Bind stored organization rules and effective roles to the approval planner.",
      demonstrationLearning: "Convert teaching observations into validated candidates without granting execution authority.",
      inputRecovery: "Bind uploaded case manifests to classification, conflict handling and missing-source recovery.",
      modelRouter: "Connect the GAI router to actual worker resources and preserve the zero-paid policy.",
      securityKernel: "Enforce policy, revocation and egress in execution paths with tenant propagation.",
      knowledgeGraph: "Persist scoped task, rule, file and evidence nodes and propagate change impact.",
      simulation: "Invoke simulation before material mutations and attach results to the existing verifier.",
      crossDeviceHandoff: "Persist checkpoints and resume the same job through actual worker adapters.",
      valueTracking: "Persist execution-derived metrics and display them in the owner dashboard.",
      selfGeneratedBenchmark: "Persist benchmark candidates while isolating held-out evaluation data.",
      automaticEscalation: "Bind fallback stages to existing tool/model execution and bounded retry state.",
      releaseOps: "Connect diagnostics and recovery UI to tested backup, restore and rollback executors.",
      liveViewScheduler: "Bind this scheduler to session load measurements; existing UI pacing is separate.",
      multimodalInteraction: "Bind this aggregate to authenticated command handling; existing UI controls are separate.",
    };
    const engines = Object.fromEntries(Object.entries(gaps).map(([name, nextAction]) => [name, {
      componentAvailable: true as const,
      integrationStatus: "UNWIRED" as const,
      executionEntryPoints: [] as string[],
      nextAction,
    }])) as Record<keyof typeof gaps, {
      componentAvailable: true;
      integrationStatus: "UNWIRED";
      executionEntryPoints: string[];
      nextAction: string;
    }>;
    return { engines, productComplete: false as const, physicalAcceptance: "NOT_EVALUATED" as const };
  }

  softwareReadiness() {
    // Retain the boolean-map API; report conservative software readiness until
    // the aggregate has real, tested execution bindings. This does not disable
    // independently integrated legacy functionality.
    return Object.fromEntries(Object.keys(this.integrationReadiness().engines).map(name => [name, false])) as Record<keyof ReturnType<JarvisCompletionRuntime["integrationReadiness"]>["engines"], boolean>;
  }
}

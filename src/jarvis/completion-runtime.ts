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

  softwareReadiness() {
    return {
      coordinator: true,
      factVerification: true,
      organizationDigitalTwin: true,
      demonstrationLearning: true,
      inputRecovery: true,
      modelRouter: true,
      securityKernel: true,
      knowledgeGraph: true,
      simulation: true,
      crossDeviceHandoff: true,
      valueTracking: true,
      selfGeneratedBenchmark: true,
      automaticEscalation: true,
      releaseOps: true,
      liveViewScheduler: true,
      multimodalInteraction: true,
    };
  }
}

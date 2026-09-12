import { JARVIS_MAX_NODES, type JarvisCapability, type JarvisNode, type JarvisTask } from "./types.ts";

function hasCapabilities(node: JarvisNode, required: JarvisCapability[]): boolean {
  return required.every((capability) => node.capabilities.includes(capability));
}

function nodeScore(node: JarvisNode, task: JarvisTask): number {
  let score = 0;
  if (node.status === "ready") score += 20;
  if (node.status === "busy") score -= 10;
  if (node.telemetry.charging) score += 3;
  if ((node.telemetry.batteryPercent ?? 100) >= 50) score += 2;
  if ((node.telemetry.cpuLoadPercent ?? 0) < 70) score += 2;
  if ((node.telemetry.gpuLoadPercent ?? 0) < 70 && node.capabilities.includes("gpu")) score += 1;
  if (task.preferredKinds?.includes(node.kind)) score += 5;
  if (node.enrollment === "full") score += 1;
  return score;
}

export class JarvisFleetManager {
  private readonly nodes = new Map<string, JarvisNode>();

  register(node: JarvisNode): JarvisNode {
    if (!this.nodes.has(node.id) && this.nodes.size >= JARVIS_MAX_NODES) {
      throw new Error(`JARVIS fleet limit exceeded (${JARVIS_MAX_NODES})`);
    }
    this.nodes.set(node.id, structuredClone(node));
    return structuredClone(node);
  }

  unregister(nodeId: string): boolean {
    return this.nodes.delete(nodeId);
  }

  get(nodeId: string): JarvisNode | undefined {
    const node = this.nodes.get(nodeId);
    return node ? structuredClone(node) : undefined;
  }

  list(): JarvisNode[] {
    return [...this.nodes.values()].map((node) => structuredClone(node));
  }

  updateHeartbeat(nodeId: string, patch: Partial<Pick<JarvisNode, "status" | "telemetry" | "lastSeenAt">>): JarvisNode {
    const current = this.nodes.get(nodeId);
    if (!current) throw new Error(`Unknown JARVIS node: ${nodeId}`);
    const updated: JarvisNode = {
      ...current,
      ...patch,
      telemetry: patch.telemetry ? { ...current.telemetry, ...patch.telemetry } : current.telemetry,
    };
    this.nodes.set(nodeId, updated);
    return structuredClone(updated);
  }

  select(task: JarvisTask): JarvisNode | undefined {
    if (task.targetNodeId) {
      const target = this.nodes.get(task.targetNodeId);
      if (!target || target.status === "offline" || target.status === "disabled") return undefined;
      if (!hasCapabilities(target, task.requiredCapabilities)) return undefined;
      return structuredClone(target);
    }

    const candidates = [...this.nodes.values()]
      .filter((node) => node.status === "ready" || node.status === "busy")
      .filter((node) => hasCapabilities(node, task.requiredCapabilities))
      .filter((node) => (node.telemetry.batteryPercent ?? 100) > 15 || node.telemetry.charging)
      .sort((a, b) => nodeScore(b, task) - nodeScore(a, task) || a.id.localeCompare(b.id));

    return candidates[0] ? structuredClone(candidates[0]) : undefined;
  }
}

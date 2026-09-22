import {
  JARVIS_MAX_NODES,
  type JarvisCapability,
  type JarvisNode,
  type JarvisNodeKind,
  type JarvisTask,
} from "./types.ts";

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

export interface JarvisFleetGroupSummary {
  group: string | null;
  registered: number;
  ready: number;
  busy: number;
  offline: number;
  needsHuman: number;
  disabled: number;
  kinds: Partial<Record<JarvisNodeKind, number>>;
}

function groupSortKey(group: string | null): string {
  return group === null ? "\uffff" : group;
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

  restore(nodes: JarvisNode[]): void {
    if (nodes.length > JARVIS_MAX_NODES) throw new Error(`JARVIS fleet limit exceeded (${JARVIS_MAX_NODES})`);

    const ids = new Set<string>();
    for (const node of nodes) {
      if (ids.has(node.id)) throw new Error(`Duplicate JARVIS node identity in fleet restore: ${node.id}`);
      ids.add(node.id);
    }

    const restored = new Map<string, JarvisNode>();
    for (const node of nodes) restored.set(node.id, structuredClone(node));

    this.nodes.clear();
    for (const [nodeId, node] of restored) this.nodes.set(nodeId, node);
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

  listByGroup(group: string | null): JarvisNode[] {
    return [...this.nodes.values()]
      .filter((node) => (node.group ?? null) === group)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => structuredClone(node));
  }

  summarizeGroups(): JarvisFleetGroupSummary[] {
    const groups = new Map<string | null, JarvisNode[]>();
    for (const node of this.nodes.values()) {
      const group = node.group ?? null;
      const entries = groups.get(group) ?? [];
      entries.push(node);
      groups.set(group, entries);
    }

    return [...groups.entries()]
      .sort(([a], [b]) => groupSortKey(a).localeCompare(groupSortKey(b)))
      .map(([group, nodes]) => {
        const kinds: Partial<Record<JarvisNodeKind, number>> = {};
        for (const node of nodes) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
        return {
          group,
          registered: nodes.length,
          ready: nodes.filter((node) => node.status === "ready").length,
          busy: nodes.filter((node) => node.status === "busy").length,
          offline: nodes.filter((node) => node.status === "offline").length,
          needsHuman: nodes.filter((node) => node.status === "needs-human" || node.status === "locked").length,
          disabled: nodes.filter((node) => node.status === "disabled").length,
          kinds,
        };
      });
  }

  updateHeartbeat(
    nodeId: string,
    patch: Partial<Pick<JarvisNode, "status" | "telemetry" | "lastSeenAt" | "capabilities" | "policy" | "enrollment">>,
  ): JarvisNode {
    const current = this.nodes.get(nodeId);
    if (!current) throw new Error(`Unknown JARVIS node: ${nodeId}`);
    const updated: JarvisNode = {
      ...current,
      ...patch,
      telemetry: patch.telemetry ? { ...current.telemetry, ...patch.telemetry } : current.telemetry,
      policy: patch.policy ? { ...current.policy, ...patch.policy } : current.policy,
      capabilities: patch.capabilities ? [...patch.capabilities] : current.capabilities,
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

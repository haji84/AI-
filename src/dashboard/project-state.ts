export type ProjectState = {
  project: string;
  phase: string;
  status: string;
  updated: string;
  currentEpic: string;
  activeIssues: string;
  blocker: string;
  nextAction: string;
  lastCi: string;
  compass: string;
};

const labels: Record<keyof ProjectState, string> = {
  project: "PROJECT",
  phase: "CURRENT_PHASE",
  status: "STATUS",
  updated: "LAST_UPDATED",
  currentEpic: "CURRENT_EPIC",
  activeIssues: "ACTIVE_ISSUES",
  blocker: "BLOCKERS",
  nextAction: "NEXT_PRIORITY",
  lastCi: "LAST_SUCCESSFUL_CI",
  compass: "COMPASS_MCP",
};

export function parseProjectState(source: string): ProjectState {
  const values = new Map<string, string>();

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+):\s*(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }

  const read = (key: keyof ProjectState) => values.get(labels[key]) || "未設定";

  return {
    project: read("project"),
    phase: read("phase"),
    status: read("status"),
    updated: read("updated"),
    currentEpic: read("currentEpic"),
    activeIssues: read("activeIssues"),
    blocker: read("blocker"),
    nextAction: read("nextAction"),
    lastCi: read("lastCi"),
    compass: read("compass"),
  };
}

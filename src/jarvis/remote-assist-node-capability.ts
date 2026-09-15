import type { JarvisNode, JarvisNodeKind, JarvisNodeStatus } from "./types.ts";
import type { JarvisRemoteAssistCapability } from "./remote-assist.ts";

export type JarvisRemoteAssistAvailability = "available" | "temporarily-unavailable" | "unsupported";

export interface JarvisRemoteAssistNodeDescriptor {
  platform: JarvisNodeKind;
  capability: JarvisRemoteAssistCapability | null;
  availability: JarvisRemoteAssistAvailability;
  canView: boolean;
  canControl: boolean;
  fullManagementVerified: false;
  reason: string;
}

function unavailableByStatus(status: JarvisNodeStatus): boolean {
  return status === "offline" || status === "disabled" || status === "locked" || status === "needs-human";
}

export function remoteAssistDescriptorForNode(node: Pick<JarvisNode, "kind" | "status" | "capabilities" | "policy">): JarvisRemoteAssistNodeDescriptor {
  const declaresView = node.capabilities.includes("remote-view");
  const declaresControl = node.capabilities.includes("remote-control") && node.policy.allowRemoteControl;

  if (!declaresView) {
    return {
      platform: node.kind,
      capability: null,
      availability: "unsupported",
      canView: false,
      canControl: false,
      fullManagementVerified: false,
      reason: `${node.kind} node does not declare a verified remote-view capability`,
    };
  }

  let capability: JarvisRemoteAssistCapability = declaresControl ? "CONTROLLABLE" : "VIEW_ONLY";
  let reason = declaresControl
    ? `${node.kind} node declares remote-view and owner-policy-approved remote-control`
    : `${node.kind} node declares remote-view only`;

  if (node.kind === "ios") {
    capability = "VIEW_ONLY";
    reason = declaresControl
      ? "iOS generic capability flags do not prove unrestricted external control; JARVIS degrades Remote Assist to VIEW_ONLY until a separately verified iOS control path exists"
      : "iOS Remote Assist is limited to the separately supported observation path; unrestricted external control is not claimed";
  }

  if (node.kind === "cloud") {
    capability = "VIEW_ONLY";
    reason = "cloud nodes may expose observation state, but JARVIS does not treat them as an interactive device-control surface";
  }

  const unavailableNow = unavailableByStatus(node.status);
  return {
    platform: node.kind,
    capability,
    availability: unavailableNow ? "temporarily-unavailable" : "available",
    canView: !unavailableNow,
    canControl: capability === "CONTROLLABLE" && !unavailableNow,
    fullManagementVerified: false,
    reason: unavailableNow ? `${reason}; current node status is ${node.status}` : reason,
  };
}

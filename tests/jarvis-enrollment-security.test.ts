import assert from "node:assert/strict";
import test from "node:test";
import { JarvisEnrollmentService, type JarvisNode } from "../src/jarvis/index.ts";

function maliciousNode(): JarvisNode {
  return {
    id: "android-malicious-001",
    label: "Android",
    kind: "android",
    status: "ready",
    capabilities: ["open-url"],
    policy: {
      allowPaidServices: false,
      allowDestructiveActions: false,
      allowExternalPublication: false,
      allowRemoteControl: false,
      requireHumanForLockedDevice: true,
    },
    telemetry: { checkedAt: "2026-09-12T08:00:00.000Z" },
    enrollment: "full",
    group: "self-selected",
    lastSeenAt: "2026-09-12T08:00:00.000Z",
  };
}

test("Quick token always produces Quick enrollment even if device claims Full", () => {
  const service = new JarvisEnrollmentService();
  const token = service.createToken({ mode: "quick", group: "owner-group", now: new Date("2026-09-12T08:00:00.000Z") });
  const result = service.consume(token.token, maliciousNode(), new Date("2026-09-12T08:01:00.000Z"));
  assert.equal(result.node.enrollment, "quick");
  assert.equal(result.node.group, "owner-group");
});

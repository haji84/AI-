import { randomBytes } from "node:crypto";
import type { JarvisEnrollmentToken, JarvisNode } from "./types.ts";

export class JarvisEnrollmentService {
  private readonly tokens = new Map<string, JarvisEnrollmentToken>();

  createToken(input: {
    mode: JarvisEnrollmentToken["mode"];
    ttlMs?: number;
    maxDevices?: number;
    group?: string;
    now?: Date;
  }): JarvisEnrollmentToken {
    const now = input.now ?? new Date();
    const token: JarvisEnrollmentToken = {
      token: randomBytes(24).toString("base64url"),
      mode: input.mode,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? 5 * 60_000)).toISOString(),
      maxDevices: input.maxDevices ?? (input.mode === "fleet" ? 100 : 1),
      usedDevices: 0,
      group: input.group,
    };
    this.tokens.set(token.token, token);
    return { ...token };
  }

  consume(tokenValue: string, node: JarvisNode, now = new Date()): { node: JarvisNode; token: JarvisEnrollmentToken } {
    const token = this.tokens.get(tokenValue);
    if (!token) throw new Error("Invalid JARVIS enrollment token");
    if (new Date(token.expiresAt).getTime() <= now.getTime()) throw new Error("Expired JARVIS enrollment token");
    if (token.usedDevices >= token.maxDevices) throw new Error("JARVIS enrollment token device limit reached");

    const enrollment = token.mode === "full" ? "full" : node.enrollment;
    const enrolled: JarvisNode = {
      ...node,
      enrollment,
      group: node.group ?? token.group,
      lastSeenAt: now.toISOString(),
    };
    const updated = { ...token, usedDevices: token.usedDevices + 1 };
    this.tokens.set(tokenValue, updated);
    if (updated.usedDevices >= updated.maxDevices) this.tokens.delete(tokenValue);
    return { node: enrolled, token: updated };
  }

  canUpgradeToFull(node: JarvisNode): boolean {
    return node.kind === "android" && node.enrollment === "quick";
  }
}

export function recommendedEnrollment(node: Pick<JarvisNode, "kind" | "enrollment">): "quick" | "full" {
  if (node.kind === "android" && node.enrollment === "full") return "full";
  return "quick";
}

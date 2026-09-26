export interface BoundedLocalModelEdit {
  path: string;
  content: string;
}

export interface LocalModelLiveEvidenceInput {
  platform: string;
  githubActions: boolean;
  runnerEnvironment: string;
  model: { digest: string; installedBytes: number; loaded: boolean };
  processProof: { pid: number; executable: string; listenerPort: number } | null;
}

export function classifyLocalModelLiveEvidence(input: LocalModelLiveEvidenceInput): { admissible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.platform !== "win32") reasons.push("not_windows_runner");
  if (!input.githubActions || input.runnerEnvironment !== "self-hosted") reasons.push("not_self_hosted_github_actions");
  if (!/^sha256:[a-f0-9]{64}$/.test(input.model.digest) || input.model.installedBytes <= 0 || !input.model.loaded) reasons.push("model_artifact_not_verified_loaded");
  if (!input.processProof
    || !Number.isInteger(input.processProof.pid)
    || input.processProof.pid <= 0
    || !/ollama\.exe$/i.test(input.processProof.executable)
    || input.processProof.listenerPort !== 11434) reasons.push("ollama_listener_process_not_verified");
  return { admissible: reasons.length === 0, reasons };
}

export function assertLoopbackModelEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("local model endpoint must use loopback HTTP");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("local model endpoint must not contain credentials or query data");
  return url.origin;
}

export function parseBoundedLocalModelEdit(
  raw: string,
  declaredPath: string,
  expectedContent: string,
): BoundedLocalModelEdit {
  if (!declaredPath || declaredPath.startsWith("/") || declaredPath.includes("..") || declaredPath.includes("\\")) {
    throw new Error("invalid declared path");
  }
  if (!raw || Buffer.byteLength(raw, "utf8") > 16_384) throw new Error("local model edit exceeds response bound");
  const value = JSON.parse(raw) as Partial<BoundedLocalModelEdit>;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "content,path") {
    throw new Error("local model edit must contain only path and content");
  }
  if (value.path !== declaredPath) throw new Error("local model edit changed a path outside the declared path");
  if (value.content !== expectedContent) throw new Error("local model edit did not produce the independently verified target");
  return { path: value.path, content: value.content };
}

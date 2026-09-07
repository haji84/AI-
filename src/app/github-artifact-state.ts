import { inflateRawSync } from "node:zlib";
import type { ReasoningFeedback } from "../orchestrator/reasoning-feedback.ts";

interface ArtifactRecord {
  id: number;
  name: string;
  expired?: boolean;
  created_at?: string;
}

interface ArtifactListResponse {
  artifacts?: ArtifactRecord[];
}

const ARTIFACT_NAME = "autonomy-dashboard-state";

function findZipEntry(zip: Buffer, filename: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const fileNameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd + extraLength > zip.length) return null;
    const entryName = zip.subarray(nameStart, nameEnd).toString("utf-8");
    const dataStart = nameEnd + extraLength;
    if ((flags & 0x08) !== 0) return null;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) return null;
    if (entryName === filename) {
      const data = zip.subarray(dataStart, dataEnd);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

function repositoryFromEnv(): string {
  return process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
}

function tokenFromEnv(): string | null {
  return process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || null;
}

export async function readReasoningFeedbackFromGitHubArtifact(): Promise<ReasoningFeedback | null> {
  const token = tokenFromEnv();
  if (!token) return null;
  const repository = repositoryFromEnv();
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const listResponse = await fetch(
      `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(ARTIFACT_NAME)}&per_page=10`,
      { headers, cache: "no-store" },
    );
    if (!listResponse.ok) return null;
    const list = await listResponse.json() as ArtifactListResponse;
    const artifact = (list.artifacts ?? [])
      .filter((item) => !item.expired && item.name === ARTIFACT_NAME)
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
    if (!artifact) return null;

    const archiveResponse = await fetch(
      `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
      { headers, cache: "no-store", redirect: "follow" },
    );
    if (!archiveResponse.ok) return null;
    const zip = Buffer.from(await archiveResponse.arrayBuffer());
    const entry = findZipEntry(zip, "reasoning-feedback.json");
    if (!entry) return null;
    return JSON.parse(entry.toString("utf-8")) as ReasoningFeedback;
  } catch {
    return null;
  }
}

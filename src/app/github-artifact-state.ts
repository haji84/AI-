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
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

function decodeZipEntry(method: number, data: Buffer): Buffer | null {
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  return null;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  // EOCD is at least 22 bytes. The ZIP comment can be up to 65535 bytes.
  const minimumOffset = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
}

function findZipEntryFromCentralDirectory(zip: Buffer, filename: string): Buffer | null {
  const eocdOffset = findEndOfCentralDirectory(zip);
  if (eocdOffset < 0 || eocdOffset + 22 > zip.length) return null;

  const centralDirectorySize = zip.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryOffset < 0 || centralDirectoryEnd > zip.length || centralDirectoryEnd > eocdOffset) return null;

  let offset = centralDirectoryOffset;
  while (offset + 46 <= centralDirectoryEnd) {
    if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) return null;

    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const fileNameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const nextOffset = nameEnd + extraLength + commentLength;

    if (nextOffset > centralDirectoryEnd) return null;
    const entryName = zip.subarray(nameStart, nameEnd).toString("utf-8");

    if (entryName === filename) {
      // Encrypted entries are intentionally unsupported.
      if ((flags & 0x01) !== 0) return null;
      if (localHeaderOffset + 30 > zip.length) return null;
      if (zip.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) return null;

      const localFileNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataStart < 0 || dataEnd > zip.length || dataEnd > centralDirectoryOffset) return null;

      return decodeZipEntry(method, zip.subarray(dataStart, dataEnd));
    }

    offset = nextOffset;
  }

  return null;
}

function findZipEntryFromLocalHeaders(zip: Buffer, filename: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) break;
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
    // Without the central directory, data-descriptor entries do not expose the
    // compressed size in the local header, so we cannot safely skip or decode them.
    if ((flags & 0x08) !== 0) return null;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) return null;
    if (entryName === filename) return decodeZipEntry(method, zip.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  return null;
}

export function findZipEntry(zip: Buffer, filename: string): Buffer | null {
  return findZipEntryFromCentralDirectory(zip, filename) ?? findZipEntryFromLocalHeaders(zip, filename);
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

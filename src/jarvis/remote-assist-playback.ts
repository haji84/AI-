import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(["recording", "stopping", "completed", "stopped", "failed"]);
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export type RecordingSummary = { id: string; serial: string; status: string; createdAt: string; frameCount: number; maxFrames: number; totalBytes: number };

function boundedRead(root: string, file: string, maxBytes: number): Buffer {
  const actualRoot = realpathSync(root);
  const actualFile = realpathSync(file);
  if (!actualFile.startsWith(actualRoot + sep) || lstatSync(file).isSymbolicLink()) throw new Error("invalid recording path");
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("invalid recording size");
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > maxBytes) throw new Error("invalid recording size");
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

function recordingDirectory(root: string, id: string): string {
  if (!ID.test(id)) throw new Error("invalid recording id");
  const directory = join(root, id);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid recording directory");
  return directory;
}

function summary(root: string, id: string): RecordingSummary {
  const directory = recordingDirectory(root, id);
  const value = JSON.parse(boundedRead(root, join(directory, "manifest.json"), 32_768).toString("utf8"));
  if (value.id !== id || typeof value.serial !== "string" || !value.serial || value.serial.length > 256 ||
      !statuses.has(value.status) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isInteger(value.frameCount) || value.frameCount < 0 || value.frameCount > 60 ||
      !Number.isInteger(value.maxFrames) || value.maxFrames < 1 || value.maxFrames > 60 || value.frameCount > value.maxFrames ||
      !Number.isInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > 64 * 1024 * 1024) throw new Error("invalid recording manifest");
  return { id, serial: value.serial, status: value.status, createdAt: value.createdAt, frameCount: value.frameCount, maxFrames: value.maxFrames, totalBytes: value.totalBytes };
}

export function recordingPlaybackResponse(request: Request, ownerAuthenticated: boolean, root = resolve(process.cwd(), ".jarvis/remote-assist-recordings")): Response {
  if (!ownerAuthenticated) return Response.json({ message: "オーナー認証が必要です" }, { status: 401, headers });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (!id) {
      if (!existsSync(root)) return Response.json({ recordings: [], unreadable: 0, truncated: false }, { headers });
      const recordings: RecordingSummary[] = [];
      let unreadable = 0;
      let inspected = 0;
      let truncated = false;
      const directory = opendirSync(root);
      try {
        for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
          if (++inspected > 200) { truncated = true; break; }
          if (!ID.test(entry.name)) continue;
          try { recordings.push(summary(root, entry.name)); } catch { unreadable++; }
        }
      } finally { directory.closeSync(); }
      recordings.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return Response.json({ recordings: recordings.slice(0, 20), unreadable, truncated: truncated || recordings.length > 20 }, { headers });
    }
    const record = summary(root, id);
    const rawFrame = url.searchParams.get("frame") ?? "";
    if (!/^[1-9]\d{0,1}$/.test(rawFrame) || Number(rawFrame) > record.frameCount) throw new Error("invalid frame index");
    const bytes = boundedRead(root, join(recordingDirectory(root, id), `frame-${rawFrame.padStart(4, "0")}.png`), 8 * 1024 * 1024);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("invalid PNG frame");
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": "image/png",
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${id}-frame-${rawFrame}.png"`,
    } });
  } catch {
    return Response.json({ message: "記録を読み取れません。削除・更新中、または不正な記録です。" }, { status: 404, headers });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export interface ScopedArtifactRead {
  path: string;
  bytes: Buffer;
  sha256: string;
}

export interface ScopedArtifactCreate {
  path: string;
  sha256: string;
  created: boolean;
  idempotent: boolean;
}

export class ArtifactConflictError extends Error {
  readonly path: string;
  readonly currentSha256: string;
  readonly requestedSha256: string;

  constructor(path: string, currentSha256: string, requestedSha256: string) {
    super("overwrite requires an approved replacement path");
    this.name = "ArtifactConflictError";
    this.path = path;
    this.currentSha256 = currentSha256;
    this.requestedSha256 = requestedSha256;
  }
}

export class ScopedArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async available(): Promise<boolean> {
    try {
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }

  async read(pathValue: unknown): Promise<ScopedArtifactRead> {
    const target = await this.secureReadPath(pathValue);
    const bytes = await readFile(target);
    return { path: target, bytes, sha256: sha256(bytes) };
  }

  async create(pathValue: unknown, data: Uint8Array): Promise<ScopedArtifactCreate> {
    const requested = Buffer.from(data);
    const requestedSha256 = sha256(requested);
    const target = await this.secureCreateTarget(pathValue);

    const existing = await this.readExistingTarget(target, requested, requestedSha256);
    if (existing) return existing;

    const temp = `${target}.jarvis-${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temp, requested, { flag: "wx" });
      try {
        // Publishing by hard-link is atomic and never replaces an existing target.
        // If a concurrent creator wins, re-check the winner below instead of overwriting it.
        await link(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raced = await this.readExistingTarget(target, requested, requestedSha256);
        if (raced) return raced;
        throw error;
      }
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }

    const actual = await readFile(target);
    const actualSha256 = sha256(actual);
    if (actualSha256 !== requestedSha256) throw new Error("published artifact hash mismatch");
    return { path: target, sha256: actualSha256, created: true, idempotent: false };
  }

  private relativeTarget(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("path required");
    const target = resolve(this.root, value);
    const rel = relative(this.root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("path escapes allowed root");
    if (!rel) throw new Error("file path required");
    return rel;
  }

  private assertContained(root: string, candidate: string): void {
    const rel = relative(root, candidate);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("resolved file escapes allowed root");
  }

  private async secureReadPath(value: unknown): Promise<string> {
    const rel = this.relativeTarget(value);
    const root = await realpath(this.root);
    const actual = await realpath(resolve(root, rel));
    this.assertContained(root, actual);
    return actual;
  }

  private async secureCreateTarget(value: unknown): Promise<string> {
    const rel = this.relativeTarget(value);
    const root = await realpath(this.root);
    const parts = rel.split(sep).filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("file path required");

    let parent = root;
    for (const part of parts) {
      const next = resolve(parent, part);
      this.assertContained(root, next);
      try {
        const info = await lstat(next);
        if (info.isSymbolicLink()) throw new Error("symlink directory is not allowed in write path");
        if (!info.isDirectory()) throw new Error("write path parent is not a directory");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          await mkdir(next);
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        }
        const created = await lstat(next);
        if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("unsafe write directory");
      }
      parent = await realpath(next);
      this.assertContained(root, parent);
    }

    const target = resolve(parent, fileName);
    this.assertContained(root, target);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("symlink file is not allowed for write");
      if (info.isDirectory()) throw new Error("write target is a directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return target;
  }

  private async readExistingTarget(
    target: string,
    requested: Buffer,
    requestedSha256: string,
  ): Promise<ScopedArtifactCreate | null> {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error("symlink file is not allowed for write");
      if (!info.isFile()) throw new Error("write target is not a regular file");
      const current = await readFile(target);
      const currentSha256 = sha256(current);
      if (current.equals(requested)) {
        return { path: target, sha256: requestedSha256, created: false, idempotent: true };
      }
      throw new ArtifactConflictError(target, currentSha256, requestedSha256);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

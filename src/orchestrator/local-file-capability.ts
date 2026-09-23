import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, link, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkAction, WorkCapability, WorkResult } from "./work-capability.ts";

interface SecureWriteTarget {
  target: string;
  exists: boolean;
}

export interface LocalFileBytes {
  target: string;
  bytes: Buffer;
  sha256: string;
}

export interface LocalFileCreateResult {
  target: string;
  sha256: string;
  status: "created" | "idempotent" | "blocked";
  currentSha256?: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LocalFileCapability implements WorkCapability {
  readonly name = "file.local";
  readonly domain = "file" as const;
  readonly operations = ["read", "write"];
  readonly access = "write" as const;
  readonly externalSideEffect = false;
  readonly maxRisk = "low" as const;
  readonly requiresHumanApproval = false;

  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async available() {
    try {
      return (await stat(this.root)).isDirectory();
    } catch {
      return false;
    }
  }

  private relativeTarget(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new Error("path required");
    const target = resolve(this.root, value);
    const rel = relative(this.root, target);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("path escapes allowed root");
    if (!rel) throw new Error("file path required");
    return rel;
  }

  private assertContained(root: string, candidate: string): void {
    const rel = relative(root, candidate);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("resolved file escapes allowed root");
  }

  private async secureReadPath(value: unknown): Promise<string> {
    const rel = this.relativeTarget(value);
    const root = await realpath(this.root);
    const actual = await realpath(resolve(root, rel));
    this.assertContained(root, actual);
    return actual;
  }

  private async secureWritePath(value: unknown): Promise<SecureWriteTarget> {
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
        await mkdir(next);
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
      return { target, exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { target, exists: false };
    }
  }

  async readBytes(path: unknown): Promise<LocalFileBytes> {
    const target = await this.secureReadPath(path);
    const bytes = await readFile(target);
    return { target, bytes, sha256: sha256(bytes) };
  }

  async createBytes(path: unknown, bytes: Buffer): Promise<LocalFileCreateResult> {
    const { target, exists } = await this.secureWritePath(path);
    const requestedSha256 = sha256(bytes);

    if (exists) {
      const currentBytes = await readFile(target);
      const currentSha256 = sha256(currentBytes);
      if (currentBytes.equals(bytes)) {
        return { target, sha256: requestedSha256, status: "idempotent", currentSha256 };
      }
      return { target, sha256: requestedSha256, status: "blocked", currentSha256 };
    }

    const temp = resolve(target + `.jarvis-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, bytes, { flag: "wx" });
      try { await link(temp, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // An intervening writer must never be replaced, even on POSIX rename semantics.
        const checked = await this.secureWritePath(path);
        const currentBytes = await readFile(checked.target);
        const currentSha256 = sha256(currentBytes);
        return { target, sha256: requestedSha256, status: currentBytes.equals(bytes) ? "idempotent" : "blocked", currentSha256 };
      }
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
    const actualBytes = await readFile(target);
    return { target, sha256: sha256(actualBytes), status: "created" };
  }

  async execute(action: WorkAction): Promise<WorkResult> {
    try {
      if (action.operation === "read") {
        const result = await this.readBytes(action.input.path);
        return this.ok(
          action,
          { text: result.bytes.toString("utf8"), sha256: result.sha256 },
          [],
          result.target,
          result.sha256,
        );
      }

      if (action.operation === "write") {
        const data = String(action.input.text ?? "");
        const result = await this.createBytes(action.input.path, Buffer.from(data, "utf8"));

        if (result.status === "blocked") {
          return {
            ok: false,
            status: "blocked",
            outputs: {
              path: result.target,
              currentSha256: result.currentSha256,
              requestedSha256: result.sha256,
            },
            changes: [],
            evidence: [
              {
                kind: "file.overwrite_blocked",
                ref: `file:${result.target}`,
                data: {
                  path: result.target,
                  currentSha256: result.currentSha256,
                  requestedSha256: result.sha256,
                },
              },
            ],
            failureClass: "policy",
            error: "overwrite requires an approved replacement path",
            provenance: {
              capability: this.name,
              attemptId: action.attemptId,
              strategyId: action.strategyId,
            },
          };
        }

        return this.ok(
          action,
          {
            path: result.target,
            sha256: result.sha256,
            ...(result.status === "idempotent" ? { idempotent: true } : {}),
          },
          result.status === "created"
            ? [{ resource: result.target, operation: "create", reversible: true }]
            : [],
          result.target,
          result.sha256,
        );
      }

      throw new Error("unsupported file operation");
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        outputs: {},
        changes: [],
        evidence: [],
        failureClass: "implementation",
        error: error instanceof Error ? error.message : "file operation failed",
        provenance: {
          capability: this.name,
          attemptId: action.attemptId,
          strategyId: action.strategyId,
        },
      };
    }
  }

  private ok(
    action: WorkAction,
    outputs: Record<string, unknown>,
    changes: WorkResult["changes"],
    target: string,
    digest: string,
  ): WorkResult {
    return {
      ok: true,
      status: "completed",
      outputs,
      changes,
      evidence: [{ kind: "file.artifact", ref: `file:${target}`, data: { path: target, sha256: digest } }],
      provenance: {
        capability: this.name,
        attemptId: action.attemptId,
        strategyId: action.strategyId,
      },
    };
  }
}

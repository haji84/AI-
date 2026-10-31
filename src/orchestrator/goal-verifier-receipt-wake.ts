import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Poll receipt bytes only. Signature and Goal authority remain with Executor. */
export class GoalVerifierReceiptWake {
  private lastDigest: string | null = null;
  readonly path: string;
  constructor(path: string) {
    if (!path || !isAbsolute(path)) throw Error("VERIFIER_RECEIPT_WAKE_PATH_INVALID");
    this.path = path;
  }
  changedDigest(): string | null {
    let bytes: Buffer;
    try {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 24_576) return null;
      bytes = readFileSync(this.path);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
      throw e;
    }
    if (bytes.length < 1 || bytes.length > 24_576) return null;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest === this.lastDigest) return null;
    this.lastDigest = digest;
    return digest;
  }
}

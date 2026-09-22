import { createHash } from "node:crypto";
import type { FactSource, SourceClass } from "./fact-verifier.ts";
import { readResearchSource } from "./research-transport.ts";
import type { ResearchTransportOptions } from "./research-transport.ts";
export interface AcquiredSource { canonicalUrl: string; retrievedAt: string; sourceClass: SourceClass; sha256: string; contentType: string; body: string; factSource: FactSource; }
export interface SourceAcquirerOptions extends ResearchTransportOptions { now?: () => Date; classify?: (url: URL) => SourceClass; }
export class HttpSourceAcquirer {
  private readonly options: SourceAcquirerOptions;
  constructor(options: SourceAcquirerOptions = {}) { this.options = options; }
  async acquire(rawUrl: string): Promise<AcquiredSource> {
    const { url, contentType, bytes } = await readResearchSource(rawUrl, this.options);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const canonicalUrl = url.toString();
    const retrievedAt = (this.options.now?.() ?? new Date()).toISOString();
    const sourceClass = this.options.classify?.(url) ?? "other";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { canonicalUrl, retrievedAt, sourceClass, sha256, contentType, body, factSource: { id: canonicalUrl, sourceClass, retrievedAt, value: body } };
  }
}

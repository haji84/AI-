import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContextItem, ContextSource, Goal } from "./goal-loop.ts";

const DEFAULT_REPOSITORY_FILES = ["PROJECT_STATE.md", "ROADMAP.md", "package.json"] as const;

export class RepositoryFileContextSource implements ContextSource {
  readonly name = "repository-files";
  private readonly root: string;
  private readonly files: readonly string[];

  constructor(options: { root?: string; files?: readonly string[] } = {}) {
    this.root = options.root ?? process.cwd();
    this.files = options.files ?? DEFAULT_REPOSITORY_FILES;
  }

  async collect(): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    for (const file of this.files) {
      try {
        const content = await readFile(resolve(this.root, file), "utf-8");
        items.push({ source: `repository.file:${file}`, summary: content.slice(0, 4000), data: { file } });
      } catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "unknown";
        items.push({ source: `repository.file:${file}`, summary: `unavailable:${code}`, data: { file, available: false } });
      }
    }
    return items;
  }
}

export interface ExternalContextConnector {
  name: string;
  available(): Promise<boolean>;
  collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]>;
}

export class SafeConnectorContextSource implements ContextSource {
  readonly name: string;
  private readonly connector: ExternalContextConnector;

  constructor(connector: ExternalContextConnector) {
    this.connector = connector;
    this.name = `connector:${connector.name}`;
  }

  async collect(input: { goal: Goal; nextAction?: string | null }): Promise<ContextItem[]> {
    if (!(await this.connector.available())) {
      return [{
        source: this.name,
        summary: "connector_unavailable",
        data: { connector: this.connector.name, available: false },
      }];
    }
    return this.connector.collect(input);
  }
}

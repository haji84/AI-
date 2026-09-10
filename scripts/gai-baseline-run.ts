import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPORT_SCHEMA = "gai-real-baseline-report:v1";
export const MANIFEST_SCHEMA = "gai-benchmark-suite:v1";

export interface BaselineCase {
  id: string;
  input: string;
  task?: Record<string, unknown>;
}

export interface BaselineManifest {
  schemaVersion: typeof MANIFEST_SCHEMA;
  suiteId: string;
  cases: BaselineCase[];
}

export interface AdapterResponse {
  ok: boolean;
  output: string;
  modelTier: string;
  provider: string;
  additionalApiCost: number;
  humanInterventionCount?: number;
  retryCount?: number;
  transferResult?: boolean | null;
  failureTaxonomy?: string | null;
}

export interface BaselineReport {
  schemaVersion: typeof REPORT_SCHEMA;
  generatedAt: string;
  status: "blocked" | "real_baseline";
  realExecution: boolean;
  suiteId: string | null;
  manifestPath: string;
  adapterPath: string | null;
  totalCases: number;
  executedCases: number;
  passedCases: number | null;
  successRate: number | null;
  blocker: string | null;
  resumeCommand: string;
  results: Array<{
    caseId: string;
    ok: boolean;
    modelTier: string;
    provider: string;
    durationMs: number;
    humanInterventionCount: number;
    retryCount: number;
    transferResult: boolean | null;
    failureTaxonomy: string | null;
  }>;
}

export interface PreflightResult {
  ready: boolean;
  blocker: string | null;
  adapterPath: string | null;
  manifest: BaselineManifest | null;
}

function resumeCommand(manifestPath: string, reportPath: string): string {
  return `GAI_BASELINE_ADAPTER=/absolute/path/to/zero-cost-adapter pnpm gai:baseline -- --manifest=${manifestPath} --report=${reportPath}`;
}

export async function preflight(options: {
  manifestPath: string;
  adapterPath?: string;
}): Promise<PreflightResult> {
  const adapterPath = options.adapterPath?.trim() ? resolve(options.adapterPath) : null;
  if (!adapterPath) {
    return {
      ready: false,
      blocker: "No real model/runtime adapter configured. Set GAI_BASELINE_ADAPTER to an executable zero-additional-cost adapter.",
      adapterPath: null,
      manifest: null,
    };
  }

  try {
    await access(adapterPath, constants.X_OK);
  } catch {
    return {
      ready: false,
      blocker: `Configured adapter is not executable: ${adapterPath}`,
      adapterPath,
      manifest: null,
    };
  }

  let manifest: BaselineManifest;
  try {
    manifest = JSON.parse(await readFile(options.manifestPath, "utf8")) as BaselineManifest;
  } catch {
    return {
      ready: false,
      blocker: `Benchmark manifest is unavailable or invalid JSON: ${options.manifestPath}`,
      adapterPath,
      manifest: null,
    };
  }

  if (manifest.schemaVersion !== MANIFEST_SCHEMA || !manifest.suiteId || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    return {
      ready: false,
      blocker: `Benchmark manifest must use ${MANIFEST_SCHEMA} and contain at least one case.`,
      adapterPath,
      manifest: null,
    };
  }

  const ids = new Set<string>();
  for (const item of manifest.cases) {
    if (!item?.id || typeof item.input !== "string" || ids.has(item.id)) {
      return {
        ready: false,
        blocker: "Benchmark manifest contains a missing/duplicate case id or a non-string input.",
        adapterPath,
        manifest: null,
      };
    }
    ids.add(item.id);
  }

  return { ready: true, blocker: null, adapterPath, manifest };
}

export async function executeAdapter(adapterPath: string, item: BaselineCase): Promise<AdapterResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(adapterPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Adapter exited ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as AdapterResponse;
        if (parsed.additionalApiCost !== 0) {
          reject(new Error("Adapter reported non-zero additional API cost; run rejected."));
          return;
        }
        if (typeof parsed.ok !== "boolean" || typeof parsed.output !== "string" || !parsed.modelTier || !parsed.provider) {
          reject(new Error("Adapter returned an invalid response schema."));
          return;
        }
        resolvePromise(parsed);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.end(JSON.stringify({ schemaVersion: "gai-baseline-case:v1", case: item }));
  });
}

export async function runBaseline(options: {
  manifestPath: string;
  reportPath: string;
  adapterPath?: string;
  now?: () => string;
}): Promise<BaselineReport> {
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const check = await preflight({ manifestPath: options.manifestPath, adapterPath: options.adapterPath });
  const command = resumeCommand(options.manifestPath, options.reportPath);

  if (!check.ready || !check.adapterPath || !check.manifest) {
    return {
      schemaVersion: REPORT_SCHEMA,
      generatedAt,
      status: "blocked",
      realExecution: false,
      suiteId: null,
      manifestPath: options.manifestPath,
      adapterPath: check.adapterPath,
      totalCases: 0,
      executedCases: 0,
      passedCases: null,
      successRate: null,
      blocker: check.blocker,
      resumeCommand: command,
      results: [],
    };
  }

  const results: BaselineReport["results"] = [];
  for (const item of check.manifest.cases) {
    const started = Date.now();
    const response = await executeAdapter(check.adapterPath, item);
    results.push({
      caseId: item.id,
      ok: response.ok,
      modelTier: response.modelTier,
      provider: response.provider,
      durationMs: Date.now() - started,
      humanInterventionCount: response.humanInterventionCount ?? 0,
      retryCount: response.retryCount ?? 0,
      transferResult: response.transferResult ?? null,
      failureTaxonomy: response.failureTaxonomy ?? null,
    });
  }

  const passedCases = results.filter((item) => item.ok).length;
  return {
    schemaVersion: REPORT_SCHEMA,
    generatedAt,
    status: "real_baseline",
    realExecution: true,
    suiteId: check.manifest.suiteId,
    manifestPath: options.manifestPath,
    adapterPath: check.adapterPath,
    totalCases: check.manifest.cases.length,
    executedCases: results.length,
    passedCases,
    successRate: results.length === 0 ? null : passedCases / results.length,
    blocker: null,
    resumeCommand: command,
    results,
  };
}

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

export async function main(): Promise<void> {
  const manifestPath = argValue("manifest", ".gai-research/benchmark-suite-v1.json");
  const reportPath = argValue("report", ".gai-research/baseline-run.json");
  const report = await runBaseline({
    manifestPath,
    reportPath,
    adapterPath: process.env.GAI_BASELINE_ADAPTER,
  });
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "blocked") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

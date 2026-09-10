import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createPreflightArtifact,
  preflightBaseline,
  runRealBaseline,
  type BaselineRuntimeAdapter,
  type BaselineTask,
} from "../src/gai/research-baseline.ts";

interface Args {
  suite?: string;
  adapter?: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    if (key && rest.length > 0) values.set(key, rest.join("="));
  }
  return {
    suite: values.get("suite"),
    adapter: values.get("adapter"),
    out: values.get("out") ?? "artifacts/gai/baseline-run.json",
  };
}

function resumeCommand(args: Args): string {
  return `pnpm gai:baseline -- --suite=${args.suite ?? "<benchmark-suite.json>"} --adapter=${args.adapter ?? "<runtime-adapter.mjs>"} --out=${args.out}`;
}

async function loadTasks(path: string): Promise<BaselineTask[]> {
  const parsed: unknown = JSON.parse(await readFile(resolve(path), "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Benchmark suite must be a JSON array of tasks.");
  return parsed as BaselineTask[];
}

async function loadAdapter(path: string): Promise<BaselineRuntimeAdapter> {
  const module = await import(pathToFileURL(resolve(path)).href);
  const factory = module.createBaselineRuntimeAdapter ?? module.default;
  if (typeof factory !== "function") {
    throw new Error("Runtime adapter module must export createBaselineRuntimeAdapter() or a default factory.");
  }
  return await factory();
}

async function writeArtifact(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = resumeCommand(args);

  if (!args.adapter) {
    const reason = "No runtime adapter supplied. Refusing to label deterministic or CI-only execution as a real baseline.";
    const artifact = createPreflightArtifact({ adapter: null, reason, resumeCommand: command });
    await writeArtifact(args.out, artifact);
    console.error(reason);
    console.error(`Resume with: ${command}`);
    process.exitCode = 2;
    return;
  }

  const adapter = await loadAdapter(args.adapter);
  const preflight = await preflightBaseline(adapter);
  if (!preflight.canRunRealBaseline) {
    const artifact = createPreflightArtifact({
      adapter,
      reason: preflight.reason ?? "Runtime preflight failed.",
      resumeCommand: command,
    });
    await writeArtifact(args.out, artifact);
    console.error(artifact.refusalReason);
    console.error(`Resume with: ${command}`);
    process.exitCode = 2;
    return;
  }

  if (!args.suite) throw new Error("--suite=<benchmark-suite.json> is required for a real baseline run.");
  const tasks = await loadTasks(args.suite);
  const artifact = await runRealBaseline({ tasks, adapter, resumeCommand: command });
  await writeArtifact(args.out, artifact);
  console.log(`Real baseline completed: ${artifact.cases.length} model-executed cases.`);
  console.log(`Artifact: ${resolve(args.out)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

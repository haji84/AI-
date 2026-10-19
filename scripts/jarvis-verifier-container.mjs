/** Bounded Docker CLI lifecycle. The owner-provisioned Docker daemon, runtime
 * and image remain trusted dependencies; tests of this module are not physical
 * container-isolation or process-cleanup acceptance evidence.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";

const failure = code => Object.assign(new Error(code), { code });
const bounded = (value, maximum) => Number.isInteger(value) && value > 0 && value <= maximum;

function dockerExecutable(cwd, env) {
  // Do not let Windows resolve a candidate-provided docker.exe from cwd.
  const filename = process.platform === "win32" ? "docker.exe" : "docker";
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, filename);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const file = realpathSync(candidate), inside = relative(cwd, file);
    if (!inside || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep))) {
      throw failure("VERIFIER_CONTAINER_EXECUTABLE_IN_WORKSPACE");
    }
    return file;
  }
  throw failure("VERIFIER_CONTAINER_RUNTIME_UNAVAILABLE");
}

function runProcess(executable, args, options) {
  return new Promise(resolve => {
    const output = { status: null, signal: null, stdout: "", stderr: "", closeObserved: false };
    const chunks = { stdout: [], stderr: [] };
    let child, deadline, grace, total = 0, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(grace);
      output.stdout = Buffer.concat(chunks.stdout).toString("utf8");
      output.stderr = Buffer.concat(chunks.stderr).toString("utf8");
      if (!output.closeObserved && child) {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      }
      resolve(output);
    };
    const terminate = code => {
      if (settled || output.error) return;
      output.error = failure(code);
      // A CLI which ignores/does not deliver close cannot strand cleanup.
      grace = setTimeout(finish, options.killGraceMs);
      try { child.kill("SIGKILL"); } catch { /* Absence of close remains explicit. */ }
    };
    try {
      child = spawn(executable, args, { cwd: options.cwd, env: options.env,
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", chunk => {
          if (settled || output.error) return;
          const bytes = Buffer.from(chunk), available = Math.max(0, options.maxBuffer - total);
          // Own only retained bytes: an empty/subarray view would otherwise
          // retain arbitrarily large original chunks after output overflow.
          if (available) chunks[stream].push(Buffer.from(bytes.subarray(0, available)));
          total += bytes.length;
          if (total > options.maxBuffer) terminate("ENOBUFS");
        });
        child[stream].on("error", () => terminate("VERIFIER_CONTAINER_OUTPUT_ERROR"));
      }
      child.once("error", error => { output.error ??= failure(error.code ?? "VERIFIER_CONTAINER_SPAWN_FAILED"); finish(); });
      child.once("close", (status, signal) => {
        output.status = status; output.signal = signal; output.closeObserved = true; finish();
      });
      deadline = setTimeout(() => terminate("ETIMEDOUT"), options.timeoutMs);
    } catch (error) {
      output.error = failure(error.code ?? "VERIFIER_CONTAINER_SPAWN_FAILED"); finish();
    }
  });
}

const record = result => ({ status: result.status, signal: result.signal,
  stdout: result.stdout, stderr: result.stderr, errorCode: result.error?.code ?? null,
  closeObserved: result.closeObserved });

export async function runVerifierContainer(args, {
  cwd, env, timeoutMs = 180_000, maxBuffer = 2 * 1024 * 1024,
  cleanupTimeoutMs = 8_000, killGraceMs = 1_000,
} = {}) {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !env || typeof env !== "object" ||
      !Array.isArray(args) || args.length < 2 || args.length > 128 || args[0] !== "run" ||
      args.some(arg => typeof arg !== "string" || arg.includes("\0") || arg.length > 16_384 ||
        /^--(?:name|cidfile)(?:=|$)/.test(arg)) ||
      !bounded(timeoutMs, 180_000) || !bounded(maxBuffer, 2 * 1024 * 1024) ||
      !bounded(cleanupTimeoutMs, 30_000) || !bounded(killGraceMs, 1_000)) {
    throw failure("VERIFIER_CONTAINER_REQUEST_INVALID");
  }
  let executable;
  try { executable = dockerExecutable(realpathSync(cwd), env); }
  catch (error) {
    return { status: null, signal: null, stdout: "", stderr: "", error,
      closeObserved: false, cleanup: { attempted: false, confirmed: false } };
  }
  const containerName = `goriq-verifier-${randomUUID()}`;
  const options = { cwd, env, timeoutMs, maxBuffer, killGraceMs };
  const cleanupOptions = { ...options, timeoutMs: cleanupTimeoutMs, maxBuffer: 4096 };
  let result, cleanup;
  try {
    result = await runProcess(executable, ["run", "--name", containerName, ...args.slice(1)], options);
  } finally {
    const removal = await runProcess(executable, ["rm", "--force", "--volumes", containerName], cleanupOptions);
    // A successful empty daemon listing proves absence; an inspect failure alone
    // cannot distinguish an absent container from an unreachable daemon. This
    // also accepts automatic --rm cleanup without treating rm's exit 1 as PASS.
    const inspection = await runProcess(executable, ["container", "ls", "--all",
      "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"], cleanupOptions);
    cleanup = { attempted: true, containerName,
      confirmed: result?.closeObserved === true && removal.closeObserved && !removal.error && inspection.closeObserved &&
        !inspection.error && inspection.status === 0 && inspection.stdout.trim() === "",
      removal: record(removal), inspection: record(inspection) };
  }
  if (!cleanup.confirmed) {
    return { ...result, runErrorCode: result.error?.code ?? null, cleanup,
      error: failure("VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED") };
  }
  return { ...result, cleanup };
}

/** Bounded host-side Git observations for the independent verifier.
 * This is callback hardening, not a sandbox for hostile/mutable Git metadata.
 * The Git installation/PATH and repository metadata must remain owner-controlled
 * during the call. No safe.directory bypass is granted for another principal.
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";

const allowedQueries = new Set([
  JSON.stringify(["rev-parse", "HEAD"]),
  JSON.stringify(["rev-parse", "--show-toplevel"]),
  JSON.stringify(["branch", "--show-current"]),
  JSON.stringify(["status", "--porcelain", "-uall"]),
  JSON.stringify(["ls-files", "-z", "--cached"]),
]);
const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
const configOverrides = [
  "--no-pager", "--no-optional-locks",
  "-c", "core.fsmonitor=false",
  "-c", `core.hooksPath=${nullFile}`,
  "-c", "core.untrackedCache=false",
  "-c", `core.attributesFile=${nullFile}`,
  "-c", "submodule.recurse=false",
];

function environment() {
  // An allowlist also removes mixed-case GIT_* variables on Windows, arbitrary
  // GIT_CONFIG_COUNT entries, alternate indexes/object stores and trace sinks.
  const env = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: nullFile,
    GIT_CONFIG_GLOBAL: nullFile, GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1" };
}

function gitExecutable(cwd, env) {
  // Resolve an absolute executable before entering the candidate cwd. In
  // particular Windows must not search a candidate-provided git.exe first.
  const filename = process.platform === "win32" ? "git.exe" : "git";
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(entry)) continue;
    const path = join(entry, filename);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    const absolute = realpathSync(path), inside = relative(cwd, absolute);
    if (!inside || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep))) {
      throw Error("VERIFIER_GIT_EXECUTABLE_IN_WORKSPACE");
    }
    return absolute;
  }
  throw Error("VERIFIER_GIT_EXECUTABLE_UNAVAILABLE");
}

export function safeGit(cwd, args) {
  if (typeof cwd !== "string" || !isAbsolute(cwd) || !Array.isArray(args) ||
      args.some(arg => typeof arg !== "string") || !allowedQueries.has(JSON.stringify(args))) {
    throw Error("VERIFIER_GIT_QUERY_NOT_ALLOWED");
  }
  const root = realpathSync(cwd), env = environment(), executable = gitExecutable(root, env);
  const invoke = commandArgs => {
    try {
      return execFileSync(executable, commandArgs, { cwd: root, env,
        encoding: "utf8", windowsHide: true, timeout: 8000, killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // Git diagnostics/config values can contain private local data.
      throw Error("VERIFIER_GIT_QUERY_FAILED");
    }
  };
  const version = /^git version (\d+)\.(\d+)\./.exec(invoke(["--version"]));
  // Older versions interpret core.fsmonitor=false as a hook pathname.
  if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 36)) {
    throw Error("VERIFIER_GIT_VERSION_UNSUPPORTED");
  }
  // Reading config names is a built-in, non-executing query. Follow includes
  // and worktree configuration so a hidden clean/process filter is rejected.
  // A concurrent config rewrite remains outside this helper's trust boundary.
  const keys = invoke([...configOverrides, "config", "--includes", "--null", "--name-only", "--list"])
    .split("\0").filter(Boolean);
  if (keys.some(key => /^(?:filter\.|hook\.|diff\.external$|diff\..*\.(?:command|textconv)$)/i.test(key))) {
    throw Error("VERIFIER_GIT_EXECUTION_CONFIG_UNSAFE");
  }
  if (args[0] === "status") {
    // Do not recurse into another repository's callbacks, but also never hide
    // its changed contents by treating --ignore-submodules as verification.
    const entries = invoke([...configOverrides, "ls-files", "--stage", "-z"]);
    if (entries.split("\0").some(entry => entry.startsWith("160000 "))) {
      throw Error("VERIFIER_GIT_SUBMODULE_UNSUPPORTED");
    }
  }
  const query = args[0] === "status" ? [...args, "--ignore-submodules=all"] : args;
  const output = invoke([...configOverrides, ...query]);
  // NUL-delimited inventories contain literal paths, including whitespace.
  return args[0] === "ls-files" ? output : output.trim();
}

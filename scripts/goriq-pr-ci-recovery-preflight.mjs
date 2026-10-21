// Dependency-free so trusted Actions control can use this policy on Node 20.
const PROTECTED_PREFIXES = [
  ".github/",
  "src/app/api/owner-login/",
  "src/app/api/owner-logout/",
  "src/app/api/vercel-owner/",
  "migrations/",
];

const PROTECTED_FILES = new Set([
  "AGENTS.md",
  "PROJECT_STATE.md",
  "docs/JARVIS_PRODUCT_SPEC.md",
  "docs/jarvis-requirements.json",
  "docs/jarvis-owner-decisions.json",
  "docs/jarvis-reverse-traceability.json",
  "docs/jarvis-additional-requirements.json",
  "package.json",
  "pnpm-lock.yaml",
]);

export function isTestPath(path) {
  return path.startsWith("tests/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

const PROTECTED_PATH_PATTERN = /(?:^|[-_./])(?:auth|security|secret|credential|permission|billing|payment|enroll(?:ment)?|migration|token)(?:[-_./]|$)/i;

function isProtectedRepairPath(path) {
  return PROTECTED_PATH_PATTERN.test(path);
}

export function allowedRepairPaths(prPaths) {
  return [...new Set(prPaths)]
    .filter((path) => !PROTECTED_FILES.has(path))
    .filter((path) => !PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !isTestPath(path))
    .filter((path) => !isProtectedRepairPath(path))
    .sort();
}

export function isSameRepositoryOpenPullRequest(pr, repository) {
  return pr?.state === "open"
    && pr.head?.repo?.full_name === repository
    && pr.base?.repo?.full_name === repository
    && typeof pr.head?.ref === "string" && pr.head.ref.length > 0
    && typeof pr.base?.ref === "string" && pr.base.ref.length > 0
    && pr.head.ref !== "main"
    && pr.head.ref !== pr.base.ref;
}

const SHA40 = /^[0-9a-f]{40}$/;

function matchesFailedHead(pr, repository, number, sha, branch) {
  return pr?.number === number
    && isSameRepositoryOpenPullRequest(pr, repository)
    && pr.head.sha === sha
    && (branch === undefined || pr.head.ref === branch);
}

async function repairableFiles(github, parameters) {
  const files = [];
  // Bound API work and fail visibly rather than accepting a truncated file list.
  for (let page = 1; page <= 30; page += 1) {
    const { data } = await github.rest.pulls.listFiles({ ...parameters, page, per_page: 100 });
    if (!Array.isArray(data) || data.length > 100) throw new Error("RECOVERY_FILE_LIST_INVALID");
    files.push(...data);
    if (data.length < 100) return files;
  }
  throw new Error("RECOVERY_FILE_LIST_LIMIT");
}

function existingRepairablePath(file) {
  if (typeof file?.filename !== "string" || !file.filename.trim() || file.status === "removed") return false;
  if (file.status === "renamed" && (
    typeof file.previous_filename !== "string" || !file.previous_filename.trim()
    || !allowedRepairPaths([file.previous_filename]).length
  )) return false;
  return allowedRepairPaths([file.filename]).length > 0;
}

export async function runRecoveryPreflight({ github, context, core, receipt }) {
  core.setOutput("eligible", "false");
  const reject = (reason, number) => {
    core.setOutput("reason", reason);
    core.notice(`Skipping stale or ineligible PR${number ? ` #${number}` : ""}; reason=${reason}.`);
    return { eligible: false, reason };
  };
  const run = context.payload.workflow_run;
  const linked = run?.pull_requests;
  const number = Array.isArray(linked) && linked.length === 1 ? linked[0]?.number : undefined;
  if (run?.conclusion !== "failure" || run.event !== "pull_request"
    || !Number.isSafeInteger(number) || number < 1 || !SHA40.test(run.head_sha ?? "")) {
    return reject("INELIGIBLE_FAILED_PR_EVENT");
  }
  if (receipt && (receipt.number !== number || receipt.headSha !== run.head_sha
    || typeof receipt.branch !== "string" || !receipt.branch.trim())) {
    return reject("INVALID_RECOVERY_RECEIPT", number);
  }
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const parameters = { owner: context.repo.owner, repo: context.repo.repo, pull_number: number };
  const { data: pr } = await github.rest.pulls.get(parameters);
  if (!matchesFailedHead(pr, repository, number, run.head_sha, receipt?.branch)) {
    return reject("PR_HEAD_MOVED_OR_INELIGIBLE", number);
  }
  const files = await repairableFiles(github, parameters);
  if (Number.isSafeInteger(pr.changed_files) && pr.changed_files > files.length) {
    throw new Error("RECOVERY_FILE_LIST_INCOMPLETE");
  }
  if (!files.some(existingRepairablePath)) return reject("NO_AUTONOMOUS_REPAIR_PATHS", number);
  // The PR may have moved while its file pages were being read.
  const { data: current } = await github.rest.pulls.get(parameters);
  if (!matchesFailedHead(current, repository, number, run.head_sha, pr.head.ref)) {
    return reject("PR_HEAD_MOVED_OR_INELIGIBLE", number);
  }
  core.setOutput("number", String(number));
  core.setOutput("branch", pr.head.ref);
  core.setOutput("head_sha", run.head_sha);
  core.setOutput("reason", "ELIGIBLE_CURRENT_HEAD");
  core.setOutput("eligible", "true");
  return { eligible: true, number, headSha: run.head_sha, branch: pr.head.ref };
}

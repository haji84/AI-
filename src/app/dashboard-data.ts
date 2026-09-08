export type DeadlineTone = "overdue" | "soon" | "normal" | "unset";

export interface DashboardTask {
  id: number;
  title: string;
  url: string;
  updatedAt: string;
  labels: string[];
  deadline: string | null;
  deadlineLabel: string;
  deadlineTone: DeadlineTone;
  progress: number | null;
}

export interface DashboardHistoryItem {
  id: number;
  title: string;
  url: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

export interface DashboardProject {
  name: string;
  detail: string;
  url: string;
  status: string;
}

export interface ControlCenterData {
  currentTask: DashboardTask | null;
  tasks: DashboardTask[];
  history: DashboardHistoryItem[];
  projects: DashboardProject[];
  warnings: string[];
}

const REPOSITORY = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
const API = `https://api.github.com/repos/${REPOSITORY}`;

function headers(useToken = true): HeadersInit {
  const token = process.env.AI_COMPANY_GITHUB_TOKEN?.trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(url: string): Promise<T | null> {
  for (const useToken of [true, false]) {
    try {
      const response = await fetch(url, { headers: headers(useToken), cache: "no-store" });
      if (response.ok) return await response.json() as T;
      if (useToken && (response.status === 403 || response.status === 404)) continue;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseDeadline(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(/(?:期限|締切|due)\s*[:：]?\s*(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/i);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function deadlineMeta(deadline: string | null): Pick<DashboardTask, "deadlineLabel" | "deadlineTone"> {
  if (!deadline) return { deadlineLabel: "期限未設定", deadlineTone: "unset" };
  const end = new Date(`${deadline}T23:59:59+09:00`).getTime();
  const diffDays = Math.ceil((end - Date.now()) / 86_400_000);
  if (diffDays < 0) return { deadlineLabel: `期限超過 ${Math.abs(diffDays)}日`, deadlineTone: "overdue" };
  if (diffDays === 0) return { deadlineLabel: "今日まで", deadlineTone: "soon" };
  if (diffDays <= 3) return { deadlineLabel: `あと${diffDays}日`, deadlineTone: "soon" };
  return { deadlineLabel: deadline, deadlineTone: "normal" };
}

function parseProgress(body: string | null): number | null {
  if (!body) return null;
  const match = body.match(/(?:進捗|progress)\s*[:：]?\s*(\d{1,3})\s*%/i);
  if (!match) return null;
  return Math.min(100, Math.max(0, Number(match[1])));
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  body: string | null;
  state?: string;
  pull_request?: unknown;
  labels?: Array<{ name?: string } | string>;
}

interface WorkflowRunsResponse {
  workflow_runs?: Array<{
    id: number;
    name: string;
    display_title?: string;
    html_url: string;
    status: string;
    conclusion: string | null;
    created_at: string;
  }>;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
}

function issueLabels(issue: GitHubIssue): string[] {
  return (issue.labels ?? []).map((item) => typeof item === "string" ? item : item.name ?? "").filter(Boolean);
}

function isSystemControlIssue(issue: GitHubIssue): boolean {
  const title = issue.title.trim();
  return /^\[VERCEL_PREVIEW\]/i.test(title)
    || /^smoke\s*:/i.test(title)
    || /^control\s*:/i.test(title);
}

function activeIssueFromProjectState(file: GitHubContentResponse | null): number | null {
  if (!file?.content || file.encoding !== "base64") return null;
  try {
    const text = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
    const line = text.match(/^ACTIVE_ISSUES:\s*(.+)$/m)?.[1];
    const issue = line?.match(/#(\d+)/)?.[1];
    return issue ? Number(issue) : null;
  } catch {
    return null;
  }
}

function toDashboardTask(issue: GitHubIssue): DashboardTask {
  const deadline = parseDeadline(issue.body);
  return {
    id: issue.number,
    title: issue.title,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    labels: issueLabels(issue),
    deadline,
    ...deadlineMeta(deadline),
    progress: parseProgress(issue.body),
  };
}

export async function readControlCenterData(): Promise<ControlCenterData> {
  const [issues, runs, projectState] = await Promise.all([
    githubJson<GitHubIssue[]>(`${API}/issues?state=open&sort=updated&direction=desc&per_page=20`),
    githubJson<WorkflowRunsResponse>(`${API}/actions/runs?per_page=12`),
    githubJson<GitHubContentResponse>(`${API}/contents/PROJECT_STATE.md`),
  ]);

  const activeIssue = activeIssueFromProjectState(projectState);
  const activeIssueData = activeIssue === null ? null : await githubJson<GitHubIssue>(`${API}/issues/${activeIssue}`);
  const activeTask = activeIssueData
    && activeIssueData.state === "open"
    && !activeIssueData.pull_request
    && !isSystemControlIssue(activeIssueData)
    ? toDashboardTask(activeIssueData)
    : null;

  const taskMap = new Map<number, DashboardTask>();
  for (const issue of issues ?? []) {
    if (!issue.pull_request && !isSystemControlIssue(issue)) taskMap.set(issue.number, toDashboardTask(issue));
  }
  if (activeTask) taskMap.set(activeTask.id, activeTask);

  const tasks = [...taskMap.values()].sort((a, b) => {
    if (activeTask) {
      if (a.id === activeTask.id && b.id !== activeTask.id) return -1;
      if (b.id === activeTask.id && a.id !== activeTask.id) return 1;
    }
    const weight = (tone: DeadlineTone) => tone === "overdue" ? 0 : tone === "soon" ? 1 : tone === "normal" ? 2 : 3;
    return weight(a.deadlineTone) - weight(b.deadlineTone) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  const history = (runs?.workflow_runs ?? []).map((run) => ({
    id: run.id,
    title: run.display_title || run.name,
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
  }));

  const warnings: string[] = [];
  const failed = history.filter((item) => item.conclusion === "failure").length;
  const overdue = tasks.filter((task) => task.deadlineTone === "overdue").length;
  const soon = tasks.filter((task) => task.deadlineTone === "soon").length;
  if (failed > 0) warnings.push(`直近の自動処理で失敗が${failed}件あります`);
  if (overdue > 0) warnings.push(`期限超過タスクが${overdue}件あります`);
  if (soon > 0) warnings.push(`期限が近いタスクが${soon}件あります`);
  if (!issues) warnings.push("GitHubタスク一覧を取得できませんでした");
  if (activeIssue !== null && !activeTask) warnings.push(`PROJECT_STATEの現在タスク #${activeIssue} を取得できませんでした`);

  return {
    currentTask: activeTask ?? tasks[0] ?? null,
    tasks,
    history,
    projects: [
      {
        name: "AI会社 / Creator Studio",
        detail: "AI社員の自律運用・Creator Studio開発",
        url: `https://github.com/${REPOSITORY}`,
        status: "開発中",
      },
      {
        name: "ハブAI",
        detail: "ハブ出現予測・探索ルート最適化",
        url: "https://github.com/haji84/habuAI",
        status: "開発中",
      },
    ],
    warnings,
  };
}

export const employeeRoster = [
  "Governor",
  "Project Manager",
  "Developer",
  "Reviewer",
  "QA",
  "Release Manager",
  "Researcher",
  "Designer",
  "Security",
  "Data Analyst",
  "UX",
];

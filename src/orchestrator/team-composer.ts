export type EmployeeRole =
  | "Governor"
  | "PM"
  | "Researcher"
  | "Architect"
  | "Frontend"
  | "Backend"
  | "Media"
  | "QA"
  | "Reviewer"
  | "Debugger"
  | "Release Manager"
  | "UX Designer"
  | "Marketing"
  | "Sales"
  | "Accounting / Finance"
  | "Legal"
  | "Advertising"
  | "Video Editor"
  | "Integration Engineer"
  | "Data Engineer / Analyst"
  | "Security Engineer"
  | "DevOps / SRE"
  | "Knowledge Manager";

export type TeamMemberSelection = {
  role: EmployeeRole;
  score: number;
  reasons: string[];
};

export type TeamComposition = {
  lead: EmployeeRole;
  members: TeamMemberSelection[];
  codeChangeLikely: boolean;
  humanGateSignals: string[];
};

type Rule = {
  role: EmployeeRole;
  patterns: RegExp[];
  weight?: number;
};

const SPECIALIST_RULES: Rule[] = [
  { role: "Frontend", patterns: [/\b(frontend|react|next\.?js|ui component|web ui|css|tsx)\b/i] },
  { role: "Backend", patterns: [/\b(backend|api|endpoint|service|server|job|storage|database|db|provider)\b/i] },
  { role: "Architect", patterns: [/\b(architecture|architect|system design|design contract|module boundary|data model)\b/i] },
  { role: "UX Designer", patterns: [/\b(ux|user experience|wireframe|usability|interaction design|screen flow)\b/i] },
  { role: "Researcher", patterns: [/\b(research|investigate|compare|evaluate|survey|literature|evidence)\b/i] },
  { role: "Media", patterns: [/\b(image generation|image edit|comfyui|flux|qwen-image|media generation)\b/i] },
  { role: "Video Editor", patterns: [/\b(video edit|video editing|timeline|cut|transition|subtitle|caption|color grading|audio sync)\b/i, /動画(編集|制作|カット|字幕|音ハメ)/i], weight: 3 },
  { role: "Integration Engineer", patterns: [/\b(integration|connector|mcp|webhook|oauth|third[- ]party|external api|gmail|calendar)\b/i] },
  { role: "Data Engineer / Analyst", patterns: [/\b(data pipeline|etl|csv|excel|spreadsheet|analytics|analysis|dataset|data quality|statistics|sql)\b/i] },
  { role: "Security Engineer", patterns: [/\b(security|secret|credential|permission|authorization|authentication|vulnerability|threat|token|least privilege)\b/i], weight: 3 },
  { role: "DevOps / SRE", patterns: [/\b(devops|sre|ci\/cd|github actions|workflow|runtime|deployment|deploy|monitoring|uptime|incident|infrastructure)\b/i] },
  { role: "Knowledge Manager", patterns: [/\b(documentation|knowledge base|runbook|decision log|adr|project memory|knowledge management)\b/i] },
  { role: "Marketing", patterns: [/\b(marketing|market research|positioning|go[- ]to[- ]market|audience|campaign strategy|brand strategy)\b/i, /マーケティング|市場調査|市場分析/i] },
  { role: "Sales", patterns: [/\b(sales|lead generation|prospect|pipeline|crm|proposal|customer outreach|deal)\b/i, /営業|商談|見込み客/i] },
  { role: "Accounting / Finance", patterns: [/\b(accounting|finance|bookkeeping|invoice|expense|budget|cash flow|reconciliation|p&l|profit and loss)\b/i, /経理|会計|請求|予算|収支/i] },
  { role: "Legal", patterns: [/\b(legal|contract|terms|privacy policy|license|compliance|regulation|law|copyright)\b/i, /法務|契約|規約|法令|著作権/i], weight: 3 },
  { role: "Advertising", patterns: [/\b(advertising|paid ads|ad creative|ad copy|cpc|cpa|roas|media buying|google ads|meta ads)\b/i, /広告|広告運用|広告文/i] },
  { role: "Debugger", patterns: [/\b(debug|bug|fix failure|failing test|error|exception|broken|ci failure)\b/i] },
  { role: "Release Manager", patterns: [/\b(release|release readiness|version|changelog|publish package)\b/i] },
];

const CODE_CHANGE_PATTERNS = [
  /\b(implement|implementation|code|refactor|fix|feature|api|frontend|backend|tsx|typescript|javascript|test|workflow)\b/i,
  /実装|修正|コード|機能追加|テスト/i,
];

const QA_PATTERNS = [
  ...CODE_CHANGE_PATTERNS,
  /\b(data|dataset|csv|excel|spreadsheet|video|image|media|pipeline)\b/i,
  /データ|動画|画像/i,
];

const HUMAN_GATE_PATTERNS: Array<[string, RegExp]> = [
  ["permissions", /\b(permissions?|authorization|access control|least privilege)\b/i],
  ["secrets", /\b(secret|credential|api key|token)\b/i],
  ["billing", /\b(billing|payment|paid plan|purchase|charge)\b/i],
  ["deployment", /\b(deploy|deployment|production release)\b/i],
  ["destructive", /\b(delete|drop table|destroy|destructive|purge)\b/i],
  ["legal publication", /\b(publish terms|publish privacy policy|external publication)\b/i],
];

function matchedReasons(text: string, patterns: RegExp[]): string[] {
  const reasons: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) reasons.push(match[0]);
  }
  return [...new Set(reasons.map((value) => value.toLowerCase()))];
}

function isNegatedMatch(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 80), index);
  const clause = before.split(/[.!?;\n]/).at(-1) ?? before;
  return /\b(?:no|without)\s+(?:(?:new|any)\s+)?(?:[\w-]+\s+){0,3}$/i.test(clause)
    || /\b(?:do not|does not|must not|never)\s+(?:[\w-]+\s+){0,5}$/i.test(clause)
    || /(?:禁止|しない|なし)[^。！？\n]{0,40}$/.test(clause);
}

function hasAffirmativeGateSignal(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(scanner)) {
    if (match.index === undefined) continue;
    if (!isNegatedMatch(text, match.index)) return true;
  }
  return false;
}

export function composeTeamFromIssue(input: { title: string; body?: string | null }): TeamComposition {
  const text = `${input.title}\n${input.body ?? ""}`.trim();
  const selected = new Map<EmployeeRole, TeamMemberSelection>();

  selected.set("PM", { role: "PM", score: 1, reasons: ["coordinates scoped issue work"] });

  for (const rule of SPECIALIST_RULES) {
    const reasons = matchedReasons(text, rule.patterns);
    if (!reasons.length) continue;
    selected.set(rule.role, {
      role: rule.role,
      score: reasons.length * (rule.weight ?? 2),
      reasons,
    });
  }

  if (selected.has("Video Editor")) selected.delete("Media");

  const codeChangeLikely = CODE_CHANGE_PATTERNS.some((pattern) => pattern.test(text));
  const qaNeeded = QA_PATTERNS.some((pattern) => pattern.test(text));

  if (qaNeeded && !selected.has("QA")) {
    selected.set("QA", { role: "QA", score: 1, reasons: ["change requires verification"] });
  }
  if (codeChangeLikely && !selected.has("Reviewer")) {
    selected.set("Reviewer", { role: "Reviewer", score: 1, reasons: ["code-changing work requires independent review"] });
  }

  const humanGateSignals = HUMAN_GATE_PATTERNS
    .filter(([, pattern]) => hasAffirmativeGateSignal(text, pattern))
    .map(([signal]) => signal);

  if (humanGateSignals.length) {
    selected.set("Governor", {
      role: "Governor",
      score: 4,
      reasons: humanGateSignals.map((signal) => `human-gate signal: ${signal}`),
    });
  }

  const members = [...selected.values()].sort((a, b) => {
    if (a.role === "PM") return -1;
    if (b.role === "PM") return 1;
    return b.score - a.score || a.role.localeCompare(b.role);
  });

  const leadCandidates = members.filter((member) => !["PM", "QA", "Reviewer", "Governor", "Release Manager"].includes(member.role));
  const lead = (leadCandidates.sort((a, b) => b.score - a.score || a.role.localeCompare(b.role))[0]?.role ?? "PM") as EmployeeRole;

  return { lead, members, codeChangeLikely, humanGateSignals };
}

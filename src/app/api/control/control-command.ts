export type ControlAction = "run" | "resume" | "pause" | "status" | "test" | "preview";

export function commandFor(action: ControlAction) {
  switch (action) {
    case "run":
      return { source: "chat", command: "次の安全な作業を進める", plan: { kind: "run", description: "Dashboard quick control: advance the next bounded safe action." } };
    case "resume":
      return { source: "chat", command: "停止中の作業を再開する", plan: { kind: "resume", description: "Dashboard quick control: resume bounded autonomous work." } };
    case "pause":
      return { source: "chat", command: "AI社員の自律作業を一時停止する", plan: { kind: "pause", description: "Dashboard quick control: pause autonomous work safely." } };
    case "status":
      return { source: "chat", command: "現在の状態だけ確認する", plan: { kind: "status", description: "Dashboard quick control: refresh current state without mutation." } };
    case "test":
      return { source: "chat", command: "安全な検証テストを実行する", plan: { kind: "inspect", description: "Dashboard quick control: run a bounded read-only verification." } };
    case "preview":
      return { source: "chat", command: "最新のダッシュボードPreviewを作成する", plan: { kind: "preview", description: "Dashboard quick control: request Preview-only deployment. Production is not authorized." } };
  }
}

import { boundedText } from "./requirements-proxy.ts";
type BrokerFetch = (path: string, init?: RequestInit) => Promise<Response>;
export function createCognitiveProxy(owner: () => Promise<boolean>, broker: BrokerFetch) {
  const denied = () => Response.json({ message: "オーナー認証が必要です" }, { status: 401 });
  const relay = async (init?: RequestInit) => {
    try {
      const response = await broker("/api/jarvis/admin/cognitive", { ...init, signal: AbortSignal.timeout(100_000) });
      return Response.json(JSON.parse(await boundedText(response.body, 64_000)), { status: response.status });
    } catch { return Response.json({ message: "処理状態を確認してください。自動では再送しません。" }, { status: 503 }); }
  };
  return {
    async GET() { if (!await owner()) return denied(); return relay({ method: "GET" }); },
    async POST(request: Request) {
      if (!await owner()) return denied();
      let payload;
      try {
        payload = JSON.parse(await boundedText(request.body, 512));
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(k => k !== "goalId") ||
            typeof payload.goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(payload.goalId)) throw Error("Invalid Goal ID");
      } catch { return Response.json({ message: "入力が不正または上限超過です" }, { status: 400 }); }
      return relay({ method: "POST", body: JSON.stringify({ goalId: payload.goalId }) });
    },
  };
}

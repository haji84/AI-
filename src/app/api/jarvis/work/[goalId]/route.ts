import { NextResponse } from "next/server";import { jarvisBrokerFetch,requireJarvisOwner } from "../../broker.ts";
export async function GET(_request:Request,{params}:{params:Promise<{goalId:string}>}){if(!(await requireJarvisOwner()))return NextResponse.json({message:"オーナー認証が必要です"},{status:401});const{goalId}=await params;if(!goalId)return NextResponse.json({message:"Goal IDが必要です"},{status:400});try{const response=await jarvisBrokerFetch(`/api/jarvis/admin/work/${encodeURIComponent(goalId)}`);const body=await response.json().catch(()=>({message:"JARVISから不正な応答を受信しました"}));return NextResponse.json(body,{status:response.status})}catch(error){return NextResponse.json({message:"JARVIS Runtimeに接続できません",detail:error instanceof Error?error.message:"unknown error"},{status:503})}}

export async function POST(request: Request, { params }: { params: Promise<{ goalId: string }> }) {
  if (!(await requireJarvisOwner())) return NextResponse.json({ message: 'オーナー認証が必要です' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ message: '同じ画面からの操作が必要です' }, { status: 403 });
  const { goalId } = await params;
  const raw = await request.text();
  if (!goalId || raw.length > 8192) return NextResponse.json({ message: '通知の表示情報が不正です' }, { status: 400 });
  try {
    const payload = JSON.parse(raw);
    if (!payload || Object.keys(payload).sort().join(',') !== 'cycleId,notificationIds') return NextResponse.json({ message: '表示通知のIDだけを指定してください' }, { status: 400 });
    const response = await jarvisBrokerFetch(`/api/jarvis/admin/work/${encodeURIComponent(goalId)}`, { method: 'POST', body: JSON.stringify(payload) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch { return NextResponse.json({ message: '通知の表示記録を保存できませんでした' }, { status: 503 }); }
}

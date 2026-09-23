"use client";
import { useEffect, useState } from "react";
type Stats = { registered:number;ready:number;offline:number;running:number;queued:number;completed:number;needsHuman:number };
export default function PersonalLiveSummary() {
  const [stats,setStats]=useState<Stats|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    let done=false;
    const controller=new AbortController();
    let refreshing=false;
    async function refresh(){
      if(refreshing || done)return;
      refreshing=true;
      try {
        const response=await fetch("/api/jarvis/state",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
        const body=await response.json() as {stats?:Stats};
        if(!response.ok || !body.stats)throw new Error(response.status===401?"状態を見るにはオーナー認証が必要です。":"端末・タスクの状態を取得できません。");
        if(!done){setStats(body.stats);setError("");}
      }catch(cause){if(!done){setStats(null);setError(cause instanceof Error?cause.message:"状態を取得できません。");}}finally{refreshing=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),10000);
    return ()=>{done=true;clearInterval(timer);controller.abort();};
  },[]);
  return <div className="personal-live-summary"><header><h2>端末・タスク</h2><a href="/jarvis/devices">端末を操作する →</a></header>{error?<p role="status">{error}</p>:<div className="personal-metrics">
    {([["接続中",stats?.ready],["実行中",stats?.running],["確認待ち",stats?.needsHuman],["オフライン",stats?.offline]] as const).map(([label,value])=><div key={label}><span>{label}</span><strong>{Number.isFinite(value)?value:"—"}</strong></div>)}
  </div>}<a href="/jarvis/tasks">タスクの詳細を見る</a></div>;
}

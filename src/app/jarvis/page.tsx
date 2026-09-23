import JarvisConsole from "./JarvisConsole.tsx";
import JarvisWorkShell from "./JarvisWorkShell.tsx";
import OwnerLogin from "./OwnerLogin";
import RemoteConsoleDisclosure from "./RemoteConsoleDisclosure";
import GoriqIcon, { type GoriqIconName } from "./GoriqIcon";
import { requireJarvisOwner } from "../api/jarvis/broker.ts";
export const dynamic = "force-dynamic";
const tools: {href:string; label:string; icon:GoriqIconName}[] = [
  {href:"/jarvis/enroll",label:"端末を追加",icon:"plus"},
  {href:"/jarvis/teach",label:"操作を教える",icon:"learn"},
  {href:"/jarvis/recordings",label:"画面の記録",icon:"record"},
  {href:"/jarvis/mobile",label:"スマホ操作パネル",icon:"devices"},
  {href:"/jarvis/diagnostics",label:"接続を診断",icon:"shield"},
  {href:"/jarvis/recovery",label:"復旧状況",icon:"recovery"},
  {href:"/jarvis/setup",label:"初回セットアップ",icon:"settings"},
  {href:"/jarvis/qa",label:"URLの順番実行",icon:"tasks"},
];
export default async function JarvisPage() {
  if (!await requireJarvisOwner()) return <main className="dashboard-shell"><OwnerLogin /></main>;
  return <div className="dashboard-shell goriq-home">
    <JarvisWorkShell />
    <details className="goriq-more-tools"><summary><GoriqIcon name="grid" /><span>その他のツール</span><span className="goriq-more-count">{tools.length}</span></summary>
      <nav aria-label="便利なツール">{tools.map(item=><a key={item.href} href={item.href}><GoriqIcon name={item.icon} /><span>{item.label}</span><GoriqIcon name="arrow" /></a>)}</nav>
    </details>
    <RemoteConsoleDisclosure><JarvisConsole /></RemoteConsoleDisclosure>
  </div>;
}

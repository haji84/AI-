const routineFlows = [
  {
    title: "いまの状態を確認",
    href: "/jarvis",
    description: "Homeで全体の状態と次に見るべき情報を確認する。",
  },
  {
    title: "タスクを確認",
    href: "/jarvis/tasks",
    description: "Tasksで進行中・待機中のタスクを確認する。Human Gateが出た場合は解除せず、その理由を確認する。",
  },
  {
    title: "端末を確認",
    href: "/jarvis/devices",
    description: "Devicesで接続状態を確認し、既存のRemote Assist入口を使う。再登録や権限変更は日常操作として扱わない。",
  },
  {
    title: "異常を切り分ける",
    href: "/jarvis/diagnostics",
    description: "Diagnosticsでready / blocked / pending / unknownを確認する。unknownを正常扱いしない。",
  },
  {
    title: "復旧状況を確認",
    href: "/jarvis/recovery",
    description: "Recoveryでblockerとnext actionを読む。この画面は状態確認用で、復旧の強制実行やGate解除は行わない。",
  },
] as const;

export default function JarvisOperatorGuide() {
  return (
    <section className="panel jarvis-settings-card" aria-labelledby="jarvis-operator-guide-title">
      <div>
        <p className="eyebrow">OWNER GUIDE</p>
        <h2 id="jarvis-operator-guide-title">日常操作ガイド</h2>
        <p className="muted">
          普段の確認と操作はJARVIS画面内で完結する。開発者向けコマンドを使わず、必要な画面へ順番に進む。
        </p>
      </div>

      <ol>
        {routineFlows.map((flow) => (
          <li key={flow.href}>
            <a href={flow.href}>{flow.title}</a>
            <p className="muted">{flow.description}</p>
          </li>
        ))}
      </ol>

      <div>
        <h3>初回セットアップが必要なとき</h3>
        <p>
          <a href="/jarvis/setup">Setup</a>は初回構成や再確認が必要なときだけ使う。端末の再登録、権限・秘密情報・公開範囲の変更、実機受入はこのガイドから自動実行しない。
        </p>
      </div>

      <div>
        <h3>止めるべき表示</h3>
        <p>
          Human Gate、physical acceptance、blocked、unknownが表示された場合は、成功扱いにせず理由とnext actionを確認する。日常操作ガイドはGateを解除しない。
        </p>
      </div>
    </section>
  );
}

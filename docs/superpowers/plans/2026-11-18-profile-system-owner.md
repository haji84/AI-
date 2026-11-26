# Profile SYSTEM owner implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session.

**Goal:** 承認済みのprofile本体だけにSYSTEM所有を認め、実機で再評価する。
**Architecture:** handle由来の正確なprofileスコープを中央Securityで判定し、
observer/closed validatorも同じ限定規則に揃える。
**Tech Stack:** C#5、PowerShell5、既存Node/Windows/独立CI。
**Spec:** `docs/superpowers/specs/2026-11-18-profile-system-owner-design.md`

## Global constraints

- 承認済みproposalの範囲のみ。SYSTEMはprofile本体以外のprivate成功に使わない。
- Windows owner/ACL、秘密、権限、runtime、原本、Goalを変更しない。
- DACL/metadata/identity/時限/source pins/全4CI/保護を維持。原本Acquireを再実行しない。

## Review focus

- directory/reparse/final-path/profile正規化の不正でSYSTEM例外が成立しないこと。
- central Securityを直接呼ぶsnapshot/再検査でも同じ限定条件を使うこと。
- private子対象や別ownerへの権限拡大、DACL省略、runtime変更がないこと。
- observerとvalidatorのSYSTEM分類が一致し、偽の子対象成功を拒否すること。
- testsは純粋/所有するinert fixtureのみ。原本の取得やWindows権限変更をしないこと。

### Task 1: owner規則と回帰試験

- [ ] C#純粋判定/observer/closed JSONの正負試験を先に追加しREDを確認。
- [ ] Capture中央Securityのhandle scope、observerとvalidatorを最小変更。
- [ ] 依存source pinを更新し、関連/全体/lint/types/要求監査を実行。
- [ ] 1回のfresh review。重要な指摘は再現RED/GREENで修正。

### Task 2: 統合と実機の読み取り確認

- [ ] exact-source全4CI、独立署名/出力/source/image/cleanupを確認。
- [ ] 承認範囲・保護・reviewを再確認し、通常統合とexact-main全4CIを確認。
- [ ] 新しいowner-only診断を1回。実run/job/source/ZBook21/closed reportを照合。
- [ ] 実際の通過/次の拒否を記録。元Goalの復旧と混同しない。

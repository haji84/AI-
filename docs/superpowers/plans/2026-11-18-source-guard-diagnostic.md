# Source guard diagnostic plan

Spec: docs/superpowers/specs/2026-11-18-source-guard-diagnostic-design.md

1. 実機profile通過・source取得拒否・固定DB存在の証拠を保持する。
2. 実C#5の例外型と実PSadapter/workflowによるRED試験を作る。
3. source-owned CLR例外だけを8固定codeへ射影し、未知fallback・25keys・全拒否を維持する。
4. GREEN/関連試験、fresh review、通常PRとsource全4CI・署名6項目。
5. 保護付き統合、exact-main全4CI・署名6項目、一度の診断付き固定読取り。
6. 実際の拒否理由で次の修正を選び、元Goal/HOLDと当初error解消を区別する。

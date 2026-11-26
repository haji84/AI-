# Source ACL metadata plan

Spec: docs/superpowers/specs/2026-11-18-source-acl-observation-design.md

1. 実機SOURCE_PRIVATE_DACL_UNVERIFIEDを保存し、固定metadata planを定義。
2. Native readerとPS strict envelopeを別agentでTDD実装、legacy policy不変。
3. rootがowner-only jobの2closed出力・fixtures・pinsを統合し、関連検証とfresh review。
4. 通常PR/source全4CI・署名6項目、保護付き統合/main全4CI・署名6項目。
5. 一度のmetadata-only実機観測で対象/owner/ACE class/mask/flagsを確認し、error解消へ継続。

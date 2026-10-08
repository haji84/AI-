# Bound worker persistence distribution to the requested node (#1745)

Date: 2026-10-08
Status: Candidate; separate owner governance approval required before merge.

Changing the canonical ZBook watchdog currently triggers GAI Worker Persistence on both PCs before main CI. Both installers contain task/launchd registration paths. That is broader than #1745's authorized repair of three ZBook files with existing task XML and permissions preserved.

Each job now checks authorization inline before checkout. It reuses #1724's current-main, successful exact-main CI, merged-PR, owner-created task Issue, completion-instruction and expiry contract without changing its grammar or workflow permissions. It additionally requires matching node metadata in both the PR and the owner Issue. A ZBook grant cannot activate the MacBook installer. Missing metadata, unavailable lookup, queued stale source, pending CI and expired authority fail visibly before mutation. Admission reserves 21 minutes, exceeding the existing 15-minute job timeout; the installer step checks expiry again.

The current #1745 PR intentionally supplies no installer grant: this change does not authorize task registration. Following protected merge and successful main CI, the separate native repair script checks its bounded receipt, actual native file view, exact observed baseline hashes and three Limited/Interactive tasks. It retains original bytes and task XML, replaces only the reviewed launcher/helper/watchdog files, then verifies byte hashes, ACLs and task XML. Publication is not physical recovery evidence. Scheduled watchdog recovery and the existing fault-run verifier must still be observed.

Ordinary repair is covered by the owner's existing completion instruction. This workflow changes production authorization enforcement and therefore requires the separate Human Gate in AGENTS.md. No approval has been inferred for that governance change. No credentials, permissions, workflow token scopes, accounts or network policy are changed. #1662's production ACL recurrence and no-repeat-removal boundary remain separate.

Tests execute both inline gates against allowed/denied metadata fixtures and run the Windows file replacement tests. These do not prove either machine recovered. If publication fails, retained original launcher/watchdog bytes are restored where possible and rollback failure is reported. Newly created helper and backup files remain for diagnosis. An authorization-gate defect must leave installation blocked; reverting to ungated automatic deployment is not an approved rollback.

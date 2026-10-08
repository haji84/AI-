# Preserve Smart App Control during ZBook recovery (#1745)

Date: 2026-10-08
Status: Preserve protection; investigate supported alternatives. Runner recovery remains blocked.

The owner asked whether recovery could proceed without disabling Smart App Control. Continue with protection enabled. The prior OFF proposal received no approval and is not the chosen next action.

Native watchdog file publication passed on main 7b3e8678. The remaining Runner failure is Windows application-control rejection 0x800711C7. Installed Runner.Listener DLL and EXE match the hash-verified official v2.337.0 ZIP. Replacing identical files has no demonstrated benefit. See [native evidence](../evidence/1745-native-watchdog-recovery.md) and its JSON receipt.

## Protection-preserving investigation

1. Look for a supported vendor-signed or Microsoft-reputation-accepted Runner release and diagnose the existing protection service's health. Do not promise that a cloud connectivity check fixes file reputation. Any vendor communication or binary submission is a separate external action, not implicitly authorized by this record.
2. Inspect the existing GORIQ Windows execution route independently of Actions Runner. The native Broker health endpoint is healthy on a49c458d; this does not prove an active native Windows task consumer. That bounded consumer is in open, unmerged PR1208 for issue1207, with existing-device identity and reboot acceptance still pending. Reconcile/review that work before a bounded physical canary; do not invent a second worker.
3. Keep the existing Runner-loss run37607612844 queued. Another execution route cannot fabricate Runner reconnection or satisfy its final Verifier. Coordinator, native Worker and network acceptance require their own correctly labeled evidence.

## Security boundary

The [Microsoft FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions) states that individual-app exceptions are unavailable. No registry edit, policy removal, new allow rule, trust-metadata bypass or protection downgrade is part of this plan. Do not change Defender antivirus, firewall, task principals, ACLs, credentials or runner registration.

A future proposal to turn Smart App Control Off would affect application execution protection across the device, not only Runner. AGENTS.md requires a separate Human Gate for "security weakening, protection/audit disabling". Existing task completion authority and PR1746 distribution-guard approval do not cover it. The owner has not granted it.

Preserve successful watchdog publication and retained backups. #1662 ACL recurrence remains separately blocked at its no-repeat-removal boundary. No deployment, security configuration, authorization receipt or runtime code change is included in this decision.

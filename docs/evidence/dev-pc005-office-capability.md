# DEV-PC-005 Office capability software evidence

Issue: #1173  
Parent: #681  
Implementation master: #882

## Requirement slice

Canonical `DEV-PC-005` requires an Office-class PC capability. Current main already contains bounded local real-file capabilities for OOXML Word (`.docx`) and Excel (`.xlsx`) artifacts. This slice adds requirement-level integration evidence that those capabilities compose through the shared Work Capability registry and preserve the same local-file safety boundary.

## Software evidence

The focused regression `tests/jarvis-dev-pc005-office-capability.test.ts` verifies:

- `LocalDocumentCapability` and `LocalSpreadsheetCapability` are both available in one `WorkCapabilityRegistry` over the same allowed local root;
- each remains low-risk, non-external-side-effect, local write/read capability;
- a real `.docx` and a real `.xlsx` are written, persisted, independently read back, and semantically compared with their requested document/workbook content;
- persisted SHA-256 output/evidence is stable across independent readback;
- identical repeat writes are idempotent;
- conflicting replacement remains fail-closed behind the existing approved-replacement policy;
- filesystem traversal outside the allowed root remains rejected;
- macro-enabled `.docm` / `.xlsm` and unsupported `.pptx` paths are not silently accepted by these capabilities.

The underlying OOXML adapters continue to reject unsupported active/embedded or external content according to their existing dedicated tests.

## Safety boundary

This evidence does **not** add Microsoft Office application automation, COM, AppleScript, arbitrary shell execution, Production WorkDispatcher wiring, or device runtime wiring. It does not change app versions, enrollment, secrets, credentials, permissions, firewall, billing, or Human Gates.

No PHYSICAL evidence is claimed. `DEV-PC-005` must remain PARTIAL until the required real-machine capability path is observed and independently verified on supported owner hardware.

## Verification required before merge

- repository guard
- lint
- full test suite
- P8 Security Regression Suite
- build
- production health
- PR current with main and mergeable
- no unresolved review threads

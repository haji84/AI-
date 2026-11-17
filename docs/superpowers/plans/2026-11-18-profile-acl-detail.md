# PROFILE ACL detail plan

Spec: `docs/superpowers/specs/2026-11-18-profile-acl-detail-design.md`
Execute inline using superpowers:executing-plans; one fresh whole-branch review.

## Constraints

- Existing capture policy and owner/ACL/identity/path/storage/deadlines remain.
- No OS ACL/owner change, secrets, privileges, service or original Acquire.
- No raw user/path/SID/SDDL/ACL output. No repeated unchanged generic probe.

## Review focus

- Principal detail must not turn OTHER into trusted Account or affect reducer acceptance.
- Classification preserves first refused ACE ordering, inherit-only skip and callback refusal.
- Masks distinguish nonwriting from writing/control/unknown bits without accepting either.
- Closed validator rejects inconsistent labels, forged success and raw data.
- Native classification is assigned before reduction and emitted only on DACL refusal.
- Existing workflow gates/defaults and limits remain; only2source pins change.

## Task1: diagnostic classification

1. Add C#5 executable pure classifier/closed validator tests; observe missing-feature RED.
2. Add closed classification, native metadata assignment, strict validation and2pins.
3. Run related, lint/types/requirements, fixed full and fresh review; fix important findings RED/GREEN.

## Task2: actual diagnosis and continued resolution

1. All4exact-source CI and signed6 audit; protected integration; all4exact-main CI/audit.
2. One new owner-only observation with classification, exact source/runner21/run/job binding.
3. Use actual rejected ACE class to prepare the minimal real fix; no unproved recovery claim.
4. Continue authorized work until this error is resolved or a concrete unavoidable Human Gate.

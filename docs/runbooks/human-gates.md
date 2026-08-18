# Human Approval Gates

Human approval is mandatory before:
- merge to main
- production deployment
- database migration execution or destructive schema change
- secrets/credential changes
- permission changes
- paid service activation or billing changes
- external publication
- data deletion
- breaking API changes
- unresolved security or license risk

Agents must stop with HUMAN_APPROVAL_REQUIRED and describe the exact requested action, impact, rollback and evidence.

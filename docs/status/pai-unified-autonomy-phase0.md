# PAI Unified Autonomy Phase 0

## Implemented
- Shared autonomy decision boundary
- Existing task-completion delegation reused
- Existing risk policy reused
- Critical-risk hard block preserved
- JARVIS adapter boundary added
- Unit tests added for decision and adapter contracts

## Remaining before merge
- Wire existing Commander/command ingress into the shared path
- Back the JARVIS adapter with the existing control plane/task queue
- Run repository CI and resolve regressions
- Confirm backward compatibility of existing direct device tasks

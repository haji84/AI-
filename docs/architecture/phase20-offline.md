# Phase 20 offline-first boundary

Offline capability classification, waiting-for-connectivity, local continuation, reconnect, sync/conflict handling and checkpoint resume remain responsibilities of the already-merged durable/offline runtime. Phase 20 persists the top-level run and does not reinterpret an offline waiting state as successful completion.

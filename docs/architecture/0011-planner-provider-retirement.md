# ADR 0011: Planner provider retirement handling

## Context

Mobile Autonomy run #8 reached the model-backed planner after repository issue access was fixed, then failed with HTTP 410 from the GitHub Models inference endpoint.

GitHub's current documentation states that GitHub Models was fully retired on 2026-07-30, including the inference API. The repository must not keep treating that endpoint as a reliable runtime dependency.

## Decision

1. Treat GitHub Models HTTP 410 as a permanent provider-retired condition, not a transient retryable failure.
2. Never crash the bounded autonomy workflow solely because the planner provider is retired or unavailable.
3. Return a bounded `inspect` plan describing the provider failure so the goal loop can stop or continue safely according to existing policy.
4. Keep the planner interface provider-neutral so a future supported provider can replace GitHub Models without changing the goal loop.
5. Do not add paid providers, API keys, billing, secrets, or new permissions in this change.

## Consequences

- Mobile Autonomy remains operational and observable even when the retired provider is called.
- Generic model-backed code generation remains unavailable until a supported provider is explicitly configured.
- Human Gate remains required before introducing credentials, billing, or new provider permissions.

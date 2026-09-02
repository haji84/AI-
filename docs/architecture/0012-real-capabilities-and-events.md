# ADR 0012: Real capabilities and event-driven autonomy

## Decision

The autonomy runtime integrates real information and action sources through bounded capability metadata and context adapters. Connectors are capabilities, not assumed ambient access.

Each managed capability declares:
- `access`: read or write
- `externalSideEffect`: whether execution changes an external system
- `risk`: low, medium, or high
- `requiresHumanApproval`: explicit Human Gate requirement

Read-only, low-risk capabilities may execute automatically. External writes, high-risk operations, irreversible actions, and explicitly approval-gated capabilities stop safely before the handler is invoked.

## Context sources

`RepositoryFileContextSource` reads a bounded allow-list of repository files. Missing files are returned as unavailable context instead of fabricated data.

`SafeConnectorContextSource` is the common adapter boundary for future Web, Gmail, Google Calendar, and other connectors. A connector must explicitly report availability. If unavailable, the runtime records `connector_unavailable` and continues safely.

Credentials are never stored in this architecture layer.

## Events

Supported event classes are:
- repository state changes
- scheduled runs
- explicit manual runs

`dispatchAutonomyEvent` records the received event in Compass, invokes the bounded goal runner with a hard cycle budget, then writes the terminal run summary back to Compass.

There is no silent infinite worker loop. Event sources trigger bounded runs.

## Human Gate

The Human Gate remains mandatory for merges, destructive changes, secrets, permissions, billing, deployment, public/external publication, high-risk capabilities, and external writes unless a future approved policy explicitly narrows that gate.

## Extension path

A future GitHub/Web/Mail/Calendar adapter implements the connector or managed-capability interface and supplies real authorization outside the repository. Missing authorization must degrade to unavailable capability/context, never simulated access.

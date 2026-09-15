# Phase 20 readiness evidence semantics

The runtime reports these booleans independently:

- `implementationComplete`: the Phase 20 coordinator exists and its automated repository checks can validate the implementation.
- `realMultiDeviceE2E`: true only when explicit real-device multi-device evidence is supplied.
- `realIPhoneE2E`: true only when explicit real-iPhone evidence is supplied.
- `longDurationRun`: true only when explicit soak/long-run evidence is supplied.
- `productionReady`: conjunction of all required real-world evidence fields after implementation completion.

Callers must not populate real-world evidence from GitHub Actions, mocks, contract tests, simulated adapters, or inferred historical success.

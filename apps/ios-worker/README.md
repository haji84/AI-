# JARVIS iOS Worker

Physical iPhone Worker app for GAI final validation. Simulator/CI output is never physical-device evidence.

## Generate the Xcode project

On the MacBook, install XcodeGen if it is not already available, then:

```bash
cd apps/ios-worker
xcodegen generate
open JarvisIOSWorker.xcodeproj
```

In Xcode select the `JarvisIOSWorker` target, choose the Apple Development Team, connect the physical iPhone, select it as the run destination, then Build & Run.

## Enroll

The app requires three values supplied by the trusted bridge/operator:

- Bridge URL: HTTPS base URL for the physical-iPhone transport endpoint.
- Device ID: defaults to the device vendor identifier and may be replaced with the enrollment-issued ID.
- Enrollment token: bounded/revocable secret for this physical Worker. Do not commit it.

Tap **Enroll & Start**. The app advertises only `ios-tooling` and `local-storage` for the initial E2E.

## Transport contract

The bridge endpoint must expose:

- `POST /enroll`
- `GET /tasks/next?deviceId=...` returning 204 or a signed task envelope
- `POST /results` accepting the signed result envelope

The task/result fields match `src/gai/iphone-worker-bridge.ts`. Tasks are HMAC-SHA256 verified before execution and are bound to device ID, task ID, nonce, TTL, and enrolled capabilities.

## Initial physical E2E

Use a bounded `ios-tooling` task with no destructive, publication, credential, permission, purchase, or other Human Gate action. Expected flow:

1. physical iPhone enrolls;
2. signed task is received;
3. signature, binding, expiry, and capability are verified on-device;
4. task executes on the physical iPhone;
5. signed result is returned;
6. server bridge verifies the result;
7. evidence records the exact main SHA and physical-device run.

Do not mark iPhone E2E PASS until steps 1-7 are captured from a real iPhone.
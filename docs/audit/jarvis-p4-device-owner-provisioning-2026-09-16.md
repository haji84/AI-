# JARVIS P4 Device Owner QR provisioning evidence — 2026-09-16

Parent: #681
Child: #752

## Scope

This record covers the existing software path for fresh/reset Android managed provisioning and the security boundary around it. It contributes CODE/UNIT-style evidence for `FLEET-005` and `DEV-A-015` only.

It does **not** claim that Device Owner provisioning has succeeded on a physical handset, that every Android setup wizard accepts the payload, or that locked personal devices can be silently unlocked.

## Existing implementation

`scripts/jarvis-broker.ts` constructs the managed-provisioning payload with:

- `android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME` = `ai.jarvis.worker/.JarvisDeviceAdminReceiver`
- `android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION` bound to the current Worker APK URL
- `android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM` bound to the current Worker APK SHA-256 checksum
- `android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE` containing the JARVIS Broker URL and the bounded enrollment token required by the provisioned Worker

The same owner-authenticated admin enrollment request returns the JSON provisioning object and, when `qrencode` is available, its QR PNG representation. The general fixed `/enroll` route remains the existing-device one-tap path and does not expose this Device Owner payload.

## Security boundary

The provisioning object is constructed only inside the `/api/jarvis/admin/` branch after `requireOwner(request)` succeeds. The public/fixed enrollment route does not return the managed-provisioning payload.

The package checksum binds managed provisioning to the exact Worker APK content served by the Broker instead of accepting an unpinned package download.

Device Owner provisioning does not authorize bypassing a user's personal lock screen. Existing personal-device policy keeps `requireHumanForLockedDevice` true; credentials/PINs are not made a fleet secret by this evidence task.

## Physical / platform boundary

Android managed provisioning is setup-state and vendor dependent. A real fresh/reset handset must still prove that its setup wizard accepts the QR, installs the checksum-matched Worker, grants Device Owner state as intended, enrolls a signed identity and reconnects normally. Until that happens, `FLEET-005` and `DEV-A-015` remain PHYSICAL-gated and must not be promoted to VERIFIED solely from this audit.

Safe fallback for an already configured/personal Android is the bounded existing-device one-tap enrollment path plus Human Takeover for lock/permission boundaries. JARVIS must not store or auto-type a user's lock credential as a workaround.

## Verification contract

`tests/jarvis-device-owner-provisioning-contract.test.ts` pins the current source boundary so later changes fail CI if the Device Admin component, APK location/checksum, admin extras or owner-authenticated route placement disappear.

# JARVIS ADB Mass Enrollment

JARVIS can register up to 100 owner-authorized Android devices with one repeated physical action: connect the device by USB and approve the Android USB debugging prompt once.

## Automatic flow

1. `com.aicompany.jarvis-adb-enrollment` runs every 5 seconds on the Mac.
2. A newly authorized USB ADB device is detected.
3. JARVIS assigns the next stable device number (`001` through `100`) and stores it in `~/Library/Application Support/JARVIS/adb-fleet.json`.
4. Model, manufacturer, Android version, USB serial, IP address and ADB target are recorded.
5. When the device has a private IPv4 address, JARVIS switches ADB to TCP port 5555 and verifies the wireless ADB target before using it.
6. `JARVIS_REMOTE_ALLOWED_SERIALS` is regenerated from the private fleet registry.
7. The Remote Gateway is restarted so the newly authorized device is immediately usable.
8. The normal JARVIS reconciler refreshes Remote Gateway health and public HTTPS ingress.

Reconnecting a previously registered USB serial keeps its original device number.

## Human action

Android requires the owner to approve the computer's ADB key on each device at least once. JARVIS does not bypass that Android security boundary. After that first approval, registration and numbering are automatic.

## Network safety

Wireless ADB is enabled only when JARVIS detects a private or link-local IPv4 address. Raw ADB must not be exposed directly to the public Internet. The iPhone/Mac control path remains JARVIS HTTPS dashboard -> authenticated Remote Gateway -> ADB.

For stable long-running wireless operation, keep the fleet on an owner-controlled private network and use stable DHCP leases/reservations. If a device's private IP changes, reconnect it by USB once so JARVIS can refresh its target automatically.

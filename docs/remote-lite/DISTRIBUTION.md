# Remote Lite Windows MSI candidate

Issue1831 / PR1832. **Unsigned candidate, not approved for friend distribution.**
Public service, physical/mobile acceptance and final signing remain open.

## Package boundary

The standard Windows Installer package installs only the manual host EXE and the
Go redistribution notice under the current user's
`%LOCALAPPDATA%\Programs\GORIQ Remote Lite`, with a current-user Start menu
shortcut. It uses perUser/limited installation scope and rejects ALLUSERS
machine-scope overrides before costing/install actions. Context-aware MSI
folder/registry rows resolve to the current user's Programs/HKCU locations;
the package does not opt into dual-purpose installation. It uses
standard MSI actions. It does not add a service, scheduled task, autorun,
firewall rule, public listener, credential, URL handler or executable custom
action. Installation does not start the host or grant screen/input consent.

Device registration remains in the separate
`%LOCALAPPDATA%\GORIQ Remote Lite` directory. Repair/upgrade/uninstall must retain
that directory and foreign user files. Empty installer directories can be
removed; no recursive/wildcard data removal is authored. Restart Manager app
shutdown is disabled and reboots are suppressed. Updating a running host has
not yet been accepted; the user must close it before an update.

Each canonical three-part version has a stable ProductCode. A same-version
rebuild cannot register a second product over the same files. Changed content
must receive a new version; distribute one immutable, reviewed and signed
artifact for that version. Rebuilding the same version is not an update path.

## Build and verification

Developer tools: PowerShell7, Go1.23+ and portable WiX3.14.1 from its
[official release](https://github.com/wixtoolset/wix3/releases/tag/wix3141rtm).
The CI download is pinned to SHA256
`6AC824E1642D6F7277D0ED7EA09411A508F6116BA6FAE0AA5F2C7DAA2FF43D31`.
No WiX runtime/custom-action DLL is shipped in the MSI. Tools run from a private
build directory; no local tool installation, elevation or paid activation.

```powershell
./scripts/remote-lite-build-windows-installer.ps1 `
  -WixDirectory <verified-portable-tools> `
  -OutputDirectory <new-candidate-directory> -Version 0.1.0
```

The builder creates the host, compiles and links with warnings as errors and
full ICE validation, then reads the actual MSI tables to verify its scope and
exact payload. It refuses to overwrite an output directory and writes a
`distributable=false` unsigned-candidate hash receipt. There is no publish step.

Local compile first refused Japanese text in codepage1252; the product now uses
932. Mandatory ICE validation then stopped with local application policy
LGHT1105. No administrator retry, validation suppression or green-build claim
was made. Read-only inspection of that generated candidate passed; it is not a
successful full build or install.

Head0837256b's normal CI39811612840 first failed an existing Windows browser
startup before reaching this step. Its one failed-job retry passed the existing
Windows tests but full ICE then reported ICE69 (cross-component shortcut file
reference) and ICE91 (fixed per-user LocalAppData file location). The correction
keeps pure per-user/limited scope, uses the context-aware ProgramFiles64Folder,
moves the shortcut into the EXE component and uses its context-aware registry
key path. It preserves all ICE checks and warnings-as-errors. Local old-MSI
inspection now fails the added machine-override gate; the corrected MSI passes
read-only metadata inspection. Full local ICE remains blocked by LGHT1105.

The b3fe08d8 CI39816971619 then reported ICE57: the non-advertised user shortcut
cannot share a component with an HKMU key path. The next correction separates
the user-menu/HKCU component from the context-aware EXE/HKMU component. Its
shortcut uses the exact formatted install-directory path rather than another
component's file-action reference. The metadata checker requires that exact
target and both component/registry scopes; the VM still verifies the resolved
shortcut target, repair and upgrade. No validator is suppressed. Local metadata
for the previous layout fails the new component check; the corrected layout
passes. Full ICE and the real lifecycle remain CI gates.

The existing disposable Windows CI job builds0.1.0 twice and0.1.1. The guarded VM
script first checks two machine-scope overrides fail at the intended launch
condition without files, HKLM/common-menu entries or product registration.
It then checks initial install, same-version maintenance/refusal, actual repair
of a corrupted EXE, version upgrade to a distinct host binary and uninstall,
retaining a dummy enrollment
file and a foreign file. Explicit ProductsEx enumeration has positive installed
registration assertions as well as negative override/uninstall checks. It
refuses execution outside a GitHub-hosted Windows
VM and refuses preexisting app/identity paths. All fixture cleanup is explicit
file/empty-directory removal. **Exact-head CI results are pending.**

## Remaining distribution gates and rollback

MSI signing, clean physical friend installation/first run, running-host update,
registration recovery, public/cellular connection and final licensing/security
review remain required. Building or installing this package does not establish
remote-control acceptance. No unsigned candidate or debug/physicalCheck APK is
to be presented as a completed friend release.

Rollback removes only the installer implementation/build/check scripts and its
CI acceptance step. For an installed candidate, normal Windows uninstall removes
tracked package components and retains the separate registration directory.
Restore the prior approved MSI with its retained identity; do not delete keys or
silently re-enroll. Package downgrade is deliberately refused, so an approved
rollback build must use a new higher version.

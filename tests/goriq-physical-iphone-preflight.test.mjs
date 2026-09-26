import assert from "node:assert/strict";
import test from "node:test";
import {
  selectSingleAvailablePhysicalIPhoneFromXCDevice,
  selectSinglePhysicalIPhoneFromXCDevice,
  summarizePhysicalIPhonePreflight,
} from "../scripts/goriq-physical-iphone-preflight.mjs";

const phone = {
  simulator: false,
  modelName: "iPhone 16 Pro",
  identifier: "00008110-001A2B3C4D5E601E",
  platform: "com.apple.platform.iphoneos",
  available: false,
  error: { code: -13, description: "Unlock /Users/alice's iPhone 00008110-001A2B3C4D5E601E" },
};

test("selects one physical iPhone from xcdevice without selecting simulators", () => {
  assert.equal(selectSinglePhysicalIPhoneFromXCDevice([phone, { ...phone, simulator: true, identifier: "simulator-id" }]), phone.identifier);
  assert.throws(() => selectSinglePhysicalIPhoneFromXCDevice([]), /exactly one physical iPhone/);
  assert.throws(() => selectSinglePhysicalIPhoneFromXCDevice([phone, { ...phone, identifier: "second-phone" }]), /exactly one physical iPhone/);
});

test("selects the one available physical iPhone after pairing", () => {
  const unavailable = { ...phone, identifier: "stale-phone" };
  const available = { ...phone, identifier: "prepared-phone", available: true, error: undefined };
  assert.equal(selectSingleAvailablePhysicalIPhoneFromXCDevice([unavailable, available]), "prepared-phone");
  assert.throws(() => selectSingleAvailablePhysicalIPhoneFromXCDevice([unavailable]), /exactly one available physical iPhone/);
});

test("summarizes USB and Xcode device state without leaking identifiers or user paths", () => {
  const summary = summarizePhysicalIPhonePreflight({
    commands: { systemProfiler: 0, xcdevice: 0, devicectl: 1, pairing: 1 },
    usb: { SPUSBDataType: [{ _items: [{ _name: "iPhone", serial_num: phone.identifier }] }] },
    xcdevice: [phone],
    devicectl: { result: { devices: [] } },
    diagnostics: {
      devicectl: "CoreDeviceError at /Users/alice/Library/Developer for 00008110-001A2B3C4D5E601E UUID 123e4567-e89b-12d3-a456-426614174000",
      pairing: "Unlock the device and tap Trust for 00008110-001A2B3C4D5E601E",
    },
  });

  assert.deepEqual(summary.commands, { systemProfiler: 0, xcdevice: 0, devicectl: 1, pairing: 1 });
  assert.equal(summary.usb.iPhoneLikeCount, 1);
  assert.deepEqual(summary.xcdevice, { physicalIPhoneCount: 1, availablePhysicalIPhoneCount: 0 });
  assert.deepEqual(summary.devicectl, { physicalIPhoneCount: 0, availablePhysicalIPhoneCount: 0 });
  assert.match(summary.diagnostics.devicectl, /CoreDeviceError/);
  assert.match(summary.diagnostics.pairing, /Unlock the device and tap Trust/);
  assert.doesNotMatch(JSON.stringify(summary), /alice|00008110|123e4567|iPhone 16 Pro/i);
});

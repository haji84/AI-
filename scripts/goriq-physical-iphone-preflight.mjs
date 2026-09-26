#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function physicalIPhonesFromXCDevice(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((value) => {
    const device = record(value);
    const platform = text(device.platform).toLowerCase();
    const modelName = text(device.modelName).toLowerCase();
    return device.simulator === false && (platform.includes("iphoneos") || modelName.startsWith("iphone"));
  });
}

export function selectSinglePhysicalIPhoneFromXCDevice(input) {
  const phones = physicalIPhonesFromXCDevice(input);
  if (phones.length !== 1) throw new Error(`expected exactly one physical iPhone in xcdevice, found ${phones.length}`);
  const identifier = text(record(phones[0]).identifier);
  if (!identifier) throw new Error("physical iPhone identifier is missing");
  return identifier;
}

export function selectSingleAvailablePhysicalIPhoneFromXCDevice(input) {
  const phones = physicalIPhonesFromXCDevice(input).filter((value) => record(value).available === true);
  if (phones.length !== 1) throw new Error(`expected exactly one available physical iPhone in xcdevice, found ${phones.length}`);
  const identifier = text(record(phones[0]).identifier);
  if (!identifier) throw new Error("available physical iPhone identifier is missing");
  return identifier;
}

function physicalIPhonesFromDevicectl(input) {
  const devices = record(record(input).result).devices;
  if (!Array.isArray(devices)) return [];
  return devices.filter((value) => {
    const device = record(value);
    const unified = record(device.properties);
    const legacy = record(device.deviceProperties);
    const hardware = record(device.hardwareProperties);
    const productType = (text(unified.productType) || text(hardware.productType)).toLowerCase();
    const deviceClass = (text(unified.deviceClass) || text(legacy.deviceClass)).toLowerCase();
    return productType.startsWith("iphone") || deviceClass === "iphone";
  });
}

function devicectlAvailable(value) {
  const device = record(value);
  const unified = record(device.properties);
  const legacy = record(device.deviceProperties);
  const connection = record(device.connectionProperties);
  const boot = (text(unified.bootState) || text(legacy.bootState)).toLowerCase();
  const pairing = (text(unified.pairingState) || text(connection.pairingState)).toLowerCase();
  const tunnel = (text(unified.tunnelState) || text(connection.tunnelState)).toLowerCase();
  return boot === "booted" && pairing === "paired" && (tunnel === "connected" || tunnel === "available");
}

function countIPhoneLikeUSBNodes(value) {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countIPhoneLikeUSBNodes(item), 0);
  if (!value || typeof value !== "object") return 0;
  const node = record(value);
  const ownName = [node._name, node.device_name, node.product_name].map(text).find(Boolean) ?? "";
  return (ownName.toLowerCase().includes("iphone") ? 1 : 0)
    + Object.values(node).reduce((count, item) => count + countIPhoneLikeUSBNodes(item), 0);
}

function sanitizeDiagnostic(value) {
  const printable = [...text(value)].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
  return printable
    .replace(/\/Users\/[^/\s'"]+/g, "/Users/[REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{8,}\b/gi, "[DEVICE-ID-REDACTED]")
    .replace(/\b[0-9a-f]{24,40}\b/gi, "[DEVICE-ID-REDACTED]")
    .slice(0, 4000);
}

export function summarizePhysicalIPhonePreflight(input) {
  const root = record(input);
  const commands = record(root.commands);
  const xcPhones = physicalIPhonesFromXCDevice(root.xcdevice);
  const corePhones = physicalIPhonesFromDevicectl(root.devicectl);
  const diagnostics = record(root.diagnostics);
  return {
    schemaVersion: 1,
    commands: {
      systemProfiler: Number(commands.systemProfiler),
      xcdevice: Number(commands.xcdevice),
      devicectl: Number(commands.devicectl),
      pairing: Number(commands.pairing),
    },
    usb: { iPhoneLikeCount: countIPhoneLikeUSBNodes(root.usb) },
    xcdevice: {
      physicalIPhoneCount: xcPhones.length,
      availablePhysicalIPhoneCount: xcPhones.filter((value) => record(value).available === true).length,
    },
    devicectl: {
      physicalIPhoneCount: corePhones.length,
      availablePhysicalIPhoneCount: corePhones.filter(devicectlAvailable).length,
    },
    diagnostics: {
      devicectl: sanitizeDiagnostic(diagnostics.devicectl),
      pairing: sanitizeDiagnostic(diagnostics.pairing),
    },
  };
}

async function readJsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function readTextOrEmpty(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "select-xcdevice" && args.length === 1) {
    process.stdout.write(`${selectSinglePhysicalIPhoneFromXCDevice(await readJsonOrNull(args[0]))}\n`);
    return;
  }
  if (command === "select-available-xcdevice" && args.length === 1) {
    process.stdout.write(`${selectSingleAvailablePhysicalIPhoneFromXCDevice(await readJsonOrNull(args[0]))}\n`);
    return;
  }
  if (command === "summarize" && args.length === 10) {
    const [output, systemProfilerExit, usbFile, xcdeviceExit, xcdeviceFile, devicectlExit, devicectlFile, devicectlLog, pairingExit, pairingLog] = args;
    const summary = summarizePhysicalIPhonePreflight({
      commands: { systemProfiler: systemProfilerExit, xcdevice: xcdeviceExit, devicectl: devicectlExit, pairing: pairingExit },
      usb: await readJsonOrNull(usbFile),
      xcdevice: await readJsonOrNull(xcdeviceFile),
      devicectl: await readJsonOrNull(devicectlFile),
      diagnostics: { devicectl: await readTextOrEmpty(devicectlLog), pairing: await readTextOrEmpty(pairingLog) },
    });
    await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  throw new Error("usage: goriq-physical-iphone-preflight.mjs select-xcdevice|select-available-xcdevice <xcdevice-json> | summarize <output> <system-profiler-exit> <usb-json> <xcdevice-exit> <xcdevice-json> <devicectl-exit> <devicectl-json> <devicectl-log> <pairing-exit> <pairing-log>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

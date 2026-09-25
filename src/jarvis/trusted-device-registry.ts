import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;
type Device = { deviceId: string; label: string; revoked: boolean };
type Registry = { version: 1; devices: Device[] };

export class TrustedDeviceRegistry {
  private readonly path: string;
  constructor(path: string) { this.path = path; }

  private read(): Registry {
    if (!existsSync(this.path)) return { version: 1, devices: [] };
    const raw = readFileSync(this.path, "utf8");
    if (raw.length > 131_072) throw new Error("trusted device registry is too large");
    const registry = JSON.parse(raw) as Registry;
    if (registry?.version !== 1 || !Array.isArray(registry.devices) || registry.devices.length > 1000) throw new Error("invalid trusted device registry");
    const seen = new Set<string>();
    for (const device of registry.devices) {
      if (!device || !DEVICE_ID.test(device.deviceId) || typeof device.label !== "string" || device.label.length > 80 ||
        typeof device.revoked !== "boolean" || seen.has(device.deviceId)) throw new Error("invalid trusted device registry");
      seen.add(device.deviceId);
    }
    return registry;
  }

  private save(registry: Registry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(registry));
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, this.path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  list(): Device[] { return this.read().devices; }
  isRevoked(deviceId: string): boolean {
    if (!DEVICE_ID.test(deviceId)) throw new Error("invalid trusted device id");
    return this.read().devices.some(device => device.deviceId === deviceId && device.revoked);
  }
  register(deviceId: string, label: string): Device {
    if (!DEVICE_ID.test(deviceId) || !label.trim() || label.length > 80) throw new Error("invalid trusted device");
    const registry = this.read();
    const existing = registry.devices.find(device => device.deviceId === deviceId);
    if (existing?.revoked) throw new Error("trusted device revoked");
    if (existing) return existing;
    if (registry.devices.length >= 1000) throw new Error("trusted device registry full");
    const device = { deviceId, label: label.trim(), revoked: false };
    registry.devices.push(device);
    this.save(registry);
    return device;
  }
  revoke(deviceId: string): Device {
    if (!DEVICE_ID.test(deviceId)) throw new Error("invalid trusted device id");
    const registry = this.read();
    const existing = registry.devices.find(device => device.deviceId === deviceId);
    if (existing?.revoked) return existing;
    if (!existing && registry.devices.length >= 1000) throw new Error("trusted device registry full");
    const revoked = existing ? { ...existing, revoked: true } : { deviceId, label: "旧端末", revoked: true };
    registry.devices = [...registry.devices.filter(device => device.deviceId !== deviceId), revoked];
    this.save(registry);
    return revoked;
  }
}

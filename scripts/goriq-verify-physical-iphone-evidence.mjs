#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { verifyPhysicalIPhoneToolchainEvidence } from "../src/orchestrator/physical-iphone-live-acceptance.ts";

const [bridgePath, toolchainPath, mainSha, taskId, deviceId, challenge, bundleIdentifier] = process.argv.slice(2);
if (![bridgePath, toolchainPath, mainSha, taskId, deviceId, challenge, bundleIdentifier].every(Boolean)) {
  throw new Error("usage: goriq-verify-physical-iphone-evidence.mjs <bridge> <toolchain> <sha> <task> <device> <challenge> <bundle>");
}
const bridge = JSON.parse(await readFile(bridgePath, "utf8"));
const toolchain = JSON.parse(await readFile(toolchainPath, "utf8"));
verifyPhysicalIPhoneToolchainEvidence(bridge, toolchain, { mainSha, taskId, deviceId, challenge, bundleIdentifier });
process.stdout.write("physical iPhone bridge and trusted-toolchain evidence match\n");

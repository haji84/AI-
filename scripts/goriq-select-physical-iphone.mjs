#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { selectSingleAvailablePhysicalIPhone } from "../src/orchestrator/physical-iphone-live-acceptance.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: goriq-select-physical-iphone.mjs <devicectl-json>");
process.stdout.write(`${selectSingleAvailablePhysicalIPhone(JSON.parse(await readFile(file, "utf8")))}\n`);

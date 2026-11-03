#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatDevicectlFailure } from "./goriq-format-devicectl-failure.ts";

const [exitCodeValue, outputFile, operation] = process.argv.slice(2);
if (!exitCodeValue || !outputFile) throw new Error("usage: goriq-format-devicectl-failure.mjs <exit-code> <output-file> [operation]");
const exitCode = Number.parseInt(exitCodeValue, 10);
if (!Number.isSafeInteger(exitCode) || exitCode < 1) throw new Error("exit code must be a positive integer");
process.stderr.write(`${formatDevicectlFailure(exitCode, await readFile(outputFile, "utf8"), operation)}\n`);

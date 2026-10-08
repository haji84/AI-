import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
const read=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
test("canonical Mac LaunchAgent directly owns the Broker process",async()=>{const installer=await read("scripts/jarvis-mac-install-launchagent.sh");const entry=await read("scripts/jarvis-mac-runtime-entry.sh");assert.equal(installer.includes("jarvis-mac-runtime-entry.sh"),true);assert.equal(installer.includes("<key>KeepAlive</key><true/>"),true);assert.equal(installer.includes("jarvis-mac-resident.sh"),false);assert.equal(entry.includes("exec pnpm jarvis:broker"),true);assert.equal(entry.includes("node@24/bin"),true);});
test("canonical runtime installer contains no literal escaped newlines in plist control lines",async()=>{const s=await read("scripts/jarvis-mac-install-launchagent.sh");for(const line of s.split("\n"))assert.equal(line.includes("\\n"),false);});

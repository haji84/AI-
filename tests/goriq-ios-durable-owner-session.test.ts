import assert from "node:assert/strict"; import {readFile} from "node:fs/promises"; import test from "node:test"; import {URL} from "node:url";
const source=(p:string)=>readFile(new URL(`../${p}`,import.meta.url),"utf8");
test("Owner session idle window is 72 hours",async()=>assert.match(await source("src/app/owner-auth.ts"),/60 \* 60 \* 24 \* 3/));
test("iOS persists routine session separately from protected proof",async()=>{const s=await source("apps/ios-owner/Sources/OwnerCredentialRuntime.swift");assert.match(s,/owner-durable-session/);assert.match(s,/restoreDurableSession/);assert.match(s,/\.userPresence, \.privateKeyUsage/);});
test("restore checks revocation and rotates session",async()=>{const s=await source("src/app/api/owner-login/trusted/session/route.ts");assert.match(s,/trustedDeviceIsRevoked/);assert.match(s,/createOwnerSessionToken/);});

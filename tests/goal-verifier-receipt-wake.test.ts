import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalVerifierReceiptWake } from "../src/orchestrator/goal-verifier-receipt-wake.ts";

test("verifier receipt wake only observes new exact bytes and cannot replay them repeatedly",()=>{
  const root=mkdtempSync(join(tmpdir(),"goriq-verifier-wake-"));
  try {
    const path=join(root,"receipt.json"),wake=new GoalVerifierReceiptWake(path);
    assert.equal(wake.changedDigest(),null);
    writeFileSync(path,'{"receipt":"one"}');
    const first=wake.changedDigest();
    assert.match(first!,/^[a-f0-9]{64}$/);
    assert.equal(wake.changedDigest(),null);
    writeFileSync(path,'{"receipt":"two"}');
    assert.notEqual(wake.changedDigest(),first);
    assert.equal(wake.changedDigest(),null);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("receipt wake does not follow symlink or read oversized attacker-controlled receipt",()=>{
  const root=mkdtempSync(join(tmpdir(),"goriq-verifier-wake-"));
  try{
    const original=join(root,"real.json"),linked=join(root,"symlink.json");
    writeFileSync(original,"sensitive");
    symlinkSync(original,linked);
    assert.equal(new GoalVerifierReceiptWake(linked).changedDigest(),null);
    writeFileSync(join(root,"huge.json"),"x".repeat(25_000));
    assert.equal(new GoalVerifierReceiptWake(join(root,"huge.json")).changedDigest(),null);
    assert.throws(()=>new GoalVerifierReceiptWake("relative.json"),/WAKE_PATH_INVALID/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

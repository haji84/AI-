import assert from "node:assert/strict";
import test from "node:test";
import {anchorAudit,holdUngroundedAdvisory} from "../scripts/goriq-ai09-finding-anchors.mjs";

const patch="diff --git a/src/example.ts b/src/example.ts\n"+
  "@@ -4,2 +4,3 @@\n context\n-const before = 0;\n"+
  "+console.log(request.headers.authorization);\n"+
  "+const after = 1;";
const valid={path:"src/example.ts",line:5,severity:"high",
  evidence:"Added `console.log(request.headers.authorization);` logs a credential header",
  summary:"Sensitive logging",proposedFix:"Remove the logging"};
const asserted={status:"CHANGES_REQUESTED",findings:[valid],blockers:["model_findings_require_action"],
  githubApprovalSatisfied:false,mergeAuthorized:false};

test("verified new-side line with exact added-code quote passes advisory anchoring",()=>{
 const a=anchorAudit([valid],patch);
 assert.equal(a.complete,true);
 assert.equal(a.grounded,1);
 assert.equal(holdUngroundedAdvisory(asserted,patch).status,"CHANGES_REQUESTED");
});
test("fabricated line or generic evidence cannot become a Builder correction",()=>{
 for(const f of [
  {...valid,line:123},
  {...valid,evidence:"A generic risk may exist."},
  {...valid,path:"src/not-changed.ts"},
  {...valid,line:4},
 ]) {
  const result=holdUngroundedAdvisory({...asserted,findings:[f]},patch);
  assert.equal(result.status,"INCONCLUSIVE");
  assert.deepEqual(result.blockers,["review_chunk_inconclusive"]);
  assert.equal(result.mergeAuthorized,false);
 }
});
test("an unanchored finding blocks all-actionable status, never silently drops it",()=>{
 const r=holdUngroundedAdvisory({...asserted,findings:[valid,{...valid,line:123}]},patch);
 assert.equal(r.status,"INCONCLUSIVE");
 assert.equal(r.findings.length,2);
});
test("unchanged CLEAN and BLOCKED are retained; malformed inputs fail closed",()=>{
 assert.equal(holdUngroundedAdvisory({...asserted,status:"NO_ACTIONABLE_FINDINGS"},patch).status,"NO_ACTIONABLE_FINDINGS");
 assert.equal(holdUngroundedAdvisory({...asserted,status:"BLOCKED"},patch).status,"BLOCKED");
 assert.throws(()=>anchorAudit(null,patch),/INVALID_ANCHOR_INPUT/);
 assert.throws(()=>holdUngroundedAdvisory({status:"APPROVED"},patch));
});
test("multi-hunk new-line accounting excludes deleted lines",()=>{
 const p="diff --git a/x.js b/x.js\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n"+
   "@@ -10,1 +10,2 @@\n-old\n+const safe = true;\n+const done = 1;";
 const f={path:"x.js",line:10,evidence:"Added `const safe = true;`."};
 assert.equal(anchorAudit([f],p).complete,true);
 assert.equal(anchorAudit([{...f,line:9}],p).complete,false);
});

test("increment additions and following new-side coordinates retain exact quote anchoring",()=>{
 const p="diff --git a/src/counter.js b/src/counter.js\n"+
  "@@ -1,2 +1,4 @@\n let pendingCounter = 0;\n+++pendingCounter;\n+const afterIncrement = true;\n return pendingCounter;";
 const f={path:"src/counter.js",line:2,evidence:"Added "+String.fromCharCode(96)+"++pendingCounter;"+String.fromCharCode(96)};
 assert.equal(anchorAudit([f],p).complete,true);
 assert.equal(anchorAudit([{...f,line:3,evidence:"Added "+String.fromCharCode(96)+"const afterIncrement = true;"+String.fromCharCode(96)}],p).complete,true);
 const r=holdUngroundedAdvisory({...asserted,findings:[f]},p);
 assert.equal(r.status,"CHANGES_REQUESTED");
 assert.equal(r.mergeAuthorized,false);
 assert.equal(r.githubApprovalSatisfied,false);
});
test("increment handling does not anchor context, headers, other paths or fabricated lines",()=>{
 const p="diff --git a/src/counter.js b/src/counter.js\n--- a/src/counter.js\n+++ b/src/counter.js\n"+
  "@@ -1 +1,2 @@\n const beforeCounter = 0;\n+++pendingCounter;";
 const f={path:"src/counter.js",line:2,evidence:"Added "+String.fromCharCode(96)+"++pendingCounter;"+String.fromCharCode(96)};
 for(const wrong of [{...f,line:1},{...f,line:3},{...f,path:"other.js"},
   {...f,evidence:"Added "+String.fromCharCode(96)+"b/src/counter.js"+String.fromCharCode(96)}]){
  assert.equal(anchorAudit([wrong],p).complete,false);
  const r=holdUngroundedAdvisory({...asserted,findings:[wrong]},p);
  assert.equal(r.status,"INCONCLUSIVE");
  assert.equal(r.mergeAuthorized,false);
 }
});

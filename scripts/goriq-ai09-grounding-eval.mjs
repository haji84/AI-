// Deterministic citation-grounding evaluation, not vulnerability detection
// quality and never independent verification or repair authorization.
import { anchorAudit } from "./goriq-ai09-finding-anchors.mjs";

const PATCH = [
  "diff --git a/src/example.mjs b/src/example.mjs",
  "@@ -4,2 +4,4 @@",
  " contextLine();",
  "-oldAssignment = false;",
  "+console.log(request.headers.authorization);",
  "+const freshValue = sanitizeUserValue(input);",
  " unchangedAfter();",
].join("\n");

function sample(id, line, evidence, expectedGrounded, path="src/example.mjs") {
  return Object.freeze({id,expectedGrounded,finding:{path,line,evidence}});
}

// A fixed, transparent benchmark of source-location grounding ONLY.
// Labels say whether text cites a real new-side added line, not whether
// code is genuinely defective. Generic security guesses stay ungrounded.
export const GROUNDING_CORPUS=Object.freeze([
  sample("added-exact-full",5,"Added `console.log(request.headers.authorization);`",true),
  sample("added-exact-substring",5,"Reads `request.headers.authorization`",true),
  sample("added-valid-second-line",6,"Added `const freshValue = sanitizeUserValue(input);`",true),
  sample("added-valid-subexpression",6,"Uses `sanitizeUserValue(input)`",true),
  sample("nonexistent-new-line",123,"Added `console.log(request.headers.authorization);`",false),
  sample("context-not-added",4,"Context `contextLine();`",false),
  sample("trailing-context-not-added",7,"Code `unchangedAfter();`",false),
  sample("deleted-old-line",5,"Deleted `oldAssignment = false;`",false),
  sample("generic-unauthenticated-risk",5,"JSON might be unsafe",false),
  sample("quoted-prompt-delimiter",5,"Added `BEGIN_UNTRUSTED_PATCH`",false),
  sample("other-file-location",5,"Added `console.log(request.headers.authorization);`",false,"src/different.mjs"),
  sample("traversal-location",5,"Added `console.log(request.headers.authorization);`",false,"../outside.mjs"),
  sample("wrong-new-line",6,"Added `console.log(request.headers.authorization);`",false),
  sample("wrong-new-line-reversed",5,"Added `const freshValue = sanitizeUserValue(input);`",false),
  sample("short-quote-unverifiable",5,"Added `console`",false),
  sample("code-not-quoted",5,"Added console.log(request.headers.authorization);",false),
  sample("old-file-line",0,"Added `console.log(request.headers.authorization);`",false),
  sample("invalid-evidence",5,null,false),
]);

export function evaluateGroundingCorpus(corpus=GROUNDING_CORPUS, patch=PATCH) {
  if(!Array.isArray(corpus)||corpus.length<1||corpus.length>100 ||
     typeof patch!=="string"||!patch||patch.length>150000)throw Error("INVALID_EVAL_CORPUS");
  const seen=new Set();
  const outcomes=corpus.map(item=>{
    if(typeof item?.id!=="string"||!/^[a-z0-9-]{4,60}$/.test(item.id)||
       seen.has(item.id)||typeof item.expectedGrounded!=="boolean")
      throw Error("INVALID_EVAL_LABEL");
    seen.add(item.id);
    const audit=anchorAudit([item.finding],patch);
    return {id:item.id,expectedGrounded:item.expectedGrounded,
      observedGrounded:audit.complete,matched:item.expectedGrounded===audit.complete};
  });
  const count=(expected,observed)=>outcomes.filter(x=>x.expectedGrounded===expected&&
      x.observedGrounded===observed).length;
  const tp=count(true,true),fp=count(false,true),tn=count(false,false),fn=count(true,false);
  const fraction=(num,den)=>den?num/den:null;
  return {
    scope:"SOURCE_LINE_GROUNDING_ONLY_NOT_BUG_DETECTION",
    total:outcomes.length,truePositive:tp,falsePositive:fp,trueNegative:tn,
    falseNegative:fn,precision:fraction(tp,tp+fp),recall:fraction(tp,tp+fn),
    falsePositiveRate:fraction(fp,fp+tn),accuracy:fraction(tp+tn,outcomes.length),
    evidenceClass:"SYNTHETIC_LABELED_FIXTURE",actualDefectsConfirmed:0,
    realModelPrecisionVerified:false,independentSecurityReviewSatisfied:false,
    githubApprovalSatisfied:false,mergeAuthorized:false,
    outcomes
  };
}

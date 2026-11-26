import assert from "node:assert/strict";
import test from "node:test";
import { renderTrackedRepairSources } from "../src/orchestrator/tracked-repair-prompt-context.ts";

test("focused excerpts retain multiline/CRLF bytes, merge neighboring windows and keep distant selections",()=>{
  const path="scripts/source.mjs",content="zero\r\none\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\nlast";
  const prompt=renderTrackedRepairSources([{path,content}],
    [{path,before:"one\r\ntwo"},{path,before:"three"},{path,before:"last"}],{version:1,paddingLines:0},[]);
  assert.equal(prompt,"SOURCE scripts/source.mjs (lines 2-4 of 8)\none\r\ntwo\r\nthree\r\n\nSOURCE scripts/source.mjs (lines 8-8 of 8)\nlast");
});

test("focused recovery shows actual inserted/deleted lines rather than reusing baseline line numbers",()=>{
  const path="scripts/source.mjs",content="head\nold\ntail\n",slots=[{path,before:"old"}];
  const inserted=renderTrackedRepairSources([{path,content}],slots,{version:1,paddingLines:0},[{path,content:"head\nnew\nextra\ntail\n"}]);
  assert.match(inserted,/REJECTED SOURCE scripts\/source.mjs \(lines 2-3 of 4\)\nnew\nextra\n$/);
  const deleted=renderTrackedRepairSources([{path,content}],slots,{version:1,paddingLines:0},[{path,content:"head\ntail\n"}]);
  assert.match(deleted,/REJECTED SOURCE scripts\/source.mjs \(lines 2-2 of 2\)\ntail\n$/);
});

test("focused source without slots remains complete and ambiguous slots fail closed",()=>{
  const path="scripts/source.mjs",files=[{path,content:"same\nsame\n"},{path:"scripts/dependency.mjs",content:"full context\n"}];
  assert.throws(()=>renderTrackedRepairSources(files,[{path,before:"same"}],{version:1,paddingLines:2},[]),/SLOT_NOT_UNIQUE/);
  assert.throws(()=>renderTrackedRepairSources(files,[{path,before:"missing"}],{version:1,paddingLines:2},[]),/SLOT_NOT_UNIQUE/);
  assert.match(renderTrackedRepairSources(files,[],{version:1,paddingLines:2},[]),/SOURCE scripts\/dependency.mjs\nfull context\n$/);
});

test("omitted context retains the complete previous source prompt byte for byte",()=>{
  assert.equal(renderTrackedRepairSources([{path:"scripts/a.mjs",content:"baseline\n"},{path:"scripts/b.mjs",content:"full\r\n"}],[],undefined,
    [{path:"scripts/a.mjs",content:"rejected\n"}]),"SOURCE scripts/a.mjs\nrejected\n\nSOURCE scripts/b.mjs\nfull\r\n");
});

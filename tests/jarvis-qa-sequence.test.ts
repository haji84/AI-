import assert from "node:assert/strict";
import test from "node:test";
import { classifyQaScreen, executeQaSequence, validateQaSheetUrl, type QaScreenState } from "../src/jarvis/qa-sequence.ts";

test('spreadsheet deep links preserve tab while rejecting credentials and unrelated hosts',()=>{
 const valid='https://docs.google.com/spreadsheets/d/example_1/edit#gid=123';assert.equal(validateQaSheetUrl(valid),valid);
 for(const invalid of ['https://evil.test/spreadsheets/d/a','https://user:pass@docs.google.com/spreadsheets/d/a','https://docs.google.com/spreadsheets/d/a#token=secret','https://docs.google.com/spreadsheets/d/a?token=secret'])assert.throws(()=>validateQaSheetUrl(invalid));
});

function driver(states: QaScreenState[]) {
  states = [...states];
  const actions: string[] = [];
  return {actions, driver: {
    async open(step:1|2){actions.push(`open${step}`);},
    async wait(){return {state:states.shift()??'pending' as QaScreenState,matched:[]};},
    async returnToSheet(){actions.push('sheet');},
    async closeAndHome(){actions.push('close-home');},
    progress(){},
  }};
}
test('both confirmations required before close/home, with spreadsheet return before URL2',async()=>{
  const f=driver(['step1-success','step2-success']);
  assert.equal((await executeQaSequence(f.driver)).outcome,'done');
  assert.deepEqual(f.actions,['open1','sheet','open2','close-home']);
});
test('error never advances to another URL or retries',async()=>{
  for(const states of [['error'],['step1-success','error']] as QaScreenState[][]){
    const f=driver(states);assert.equal((await executeQaSequence(f.driver)).outcome,'error-no-retry');
    assert.deepEqual(f.actions,states.length===1?['open1','close-home']:['open1','sheet','open2','close-home']);
  }
});
test('unknown or out-of-order screen cannot grant completion',async()=>{
  for(const state of ['pending','step2-success'] as QaScreenState[]){
    const f=driver([state]);assert.equal((await executeQaSequence(f.driver)).outcome,'step1-timeout');assert.deepEqual(f.actions,['open1']);
  }
});
test('failed sheet return or HOME confirmation never reports done',async()=>{
  const f=driver(['step1-success']);f.driver.returnToSheet=async()=>{throw Error('sheet unavailable');};
  await assert.rejects(executeQaSequence(f.driver));assert.deepEqual(f.actions,['open1']);
  const g=driver(['step1-success','step2-success']);g.driver.closeAndHome=async()=>{throw Error('HOME not confirmed');};
  await assert.rejects(executeQaSequence(g.driver));assert.deepEqual(g.actions,['open1','sheet','open2']);
});
test('line-wrapped Japanese labels match but metadata cannot spoof success',()=>{
 assert.equal(classifyQaScreen('<node text="受け取り&#10;ました"/><node text="マイQRコードを表示"/>').state,'step2-success');
 assert.equal(classifyQaScreen('<node resource-id="受け取りました マイQRコードを表示" text="読み込み中"/>').state,'pending');
 assert.equal(classifyQaScreen('<node text="受け取りました マイQRコードを表示 あなたのアカウントでエラーが発生しました"/>').state,'error');
});

test("error screen wins and is marked no-retry candidate", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="お友達のお手伝いが出来ませんでした" />
      <node text="あなたのアカウントでエラーが発生しました。別のアカウントでお試しください。" />
      <node text="参加する" />
    </hierarchy>
  `);
  assert.equal(result.state, "error");
  assert.ok(result.matched.some((value) => value.includes("お友達のお手伝い")));
});

test("step1 success requires the supplied green-state markers", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="イベント詳細" />
      <node text="新規ユーザー" />
      <node text="30日以上アプリを使っていない人" />
      <node text="今日アプリを使っていない人" />
      <node text="その他の既存ユーザー" />
    </hierarchy>
  `);
  assert.equal(result.state, "step1-success");
});

test("generic event screen is not enough for step1 success", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="イベント詳細" />
      <node text="獲得履歴" />
      <node text="イベントルール" />
    </hierarchy>
  `);
  assert.equal(result.state, "pending");
});

test("step2 success requires receipt confirmation and QR action", () => {
  const result = classifyQaScreen(`
    <hierarchy>
      <node text="友だち @user が受け取りました" />
      <node text="10円分" />
      <node text="マイQRコードを表示" />
    </hierarchy>
  `);
  assert.equal(result.state, "step2-success");
});

test("unrecognized screen remains pending", () => {
  const result = classifyQaScreen(`<hierarchy><node text="読み込み中" /></hierarchy>`);
  assert.equal(result.state, "pending");
});

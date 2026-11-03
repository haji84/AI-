import process from "node:process";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { attestLocalCandidate } from '../scripts/jarvis-independent-artifact-attestation.mjs';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'verifier-v1-mode-model-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),candidate=join(root,'candidate');mkdirSync(repo);mkdirSync(join(repo,'src'));mkdirSync(join(repo,'docs'));
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(repo,'init');git(repo,'config','user.name','V1 frozen regression');git(repo,'config','user.email','test@example.invalid');
 writeFileSync(join(repo,'src/b.ts'),'export const untouched = true;\n');chmodSync(join(repo,'src/b.ts'),0o644);
 writeFileSync(join(repo,'docs/baseline.txt'),'baseline\n');git(repo,'add','.');git(repo,'commit','-m','pristine baseline');
 const base=git(repo,'rev-parse','HEAD');git(repo,'worktree','add','--detach',candidate,'HEAD');git(candidate,'config','core.filemode','false');
 const content='new approved artifact\n';writeFileSync(join(candidate,'docs/candidate.txt'),content);
 return {candidate,base,content,scope:{workspace:candidate,baseRevision:base,targetPath:'docs/candidate.txt',allowedUntracked:['docs/candidate.txt']}};
}

test('v1 rejects undeclared executable mode change hidden by core.filemode=false',{skip:process.platform==='win32'},t=>{
 const f=fixture(t);chmodSync(join(f.candidate,'src/b.ts'),0o755);
 assert.throws(()=>attestLocalCandidate(f.scope),/INDEPENDENT_ARTIFACT_STATUS_MISMATCH/,
  'A v1 candidate must not conceal undeclared executable-mode changes');
});

test('ordinary v1 new-file candidates remain valid',t=>{
 const f=fixture(t),result=attestLocalCandidate(f.scope);
 assert.equal(result.artifactDigest,createHash('sha256').update(f.content).digest('hex'));
});

const sourcePath=join(dirname(fileURLToPath(import.meta.url)),'../scripts/jarvis-verifier-safe-git.mjs');
const source=readFileSync(sourcePath,'utf8');
const ast=ts.createSourceFile(sourcePath,source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
assert.equal(ast.parseDiagnostics.length,0,'Verifier source must be valid JavaScript');
const declarations=ast.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations])
 .filter(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='configOverrides');
assert.equal(declarations.length,1,'The original top-level configOverrides binding must remain unique');
assert.ok(declarations[0].initializer);
const initializer=declarations[0].initializer.getText(ast);
function options(platform) {
 const result=vm.runInNewContext('('+initializer+')',{process:Object.freeze({platform}),nullFile:platform==='win32'?'NUL':'/dev/null'},
  {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
 assert.ok(Array.isArray(result),'Git options must be an array');
 assert.ok(result.length<=64);
 const values=Array.from(result);assert.ok(values.every(value=>typeof value==='string'),'Git argv entries must all be strings');
 return values;
}
function originalOptions(platform) {
 const nullFile=platform==='win32'?'NUL':'/dev/null';
 return ['--no-pager','--no-optional-locks','-c','core.fsmonitor=false','-c',`core.hooksPath=${nullFile}`,
  '-c','core.untrackedCache=false','-c',`core.attributesFile=${nullFile}`,'-c','submodule.recurse=false'];
}

test('Windows options remain exactly the original options',()=>{
 assert.deepEqual(options('win32'),originalOptions('win32'));
});

for(const platform of ['linux','darwin']) {
 test(`${platform} observes executable modes and preserves every original option`,()=>{
  const actual=options(platform),positions=actual.flatMap((value,index)=>value==='core.filemode=true'?[index]:[]);
  assert.equal(positions.length,1,'Exactly one authoritative executable-mode setting is required');
  const position=positions[0];assert.ok(position>0);assert.equal(actual[position-1],'-c');
  const withoutNewPair=[...actual.slice(0,position-1),...actual.slice(position+1)];
  assert.deepEqual(withoutNewPair,originalOptions(platform),'No existing security option may be removed or changed');
 });
}

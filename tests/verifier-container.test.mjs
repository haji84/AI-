import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { runVerifierContainer } from "../scripts/jarvis-verifier-container.mjs";
import { restoreR66WorkflowBaseline } from "./fixtures/pr1905-ci-source-contract.mjs";

function fixture(t, behavior = {}) {
  const root = mkdtempSync(join(tmpdir(), "goriq-container-boundary-"));
  const bin = join(root, "bin"), cwd = join(root, "workspace");
  mkdirSync(bin); mkdirSync(cwd);
  const executable = join(bin, process.platform === "win32" ? "docker.exe" : "docker");
  writeFileSync(executable, "not executable test fixture", { mode: 0o755 });
  const calls = [], killed = [];
  const complete = (child, status = 0, stdout = "", stderr = "") => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end(); child.stderr.end(); child.emit("close", status, null);
  };
  t.mock.method(childProcess, "spawn", (command, args, options) => {
    assert.equal(command, executable, "The candidate cwd must not select the Docker executable");
    assert.equal(options.shell, false);
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.unref = () => {};
    child.kill = signal => {
      killed.push({ args, signal });
      behavior.onKill?.();
      if (!behavior.ignoreKill) globalThis.queueMicrotask(() => complete(child, null));
      return !behavior.ignoreKill;
    };
    globalThis.queueMicrotask(() => {
      if (args[0] === "run") {
        if (behavior.spawnError) { child.emit("error", Object.assign(Error("fixture unavailable"), { code: "ENOENT" })); return; }
        if (behavior.hang) return;
        complete(child, behavior.exitCode ?? 0, behavior.output ?? "check output", behavior.stderr ?? "");
      } else if (args[0] === "rm") {
        if (behavior.cleanupHang) return;
        complete(child, behavior.removalCode ?? 0, "", behavior.removalError ?? "");
      } else {
        assert.deepEqual(args.slice(0, 3), ["container", "ls", "--all"]);
        complete(child, behavior.inspectCode ?? 0, behavior.remaining ? "container-still-present\n" : "", behavior.inspectError ?? "");
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.includes("goriq-container-boundary-"));
    rmSync(root, { recursive: true, force: true });
  });
  return { calls, killed, options: { cwd, env: { PATH: bin }, timeoutMs: 30,
    cleanupTimeoutMs: 30, killGraceMs: 10, maxBuffer: 128 } };
}
const runArgs = ["run", "--rm", "--network=none", "fixture@sha256:" + "a".repeat(64), "echo", "fixture"];

test("zero exit requires exact named-container cleanup and confirmed absence", async t => {
  const f = fixture(t), result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, "check output");
  assert.equal(result.cleanup?.confirmed, true);
  assert.match(result.cliTiming.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(result.cliTiming.elapsedMs >= 0);
  assert.ok(result.cliTiming.firstOutputElapsedMs >= 0);
  assert.ok(result.cliTiming.lastOutputElapsedMs >= result.cliTiming.firstOutputElapsedMs);
  assert.ok(result.cliTiming.elapsedMs >= result.cliTiming.lastOutputElapsedMs);
  assert.ok(result.cleanup.removal.cliTiming.elapsedMs >= 0);
  const name = f.calls[0][f.calls[0].indexOf("--name") + 1];
  assert.match(name, /^goriq-verifier-[a-f0-9-]{36}$/);
  assert.deepEqual(f.calls[1], ["rm", "--force", "--volumes", name]);
  assert.ok(f.calls[2].includes(`name=^/${name}$`));
});

test("timeout kills the Docker CLI and cleans the container", async t => {
  // Test the measured monotonic interval deterministically; a real timer's
  // callback scheduling is not an exact wall-clock measurement contract.
  let clock = 0n;
  const f = fixture(t, { hang: true, onKill: () => { clock = 37_250_000n; } });
  t.mock.method(process.hrtime, "bigint", () => clock);
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.ok(result.cliTiming.elapsedMs >= f.options.timeoutMs);
  assert.equal(result.cliTiming.elapsedMs, 37.25);
  assert.equal(result.cliTiming.firstOutputElapsedMs, null);
  assert.equal(result.cliTiming.lastOutputElapsedMs, null);
  assert.equal(result.cleanup?.confirmed, true);
  assert.equal(result.closeObserved, true);
  assert.equal(f.killed[0]?.signal, "SIGKILL");
  assert.equal(f.calls[1]?.[0], "rm");
});

test("a CLI that never closes remains cleanup-uncertain even after an empty listing", async t => {
  const f = fixture(t, { hang: true, ignoreKill: true });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
  assert.equal(result.runErrorCode, "ETIMEDOUT");
  assert.equal(result.closeObserved, false);
  assert.equal(result.cleanup?.confirmed, false);
  assert.equal(result.cleanup?.inspection.status, 0);
  assert.equal(f.calls.length, 3);
});

test("combined output overflow is bounded and cannot become PASS", async t => {
  const f = fixture(t, { output: "x".repeat(100), stderr: "y".repeat(100) });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "ENOBUFS");
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 128);
  assert.equal(result.cleanup?.confirmed, true);
});

for (const [label, behavior] of [
  ["still present", { remaining: true }],
  ["daemon query fails", { inspectCode: 1, inspectError: "daemon unavailable" }],
  ["cleanup hangs", { cleanupHang: true, ignoreKill: true }],
]) {
  test(`successful check is inconclusive when cleanup ${label}`, async t => {
    const f = fixture(t, behavior), result = await runVerifierContainer(runArgs, f.options);
    assert.equal(result.status, 0);
    assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
    assert.equal(result.cleanup?.confirmed, false);
    assert.equal(f.calls.length, 3);
  });
}

test("a failed check preserves its logs and still removes the named container", async t => {
  const f = fixture(t, { exitCode: 2, output: "test failed", stderr: "assertion detail" });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "test failed");
  assert.equal(result.stderr, "assertion detail");
  assert.equal(result.cleanup?.confirmed, true);
});

test("spawn failure still reaches scoped cleanup and retains the failure code", async t => {
  const f = fixture(t, { spawnError: true });
  const result = await runVerifierContainer(runArgs, f.options);
  assert.equal(result.error?.code, "VERIFIER_CONTAINER_CLEANUP_UNCONFIRMED");
  assert.equal(result.runErrorCode, "ENOENT");
  assert.equal(result.cleanup?.confirmed, false);
  assert.equal(f.calls.length, 3);
});

test("caller cannot replace the generated cleanup identity", async t => {
  const f = fixture(t);
  await assert.rejects(runVerifierContainer(["run", "--name=unrelated", "fixture"], f.options),
    /VERIFIER_CONTAINER_REQUEST_INVALID/);
  assert.equal(f.calls.length, 0);
});

for (const [label, alias] of [["candidate", false], ["candidate alias", true], ["exported snapshot", false]]) {
  test(`Docker resolved inside ${label} is rejected before any process launch`, async t => {
    const f = fixture(t), parent = dirname(f.options.cwd);
    const untrustedRoot = join(parent, alias ? "candidate" : label.replaceAll(" ", "-"));
    const unsafeBin = join(untrustedRoot, "bin");
    mkdirSync(unsafeBin, { recursive: true });
    writeFileSync(join(unsafeBin, process.platform === "win32" ? "docker.exe" : "docker"), "untrusted CLI", { mode: 0o755 });
    let pathEntry = unsafeBin;
    if (alias) {
      pathEntry = join(parent, "tool-alias");
      symlinkSync(unsafeBin, pathEntry, process.platform === "win32" ? "junction" : "dir");
    }
    let launches = 0;
    t.mock.method(childProcess, "spawn", () => { launches++; throw Error("UNTRUSTED_CLI_LAUNCHED"); });
    syncBuiltinESMExports();
    const result = await runVerifierContainer(runArgs, { ...f.options,
      untrustedExecutableRoots: [untrustedRoot], env: { PATH: pathEntry + delimiter + f.options.env.PATH } });
    assert.equal(result.error?.code, "VERIFIER_CONTAINER_EXECUTABLE_IN_WORKSPACE");
    assert.equal(launches, 0);
    assert.deepEqual(result.cleanup, { attempted: false, confirmed: false });
  });
}

test("untrusted executable roots must be bounded absolute host paths", async t => {
  const f = fixture(t);
  for (const roots of ["workspace", ["relative"], [null], Array(9).fill(f.options.cwd)]) {
    await assert.rejects(runVerifierContainer(runArgs, { ...f.options, untrustedExecutableRoots: roots }),
      /VERIFIER_CONTAINER_REQUEST_INVALID/);
  }
  assert.equal(f.calls.length, 0);
});


import * as hostedBudget from "../scripts/jarvis-verifier-container.mjs";
test("hosted CI budget interfaces refuse forged copied and serialized lifetimes before any larger execution", async t => {
  for (const name of ["beginHostedCiEntry", "bindHostedCiRequest", "observeHostedCiBudget", "runHostedCiContainer"]) assert.equal(typeof hostedBudget[name], "function", name);
  const f = fixture(t);
  for (const token of [{}, Object.freeze({}), JSON.parse("{}"), null, "hosted-ci"]){
    assert.throws(() => hostedBudget.bindHostedCiRequest(token, {}), /HOSTED_CI_/);
    assert.throws(() => hostedBudget.observeHostedCiBudget(token, "SETUP"), /HOSTED_CI_/);
    await assert.rejects(hostedBudget.runHostedCiContainer(token, {}, "unit", runArgs, f.options), /HOSTED_CI_/);
  }
  await assert.rejects(runVerifierContainer(runArgs, { ...f.options, timeoutMs: 300001 }), /REQUEST_INVALID/);
  assert.equal(f.calls.length, 0);
});
test("ordinary imported module cannot be activated by later hosted environment or argv mutation", async () => {
  assert.equal(typeof hostedBudget.beginHostedCiEntry, "function");
  const oldArgv = process.argv, old = process.env.GITHUB_ACTIONS;
  try {process.argv = [process.execPath, resolve("scripts/jarvis-verifier-live-ci.mjs"), "--execute-hosted-ci"];process.env.GITHUB_ACTIONS = "true";await assert.rejects(hostedBudget.beginHostedCiEntry(), /HOSTED_CI_ENTRY/);}
  finally {process.argv = oldArgv;if(old===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=old;}
});

// Source-extracted private host models below are counterfactual component
// evidence only. Tokens exist only in the VM registry, never the real module.
// No production API accepts a fake clock, executor, metadata URL or factory.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import { setTimeout,clearTimeout } from "node:timers";
import { relative, isAbsolute, sep } from "node:path";
function hostedPrivateModel(config = {}) {
  const code = readFileSync("scripts/jarvis-verifier-container.mjs", "utf8");
  const source = code.slice(code.indexOf("// Hosted entry lifetime."))
    .replaceAll("import.meta.url", '"file:///public/repo/scripts/jarvis-verifier-container.mjs"').replaceAll(/^export /gm, "");
  const clock = { mono: 1000000000000n, utc: Date.now() }, events = [], calls = [], ledger = config.ledger ?? new Set();
  let sourceValue = "public trusted host source", apiIndex = 0;
  const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "haji84/AI-", GITHUB_REPOSITORY_OWNER: "haji84",
    GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "independent-verifier-container", GITHUB_WORKFLOW: "CI",
    GITHUB_REF: "refs/pull/1905/merge", GITHUB_EVENT_NAME: "pull_request_review", GITHUB_WORKSPACE: "/public/repo",
    RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux", RUNNER_TEMP: "/public/temp", GITHUB_SHA: "f".repeat(40), PATH: "/public/bin" };
  const base = "a".repeat(40), startedAt = new Date(Math.floor((clock.utc - 60000) / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const run = { id:12345, run_attempt:1, status:"in_progress", head_sha:base, name:"CI", path:".github/workflows/ci.yml", event:"pull_request_review", workflow_id:7,
    repository:{full_name:"haji84/AI-",private:false},head_repository:{full_name:"haji84/AI-"} };
  const jobs = { total_count:1,jobs:[{id:101,run_id:12345,run_attempt:1,name:"independent-verifier-container",status:"in_progress",head_sha:base,labels:["ubuntu-latest"],started_at:startedAt}] };
  config.metadata?.(run,jobs);
  const processModel = { platform:"linux",argv:["node","/public/repo/scripts/jarvis-verifier-live-ci.mjs","--execute-hosted-ci"],cwd:()=>"/public/repo",env,
    hrtime:{bigint:()=>{events.push("M");return clock.mono;}} };
  class ModelDate extends Date {static now(){events.push("W");config.utcRead?.(clock);return clock.utc;}}
  const fakeRequest = (options, callback) => {
    const request = new EventEmitter();request.destroy = ()=>{};request.end = ()=>globalThis.queueMicrotask(()=>{
      calls.push({kind:"GET",options});const index=apiIndex++, response=new EventEmitter();response.statusCode=config.status??200;response.resume=()=>{};
      response.rawHeaders=["Date",new Date(Math.floor(clock.utc/1000)*1000).toUTCString()];response.headers={};config.headers?.(response,index);
      callback(response);config.responseTime?.(clock,index);response.emit("data",config.oversize?Buffer.alloc(262145):Buffer.from(JSON.stringify(index===0?run:jobs)));response.emit("end");
    });return request;
  };
  // Old models keep the new wait at abstract zero modeled time so their
  // established arithmetic/assertions stay exact. Dedicated settle controls
  // below advance both original clocks; ONLY this fixed timer is intercepted.
  const modelSetTimeout=(callback,delay,...args)=>{
    if(delay!==30000)return setTimeout(callback,delay,...args);
    calls.push({kind:"settle",delay});globalThis.queueMicrotask(()=>{config.settle?.(clock);callback(...args);});return undefined;
  };
  const context={Buffer,Error,URL,Date:ModelDate,process:processModel,Set,WeakMap,Object,JSON,BigInt,Number,Math,Promise,
    setTimeout:modelSetTimeout,clearTimeout,delimiter,dirname,join,relative,resolve,sep,isAbsolute,fileURLToPath,createHash,randomUUID,
    failure:code=>Object.assign(Error(code),{code}),bounded:(n,max)=>Number.isInteger(n)&&n>0&&n<=max,
    statSync:()=>({isFile:()=>true,size:100}),realpathSync:path=>path,existsSync:()=>true,
    readFileSync:()=>{config.sourceRead?.(clock);return Buffer.from(sourceValue);},mkdirSync:path=>{if(ledger.has(path))throw Error("EEXIST");ledger.add(path);},
    writeFileSync:(path,_bytes,options)=>{if(options?.flag==="wx"&&ledger.has(path))throw Error("EEXIST");ledger.add(path);},
    execFileSync:(_file,args)=>{calls.push({kind:"baseGit",args});return args.includes("--show-toplevel")?"/public/repo\n":base+"\n";},httpsRequest:fakeRequest,
    dockerExecutable:()=>{config.resolveExecutable?.(clock);return "/public/bin/docker";},record:r=>({status:r.status,errorCode:r.error?.code??null,closeObserved:r.closeObserved,stdout:r.stdout}),
    runProcess:async(_exe,args,options)=>{calls.push({kind:"process",args,options});return config.runProcess?await config.runProcess(args,options,clock):{status:0,signal:null,stdout:"",stderr:"",closeObserved:true};}
  };
  runInNewContext(source+';globalThis.api={beginHostedCiEntry,bindHostedCiRequest,observeHostedCiBudget,runHostedCiContainer,expected:(t,n)=>hostedExpectedDocker(hostedState(t),n),state:t=>hostedState(t),identity:hostedOfficialIdentity};',context);
  const api=context.api;
  return {api,context,clock,calls,ledger,events,env,run,jobs,base,alterSource:()=>{sourceValue="changed public source";},
    advance:(ms,wall=ms)=>{clock.mono+=BigInt(ms)*1000000n;clock.utc+=wall;},
    async ready(){const entry=await api.beginHostedCiEntry();env.GORIQ_VERIFIER_OPERATOR_ISOLATED="1";env.GORIQ_VERIFIER_CONTAINER_IMAGE="registry/public@sha256:"+"d".repeat(64);
      const req={goalId:"public-goal",jobId:"public-job",changeSetId:"public-change",builderId:"builder",verifierId:"verifier",baseRevision:base,sourceRevision:"b".repeat(64),artifactDigest:"c".repeat(64),
        targetPath:"docs/public.txt",allowedUntracked:["docs/public.txt"],requiredChecks:["lint","typecheck","unit","integration","security","build"],candidateWorkspace:"/public/candidate",verifierWorkspace:"/public/runner",privateKeyFile:"/public/private/key",receiptFile:"/public/private/receipt",expiresAt:entry.context.expiresAt};
      return {...entry,req,options:{cwd:req.verifierWorkspace,env:{PATH:env.PATH,SystemRoot:""},untrustedExecutableRoots:[req.candidateWorkspace,req.verifierWorkspace,req.receiptFile+".logs/source"],maxBuffer:2097152}};
    }};
}

test("private hosted model retains both conservative official cuts, original capture, exact two GETs and exclusive cross-process entry",async()=>{
 const m=hostedPrivateModel(),r=await m.ready();assert.deepEqual(m.events.slice(0,2),["M","W"]);assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);
 assert.deepEqual(m.calls.filter(x=>x.kind==="GET").map(x=>x.options.path),["/repos/haji84/AI-/actions/runs/12345","/repos/haji84/AI-/actions/runs/12345/attempts/1/jobs?per_page=100"]);
 assert.equal(r.context.baseRevision,m.base);assert.notEqual(r.context.baseRevision,m.env.GITHUB_SHA);assert.ok(Object.isFrozen(r.token)&&Object.isFrozen(r.context));
 await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);const restarted=hostedPrivateModel({ledger:m.ledger});await assert.rejects(restarted.api.beginHostedCiEntry(),/ENTRY_FAILED/);assert.equal(restarted.calls.length,0);
 await assert.rejects(hostedBudget.runHostedCiContainer(r.token,r.req,"unit",[],{}),/TOKEN_INVALID/);
 m.api.bindHostedCiRequest(r.token,r.req);const before=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(2000);const after=m.api.observeHostedCiBudget(r.token,"SETUP");assert.ok(after.remainingMs<=before.remainingMs-2000);
});

test("private hosted metadata model refuses ambiguous stale future paginated cached redirected oversize late or cross-source inputs",async()=>{
 const cases=[{metadata:r=>{r.head_sha="e".repeat(40);}},{metadata:(_r,j)=>{j.jobs.push({...j.jobs[0]});j.total_count=2;}},{metadata:(_r,j)=>{j.total_count=101;}},
  {metadata:(_r,j)=>{j.jobs[0].run_id++;}},{metadata:(_r,j)=>{j.jobs[0].run_attempt=2;}},{metadata:(_r,j)=>{j.jobs[0].labels=["self-hosted"];}},
  {metadata:(_r,j)=>{j.jobs[0].started_at="2099-01-01T00:00:00Z";}},{metadata:(_r,j)=>{j.jobs[0].started_at="2000-01-01T00:00:00Z";}},
  {headers:r=>{r.rawHeaders.push("Date",r.rawHeaders[1]);}},{headers:r=>{r.rawHeaders[1]="not-a-date";}},{headers:r=>{r.rawHeaders.push("Age","1");}},
  {headers:r=>{r.headers.warning="110 stale";}},{headers:r=>{r.headers.link="next";}},{status:302},{oversize:true},{responseTime:c=>{c.mono+=10001n*1000000n;c.utc+=10001;}}];
 for(const config of cases){const m=hostedPrivateModel(config);await assert.rejects(m.api.beginHostedCiEntry(),/HOSTED_CI_/);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);}
});

test("private hosted budget rejects copied request tokens missing or mutated expiry host JSON fields and sticky context drift",async()=>{
 for(const change of [r=>{delete r.expiresAt;},r=>{r.expiresAt=new Date(Date.parse(r.expiresAt)+1).toISOString();},r=>{r.hostedBudget={unit:600001};},r=>{r.baseRevision="e".repeat(40);}]){
  const m=hostedPrivateModel(),r=await m.ready();change(r.req);assert.throws(()=>m.api.bindHostedCiRequest(r.token,r.req),/HOSTED_CI_/);assert.throws(()=>m.api.bindHostedCiRequest(r.token,{...r.req,expiresAt:r.context.expiresAt}),/HOSTED_CI_/);
 }
 for(const mutate of [(m,r)=>{r.req.sourceRevision="e".repeat(64);},m=>{m.env.GITHUB_RUN_ID="12346";},m=>m.alterSource()]){
  const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);mutate(m,r);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/HOSTED_CI_/);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/TERMINAL/);
 }
});

test("private hosted arithmetic model uses pre-UTC stamps, retained forward cuts, sticky rollback and minimum official projections",async()=>{
 const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);const first=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(1000,5000);const tightened=m.api.observeHostedCiBudget(r.token,"SETUP");assert.ok(tightened.remainingMs<=first.remainingMs-5000);
 m.advance(1000,0);assert.ok(m.api.observeHostedCiBudget(r.token,"SETUP").remainingMs<=tightened.remainingMs-1000);m.clock.utc--;assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/CLOCK_INVALID/);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/TERMINAL/);assert.ok(m.api.observeHostedCiBudget(r.token,"CLEANUP").remainingMs>0);
 const n=hostedPrivateModel(),s=await n.ready();n.api.bindHostedCiRequest(s.token,s.req);const cut=n.api.observeHostedCiBudget(s.token,"SETUP").retainedAcceptanceMono;const original=n.context.Date.now;n.context.Date.now=original; // bound production reference cannot be replaced through an option
 n.clock.mono+=5000000000n;const later=n.api.observeHostedCiBudget(s.token,"SETUP");assert.ok(BigInt(later.retainedAcceptanceMono)<=BigInt(cut));
 const upper=Date.now(),start=new Date(Math.floor((upper-60000)/1000)*1000).toISOString().replace(".000Z","Z"),jobs=JSON.parse(JSON.stringify(n.jobs));jobs.jobs[0].started_at=start;
 const a={body:n.run,dateMs:Math.floor(upper/1000)*1000,postMono:1000000000n,rttCeilMs:10000},b={body:jobs,dateMs:a.dateMs,postMono:2000000000n,rttCeilMs:0};const identity=n.api.identity(a,b,n.base),J=Date.parse(start)+2100000;
 const expected=[a,b].map(o=>o.postMono+BigInt(J-o.dateMs-1000-o.rttCeilMs)*1000000n).reduce((x,y)=>x<y?x:y);assert.equal(identity.outerMono,expected);assert.equal(identity.officialUtcCap,J-21000);
});

test("private hosted checks preserve fixed commands quotas sequential-once ceilings and refuse public timeout overrides",async()=>{
 const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);const names=[];
 for(const name of r.req.requiredChecks){const args=m.api.expected(r.token,name);assert.ok(args.includes("--network=none")&&args.includes("--memory=2g")&&args.includes("--pids-limit=128")&&args.includes("--cpus=3"));
  const output=await m.api.runHostedCiContainer(r.token,r.req,name,args,r.options);assert.equal(output.status,0);assert.equal(output.error,undefined);assert.equal(output.hostedBudget.ceilingMs,["unit","integration"].includes(name)?600000:180000);names.push(output.cleanup.containerName);}
 assert.equal(new Set(names).size,6);await assert.rejects(m.api.runHostedCiContainer(r.token,r.req,"lint",[],r.options),/CHECK_ORDER/);
 for(const timeoutMs of [300001,600001]){const n=hostedPrivateModel(),s=await n.ready();n.api.bindHostedCiRequest(s.token,s.req);await assert.rejects(n.api.runHostedCiContainer(s.token,s.req,"lint",n.api.expected(s.token,"lint"),{...s.options,timeoutMs}),/OPTIONS_INVALID/);assert.equal(n.calls.filter(x=>x.kind==="process").length,0);}
});

test("private hosted acceptance terminal still performs original-envelope cleanup; exhausted outer never starts renewed cleanup",async()=>{
 for(const elapsed of [1800001,2100001]){let first=true;const m=hostedPrivateModel({runProcess:async(args,_options,c)=>{if(args[0]==="run"&&first){first=false;c.mono+=BigInt(elapsed)*1000000n;c.utc+=elapsed;}return {status:0,signal:null,stdout:"",stderr:"",closeObserved:true};}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
  const result=await m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options);assert.ok(result.error);const launched=m.calls.filter(x=>x.kind==="process");assert.equal(launched.length,elapsed===1800001?3:1);assert.equal(result.cleanup.confirmed,elapsed===1800001);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SIGN_BEFORE"),/TERMINAL/);
 }
});

test("private pre-UTC pairing accounts a delayed UTC return and all 48 conservative official projections",async()=>{
 let inject=false;const m=hostedPrivateModel({utcRead:c=>{if(inject){inject=false;c.utc+=1000;c.mono+=5000000000n;}}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
 const first=m.api.observeHostedCiBudget(r.token,"SETUP");inject=true;const delayed=m.api.observeHostedCiBudget(r.token,"SETUP");assert.equal(BigInt(delayed.retainedAcceptanceMono),BigInt(first.retainedAcceptanceMono)-1000000000n);assert.ok(delayed.remainingMs<=first.remainingMs-6000);
 const D=Math.floor(Date.now()/1000)*1000,J=D-60000+2100000;let cases=0;
 for(const rtt of [0,1,9999,10000])for(const fraction of [0,999])for(const gap of [0,1,5000])for(const secondRtt of [0,10000]){
  const serverStart=D+fraction,serverPostA=serverStart+rtt,serverHeaderB=serverPostA+gap,serverPostB=serverHeaderB+secondRtt;
  const pa=1000000000000n+BigInt(rtt)*1000000n,pb=pa+BigInt(gap+secondRtt)*1000000n,jobs=JSON.parse(JSON.stringify(m.jobs));jobs.jobs[0].started_at=new Date(D-60000).toISOString().replace(".000Z","Z");
  const a={body:m.run,dateMs:D,postMono:pa,rttCeilMs:rtt},b={body:jobs,dateMs:Math.floor(serverHeaderB/1000)*1000,postMono:pb,rttCeilMs:secondRtt};
  const cut=m.api.identity(a,b,m.base).outerMono;assert.ok(cut<=pa+BigInt(J-serverPostA)*1000000n);assert.ok(cut<=pb+BigInt(J-serverPostB)*1000000n);cases++;
 }
 assert.equal(cases,48);
});

test("private concurrent use consumes acceptance but cannot mutate owned cleanup arguments or stop cleanup",async()=>{
 let release,first=true;const m=hostedPrivateModel({runProcess:async(args)=>{if(args[0]==="run"&&first){first=false;return await new Promise(resolve=>{release=resolve;});}return {status:0,signal:null,stdout:"",stderr:"",closeObserved:true};}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
 const main=m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options);
 r.options.cwd="/unrelated";r.options.env.DOCKER_HOST="PUBLIC_UNRELATED_DAEMON";r.options.env.PATH="/unrelated";
 await assert.rejects(m.api.runHostedCiContainer(r.token,r.req,"typecheck",[],r.options),/CHECK_ORDER/);
 release({status:0,signal:null,stdout:"",stderr:"",closeObserved:true});const result=await main;assert.ok(result.error);assert.equal(result.cleanup.confirmed,true);
 const processes=m.calls.filter(x=>x.kind==="process");assert.equal(processes.length,3);for(const call of processes){assert.equal(call.options.cwd,"/public/runner");assert.equal(call.options.env.PATH,"/public/bin");assert.equal(Object.hasOwn(call.options.env,"DOCKER_HOST"),false);}
});

test("private original outer eligibility is sticky after monotonic reversal even if the clock later recovers",async()=>{
 const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);m.clock.mono--;
 assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/MONOTONIC_INVALID/);m.clock.mono+=1000n;assert.throws(()=>m.api.observeHostedCiBudget(r.token,"CLEANUP"),/OUTER_CLOCK_INVALID/);
});


test("private final executable-resolution delay cannot launch after the original cut or keep an earlier larger allowance",async()=>{
 for(const delay of [1800001,5000]){let active=false;const m=hostedPrivateModel({resolveExecutable:c=>{if(active){c.mono+=BigInt(delay)*1000000n;c.utc+=delay;}}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);active=true;
  if(delay===5000)m.advance(1800000-379000-16000);
  const result=await m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options),launched=m.calls.filter(x=>x.kind==="process"&&x.args[0]==="run");
  if(delay===1800001){assert.equal(launched.length,0,"No child after delayed executable resolution crosses the original cut");assert.ok(result.error);}else{assert.equal(launched.length,1);assert.ok(launched[0].options.timeoutMs<=11000,"Final allowance must be recomputed after synchronous executable resolution");}
 }
});


// Real local processes exercise the same private CLI lifecycle used by hosted
// execution. This is not Docker/hosted isolation or 600-second acceptance proof.
test("real owned fake CLI timeout observes close then independently runs exact-name cleanup", {skip:process.platform!=="linux"}, async t=>{
 const noexecShared=readFileSync("/proc/self/mountinfo","utf8").split("\n").some(line=>line.split(" ")[4]==="/dev/shm"&&line.split(" ")[5].split(",").includes("noexec"));
 const root=mkdtempSync(join(noexecShared?"/dev/shm":tmpdir(),"goriq-real-cli-")),bin=join(root,"bin"),cwd=join(root,"workspace"),log=join(root,"calls.jsonl"),preload=join(root,"fixed-cli.cjs");mkdirSync(bin);mkdirSync(cwd);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 // Execute the installed Node image; temp code is read, never execve'd. This
 // remains meaningful inside the existing noexec tmpfs and creates no child.
 writeFileSync(preload,`const fs=require("node:fs"),path=require("node:path");const a=process.argv.slice(1);a[0]=path.basename(a[0]);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+"\\n");if(a[0]==="run"){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}else if(a[0]==="rm"||a[0]==="container"){process.exit(0);}else process.exit(2);\n`);
 symlinkSync(process.execPath,join(bin,"docker"));
 const harness=join(root,"actual-lifecycle.mjs"),moduleUrl=new URL("../scripts/jarvis-verifier-container.mjs",import.meta.url).href;
 const options={cwd,env:{PATH:bin,NODE_OPTIONS:"--require="+preload},timeoutMs:250,cleanupTimeoutMs:2000,killGraceMs:1000,maxBuffer:4096};
 // A fresh process cannot inherit earlier test.mock ESM spawn bindings.
 writeFileSync(harness,`import {runVerifierContainer} from ${JSON.stringify(moduleUrl)};const result=await runVerifierContainer(${JSON.stringify(runArgs)},${JSON.stringify(options)});process.stdout.write(JSON.stringify(result));`);
 const child=childProcess.spawnSync(process.execPath,[harness],{encoding:"utf8",timeout:5000});assert.equal(child.status,0);const result=JSON.parse(child.stdout);
 assert.equal(result.error?.code,"ETIMEDOUT");assert.equal(result.closeObserved,true);assert.equal(result.signal,"SIGKILL");assert.equal(result.cleanup.confirmed,true);
 assert.ok(result.cliTiming.elapsedMs>=250);const calls=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line));assert.equal(calls.length,3);
 const name=calls[0][calls[0].indexOf("--name")+1];assert.equal(result.cleanup.containerName,name);assert.deepEqual(calls[1],["rm","--force","--volumes",name]);assert.ok(calls[2].includes(`name=^/${name}$`));
 if(noexecShared)assert.ok(root.startsWith("/dev/shm/"));
});

function privateSafeGitModel(m,invoke){
 const source=readFileSync("scripts/jarvis-verifier-safe-git.mjs","utf8").replace(/^import .*;\n/gm,"").replace("export function safeGit","function safeGit");
 const context={...m.context,observeHostedCiBudget:m.api.observeHostedCiBudget,execFileSync:invoke};
 runInNewContext(source+";globalThis.callSafeGit=safeGit;",context);return context.callSafeGit;
}

test("private registered safeGit model clamps every inner invoke and refuses a late result before the next invoke",async()=>{
 for(const late of [false,true]){
  const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);const budget=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(budget.remainingMs-100);
  const calls=[],safe=privateSafeGitModel(m,(_exe,args,options)=>{calls.push({args,options});m.advance(late?101:10);return args[0]==="--version"?"git version 2.47.0\n":args.includes("config")?"":m.base+"\n";});
  if(late){assert.throws(()=>safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),/ACCEPTANCE_EXPIRED/);assert.equal(calls.length,1);assert.throws(()=>safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),/TERMINAL/);}
  else {assert.equal(safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),m.base);assert.deepEqual(calls.map(c=>c.options.timeout),[100,90,80]);for(const c of calls)assert.equal(c.options.killSignal,"SIGKILL");}
 }
});

test("private registered safeGit throw and reversal stay terminal while genuine unbound setup remains readonly",async()=>{
 for(const mode of ["throw-late","reverse"]){const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);let calls=0;
  const safe=privateSafeGitModel(m,()=>{calls++;if(mode==="reverse")m.clock.mono--;else m.advance(1800001);throw Error("PUBLIC_FIXED_EXEC_ERROR");});
  assert.throws(()=>safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),/HOSTED_CI_/);assert.equal(calls,1);assert.throws(()=>safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),/TERMINAL/);}
 const m=hostedPrivateModel(),r=await m.ready(),calls=[];const safe=privateSafeGitModel(m,(_exe,args,options)=>{calls.push(options);return args[0]==="--version"?"git version 2.47.0\n":args.includes("config")?"":m.base+"\n";});
 assert.equal(safe("/public/candidate",["rev-parse","HEAD"],{hostedCiLifetime:r.token}),m.base);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.timeout===8000));
 assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SIGN_BEFORE"),/REQUEST_NOT_BOUND/);await assert.rejects(m.api.runHostedCiContainer(r.token,r.req,"lint",[],r.options),/CHECK_ORDER|TERMINAL/);assert.equal(m.calls.filter(c=>c.kind==="process").length,0);
});

// Less than the fixed reserve plus child tail never becomes a 1ms child grant.
test("private hosted no-budget wrong-order cross-request and weakened resource vectors launch nothing",async()=>{
 for(const mode of ["no-budget","wrong-order","copy-request","weaken-memory"]){const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);let args=m.api.expected(r.token,"lint");
  if(mode==="no-budget"){const b=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(b.remainingMs-379000);}
  if(mode==="weaken-memory")args=args.map(x=>x==="--memory=2g"?"--memory=4g":x);
  await assert.rejects(m.api.runHostedCiContainer(r.token,mode==="copy-request"?{...r.req}:r.req,mode==="wrong-order"?"unit":"lint",args,r.options),/HOSTED_CI_/);assert.equal(m.calls.filter(c=>c.kind==="process").length,0);
 }
});


import { generateKeyPairSync, sign as signModelBytes } from "node:crypto";
import { verifierCommand,verifierCheckTimeoutMs,validateVerifierRunRequest,createTrustedVerifierSigner } from "../scripts/jarvis-independent-check-runner.mjs";
test("private actual runner models refuse late valid signer results and binding drift before any receipt write",async()=>{
 const source=readFileSync("scripts/jarvis-independent-check-runner.mjs","utf8"),start=source.indexOf("export async function runIndependentVerifier"),end=source.indexOf('\nif(process.argv[1]',start),canonicalStart=source.indexOf("function canonical(payload)"),canonicalEnd=source.indexOf("function externalPath",canonicalStart);assert.ok(start>0&&end>start);
 const keys=generateKeyPairSync("ed25519"),publicKeyPem=keys.publicKey.export({type:"spki",format:"pem"}).toString();
 for(const mode of ["on-time","late-valid-signature","rollback","request-drift","late-private-write"]){
  const m=hostedPrivateModel(),r=await m.ready();delete r.req.privateKeyFile;const writes=[],identity={artifactDigest:r.req.artifactDigest,candidateRevision:r.req.sourceRevision,fileHashes:{[r.req.targetPath]:"e".repeat(64)}};
  const context={...m.context,Date,verify:undefined,validateVerifierRunRequest,verifierCommand,verifierCheckTimeoutMs,createTrustedVerifierSigner,
   bindHostedCiRequest:m.api.bindHostedCiRequest,observeHostedCiBudget:m.api.observeHostedCiBudget,runHostedCiContainer:m.api.runHostedCiContainer,
   safeGit:(_cwd,args)=>args[0]==="status"?"":m.base,exactGitRoot:p=>p,attestLocalCandidate:()=>identity,externalPath:(_c,_r,p)=>p,
   existsSync:()=>false,realpathSync:p=>p,mkdirSync:()=>{},copyFileSync:()=>{},constants:{COPYFILE_EXCL:1},exportSnapshot:()=>{},
   hash:b=>createHash("sha256").update(b).digest("hex"),writeFileSync:(p,b)=>{writes.push({path:p,bytes:Buffer.from(b)});if(mode==="late-private-write"&&p===r.req.receiptFile)m.advance(1800001);}};
  runInNewContext(source.slice(canonicalStart,canonicalEnd)+source.slice(start,end).replace("export async function","async function")+";globalThis.runActual=runIndependentVerifier;",context);
  let signed=0;const options={hostedCiLifetime:r.token,signerTransport:{publicKeyPem,sign:bytes=>{signed++;const signature=signModelBytes(null,bytes,keys.privateKey).toString("base64");
    if(mode==="late-valid-signature")m.advance(1800001);if(mode==="rollback")m.clock.utc--;if(mode==="request-drift")r.req.allowedUntracked.push("docs/changed.txt");return signature;}}};
  if(mode==="on-time"){const result=await context.runActual(r.req,options);assert.equal(result.verified,false);assert.equal(result.provisionalVerified,true);assert.equal(writes.filter(w=>w.path===r.req.receiptFile).length,1);}
  else {await assert.rejects(context.runActual(r.req,options),/HOSTED_CI_/);assert.equal(writes.filter(w=>w.path===r.req.receiptFile).length,mode==="late-private-write"?1:0);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"AUDIT_BEFORE"),/TERMINAL/);}
  assert.equal(signed,1);assert.equal(m.calls.filter(c=>c.kind==="process"&&c.args[0]==="run").length,6);assert.ok(writes.every(w=>w.path.startsWith("/public/private/")));assert.ok(m.api.observeHostedCiBudget(r.token,"CLEANUP").remainingMs>0);
 }
});


// Regression for the independent exact-source metadata-forward finding. All
// clock/executor state is confined to the existing private VM test model.
test("private every metadata UTC observation retains its pre-UTC minimum across later stalled-wall scheduling",async()=>{
 for(const responseIndex of [0,1])for(const [forwardMs,delayMs] of [[5000,0],[5000,4000],[4000,5000]])for(const delayedUtcReturn of [false,true]){
  let pending=false;const m=hostedPrivateModel({responseTime:(c,index)=>{if(index===responseIndex){if(delayedUtcReturn)pending=true;else {c.utc+=forwardMs;globalThis.queueMicrotask(()=>{c.mono+=BigInt(delayMs)*1000000n;});}}},
   utcRead:c=>{if(pending){pending=false;c.utc+=forwardMs;c.mono+=BigInt(delayMs)*1000000n;}}});
  const origin=m.clock.mono,entry=await m.api.beginHostedCiEntry(),sample=m.api.observeHostedCiBudget(entry.token,"SETUP"),required=origin+BigInt(1800000-forwardMs)*1000000n;
  assert.ok(BigInt(sample.retainedAcceptanceMono)<=required,`GET${responseIndex+1} forward${forwardMs} delay${delayMs} delayedUTC${delayedUtcReturn} lost its observed minimum`);
  assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.ok(BigInt(sample.retainedAcceptanceMono)<=BigInt(sample.originalAcceptanceMono));
 }
});

test("private metadata completion already beyond its newly observed cut refuses before the next GET",async()=>{
 let consumed=false,pending=false;const m=hostedPrivateModel({sourceRead:c=>{if(!consumed){consumed=true;c.mono+=1795000n*1000000n;c.utc+=1795000;}},
  responseTime:(_c,index)=>{if(index===0)pending=true;},utcRead:c=>{if(pending){pending=false;c.utc+=4000;c.mono+=3000n*1000000n;}}});
 await assert.rejects(m.api.beginHostedCiEntry(),/ACCEPTANCE_EXPIRED/);assert.equal(m.calls.filter(x=>x.kind==="GET").length,1);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);
});


// Preserve observed child diagnostics separately from hosted acceptance refusal.
test("private hosted child timeout overflow and timely nonzero exit retain original cause and completed-failure classification",async()=>{
 for(const childCode of ["ETIMEDOUT","ENOBUFS","NONZERO_EXIT"]){
  const m=hostedPrivateModel({runProcess:async args=>args[0]==="run"?{status:childCode==="NONZERO_EXIT"?1:null,signal:childCode==="NONZERO_EXIT"?null:"SIGKILL",stdout:"",stderr:"",closeObserved:true,
   ...(childCode==="NONZERO_EXIT"?{}:{error:Object.assign(Error(childCode),{code:childCode})})}:{status:0,signal:null,stdout:"",stderr:"",closeObserved:true}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
  const output=await m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options);
  assert.equal(output.error?.code??null,childCode==="NONZERO_EXIT"?null:childCode);assert.equal(output.status,childCode==="NONZERO_EXIT"?1:null);assert.equal(output.signal,childCode==="NONZERO_EXIT"?null:"SIGKILL");assert.equal(output.closeObserved,true);
  assert.equal(output.cleanup.confirmed,true);assert.equal(output.hostedBudget.failureCode,"HOSTED_CI_CHECK_FAILED");assert.equal(output.hostedBudget.acceptanceEligible,false);
  const classification=output.error||output.status===null?"inconclusive":output.status===0?"passed":"failed";assert.equal(classification,childCode==="NONZERO_EXIT"?"failed":"inconclusive");
  assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SETUP"),/TERMINAL/);await assert.rejects(m.api.runHostedCiContainer(r.token,r.req,"typecheck",[],r.options),/TERMINAL|OPTIONS_INVALID/);assert.equal(m.calls.filter(x=>x.kind==="process").length,3);
 }
});

test("private late drifted or cleanup-uncertain nonzero result remains inconclusive with observed exit and sticky hosted refusal",async()=>{
 for(const mode of ["late","drift","cleanup-uncertain"]){const m=hostedPrivateModel({runProcess:async(args,_o,c)=>{
   if(args[0]==="run"){if(mode==="late"){c.mono+=1800001n*1000000n;c.utc+=1800001;}if(mode==="drift")m.env.GITHUB_RUN_ID="12346";return {status:1,signal:null,stdout:"",stderr:"",closeObserved:true};}
   return {status:0,signal:null,stdout:mode==="cleanup-uncertain"&&args[0]==="container"?"owned-container-remains":"",stderr:"",closeObserved:true};}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
  const output=await m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options);assert.equal(output.status,1);assert.equal(output.closeObserved,true);assert.ok(output.error);assert.equal(output.hostedBudget.acceptanceEligible,false);assert.ok(output.hostedBudget.failureCode);
  assert.equal(output.error||output.status===null?"inconclusive":output.status===0?"passed":"failed","inconclusive");assert.equal(output.cleanup.attempted,true);assert.equal(m.calls.filter(x=>x.kind==="process").length,3);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SIGN_BEFORE"),/TERMINAL/);
 }
});


// Fixed diagnostic bits correspond one-for-one to the unchanged run-refusal
// expression. This private VM model never exposes a production injection API.
function runDiagnosticPrivateModel(config={},capturedId){
 const m=hostedPrivateModel(config);if(capturedId===undefined)return m;
 m.env.GITHUB_RUN_ID=capturedId;const context={...m.context};
 const code=readFileSync("scripts/jarvis-verifier-container.mjs","utf8"),source=code.slice(code.indexOf("// Hosted entry lifetime.")).replaceAll("import.meta.url",'"file:///public/repo/scripts/jarvis-verifier-container.mjs"').replaceAll(/^export /gm,"");
 runInNewContext(source+";globalThis.runDiagnosticApi={beginHostedCiEntry,bindHostedCiRequest,observeHostedCiBudget,runHostedCiContainer,identity:hostedOfficialIdentity};",context);return {...m,api:context.runDiagnosticApi};
}
const runDiagnosticPrefix="HOSTED_CI_OFFICIAL_RUN_MISMATCH:RUN_IDENTITY_V1:";
test("private official run mismatch reports only the same thirteen atomic predicate bits without issuing or replaying entry",async()=>{
 const cases=[
  {bits:[0],capturedId:"9007199254740992",change:r=>{r.id=9007199254740992;}},
  {bits:[1],change:r=>{r.id++;}},{bits:[2],change:r=>{r.run_attempt=2;}},{bits:[3],change:r=>{r.status="PUBLIC_DIAGNOSTIC_CANARY";}},
  {bits:[4],change:r=>{r.head_sha="e".repeat(40);}},{bits:[5],change:r=>{r.name="PUBLIC_DIAGNOSTIC_CANARY";}},{bits:[6],change:r=>{r.path="PUBLIC_DIAGNOSTIC_CANARY";}},
  {bits:[7],change:r=>{r.event="PUBLIC_DIAGNOSTIC_CANARY";}},{bits:[8],change:r=>{r.repository.full_name="PUBLIC_DIAGNOSTIC_CANARY";}},{bits:[9],change:r=>{r.repository.private=true;}},
  {bits:[10],change:r=>{r.head_repository.full_name="PUBLIC_DIAGNOSTIC_CANARY";}},{bits:[11],change:r=>{r.workflow_id=7.5;}},{bits:[12],change:r=>{r.workflow_id=0;}},
  {bits:[3,4,8,10],change:r=>{r.status="queued";r.head_sha="e".repeat(40);r.repository.full_name="PUBLIC_DIAGNOSTIC_CANARY";r.head_repository.full_name="PUBLIC_DIAGNOSTIC_CANARY";}},
  {bits:[1,6,9,12],change:r=>{r.id++;r.path="PUBLIC_DIAGNOSTIC_CANARY";r.repository.private=true;r.workflow_id=0;}}
 ];
 for(const item of cases){const m=runDiagnosticPrivateModel({metadata:item.change},item.capturedId),expected=Array.from({length:13},(_x,i)=>item.bits.includes(i)?"1":"0").join("");let issued=false;
  await assert.rejects(m.api.beginHostedCiEntry().then(value=>{issued=true;return value;}),error=>{assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.equal(error.message,runDiagnosticPrefix+expected);assert.equal(error.message.includes("PUBLIC_DIAGNOSTIC_CANARY"),false);return true;});
  assert.equal(issued,false);assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);
  await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);
 }
});

test("private malformed official run inputs keep canonical refusal and fixed mask without serializing input",()=>{
 for(const body of [null,undefined,false,3,"PUBLIC_DIAGNOSTIC_CANARY",[],{}]){const m=hostedPrivateModel();assert.throws(()=>m.api.identity({body},{body:m.jobs},m.base),error=>{
  assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.match(error.message,/^HOSTED_CI_OFFICIAL_RUN_MISMATCH:RUN_IDENTITY_V1:[01]{13}$/);assert.equal(error.message.includes("PUBLIC_DIAGNOSTIC_CANARY"),false);return true;});assert.equal(m.calls.length,0);}
 const m=hostedPrivateModel();m.run.repository=null;assert.throws(()=>m.api.identity({body:m.run},{body:m.jobs},m.base),error=>error.code==="HOSTED_CI_OFFICIAL_RUN_MISMATCH"&&/^HOSTED_CI_OFFICIAL_RUN_MISMATCH:RUN_IDENTITY_V1:[01]{13}$/.test(error.message));
});

test("private entry refuses copied diagnostic messages and malicious properties instead of reflecting arbitrary errors",async()=>{
 for(const message of [runDiagnosticPrefix+"1".repeat(13),runDiagnosticPrefix+"1".repeat(12),runDiagnosticPrefix+"1".repeat(14),runDiagnosticPrefix+"1".repeat(13)+"PUBLIC_DIAGNOSTIC_CANARY","PUBLIC_DIAGNOSTIC_CANARY"]){
  const fake=Object.assign(Error(message),{code:"HOSTED_CI_OFFICIAL_RUN_MISMATCH",runPredicateMask:"1".repeat(13),hostedRunPredicateMask:"PUBLIC_DIAGNOSTIC_CANARY",diagnostic:runDiagnosticPrefix+"1".repeat(13)});
  const m=hostedPrivateModel({sourceRead:()=>{throw fake;}});await assert.rejects(m.api.beginHostedCiEntry(),error=>{assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.equal(error.message,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");return true;});assert.equal(m.calls.filter(x=>x.kind==="GET"||x.kind==="process").length,0);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);
 }
});

test("private valid official entry stays unchanged and non-run metadata failures keep their canonical codes",async()=>{
 const m=hostedPrivateModel(),entry=await m.api.beginHostedCiEntry();assert.ok(Object.isFrozen(entry.token)&&Object.isFrozen(entry.context));assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);
 for(const [change,code] of [[(_r,j)=>{j.total_count=101;},"HOSTED_CI_OFFICIAL_JOBS_INVALID"],[(_r,j)=>{j.jobs[0].labels=["self-hosted"];},"HOSTED_CI_OFFICIAL_JOB_INVALID"]]){
  const n=hostedPrivateModel({metadata:change});await assert.rejects(n.api.beginHostedCiEntry(),error=>{assert.equal(error.code,code);assert.equal(error.message,code);return true;});assert.equal(n.calls.filter(x=>x.kind==="GET").length,2);assert.equal(n.calls.filter(x=>x.kind==="process").length,0);
 }
});

test("private malformed workflow comparison cannot replace canonical run refusal with a diagnostic exception",async()=>{
 for(const workflow of [{toString:"PUBLIC_DIAGNOSTIC_CANARY"},{valueOf:"PUBLIC_DIAGNOSTIC_CANARY",toString:"PUBLIC_DIAGNOSTIC_CANARY"},{valueOf:[]},{valueOf:null},[],[7],null]){
  const m=hostedPrivateModel({metadata:r=>{r.workflow_id=workflow;}});await assert.rejects(m.api.beginHostedCiEntry(),error=>{
   assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.equal(error.message,runDiagnosticPrefix+"0000000000011");assert.equal(error.message.includes("PUBLIC_DIAGNOSTIC_CANARY"),false);return true;
  });assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);
 }
});


test("private combined malformed run diagnostics mark the unreachable workflow comparison invalid without coercion",async()=>{
 const m=hostedPrivateModel({metadata:r=>{r.status="queued";r.path="PUBLIC_DIAGNOSTIC_CANARY";r.repository.private=true;r.workflow_id={valueOf:null};}});
 await assert.rejects(m.api.beginHostedCiEntry(),error=>{assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.equal(error.message,runDiagnosticPrefix+Array.from({length:13},(_x,i)=>[3,6,9,11,12].includes(i)?"1":"0").join(""));return true;});
 assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);
});


test("private fixed settling wait follows original allocation source and Git and consumes original clocks without renewal",async()=>{
 for(const [monoMs,utcMs] of [[30000,30000],[45000,45000],[30000,50000],[45000,30000]]){
  let sourceReads=0,atSettle;const m=hostedPrivateModel({sourceRead:()=>{sourceReads++;},settle:c=>{atSettle={git:m.calls.filter(x=>x.kind==="baseGit").length,gets:m.calls.filter(x=>x.kind==="GET").length,sourceReads,claimed:m.ledger.has("/public/temp/goriq-verifier-live-evidence/entry.json")};c.mono+=BigInt(monoMs)*1000000n;c.utc+=utcMs;}});
  const originalMono=m.clock.mono,originalUtc=m.clock.utc,entry=await m.api.beginHostedCiEntry(),budget=m.api.observeHostedCiBudget(entry.token,"SETUP");
  assert.equal(m.calls.filter(x=>x.kind==="settle").length,1);assert.deepEqual(atSettle,{git:2,gets:0,sourceReads:6,claimed:true});
  assert.equal(entry.context.originalModuleMono,String(originalMono));assert.equal(entry.context.originalModuleUtc,originalUtc);assert.equal(entry.context.originalAcceptanceMono,String(originalMono+1800000n*1000000n));
  assert.equal(budget.remainingMs,1800000-Math.max(monoMs,utcMs));assert.ok(Date.parse(entry.context.expiresAt)<=originalUtc+1800000);assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);
 }
});

test("private settle overshoot expiry rollback forward and identity drift refuse before metadata and retain anti-remint",async()=>{
 const cases=[{name:"original equality",mono:1800000,utc:1800000,code:"ACCEPTANCE_EXPIRED"},{name:"UTC expired",mono:30000,utc:1800000,code:"ACCEPTANCE_EXPIRED"},
  {name:"UTC rollback",mono:30000,utc:-1,code:"CLOCK_INVALID"},{name:"mono reversal",mono:-1,utc:30000,code:"MONOTONIC_INVALID"},
  {name:"context",mono:30000,utc:30000,code:"CONTEXT_DRIFT",mutate:m=>{m.env.GITHUB_JOB="other";}},{name:"source",mono:30000,utc:30000,code:"SOURCE_DRIFT",mutate:m=>m.alterSource()}];
 for(const item of cases){const m=hostedPrivateModel({settle:c=>{c.mono+=BigInt(item.mono)*1000000n;c.utc+=item.utc;item.mutate?.(m);}});let issued=false;
  await assert.rejects(m.api.beginHostedCiEntry().then(value=>{issued=true;return value;}),new RegExp(item.code),item.name);assert.equal(issued,false);assert.equal(m.calls.filter(x=>x.kind==="settle").length,1);assert.equal(m.calls.filter(x=>x.kind==="GET"||x.kind==="process").length,0);assert.ok(m.ledger.has("/public/temp/goriq-verifier-live-evidence/entry.json"));
  await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);assert.equal(m.calls.filter(x=>x.kind==="settle").length,1);
 }
});

test("private pending settle cannot replay or replace strict in-progress identity with a retry",async()=>{
 for(const status of ["in_progress","queued","completed",null,{}]){const m=hostedPrivateModel({metadata:r=>{r.status=status;},settle:c=>{c.mono+=30000n*1000000n;c.utc+=30000;}});
  const first=m.api.beginHostedCiEntry();assert.equal(m.calls.filter(x=>x.kind==="settle").length,1);assert.equal(m.calls.filter(x=>x.kind==="GET").length,0);const replay=m.api.beginHostedCiEntry();await assert.rejects(replay,/ENTRY_REFUSED/);
  if(status==="in_progress"){const entry=await first;assert.ok(Object.isFrozen(entry.token));}else await assert.rejects(first,error=>{assert.equal(error.code,"HOSTED_CI_OFFICIAL_RUN_MISMATCH");assert.equal(error.message,"HOSTED_CI_OFFICIAL_RUN_MISMATCH:RUN_IDENTITY_V1:0001000000000");return true;});
  assert.equal(m.calls.filter(x=>x.kind==="settle").length,1);assert.equal(m.calls.filter(x=>x.kind==="GET").length,2);assert.equal(m.calls.filter(x=>x.kind==="process").length,0);await assert.rejects(m.api.beginHostedCiEntry(),/ENTRY_REFUSED/);
 }
});

// R66 prospective fixed hosted reserve amendment. Source65 remains historical
// FAIL; these snapshots compare child admission only, not check completion.
test("R66 frozen Source65 admission snapshots use the prospectively adopted reserve",async()=>{
 for(const row of [{name:"integration",remaining:1142289,old:523289,expected:600000},{name:"security",remaining:632931,old:13931,expected:180000}]){
  const m=hostedPrivateModel(),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
  for(const name of r.req.requiredChecks.slice(0,r.req.requiredChecks.indexOf(row.name))){const result=await m.api.runHostedCiContainer(r.token,r.req,name,m.api.expected(r.token,name),r.options);assert.equal(result.status,0);}
  const before=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(before.remainingMs-row.remaining);
  assert.equal(m.api.observeHostedCiBudget(r.token,"SETUP").remainingMs,row.remaining);
  assert.equal(Math.min(["unit","integration"].includes(row.name)?600000:180000,row.remaining-600000-19000),row.old);
  const result=await m.api.runHostedCiContainer(r.token,r.req,row.name,m.api.expected(r.token,row.name),r.options);
  const launched=m.calls.filter(c=>c.kind==="process"&&c.args[0]==="run").at(-1);
  assert.equal(result.error,undefined);assert.equal(launched.options.timeoutMs,row.expected,row.name);
  assert.equal(result.hostedBudget.reserveMs,360000);
 }
});

test("R66 zero and genuine1ms boundary final resolution retain the original admission cut",async()=>{
 for(const row of [{remaining:379000,delay:0,launch:false},{remaining:379001,delay:0,launch:true},{remaining:379001,delay:1,launch:false}]){
  let active=false,resolutions=0;const m=hostedPrivateModel({resolveExecutable:c=>{if(active){resolutions++;c.mono+=BigInt(row.delay)*1000000n;c.utc+=row.delay;}}}),r=await m.ready();m.api.bindHostedCiRequest(r.token,r.req);
  const before=m.api.observeHostedCiBudget(r.token,"SETUP");m.advance(before.remainingMs-row.remaining);active=true;
  let result;try{result=await m.api.runHostedCiContainer(r.token,r.req,"lint",m.api.expected(r.token,"lint"),r.options);}catch(error){result={error};}
  const launched=m.calls.filter(c=>c.kind==="process"&&c.args[0]==="run");
  assert.equal(launched.length,row.launch?1:0,JSON.stringify(row));
  if(row.launch){assert.equal(launched[0].options.timeoutMs,1);assert.equal(result.error,undefined);}else{assert.ok(result.error);assert.throws(()=>m.api.observeHostedCiBudget(r.token,"SIGN_BEFORE"),/TERMINAL/);}
  if(row.remaining===379000)assert.equal(resolutions,0,"No executable resolution without genuine allowance");
 }
});

function r66RuntimeFactsSource(){
 const workflow=readFileSync(".github/workflows/ci.yml","utf8"),marker="      - name: Collect bounded public test runtime facts\n        if: always()\n        timeout-minutes: 1\n        shell: bash\n        run: |\n          python3 - <<'PY'\n";
 const start=workflow.indexOf(marker);assert.ok(start>=0,"The bounded always-after-Test runtime facts step must exist");
 const end=workflow.indexOf("          PY\n",start+marker.length);assert.ok(end>start);
 const source=workflow.slice(start+marker.length,end).split("\n").map(line=>{assert.ok(!line||line.startsWith("          "));return line.slice(10);}).join("\n");
 assert.ok(workflow.indexOf("      - name: Test\n        run: pnpm test\n")<start);
 return {source,workflow,addition:workflow.slice(start,end+"          PY\n".length)};
}

test("R66 runtime facts preserves the entire prior workflow outside one after-Test diagnostic",()=>{
 const {source,workflow,addition}=r66RuntimeFactsSource();
 assert.equal(createHash("sha256").update(restoreR66WorkflowBaseline(workflow.replace(addition,""))).digest("hex"),"e5cd90e8c3d25858d85eb44959f11206db46bd850ee7e6e2e0dc7dc4f7286c26");
 assert.ok(source.includes("PUBLIC_TEST_RUNTIME_DIAGNOSTIC_ONLY"));assert.ok(source.includes("INCONCLUSIVE_IO"));
 for(const forbidden of ["os.environ.items", "os.environ.copy", "check_output", "shell=True", "resource.setrlimit", "SetMinThreads", "continue-on-error"])assert.equal(source.includes(forbidden),false,forbidden);
});

test("R66 runtime facts closes IO errors and hostile settings without raw values",{skip:process.platform!=="linux"},()=>{
 const {source}=r66RuntimeFactsSource(),body=source.slice(0,source.lastIndexOf("print(json.dumps(collect_facts()"));assert.ok(body.length>0);
 const harness=body+`\nfrom unittest.mock import patch\nsecret='PRIVATE_DO_NOT_PRINT'\nresults=[]\nwith patch('shutil.which',side_effect=OSError(secret)):\n results.append(collect_facts())\nwith patch('shutil.which',return_value=None),patch('resource.getrlimit',side_effect=OSError(secret)),patch.dict(os.environ,{'DOTNET_DefaultStackSize':secret,'COMPlus_DefaultStackSize':'0x100000'}):\n results.append(collect_facts())\nfor value in ['1','FFFFFFFF','10000\\x00','0x10000\\n',secret]:\n with patch('shutil.which',return_value=None),patch('os.environ',{'DOTNET_DefaultStackSize':value}):\n  results.append(collect_facts())\nwith patch('shutil.which',return_value='/missing/'+secret):\n results.append(collect_facts())\nprint(json.dumps(results,sort_keys=True))\n`;
 const result=childProcess.spawnSync("python3",["-"],{input:harness,encoding:"utf8",timeout:5000,maxBuffer:65536});assert.equal(result.status,0);assert.equal(result.stderr,"");assert.equal(result.stdout.includes("PRIVATE_DO_NOT_PRINT"),false);
 const rows=JSON.parse(result.stdout);assert.equal(rows.length,8);assert.equal(rows[0].pwsh.state,"INCONCLUSIVE_IO");assert.equal(rows[1].stackLimit.state,"INCONCLUSIVE_IO");assert.deepEqual(rows[1].COMPlus_DefaultStackSize,{state:"CANONICAL_BOUNDED_HEX_BYTES",bytes:1048576});
 for(const row of rows.slice(1,7))assert.equal(row.DOTNET_DefaultStackSize.state,"INCONCLUSIVE_NONCANONICAL");assert.equal(rows.at(-1).pwsh.state,"INCONCLUSIVE_IO");
});

test("R66 runtime facts real local pwsh observation stays bounded public DATA",{skip:process.platform!=="linux"},()=>{
 const {source}=r66RuntimeFactsSource();const result=childProcess.spawnSync("python3",["-"],{input:source,encoding:"utf8",timeout:18000,maxBuffer:16384});assert.equal(result.status,0);assert.equal(result.stderr,"");
 const facts=JSON.parse(result.stdout);assert.equal(facts.purpose,"PUBLIC_TEST_RUNTIME_DIAGNOSTIC_ONLY");assert.equal(facts.authority,false);
 assert.equal(facts.pwsh.state,"CLOSED_VALID_FACTS");assert.match(facts.pwsh.binarySha256,/^[a-f0-9]{64}$/);assert.match(facts.pwsh.version,/^[0-9]+\.[0-9]+\.[0-9]+$/);assert.ok(["FullLanguage","ConstrainedLanguage","NoLanguage","RestrictedLanguage"].includes(facts.pwsh.languageMode));
});

test("R66 fixed runtime probe caps bytes and retains error timeout and cleanup uncertainty",{skip:process.platform!=="linux"},()=>{
 const {source}=r66RuntimeFactsSource(),body=source.slice(0,source.lastIndexOf("print(json.dumps(collect_facts()"));
 const harness=body+`\nfrom unittest.mock import patch\nfrom io import BytesIO\nclass Pipe:\n def __init__(self,n):self.n=n\n def fileno(self):return self.n\n def close(self):pass\nclass Child:\n def __init__(self,status=0,cleanup=False):self.stdout=Pipe(1);self.stderr=Pipe(2);self.status=status;self.cleanup=cleanup;self.killed=False;self.args=None\n def poll(self):return self.status\n def wait(self,timeout=None):\n  if self.cleanup:raise subprocess.TimeoutExpired('fixed',1)\n  return self.status\n def kill(self):self.killed=True\nclass Selector:\n def __init__(self):self.map={}\n def register(self,p,event,name):self.map[p.n]=type('Key',(),{'fileobj':p,'data':name})()\n def get_map(self):return self.map\n def unregister(self,p):del self.map[p.n]\n def select(self,timeout):return [(v,1) for v in list(self.map.values())]\n def close(self):pass\nresults=[]\nfor mode in ['valid','stderr','nonzero','malformed','overflow','timeout','cleanup','spawn-io','pipe-io']:\n child=Child(7 if mode=='nonzero' else 0,mode=='cleanup')\n chunks={1:[b'7.5.4\\n.NET 9.0.10\\nFullLanguage\\n',b''],2:[b'']}\n if mode=='stderr':chunks[2]=[b'PRIVATE_DO_NOT_PRINT',b'']\n if mode=='malformed':chunks[1]=[b'PRIVATE_DO_NOT_PRINT',b'']\n if mode=='overflow':chunks[1]=[b'X'*4097]\n def read(fd,n):\n  if mode=='pipe-io':raise OSError('PRIVATE_DO_NOT_PRINT')\n  return chunks[fd].pop(0)\n def popen(args,**kwargs):\n  assert args==['/fixed/pwsh','-NoLogo','-NoProfile','-NonInteractive','-Command','[Console]::Out.WriteLine($PSVersionTable.PSVersion.ToString());[Console]::Out.WriteLine([Runtime.InteropServices.RuntimeInformation]::FrameworkDescription);[Console]::Out.WriteLine($ExecutionContext.SessionState.LanguageMode.ToString())']\n  assert kwargs=={'stdout':subprocess.PIPE,'stderr':subprocess.PIPE}\n  if mode=='spawn-io':raise OSError('PRIVATE_DO_NOT_PRINT')\n  return child\n times=iter([0,15] if mode=='timeout' else [0]+[0]*100)\n with patch('subprocess.Popen',side_effect=popen),patch('selectors.DefaultSelector',Selector),patch('os.set_blocking'),patch('os.read',side_effect=read),patch('time.monotonic',side_effect=lambda:next(times)):\n  results.append(probe_runtime('/fixed/pwsh'))\nprint(json.dumps(results,sort_keys=True))\n`;
 const result=childProcess.spawnSync("python3",["-"],{input:harness,encoding:"utf8",timeout:5000,maxBuffer:65536});assert.equal(result.status,0);assert.equal(result.stderr,"");assert.equal(result.stdout.includes("PRIVATE_DO_NOT_PRINT"),false);
 assert.deepEqual(JSON.parse(result.stdout).map(r=>r.state),["CLOSED_VALID_FACTS","INCONCLUSIVE_CLOSED_PROBE","INCONCLUSIVE_CLOSED_PROBE","INCONCLUSIVE_CLOSED_PROBE","INCONCLUSIVE_OUTPUT_BOUND","INCONCLUSIVE_TIMEOUT","INCONCLUSIVE_CLEANUP","INCONCLUSIVE_IO","INCONCLUSIVE_IO"]);
});

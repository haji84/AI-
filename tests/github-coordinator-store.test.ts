import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { DistributedCoordinatorRuntime } from '../src/gai/distributed-coordinator.ts';
import { GitHubCoordinatorStore } from '../scripts/goriq-github-coordinator-store.ts';

const repository = 'fixture-owner/fixture-repo';
const branch = 'goriq-state/fixture';
const path = 'state/coordinator.enc.json';
const clusterId = 'fixture-cluster';
const token = 'fixture-token-not-a-live-credential';
const key = Buffer.alloc(32, 0x31);
const api = `https://api.github.com/repos/${repository}/contents/${path}`;
const original = {
  clusterId, coordinatorId: 'runner-A', epoch: 1,
  fencingToken: 'fixture-fence-1', issuedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', leaseUntil: '2026-01-01T00:01:00.000Z',
};
const renewed = {...original, updatedAt: '2026-01-01T00:00:30.000Z', leaseUntil: '2026-01-01T00:01:30.000Z'};
const takeover = {...original, coordinatorId: 'runner-B', epoch: 2, fencingToken: 'fixture-fence-2',
  issuedAt: '2026-01-01T00:02:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z', leaseUntil: '2026-01-01T00:03:00.000Z'};
const blob = (bytes: Buffer) => createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
function seal(value: unknown, overrides: {branch?: string; key?: Buffer} = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', overrides.key ?? key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(['goriq-coordinator-v1', repository, overrides.branch ?? branch, path, clusterId])));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.from(JSON.stringify({version:1, algorithm:'aes-256-gcm', nonce:iv.toString('base64'),
    ciphertext:data.toString('base64'), tag:cipher.getAuthTag().toString('base64')}));
}
function fixture(initial: Buffer | null = seal(original)) {
  let bytes = initial;
  const requests: {url:string; init:RequestInit}[] = [];
  let putCount = 0;
  let hook: ((url:string, init:RequestInit) => Response | Promise<Response> | null) | undefined;
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input); requests.push({url,init});
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${token}`);
    if (hook) { const result = await hook(url, init); if(result) return result; }
    if (init.method === 'GET') {
      assert.equal(url, `${api}?ref=${encodeURIComponent(branch)}`);
      return bytes ? Response.json({type:'file', path, encoding:'base64', sha:blob(bytes),
        content:bytes.toString('base64').match(/.{1,60}/g)!.join('\n')+'\n'}) : Response.json({}, {status:404});
    }
    assert.equal(init.method,'PUT'); assert.equal(url, api); ++putCount;
    const data = JSON.parse(String(init.body));
    assert.equal(data.branch,branch); assert.equal(data.message,'chore(goriq): checkpoint coordinator lease');
    assert.deepEqual(Object.keys(data).sort(),['branch','content','message','sha']);
    if(!bytes || data.sha !== blob(bytes)) return Response.json({}, {status:409});
    bytes = Buffer.from(data.content,'base64');
    return Response.json({content:{sha:blob(bytes)}, commit:{sha:'c'.repeat(40)}});
  };
  const options = (extra = {}) => ({repository, stateBranch:branch, clusterId, token, key, minimumEpoch:1, fetchImpl, ...extra});
  return {requests, options, fetchImpl, get bytes(){return bytes;}, get putCount(){return putCount;},
    replace(value:Buffer|null){bytes=value;}, intercept(fn:typeof hook){hook=fn;}};
}

test('a fresh client restores encrypted state without a local filesystem', async()=>{
  const f=fixture(); const store=new GitHubCoordinatorStore(f.options());
  const a=await store.load(); assert.deepEqual(a,original);
  a.coordinatorId='mutated-copy';
  assert.deepEqual(await new GitHubCoordinatorStore(f.options()).load(),original);
  assert.equal(f.putCount,0);
});
test('renew writes ciphertext with exact SHA and reads it back',async()=>{
  const f=fixture(); const s=new GitHubCoordinatorStore(f.options());
  await s.load(); assert.equal(await s.compareAndSwap(original,renewed),true);
  assert.deepEqual(await new GitHubCoordinatorStore(f.options()).load(),renewed);
  assert.equal(f.putCount,1);
  const wire=f.bytes!.toString(); assert.ok(!wire.includes(clusterId)); assert.ok(!wire.includes('runner-A'));
  assert.ok(!wire.includes(token)); assert.ok(!wire.includes(key.toString('hex')));
});
test('two clients race: only the one with the current blob can write',async()=>{
  const f=fixture(), a=new GitHubCoordinatorStore(f.options()), b=new GitHubCoordinatorStore(f.options());
  await a.load(); await b.load();
  assert.equal(await a.compareAndSwap(original,renewed),true);
  assert.equal(await b.compareAndSwap(original,takeover),false);
  assert.deepEqual(await b.load(),renewed);
});
test('server-side conflict is not retried or reported as saved',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options()); await s.load();
  f.intercept((_u,i)=>i.method==='PUT'?Response.json({}, {status:409}):null);
  assert.equal(await s.compareAndSwap(original,renewed),false);
  assert.equal(f.requests.filter(r=>r.init.method==='PUT').length,1);
});
test('missing state is HOLD, never a new empty Goal or coordinator',async()=>{
  const f=fixture(null),s=new GitHubCoordinatorStore(f.options());
  await assert.rejects(s.load(),/GITHUB_COORDINATOR_STATE_MISSING/);
  assert.equal(f.putCount,0);
});
test('blind save and bootstrap are rejected before any network operation',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());
  await assert.rejects(s.save(original),/GITHUB_COORDINATOR_CAS_REQUIRED/);
  await assert.rejects(s.compareAndSwap(null,original),/GITHUB_COORDINATOR_BOOTSTRAP_FORBIDDEN/);
  assert.equal(f.requests.length,0);
});
test('CAS requires a matching prior observation by this client',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());
  await assert.rejects(s.compareAndSwap(original,renewed),/GITHUB_COORDINATOR_READ_REQUIRED/);
  assert.equal(f.requests.length,0);
});
for(const status of [401,403,429,500,503]) test(`HTTP ${status} is not absence and never publishes body text`,async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());
  f.intercept(()=>new Response(`SECRET ${token}`,{status}));
  await assert.rejects(s.load(),e=> e instanceof Error && /^GITHUB_COORDINATOR_HTTP_/.test(e.message)&&!e.message.includes(token));
  assert.equal(f.putCount,0);
});
test('transport errors never leak credential-bearing exceptions',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options()); f.intercept(()=>{throw Error(token);});
  await assert.rejects(s.load(),/^Error: GITHUB_COORDINATOR_READ_UNAVAILABLE$/);
});
test('write transport failure is explicitly uncertain, with no automatic retry',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options()); await s.load();
  f.intercept((_u,i)=>{if(i.method==='PUT')throw Error(token);return null;});
  await assert.rejects(s.compareAndSwap(original,renewed),/GITHUB_COORDINATOR_WRITE_OUTCOME_UNKNOWN/);
  assert.equal(f.requests.filter(r=>r.init.method==='PUT').length,1);
});
test('successful PUT without independent readback remains uncertain',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();
  let written=false; f.intercept((_u,i)=>{
    if(i.method==='PUT'){written=true;return null;}
    return written ? Response.json({}, {status:503}) : null;
  });
  await assert.rejects(s.compareAndSwap(original,renewed),/GITHUB_COORDINATOR_WRITE_OUTCOME_UNKNOWN/);
  assert.equal(f.putCount,1);
});
test('wrong key cannot decode or replace a stored record',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options({key:Buffer.alloc(32,0x32)}));
  await assert.rejects(s.load(),/GITHUB_COORDINATOR_CIPHERTEXT_INVALID/);assert.equal(f.putCount,0);
});
test('encrypted record from another branch is rejected',async()=>{
  const f=fixture(seal(original,{branch:'goriq-state/other'}));
  await assert.rejects(new GitHubCoordinatorStore(f.options()).load(),/GITHUB_COORDINATOR_CIPHERTEXT_INVALID/);
});
test('ciphertext corruption fails closed even with a new Git blob hash',async()=>{
  const data=JSON.parse(seal(original).toString());const b=Buffer.from(data.ciphertext,'base64');b[0]^=1;data.ciphertext=b.toString('base64');
  const f=fixture(Buffer.from(JSON.stringify(data)));
  await assert.rejects(new GitHubCoordinatorStore(f.options()).load(),/GITHUB_COORDINATOR_CIPHERTEXT_INVALID/);
});
test('rollback below the configured epoch floor is rejected',async()=>{
  const f=fixture(); await assert.rejects(new GitHubCoordinatorStore(f.options({minimumEpoch:2})).load(),/GITHUB_COORDINATOR_ROLLBACK/);
});
test('rollback after observing a later epoch is rejected',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();f.replace(seal(takeover));await s.load();
  f.replace(seal(original));await assert.rejects(s.load(),/GITHUB_COORDINATOR_ROLLBACK/);
});
test('takeover must advance exactly one epoch and change fencing token',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();
  await assert.rejects(s.compareAndSwap(original,{...takeover,epoch:4}),/GITHUB_COORDINATOR_TRANSITION_INVALID/);
  await assert.rejects(s.compareAndSwap(original,{...takeover,fencingToken:original.fencingToken}),/GITHUB_COORDINATOR_TRANSITION_INVALID/);
  assert.equal(await s.compareAndSwap(original,takeover),true);
});
test('same-epoch renewal cannot change owner or fencing token',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();
  for(const patch of [{coordinatorId:'runner-B'},{fencingToken:'other'},{issuedAt:renewed.updatedAt}])
    await assert.rejects(s.compareAndSwap(original,{...renewed,...patch}),/GITHUB_COORDINATOR_TRANSITION_INVALID/);
  assert.equal(f.putCount,0);
});
test('unknown or secret-bearing fields cannot be written into a lease',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();
  const invalid = {...renewed,unexpectedSecret:token};
  await assert.rejects(s.compareAndSwap(original,invalid),/GITHUB_COORDINATOR_LEASE_INVALID/);
  assert.equal(f.putCount,0);
});
for(const patch of [{repository:'fixture-owner/repo?secret'}, {stateBranch:'main'}, {stateBranch:'goriq-state/../main'},
  {key:Buffer.alloc(31)}, {minimumEpoch:0}, {minimumEpoch:Number.MAX_SAFE_INTEGER+1}, {token:'abc\nheader'}])
  test(`invalid configuration rejected: ${Object.keys(patch)[0]} ${JSON.stringify(patch).slice(0,45)}`,()=>{
    const f=fixture(); assert.throws(()=>new GitHubCoordinatorStore(f.options(patch)),/GITHUB_COORDINATOR_CONFIG_INVALID/);
    assert.equal(f.requests.length,0);
  });
test('incorrect Git blob digest is rejected',async()=>{
  const f=fixture(); f.intercept(()=>Response.json({type:'file',path,encoding:'base64',sha:'f'.repeat(40),content:f.bytes!.toString('base64')}));
  await assert.rejects(new GitHubCoordinatorStore(f.options()).load(),/GITHUB_COORDINATOR_RESPONSE_INVALID/);
});
test('oversized response is bounded and cannot create state',async()=>{
  const f=fixture();f.intercept(()=>new Response('x'.repeat(70000)));
  await assert.rejects(new GitHubCoordinatorStore(f.options()).load(),/GITHUB_COORDINATOR_RESPONSE_TOO_LARGE/);
});
test('instance JSON never exposes token or encryption key',()=>{
  const f=fixture();const serialized=JSON.stringify(new GitHubCoordinatorStore(f.options()));
  assert.ok(!serialized.includes(token));assert.ok(!serialized.includes(key.toString('hex')));
});

test('existing coordinator runtime renews then hands over without a local state file',async()=>{
  const f=fixture();
  const a=new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options()),clusterId);
  const start=new Date('2026-01-01T00:00:00.000Z');
  const candidateA=[{nodeId:'runner-A',available:true,eligible:true,score:1,observedAt:start.toISOString()}];
  const claim=await a.elect(candidateA,60000,start);
  assert.equal(f.putCount,0);
  const renewedClaim=await a.renew(claim,candidateA,60000,new Date('2026-01-01T00:00:30.000Z'));
  assert.equal(renewedClaim.epoch,1);
  const b=new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options()),clusterId);
  const next=await b.elect([{nodeId:'runner-B',available:true,eligible:true,score:1,observedAt:takeover.issuedAt}],60000,new Date(takeover.issuedAt));
  assert.equal(next.epoch,2);assert.equal(next.coordinatorId,'runner-B');assert.notEqual(next.fencingToken,claim.fencingToken);
  await assert.rejects(a.assertAuthoritative(renewedClaim,new Date('2026-01-01T00:02:01.000Z')),/STALE_COORDINATOR_CLAIM/);
  const restarted=new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options({minimumEpoch:2})),clusterId);
  assert.deepEqual(await restarted.current(),await b.current());
  await restarted.assertAuthoritative(next,new Date('2026-01-01T00:02:01.000Z'));
});
test('two existing runtimes elect concurrently and do not both acquire ownership',async()=>{
  const f=fixture();
  const run=(nodeId:string)=>new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options()),clusterId)
    .elect([{nodeId,available:true,eligible:true,score:1,observedAt:takeover.issuedAt}],60000,new Date(takeover.issuedAt));
  const results=await Promise.allSettled([run('runner-B'),run('runner-C')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const failed=results.find(r=>r.status==='rejected');assert.ok(failed&&failed.status==='rejected');
  assert.match(String(failed.reason),/COORDINATOR_WRITE_CONFLICT/);
  assert.equal((await new GitHubCoordinatorStore(f.options()).load()).epoch,2);
});
test('new runtime refuses to elect when shared state is missing',async()=>{
  const f=fixture(null);
  const runtime=new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options()),clusterId);
  await assert.rejects(runtime.elect([{nodeId:'runner-B',available:true,eligible:true,score:1,observedAt:takeover.issuedAt}],60000,new Date(takeover.issuedAt)),/STATE_MISSING/);
  assert.equal(f.putCount,0);
});
test('an observed deleted record is not recreated by a later write',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();f.replace(null);
  await assert.rejects(s.compareAndSwap(original,renewed),/STATE_MISSING/);assert.equal(f.putCount,0);
});
test('renewal replay within an epoch cannot move time backwards',async()=>{
  const f=fixture(seal(renewed)),s=new GitHubCoordinatorStore(f.options());await s.load();f.replace(seal(original));
  await assert.rejects(s.load(),/ROLLBACK/);
});
test('missing permissions at write time fail without any retry',async()=>{
  const f=fixture(),s=new GitHubCoordinatorStore(f.options());await s.load();
  f.intercept((_u,i)=>i.method==='PUT'?new Response(token,{status:403}):null);
  await assert.rejects(s.compareAndSwap(original,renewed),/^Error: GITHUB_COORDINATOR_HTTP_403$/);
  assert.equal(f.requests.filter(r=>r.init.method==='PUT').length,1);
});
test('API response for another path is rejected',async()=>{
  const f=fixture();f.intercept(()=>Response.json({type:'file',path:'wrong',encoding:'base64',sha:blob(f.bytes!),content:f.bytes!.toString('base64')}));
  await assert.rejects(new GitHubCoordinatorStore(f.options()).load(),/RESPONSE_INVALID/);
});
test('an epoch floor is not an execution or Goal-creation grant',async()=>{
  const f=fixture(seal(takeover));const runtime=new DistributedCoordinatorRuntime(new GitHubCoordinatorStore(f.options({minimumEpoch:2})),clusterId);
  await assert.rejects(runtime.elect([],60000,new Date('2026-01-01T00:04:00.000Z')),/NO_ELIGIBLE_COORDINATOR/);
  assert.equal(f.putCount,0);
});

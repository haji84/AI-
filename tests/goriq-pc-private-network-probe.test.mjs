import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout, clearTimeout } from 'node:timers';
import { summarizeNetwork, collectNetwork } from '../scripts/goriq-pc-private-network-probe.mjs';
const { AbortSignal, Response, ReadableStream } = globalThis;

const status={BackendState:'Running',Self:{DNSName:'SECRET-HOST.tail123.ts.net.'},Peer:{
  a:{Online:true,OS:'macOS',DNSName:'SECRET-MAC.tail123.ts.net.'},
  b:{Online:true,OS:'iOS',DNSName:'SECRET-PHONE.tail123.ts.net.'},
  c:{Online:false,OS:'windows',DNSName:'SECRET-WINDOWS.tail123.ts.net.'},
}};
const serve={TCP:{'443':{HTTPS:true}},Web:{'SECRET-HOST.tail123.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:3000'}}}}};
const success=text=>({ok:true,stdout:JSON.stringify(text)});

// Mistaking a configured local route for peer acceptance would produce a false real-device PASS.
test('reports configured route and anonymous online peer classes without granting transport acceptance',()=>{
  const result=summarizeNetwork(success(status),success(serve));
  assert.equal(result.privateHttpsConfigured,true);
  assert.equal(result.funnelState,'private');
  assert.equal(result.backendState,'Running');
  assert.equal(result.onlinePeerCount,2);
  assert.equal(result.onlineMacPeerCount,1);
  assert.equal(result.onlineWindowsPeerCount,0);
  assert.equal(/SECRET|tail123|Proxy|100\./.test(JSON.stringify(result)),false);
  assert.equal(result.transportAcceptanceVerified,false);
});

// Empty or unavailable configuration must never become a ready private ingress.
test('distinguishes unconfigured Serve from failed command or invalid status',()=>{
  assert.equal(summarizeNetwork(success(status),success(null)).funnelState,'unconfigured');
  assert.equal(summarizeNetwork(success(status),{ok:false}).funnelState,'unknown');
  assert.equal(summarizeNetwork({ok:true,stdout:'invalid'},success(serve)).statusReadable,false);
  assert.equal(summarizeNetwork({ok:true,stdout:'null'},success(serve)).privateHttpsConfigured,false);
});

// A public tunnel or direct Broker proxy is outside the private dashboard contract.
test('rejects public or protected-backend routes in diagnostic readiness',()=>{
  assert.equal(summarizeNetwork(success(status),success({...serve,AllowFunnel:{'SECRET-HOST.tail123.ts.net:443':true}})).privateHttpsConfigured,false);
  const direct={TCP:serve.TCP,Web:{'SECRET-HOST.tail123.ts.net:443':{Handlers:{'/':{Proxy:'http://127.0.0.1:8787'}}}}};
  assert.equal(summarizeNetwork(success(status),success(direct)).privateHttpsConfigured,false);
});

// Unsupported platforms must fail before attempting host-local commands or requests.
test('refuses non-native platform before any I/O',async()=>{
  let calls=0;
  await assert.rejects(collectNetwork({platform:'linux',revision:'a'.repeat(40),run:async()=>{calls++;},fetcher:async()=>{calls++;}}),/NATIVE_PC_REQUIRED/);
  assert.equal(calls,0);
});

// Changing the subprocess allowlist or request target could mutate state or disclose credentials.
test('collects only read-only CLI status and credential-free health with bounded default TLS verification',async()=>{
  const commands=[],requests=[];
  const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),
    run:async(command,args)=>{
      commands.push([command,args]);
      assert.equal(command,'tailscale');
      assert.ok(['status --json','serve status --json'].includes(args.join(' ')));
      return success(args[0]==='status'?status:serve);
    },
    fetcher:async(url,options)=>{
      requests.push(url);
      assert.equal(options.method,'GET');
      assert.equal(options.redirect,'error');
      assert.equal(options.headers,undefined);
      assert.ok(options.signal instanceof AbortSignal);
      if(url.startsWith('https:')) throw Object.assign(new TypeError('SECRET PRIVATE URL'),{cause:{code:'ECONNREFUSED'}});
      return Response.json(url.includes(':3000')?{status:'ok'}:{ok:true,service:url.includes(':8787')?'jarvis-broker':'jarvis-remote-gateway',runtimeRevision:'a'.repeat(40)});
    },
  });
  assert.equal(commands.length,2);
  assert.equal(requests.length,4);
  assert.equal(result.dashboardHealthy,true);
  assert.equal(result.brokerHealthy,true);
  assert.equal(result.privateHttpsHealth.transportClass,'connection-refused');
  assert.equal(result.diagnosticOnly,true);
  assert.equal(result.transportAcceptanceVerified,false);
  assert.equal(/SECRET|tail123|https:\/\/|PRIVATE URL/.test(JSON.stringify(result)),false);
});

// A missing CLI must not result in a fabricated successful network inspection or arbitrary URL probe.
test('failed CLI preserves unknown network state while inspecting loopback health',async()=>{
  let requests=0;
  const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),run:async()=>({ok:false}),fetcher:async()=>{requests++;throw new Error('SECRET');}});
  assert.equal(result.statusReadable,false);
  assert.equal(result.privateHttpsHealth.attempted,false);
  assert.equal(requests,3);
  assert.equal(result.brokerHealthy,false);
});

// A health endpoint producing a large body must be stopped before consuming unbounded native memory.
test('rejects oversized health data without printing or accepting it',async()=>{
  const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),
    run:async(_command,args)=>success(args[0]==='status'?status:serve),
    fetcher:async()=>Response.json({status:'ok',ok:true,service:'jarvis-broker',padding:'SECRET'.repeat(20000)}),
  });
  assert.equal(result.dashboardHealthy,false);
  assert.equal(result.brokerHealthy,false);
  assert.equal(result.privateHttpsHealth.healthy,false);
  assert.equal(/SECRET|padding/.test(JSON.stringify(result)),false);
});

// JSON validity alone must not turn arrays or primitives into a readable Tailscale status object.
test('malformed top-level CLI status remains unavailable',()=>{
  for (const invalid of [[], 'Running', 1, null, {...status,Peer:'not-a-map'}]) {
    assert.equal(summarizeNetwork(success(invalid),success(serve)).statusReadable,false);
  }
});

// Hex-shaped unverified data must not be published as a public source revision.
test('does not publish an unknown broker revision',async()=>{
  const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),
    run:async()=>({ok:false}),fetcher:async()=>Response.json({ok:true,service:'jarvis-broker',runtimeRevision:'b'.repeat(40)}),
  });
  assert.equal(result.brokerHealthy,true);
  assert.equal(result.brokerRevision,null);
  assert.equal(result.brokerMatchesDiagnosticSource,false);
  assert.equal(JSON.stringify(result).includes('b'.repeat(40)),false);
});

// A chunked producer must be cancelled once the aggregate byte budget is exceeded.
test('cancels chunked oversized health streams',async()=>{
  let cancelled=0;
  const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),
    run:async(_command,args)=>success(args[0]==='status'?status:serve),
    fetcher:async()=>new Response(new ReadableStream({
      pull(controller){controller.enqueue(new Uint8Array(4096));},
      cancel(){cancelled++;},
    })),
  });
  assert.equal(result.dashboardHealthy,false);
  assert.equal(cancelled,4);
});

// A stalled body must be cancelled at the fixed deadline rather than hanging the native runner.
test('cancels stalled health streams at the bounded deadline',{timeout:10000},async()=>{
  const keepAlive=setTimeout(()=>{},7000); let cancelled=0;
  try {
    const result=await collectNetwork({platform:'darwin',revision:'a'.repeat(40),
      run:async()=>({ok:false}),fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled++;}})),
    });
    assert.equal(result.loopbackHealth.dashboard.transportClass,'timeout');
    assert.equal(result.loopbackHealth.broker.transportClass,'timeout');
    assert.equal(cancelled,3);
  } finally {clearTimeout(keepAlive);}
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const jobs = {
  'gai-code-builder-zbook.yml': ['install-and-probe'],
  'research-worker-e2e.yml': ['zbook-real','macbook-real','aggregate'],
  'resident-research-worker-e2e.yml': ['install-zbook','install-macbook','natural-command-e2e'],
  'goriq-repair-engines-runtime.yml': ['zbook-local-repair','mac-chat-work-bridge','mac-bridge-post-cleanup-proof'],
  'jarvis-mac-bootstrap.yml': ['install'],
  'goriq-jarvis-production-sync.yml': ['deploy-code','sync'],
  'goriq-mac-private-dashboard.yml': ['mac-dashboard'],
};
function workflow(file) { return readFileSync(fileURLToPath(new URL('../.github/workflows/'+file,import.meta.url)),'utf8'); }
function body(source,job) {
  const start=source.indexOf('\n  '+job+':');
  assert.ok(start>=0,'job exists: '+job);
  const tail=source.slice(start+1); const next=tail.slice(3).search(/^ {2}[\w-]+:\s*$/m);
  return next<0?tail:tail.slice(0,next+3);
}
function condition(file,job) {
  const match=body(workflow(file),job).match(/^ {4}if: ([^\r\n]+)$/m);
  return match?match[1].replace(/^\$\{\{\s*|\s*\}\}$/g,''):'true';
}
function allowed(file,job,event,overrides={}) {
  const github={event_name:event,repository:'haji84/AI-',ref:'refs/heads/main',actor:'haji84',event:{issue:{title:'[JARVIS CODE BUILDER PROBE] fixture'},workflow_run:{conclusion:'success',event:'workflow_run',head_branch:'main',actor:{login:'haji84'}}},...overrides};
  return vm.runInNewContext(condition(file,job),{github,always:()=>true,startsWith:(value,prefix)=>value.startsWith(prefix)},{timeout:100});
}
for(const [file,names]of Object.entries(jobs)) {
  test(file+' denies automatic native mutations while retaining existing manual paths',()=>{
    for(const job of names) {
      for(const event of ['push','schedule','workflow_run']) assert.equal(allowed(file,job,event),false,event+' must not start '+job);
      assert.equal(allowed(file,job,'workflow_dispatch'),job!=='deploy-code','manual path changed: '+job);
      assert.equal(allowed(file,job,'issues'),file==='gai-code-builder-zbook.yml','Issue path changed: '+job);
    }
  });
}
test('Builder rejects other Issue titles and dashboard retains owner/repository/main fences',()=>{
  assert.equal(allowed('gai-code-builder-zbook.yml','install-and-probe','issues',{event:{issue:{title:'ordinary issue'}}}),false);
  for(const overrides of [{actor:'other'},{repository:'other/repo'},{ref:'refs/heads/other'}]) assert.equal(allowed('goriq-mac-private-dashboard.yml','mac-dashboard','workflow_dispatch',overrides),false);
});
test('hosted pure repair smoke remains automatic and manual-only verification never fabricates native proof',()=>{
  const source=workflow('goriq-repair-engines-runtime.yml');
  assert.doesNotMatch(body(source,'learned-repair-smoke'),/^ {4}if:/m);
  assert.match(body(source,'learned-repair-smoke'),/runs-on: ubuntu-latest/);
  assert.match(body(workflow('research-worker-e2e.yml'),'aggregate'),/if: github.event_name == 'workflow_dispatch' && always\(\)/);
  assert.match(body(workflow('resident-research-worker-e2e.yml'),'natural-command-e2e'),/needs: \[install-zbook, install-macbook\]/);
});

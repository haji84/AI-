import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
import process from 'node:process';
import {fileURLToPath, URL} from 'node:url';
import ts from 'typescript';

const sourceFile=process.env.GORIQ_PREP1218_SOURCE ?? fileURLToPath(new URL("../src/app/jarvis/settings/TrustedDeviceSettings.tsx",import.meta.url));
assert.ok(sourceFile,'Pass a readonly full component snapshot');
const source=readFileSync(sourceFile,'utf8');
const compiled=ts.transpileModule(source,{fileName:'TrustedDeviceSettings.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length??0,0);

function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);return text(tree.props?.children);}
async function browser({confirmed=true,postStatus=200}={}){
  const state=[],effects=[],seenEffects=new Set(),events=[],requests=[];let cursor=0,effectCursor=0,localPresent=true,sessionRevoked=false,otherRevoked=false;
  const selfId='fixture-current-device',otherId='fixture-other-device';
  const useState=initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return[state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];};
  const useEffect=effect=>{const index=effectCursor++;if(!seenEffects.has(index)){seenEffects.add(index);effects.push(effect);}};
  const client={hasTrustedDevice:async()=>localPresent,trustedDeviceInfo:async()=>({id:selfId,label:'Fixture browser'}),removeTrustedDevice:async()=>{events.push('local-remove');localPresent=false;},
    enrollTrustedDevice:async()=>assert.fail('No enrollment in revocation scenario'),changeTrustedDevicePin:async()=>assert.fail('No PIN change in revocation scenario')};
  const fetch=async(url,options={})=>{
    assert.equal(url,'/api/owner-login/trusted/devices');const method=options.method??'GET';requests.push({method,body:options.body??null,sessionRevoked});
    if(method==='POST'){
      const body=JSON.parse(options.body);events.push('server-revoke:'+body.deviceId);
      if(postStatus>=400)return {ok:false,status:postStatus};
      if(body.deviceId===selfId)sessionRevoked=true;else{assert.equal(body.deviceId,otherId);otherRevoked=true;}
      return {ok:true,status:200,json:async()=>({ok:true})};
    }
    assert.equal(method,'GET');
    if(sessionRevoked)return {ok:false,status:401,json:async()=>({error:'fixture-auth-required'})};
    return {ok:true,status:200,json:async()=>({devices:[{deviceId:selfId,label:'Fixture browser',revoked:false},{deviceId:otherId,label:'Fixture other',revoked:otherRevoked}]})};
  };
  const jsx=(type,props)=>({type,props}),module={exports:{}};
  const require=id=>{if(id==='react')return{useState,useEffect};if(id==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};if(id==='../trusted-device-client')return client;assert.fail('Unexpected full-component dependency: '+id);};
  const context=vm.createContext({module,exports:module.exports,require,fetch,navigator:{platform:'fixture'},window:{confirm:()=>confirmed,location:{replace:url=>{assert.equal(url,'/jarvis/login');events.push('navigate:'+url);}}}},
    {codeGeneration:{strings:false,wasm:false}});
  new vm.Script(compiled.outputText,{filename:'TrustedDeviceSettings.compiled.cjs'}).runInContext(context,{timeout:1000});
  const Component=module.exports.default;assert.equal(typeof Component,'function');
  const render=()=>{cursor=0;effectCursor=0;return Component();};
  render();for(const effect of effects.splice(0))effect();await setImmediate();
  const tree=render();assert.ok(nodes(tree).some(node=>node.type==='button'&&text(node)==='この端末のPIN資格を失効'),'Actual rendered UI exposes current trusted-device action');
  const click=async label=>{const button=nodes(render()).find(node=>node.type==='button'&&text(node)===label);assert.ok(button,'Rendered button '+label);assert.equal(button.props.disabled,false);await button.props.onClick();await setImmediate();return render();};
  return {click,render,events,requests,selfId,otherId};
}

test('self-revocation expires current trusted session and navigates without unauthorized refresh',async()=>{
  const ui=await browser();await ui.click('この端末のPIN資格を失効');
  assert.equal(ui.requests.filter(r=>r.method==='POST').length,1);
  assert.equal(ui.events.filter(e=>e==='local-remove').length,1);
  assert.equal(ui.requests.filter(r=>r.method==='GET'&&r.sessionRevoked).length,0,'After self revocation the authenticated device list is unavailable');
  assert.deepEqual(ui.events,['server-revoke:'+ui.selfId,'local-remove','navigate:/jarvis/login']);
});

test('canceling revocation preserves server and local credential state',async()=>{
  const ui=await browser({confirmed:false});const tree=await ui.click('この端末のPIN資格を失効');
  assert.equal(ui.requests.filter(r=>r.method==='POST').length,0);assert.deepEqual(ui.events,[]);
  assert.ok(nodes(tree).some(n=>n.type==='button'&&text(n)==='この端末のPIN資格を失効'));
});

test('server rejection preserves the local registration and remains in settings',async()=>{
  const ui=await browser({postStatus:500});const tree=await ui.click('この端末のPIN資格を失効');
  assert.deepEqual(ui.events,['server-revoke:'+ui.selfId]);assert.equal(ui.requests.filter(r=>r.method==='GET').length,1);
  assert.ok(nodes(tree).some(n=>n.type==='button'&&text(n)==='この端末のPIN資格を失効'));
  assert.ok(nodes(tree).some(n=>n.props?.role==='status'&&text(n).includes('登録を残しました')));
});

test('revoking another device refreshes the usable session without removing local identity or redirecting',async()=>{
  const ui=await browser();await ui.click('失効');
  assert.deepEqual(ui.events,['server-revoke:'+ui.otherId]);assert.equal(ui.requests.filter(r=>r.method==='GET').length,2);
  assert.equal(ui.requests.filter(r=>r.method==='GET'&&r.sessionRevoked).length,0);
});

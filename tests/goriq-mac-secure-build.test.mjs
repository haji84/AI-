import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, writeFile, symlink, rm, readFile, chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {URL} from 'node:url';
import * as native from '../scripts/goriq-mac-private-dashboard-native.mjs';

test('native dashboard build creates an inventory-safe production bundle without relaxing write-bit rejection',
  {skip:process.platform==='win32',timeout:120000},async()=>{
    assert.equal(typeof native.buildDashboardArtifacts,'function');
    const root=await mkdtemp(join(homedir(),'.goriq-build-test-'));
    try {
      await chmod(root,0o700);
      await mkdir(join(root,'app'),{mode:0o700});
      await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'next build'},
        dependencies:{next:'16.3.2',react:'19.2.8','react-dom':'19.2.8'}}));
      // This fixture reuses already installed dependencies; never install or access a registry.
      await writeFile(join(root,'pnpm-workspace.yaml'),'verifyDepsBeforeRun: false\n');
      await writeFile(join(root,'next.config.mjs'),'export default {agentRules:false,experimental:{cpus:1}};\n');
      await writeFile(join(root,'app','layout.js'),'export default function Layout({children}){return <html><body>{children}</body></html>}');
      await writeFile(join(root,'app','page.js'),'export default function Page(){return <main>GORIQ build fixture</main>}');
      await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
      const moduleUrl=new URL('../scripts/goriq-mac-private-dashboard-native.mjs',import.meta.url).href;
      await promisify(execFile)(process.execPath,['--input-type=module','-e',
        `import {buildDashboardArtifacts} from ${JSON.stringify(moduleUrl)}; process.umask(0o077); await buildDashboardArtifacts({release:process.argv[1],env:{PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',NEXT_TELEMETRY_DISABLED:'1',NO_COLOR:'1'}});`,root],
        {timeout:110000,maxBuffer:4*1024*1024});
      await rm(join(root,'node_modules'));
      const inventory=await native.releaseInventory(root);
      assert.ok(inventory.some(entry=>entry.path==='.next/BUILD_ID' && entry.type==='file'));
      assert.ok((await readFile(join(root,'.next','BUILD_ID'),'utf8')).trim());
      const artifact=join(root,'.next','BUILD_ID');
      await chmod(artifact,0o660);
      await assert.rejects(native.releaseInventory(root),error=>error.message==='RELEASE_OWNER_REJECTED' &&
        error.releaseBoundary.surface==='build' && error.releaseBoundary.groupWritable===true);
    } finally {await rm(root,{recursive:true,force:true});}
  });

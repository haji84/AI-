import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { planFullCoverage } from '../src/orchestrator/ai09-full-coverage.mjs';

const SHA = /^[a-f0-9]{40}$/u;
const deny = reason => { throw new Error(reason); };
const pathOK = x => typeof x === 'string' && x && Buffer.byteLength(x) <= 250 &&
  !x.startsWith('/') && !x.startsWith('-') && !x.includes('\\') &&
  !x.split('/').some(y => !y || y === '.' || y === '..') &&
  ![...x].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

function git(cwd, args, maxBuffer = 12 * 1024 * 1024) {
  try {
    // Never use a shell or run code from either revision; no network or checkout.
    return execFileSync('git', args, { cwd, windowsHide:true, encoding:null,
      timeout:15000, maxBuffer, stdio:['ignore','pipe','ignore'] });
  } catch { deny('AI09_PINNED_GIT_READ_FAILED'); }
}
function gitText(cwd,args) { return git(cwd,args).toString('utf8').trim(); }
function pinnedBlob(cwd,commit,path) {
  if (!pathOK(path)) deny('AI09_INVALID_GIT_PATH');
  const oid=gitText(cwd,['rev-parse','--verify',commit+':'+path]);
  if (!SHA.test(oid) || gitText(cwd,['cat-file','-t',oid]) !== 'blob')
    deny('AI09_NON_BLOB_OR_OBJECT_MISSING');
  return git(cwd,['cat-file','blob',oid]);
}
function changedEntries(cwd,baseSha,headSha) {
  // -z protects NUL-separated names. Detect renames explicitly; no textconv.
  const raw=git(cwd,['diff','--no-ext-diff','--no-textconv','--name-status',
    '-z','--find-renames',baseSha,headSha],4*1024*1024);
  if (!raw.length || raw[raw.length-1] !== 0) deny('AI09_NAME_STATUS_INVALID');
  const fields=raw.toString('utf8').split('\u0000');
  fields.pop();
  const entries=[];
  for(let i=0;i<fields.length;) {
    const status=fields[i++];
    if (!/^(?:A|D|M|R[0-9]{1,3})$/u.test(status)) deny('AI09_UNSUPPORTED_GIT_CHANGE_TYPE');
    const previousPath=status.startsWith('R') ? fields[i++] : undefined;
    const path=fields[i++];
    if (!pathOK(path) || previousPath !== undefined && !pathOK(previousPath))
      deny('AI09_GIT_DIFF_PATH_INVALID');
    const type=status==='A'?'added':status==='D'?'deleted':status.startsWith('R')?'renamed':'modified';
    entries.push({path,status:type,...(previousPath?{previousPath}:{})});
    if(entries.length>500) deny('AI09_CHANGE_COUNT_BUDGET_EXCEEDED');
  }
  return entries;
}

/** Read only from exact commits already present in the trusted reviewer's Git store.
 * expectedPaths is an independently fetched, pinned GitHub PR changed-path list.
 * This candidate is not wired into the active reviewer or an approval gate. */
export function planPinnedGitCoverage({cwd,baseSha,headSha,expectedPaths}={}) {
  if(typeof cwd!=='string'||!cwd||!SHA.test(baseSha??'')||!SHA.test(headSha??'')||
      baseSha===headSha) deny('AI09_PINNED_SCOPE_INVALID');
  for(const sha of [baseSha,headSha]) {
    if(gitText(cwd,['rev-parse','--verify',sha+'^{commit}'])!==sha)
      deny('AI09_GIT_COMMIT_NOT_PINNED');
  }
  // A diverged PR requires a separately verified merge-base plan.
  try { execFileSync('git',['merge-base','--is-ancestor',baseSha,headSha],
    {cwd,windowsHide:true,stdio:'ignore',timeout:10000}); }
  catch { deny('AI09_STALE_OR_DIVERGED_BASE'); }
  const entries=changedEntries(cwd,baseSha,headSha);
  const files=entries.map(e=>({
    ...e,
    before:e.status==='added'?null:pinnedBlob(cwd,baseSha,e.previousPath??e.path),
    after:e.status==='deleted'?null:pinnedBlob(cwd,headSha,e.path)
  }));
  return planFullCoverage({baseSha,headSha,files,expectedPaths});
}

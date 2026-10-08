// Public GitHub metadata only: no new token or permission is needed.
const revision = process.env.GORIQ_PC_APPROVED_REVISION;
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[a-f0-9]{40}$/.test(revision ?? '') || repository !== 'haji84/AI-' ||
    process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_SHA !== revision) throw Error('PC exact source context required');
async function read(endpoint) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('PC public CI verification unavailable');
  return response.json();
}
const main = await read('git/ref/heads/main');
if (main.object?.sha !== revision) throw Error('PC activation requires current exact main');
const runs = await read(`actions/runs?head_sha=${revision}&per_page=100`);
if (!runs.workflow_runs?.some(run => run.name === 'CI' && run.event === 'push' && run.head_branch === 'main' && run.head_sha === revision && run.status === 'completed' && run.conclusion === 'success')) throw Error('PC successful exact main CI required');
console.log(JSON.stringify({ sourceRevision: revision, exactMainCi: true, checkedAt: new Date().toISOString() }));

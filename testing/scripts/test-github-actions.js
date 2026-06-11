#!/usr/bin/env node
/**
 * test-github-actions.js
 * Verifies the GitHub Actions workflow and recent run history.
 *
 * Usage:
 *   GITHUB_TOKEN=<pat_with_actions_read> \
 *   node test-github-actions.js
 */

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const REPO_OWNER    = process.env.GITHUB_REPO_OWNER || 'DeveloperAlly';
const REPO_NAME     = process.env.GITHUB_REPO_NAME  || 'gamerslab';
const WORKFLOW_FILE = 'monitor.yml';
if (!GITHUB_TOKEN) { console.error('GITHUB_TOKEN required'); process.exit(1); }

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'GamersLab-Test' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; };
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const sec  = msg => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function testWorkflow() {
  sec('1. Workflow file and state');
  const data = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows`);
  const wf = (data.workflows||[]).find(w => w.path.includes(WORKFLOW_FILE));
  if (!wf) { fail(`${WORKFLOW_FILE} not found`); return null; }
  ok(`found: ${wf.name} (id=${wf.id})`);
  wf.state==='active' ? ok('state: active') : fail(`state: ${wf.state}`);
  return wf;
}

async function testRuns(wf) {
  sec('2. Recent runs');
  const data = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${wf.id}/runs?per_page=10`);
  const runs = data.workflow_runs || [];
  if (!runs.length) { warn('no runs found'); return; }

  const counts = runs.reduce((a,r) => { const k=r.status==='completed'?r.conclusion:r.status; a[k]=(a[k]||0)+1; return a; }, {});
  ok(`last ${runs.length}: ${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join('  ')}`);

  const ageMin = Math.round((Date.now() - new Date(runs[0].created_at)) / 60000);
  ageMin < 30 ? ok(`most recent: ${ageMin}m ago`) : warn(`most recent: ${ageMin}m ago — cron may be throttled`);

  const failures = runs.filter(r => r.conclusion==='failure').length;
  failures ? warn(`${failures} failure(s) in last 10 runs`) : ok('no failures in last 10 runs');
}

async function testSecrets() {
  sec('3. Required secrets (existence only)');
  const REQUIRED = ['SUPABASE_URL','SUPABASE_SERVICE_KEY','TARGET_URL'];
  try {
    const data = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets`);
    const names = new Set((data.secrets||[]).map(s=>s.name));
    REQUIRED.forEach(s => names.has(s) ? ok(`secret exists: ${s}`) : fail(`secret MISSING: ${s}`));
  } catch {
    warn('Cannot list secrets (insufficient token scope) — verify manually in Settings → Secrets → Actions');
    REQUIRED.forEach(s => warn(`check: ${s}`));
  }
}

async function testJobDetail(wf) {
  sec('4. Most recent run — job breakdown');
  const data = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${wf.id}/runs?per_page=1`);
  const run = (data.workflow_runs||[])[0];
  if (!run) { warn('no runs to inspect'); return; }
  const jobs = await gh(`/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${run.id}/jobs`);
  const REGIONS = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south'];
  ok(`run #${run.run_number} had ${(jobs.jobs||[]).length} jobs`);
  for (const reg of REGIONS) {
    const j = (jobs.jobs||[]).find(j => j.name.includes(reg));
    if (!j) { warn(`no job for region: ${reg}`); continue; }
    const icon = j.conclusion==='success' ? '\x1b[32m✓\x1b[0m' : j.conclusion==='failure' ? '\x1b[31m✗\x1b[0m' : '?';
    const dur  = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at)-new Date(j.started_at))/1000)+'s' : '?';
    console.log(`    ${icon} ${reg.padEnd(14)} ${(j.conclusion||j.status).padEnd(10)} ${dur}`);
  }
}

async function main() {
  console.log(`\n\x1b[1mGitHub: ${REPO_OWNER}/${REPO_NAME}\x1b[0m`);
  const wf = await testWorkflow();
  if (!wf) process.exit(1);
  await testRuns(wf);
  await testSecrets();
  await testJobDetail(wf);
  console.log(process.exitCode ? '\n\x1b[31mFailed.\x1b[0m' : '\n\x1b[32mAll passed.\x1b[0m');
}
main().catch(e => { console.error(e); process.exit(1); });

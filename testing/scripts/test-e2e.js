#!/usr/bin/env node
/**
 * test-e2e.js
 * Full end-to-end pipeline test:
 *   1. Trigger a GitHub Actions run via the Cloudflare Worker
 *   2. Poll GitHub until the run completes (or timeout)
 *   3. Verify new Supabase rows exist with correct Playwright fields
 *
 * Usage:
 *   WORKER_URL=https://geo-monitor-worker.divine-wind-e9a3.workers.dev \
 *   SUPABASE_URL=https://bacumktnpozarnfvsrbw.supabase.co \
 *   SUPABASE_KEY=<key> \
 *   GITHUB_TOKEN=<pat_with_actions_read> \
 *   node test-e2e.js
 *
 * Flags:
 *   --skip-trigger   skip the trigger step (use if a run is already in progress)
 *   --timeout 300    max seconds to wait for run completion (default: 300)
 */

const WORKER_URL   = process.env.WORKER_URL   || 'https://geo-monitor-worker.divine-wind-e9a3.workers.dev';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bacumktnpozarnfvsrbw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER   = process.env.GITHUB_REPO_OWNER || 'DeveloperAlly';
const REPO_NAME    = process.env.GITHUB_REPO_NAME  || 'gamerslab';
const TIMEOUT_SEC  = parseInt(process.env.TIMEOUT || '300');
const REGIONS      = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south'];
if (!SUPABASE_KEY) { console.error('SUPABASE_KEY required'); process.exit(1); }

const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; };
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const info = msg => console.log(`  \x1b[34m…\x1b[0m ${msg}`);
const sec  = msg => console.log(`\n\x1b[1m${msg}\x1b[0m`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function step1Trigger() {
  sec('1. Trigger via Cloudflare Worker /api/trigger');
  if (process.argv.includes('--skip-trigger')) {
    warn('skipped (--skip-trigger)');
    return Date.now();
  }
  const res = await fetch(`${WORKER_URL}/api/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'standard' }),
  });
  const body = await res.json();
  if (res.ok && body.triggered) { ok(`dispatched (mode=${body.mode})`); return Date.now(); }
  fail(`trigger failed: ${JSON.stringify(body)}`); return null;
}

async function step2WaitForRun(t0) {
  sec('2. Wait for GitHub Actions run to complete');
  if (!GITHUB_TOKEN) {
    warn('GITHUB_TOKEN not set — skipping poll, waiting 90s instead');
    info('check https://github.com/DeveloperAlly/gamerslab/actions manually');
    await sleep(90000);
    return true;
  }
  info('waiting 15s for GitHub to register run...');
  await sleep(15000);

  const deadline = Date.now() + TIMEOUT_SEC * 1000;
  while (Date.now() < deadline) {
    const data = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=5&event=workflow_dispatch`,
      { headers: { Authorization:`Bearer ${GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'GamersLab-Test' } }
    ).then(r => r.json());

    const runs = (data.workflow_runs||[]).filter(r => new Date(r.created_at).getTime() > t0 - 30000);
    if (!runs.length) { info('no matching run yet, retrying...'); await sleep(10000); continue; }

    const run = runs[0];
    info(`run #${run.run_number} status=${run.status} conclusion=${run.conclusion||'pending'}`);
    if (run.status === 'completed') {
      if (run.conclusion === 'success') { ok(`run #${run.run_number} succeeded`); return true; }
      else { fail(`run #${run.run_number} conclusion=${run.conclusion}`); return false; }
    }
    await sleep(10000);
  }
  fail(`timed out after ${TIMEOUT_SEC}s`); return false;
}

async function step3VerifySupabase(t0) {
  sec('3. Verify Supabase results');
  const since = new Date(t0 - 5000).toISOString();
  const rows = await sbGet(
    `/monitor_results?select=region,status,ttfb_ms,page_title,game_iframe_loaded,js_errors,referrer_used,render_error,checked_at` +
    `&checked_at=gte.${since}&order=checked_at.desc&limit=30`
  );

  if (!rows.length) { fail('no results in Supabase since trigger — check GitHub Actions logs'); return; }
  ok(`${rows.length} new rows found`);

  const seen = new Set(rows.map(r => r.region));
  REGIONS.forEach(reg => seen.has(reg) ? ok(`result received: ${reg}`) : fail(`missing result: ${reg}`));

  sec('4. Per-region detail');
  for (const reg of REGIONS) {
    const row = rows.find(r => r.region === reg);
    if (!row) continue;
    const s   = row.status===1 ? '\x1b[32mOK\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const ifr = row.game_iframe_loaded===true ? '\x1b[32miframe✓\x1b[0m' : row.game_iframe_loaded===false ? '\x1b[33miframe✗\x1b[0m' : 'iframe?';
    const err = (() => { try { return JSON.parse(row.js_errors||'[]').length; } catch { return '?'; } })();
    console.log(`    ${reg.padEnd(14)} ${s}  ttfb=${String(row.ttfb_ms||'?').padStart(5)}ms  ${ifr}  js_errors=${err}  ref=${row.referrer_used||'(direct)'}`);
    if (row.render_error) fail(`  ${reg}: ${row.render_error}`);
  }

  sec('5. Summary');
  const passed = rows.filter(r=>r.status===1).length;
  const pct    = Math.round(passed/rows.length*100);
  passed===rows.length ? ok(`all ${passed} checks passed`) : warn(`${passed}/${rows.length} passed (${pct}%)`);

  const pw = rows.filter(r=>r.page_title!==null).length;
  pw ? ok(`${pw}/${rows.length} have Playwright data`) : fail('no Playwright data — check monitor.js logs');

  const iframe = rows.filter(r=>r.game_iframe_loaded===true).length;
  iframe ? ok(`game iframe loaded in ${iframe}/${pw} Playwright results`) : warn('game iframe not loaded — may be blocked by itch.io IP filter');
}

async function main() {
  console.log('\n\x1b[1mGamersLab Geo Monitor — E2E Test\x1b[0m');
  console.log(`Worker: ${WORKER_URL}\nSupabase: ${SUPABASE_URL}\nTimeout: ${TIMEOUT_SEC}s`);
  const t0 = await step1Trigger();
  if (!t0) process.exit(1);
  await step2WaitForRun(t0);
  await step3VerifySupabase(t0);
  console.log(process.exitCode ? '\n\x1b[31mE2E test failed.\x1b[0m' : '\n\x1b[32mE2E test passed.\x1b[0m');
}
main().catch(e => { console.error(e); process.exit(1); });

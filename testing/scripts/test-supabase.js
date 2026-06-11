#!/usr/bin/env node
/**
 * test-supabase.js
 * Verifies Supabase schema, seed data, and recent pipeline results.
 *
 * Usage:
 *   SUPABASE_URL=https://bacumktnpozarnfvsrbw.supabase.co \
 *   SUPABASE_KEY=<service_or_publishable_key> \
 *   node test-supabase.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bacumktnpozarnfvsrbw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_KEY) { console.error('SUPABASE_KEY required'); process.exit(1); }

const PLAYWRIGHT_COLS = ['page_title','game_iframe_loaded','js_errors','page_blocked','render_error','referrer_used','click_check_done','login_prompt_shown'];
const REGIONS = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south'];

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; };
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const sec  = msg => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function testTables() {
  sec('1. Tables');
  for (const t of ['monitor_results','targets','referrers','monitor_config','scheduled_surges']) {
    try { await sb(`/${t}?limit=0`); ok(`exists: ${t}`); }
    catch { fail(`missing: ${t} — run 01_schema_migration.sql`); }
  }
}

async function testColumns() {
  sec('2. Playwright columns on monitor_results');
  try {
    await sb(`/monitor_results?limit=1&select=${PLAYWRIGHT_COLS.join(',')}`);
    ok(`all Playwright columns present`);
  } catch (e) {
    fail(`missing Playwright columns — run 01_schema_migration.sql migration section: ${e.message}`);
  }
}

async function testSeedData() {
  sec('3. Seed data');
  const targets = await sb('/targets?active=eq.true&limit=1');
  targets.length ? ok(`active target: ${targets[0].url}`) : fail('no active target — run seed in 01_schema_migration.sql');

  const refs = await sb('/referrers?enabled=eq.true&select=name');
  refs.length ? ok(`${refs.length} enabled referrer(s): ${refs.map(r=>r.name).join(', ')}`) : warn('no enabled referrers — visits go direct to target');

  const cfg = await sb('/monitor_config?select=key,value');
  const pct = cfg.find(r => r.key === 'click_check_percentage');
  pct ? ok(`click_check_percentage = ${pct.value}%`) : fail('monitor_config missing click_check_percentage — run seed');
}

async function testRecentResults() {
  sec('4. Recent results');
  const rows = await sb('/monitor_results?select=region,status,ttfb_ms,page_title,game_iframe_loaded,referrer_used,checked_at&order=checked_at.desc&limit=12');
  if (!rows.length) { warn('no results yet — trigger a manual run first'); return; }

  const ageMin = Math.round((Date.now() - new Date(rows[0].checked_at)) / 60000);
  ageMin < 30 ? ok(`most recent: ${ageMin}m ago`) : warn(`most recent: ${ageMin}m ago — pipeline may be idle`);
  ok(`${rows.length} results loaded`);

  const seen = new Set(rows.map(r => r.region));
  REGIONS.forEach(r => seen.has(r) ? ok(`region present: ${r}`) : warn(`region not seen in last 12: ${r}`));

  const pw = rows.filter(r => r.page_title !== null);
  pw.length ? ok(`${pw.length}/${rows.length} have Playwright data`) : warn('no Playwright data — trigger a run');

  const iframe = pw.filter(r => r.game_iframe_loaded).length;
  iframe ? ok(`game iframe loaded in ${iframe}/${pw.length} Playwright runs`) : warn('game iframe not loaded in any run');

  const withRef = rows.filter(r => r.referrer_used);
  withRef.length
    ? ok(`referrers used: ${[...new Set(withRef.map(r=>r.referrer_used))].join(', ')}`)
    : warn('no referrer_used data yet');
}

async function testSurges() {
  sec('5. Scheduled surges');
  const surges = await sb('/scheduled_surges?select=id,scheduled_at,label,status&order=created_at.desc&limit=5');
  if (!surges.length) { ok('no scheduled surges (normal)'); return; }
  const counts = surges.reduce((a,s) => { a[s.status]=(a[s.status]||0)+1; return a; }, {});
  ok(`surges: ${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join('  ')}`);
  const overdue = surges.filter(s => s.status==='pending' && new Date(s.scheduled_at) < new Date(Date.now()-5*60000));
  overdue.length ? fail(`${overdue.length} overdue pending surge(s) — Workflow G may be down`) : ok('no overdue pending surges');
}

async function main() {
  console.log(`\n\x1b[1mSupabase: ${SUPABASE_URL}\x1b[0m`);
  await testTables();
  await testColumns();
  await testSeedData();
  await testRecentResults();
  await testSurges();
  console.log(process.exitCode ? '\n\x1b[31mFailed.\x1b[0m' : '\n\x1b[32mAll passed.\x1b[0m');
}
main().catch(e => { console.error(e); process.exit(1); });

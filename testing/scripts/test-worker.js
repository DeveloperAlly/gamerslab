#!/usr/bin/env node
/**
 * test-worker.js
 * Tests the Cloudflare Worker geo proxy and all /api/* endpoints.
 *
 * Usage:
 *   WORKER_URL=https://geo-monitor-worker.divine-wind-e9a3.workers.dev \
 *   node test-worker.js
 *
 * Flags:
 *   --skip-trigger   skip /api/trigger (avoids firing a real GH Actions run)
 *   --skip-discord   skip /api/discord-test (avoids posting to Discord)
 */

const WORKER_URL = process.env.WORKER_URL || 'https://geo-monitor-worker.divine-wind-e9a3.workers.dev';
const REGIONS = ['us-east','eu-west','ap-southeast','sa-east','me-south','af-south'];

async function req(url, opts={}) {
  const res = await fetch(url, opts);
  let body; try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, ok: res.ok, body };
}

const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; };
const skip = msg => console.log(`  \x1b[33m⊘\x1b[0m ${msg}`);
const sec  = msg => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function testSingleRegion() {
  sec('1. Geo proxy — single region (us-east)');
  const r = await req(WORKER_URL, { headers: { 'X-Monitor-Region': 'us-east' } });
  if (!r.ok)             return fail(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  const b = r.body;
  b.ok === true          ? ok(`ok=true  ttfb=${b.ttfb_ms}ms  colo=${b.cf_colo}`) : fail(`ok=false  error=${b.render_error||b.error}`);
  typeof b.ttfb_ms==='number' ? ok(`ttfb_ms present (${b.ttfb_ms}ms)`) : fail('ttfb_ms missing');
}

async function testAllRegions() {
  sec('2. Geo proxy — all 6 regions in parallel');
  const results = await Promise.all(
    REGIONS.map(region => req(WORKER_URL, { headers: { 'X-Monitor-Region': region } }).then(r => ({ region, ...r.body })))
  );
  for (const r of results) {
    r.ok
      ? ok(`${r.region.padEnd(14)} ttfb=${String(r.ttfb_ms||'?').padStart(5)}ms  colo=${r.cf_colo||'?'}`)
      : fail(`${r.region.padEnd(14)} ok=false  error=${r.render_error||r.error}`);
  }
}

async function testWorkflowStatus() {
  sec('3. /api/workflow/status');
  const r = await req(`${WORKER_URL}/api/workflow/status`, { method: 'GET' });
  if (!r.ok) return fail(`HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  typeof r.body.active!=='undefined'          ? ok(`active=${r.body.active}`)          : fail('active field missing');
  typeof r.body.intervalMinutes!=='undefined' ? ok(`intervalMinutes=${r.body.intervalMinutes}`) : fail('intervalMinutes missing');
}

async function testCors() {
  sec('4. CORS preflight (OPTIONS)');
  const r = await req(WORKER_URL, { method: 'OPTIONS' });
  (r.status===204||r.status===200) ? ok(`OPTIONS ${r.status}`) : fail(`OPTIONS ${r.status}`);
}

async function testDiscord() {
  sec('5. /api/discord-test');
  if (process.argv.includes('--skip-discord')) { skip('skipped (--skip-discord)'); return; }
  const r = await req(`${WORKER_URL}/api/discord-test`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  r.ok && r.body.sent ? ok('Discord test message sent') : fail(`Discord failed: ${JSON.stringify(r.body)}`);
}

async function testTrigger() {
  sec('6. /api/trigger (fires a real GitHub Actions run)');
  if (process.argv.includes('--skip-trigger')) { skip('skipped (--skip-trigger)'); return; }
  const r = await req(`${WORKER_URL}/api/trigger`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode:'standard'}) });
  r.ok && r.body.triggered ? ok(`triggered: mode=${r.body.mode}`) : fail(`failed: ${JSON.stringify(r.body)}`);
}

async function main() {
  console.log(`\n\x1b[1mWorker: ${WORKER_URL}\x1b[0m`);
  await testSingleRegion();
  await testAllRegions();
  await testWorkflowStatus();
  await testCors();
  await testDiscord();
  await testTrigger();
  console.log(process.exitCode ? '\n\x1b[31mFailed.\x1b[0m' : '\n\x1b[32mAll passed.\x1b[0m');
}
main().catch(e => { console.error(e); process.exit(1); });

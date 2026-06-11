#!/usr/bin/env node
/**
 * test-n8n.js
 * Checks n8n workflow active status, node config, and recent executions.
 *
 * Usage:
 *   N8N_URL=https://n8n-j39n.sliplane.app \
 *   N8N_API_KEY=<api_key> \
 *   node test-n8n.js
 */

const N8N_URL     = process.env.N8N_URL     || 'https://n8n-j39n.sliplane.app';
const N8N_API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.N8N_WORKFLOW_ID || 'pTkt5lTwDgTwUY1f';
if (!N8N_API_KEY) { console.error('N8N_API_KEY required'); process.exit(1); }

async function n8n(path) {
  const res = await fetch(`${N8N_URL}/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  if (!res.ok) throw new Error(`n8n ${res.status}: ${await res.text()}`);
  return res.json();
}

const ok   = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); process.exitCode = 1; };
const warn = msg => console.log(`  \x1b[33m⚠\x1b[0m ${msg}`);
const sec  = msg => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function testWorkflow() {
  sec('1. Workflow status and node config');
  const wf = await n8n(`/workflows/${WORKFLOW_ID}`);
  wf.active ? ok(`"${wf.name}" is ACTIVE`) : fail(`"${wf.name}" is INACTIVE — activate in n8n`);

  // Schedule Trigger interval
  const sched = wf.nodes.find(n => n.name === 'Schedule Trigger');
  if (sched) {
    const mins = sched.parameters?.rule?.interval?.[0]?.minutesInterval;
    mins ? ok(`Schedule Trigger: every ${mins} minute(s)`) : fail('Schedule Trigger missing minutesInterval');
  }

  // Mark fired SQL — must use $('Check due events') not $json.id
  const mf = wf.nodes.find(n => n.name === 'Mark fired');
  if (mf) {
    const q = mf.parameters?.query || '';
    if (q.includes("$('Check due events')"))  ok('Mark fired SQL: correct reference \u2713');
    else if (q.includes('$json.id'))          fail('Mark fired SQL uses $json.id — will be undefined after GitHub dispatch node. Fix: use $(\'Check due events\').item.json.id');
    else                                      warn(`Mark fired SQL unexpected: ${q.slice(0,80)}`);
  }
}

async function testExecutions() {
  sec('2. Recent executions (last 10)');
  const data = await n8n(`/executions?workflowId=${WORKFLOW_ID}&limit=10`);
  const execs = data.data || [];
  if (!execs.length) { warn('no executions found'); return; }

  const counts = execs.reduce((a,e) => { a[e.status]=(a[e.status]||0)+1; return a; }, {});
  ok(`last ${execs.length}: ${Object.entries(counts).map(([k,v])=>`${k}=${v}`).join('  ')}`);

  const errors = execs.filter(e => e.status==='error');
  errors.length ? fail(`${errors.length} error(s) in last 10 runs`) : ok('no errors in last 10 runs');

  const ageMin = Math.round((Date.now() - new Date(execs[0].startedAt)) / 60000);
  ageMin < 60 ? ok(`most recent: ${ageMin}m ago (${execs[0].status})`) : warn(`most recent: ${ageMin}m ago — may be idle`);
}

async function testWebhooks() {
  sec('3. Webhook reachability');
  const tests = [
    { name: 'Surge webhook',          path: '/webhook/surge',          body: '{}' },
    { name: 'Schedule surge webhook', path: '/webhook/schedule-surge', body: JSON.stringify({ scheduledAt: new Date(Date.now()+9999999).toISOString(), label: 'test' }) },
  ];
  for (const t of tests) {
    const res = await fetch(`${N8N_URL}${t.path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:t.body });
    res.status < 500 ? ok(`${t.name}: HTTP ${res.status}`) : fail(`${t.name}: HTTP ${res.status} (server error)`);
  }
}

async function main() {
  console.log(`\n\x1b[1mn8n: ${N8N_URL} / workflow: ${WORKFLOW_ID}\x1b[0m`);
  await testWorkflow();
  await testExecutions();
  await testWebhooks();
  console.log(process.exitCode ? '\n\x1b[31mFailed.\x1b[0m' : '\n\x1b[32mAll passed.\x1b[0m');
}
main().catch(e => { console.error(e); process.exit(1); });

/**
 * GamersLab Surge Check — 19 parallel lightweight page fetches
 *
 * Runs after the main Playwright check in surge mode.
 * Uses 19 concurrent lightweight browser contexts (not full Playwright checks)
 * to simulate concurrent user load. Each context opens the page, waits for
 * domcontentloaded, and records whether it loaded successfully.
 *
 * Does NOT push individual results to Supabase — the main Playwright result
 * already records the authoritative surge check. This script just fires the
 * load and exits, creating concurrent traffic on the target.
 */

const { chromium } = require('playwright');

const TARGET_URL = process.env.TARGET_URL || 'https://uprisinglabs.itch.io/bug-seek-expedition-edition';
const REGION = process.env.REGION || 'unknown';
const CONCURRENCY = 19;
const TIMEOUT = 15000;

async function singleLoad(browser, index) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    console.log(`Surge load ${index + 1}/${CONCURRENCY} [${REGION}]: ok`);
  } catch (e) {
    console.log(`Surge load ${index + 1}/${CONCURRENCY} [${REGION}]: ${e.message.substring(0, 80)}`);
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  console.log(`Starting ${CONCURRENCY} parallel surge loads from ${REGION}...`);
  const tasks = Array.from({ length: CONCURRENCY }, (_, i) => singleLoad(browser, i));
  await Promise.allSettled(tasks);
  await browser.close();
  console.log(`Surge complete: ${CONCURRENCY} loads from ${REGION}`);
}

run().catch(e => {
  console.error('Surge script error:', e);
  process.exit(0);
});

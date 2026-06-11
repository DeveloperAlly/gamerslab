/**
 * GamersLab Geo Monitor — Playwright headless browser check
 *
 * Fetches config from Supabase at runtime:
 *   - active target URL
 *   - enabled referrer list
 *   - click_check_percentage (what % of runs click "Run game" to verify login prompt)
 *
 * Visit flow:
 *   1. Navigate to referrer (randomly chosen from enabled list)
 *   2. Dwell 2–4s on referrer
 *   3. Navigate to target URL (Referer header set naturally by browser)
 *   4. Verify page loads and has expected content
 *   5. Check game embed is present (resilient multi-strategy detection)
 *   6. If selected by click_check_percentage: find and click the play button
 *      using multiple parallel strategies, verify login prompt appears
 *   7. Dwell 3–6s
 *
 * RESILIENCE PHILOSOPHY:
 * Every detection step uses multiple independent strategies simultaneously.
 * If itch.io changes their HTML, CSS classes, button text, or layout,
 * at least one strategy should still work. Strategies are never dependent
 * on each other — iframe check and click-check are fully independent.
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

const REGION          = process.env.REGION       || 'unknown';
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_KEY;
const FALLBACK_TARGET = process.env.TARGET_URL   || 'https://uprisinglabs.itch.io/bug-seek-expedition-edition';
const TIMEOUT         = 25000;

const ACCEPT_LANGUAGE = {
  'us-east':      'en-US,en;q=0.9',
  'eu-west':      'fr-FR,fr;q=0.9,en;q=0.8',
  'ap-southeast': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sa-east':      'pt-BR,pt;q=0.9,en;q=0.8',
  'me-south':     'ar-SA,ar;q=0.9,en;q=0.8',
  'af-south':     'sw-KE,sw;q=0.9,en;q=0.8',
};

const BLOCK_INDICATORS = [
  'cf-browser-verification', 'Attention Required', 'Just a moment',
  'Enable JavaScript and cookies', 'Access denied',
];

// ── Game embed detection strategies ──────────────────────────────────────────
// All tried in parallel. Any match = game embed confirmed present.

// CSS selectors for the iframe or its container
const EMBED_CSS_SELECTORS = [
  'iframe#game_drop',
  '.game_frame iframe',
  '#game_frame iframe',
  '#game_frame',
  '.game_frame',
  '.iframe_wrap iframe',
  '.iframe_wrap',
  '.html_embed_widget iframe',
  '.html_embed_widget',
  'div[class*="game_frame"]',
  'div[class*="game_drop"]',
  'div[id*="game"]',
];

// HTML source strings — if any appear in the page source the embed scaffold is present
const EMBED_SOURCE_MARKERS = [
  'game_drop', 'game_frame', 'iframe_wrap',
  'html_embed_widget', 'load_iframe_btn',
  'Run game', 'Restore game', 'data-iframe',
];

// ── Play button detection strategies ─────────────────────────────────────────
// All tried in parallel. Any match = play button found.
// NEVER rely on a single selector — itch.io changes their HTML regularly.

// CSS selectors
const PLAY_BTN_CSS = [
  'button.load_iframe_btn',
  '.run_game_btn',
  '[data-action="load_iframe"]',
  '.play_btn',
  'button[class*="load"]',
  'button[class*="run"]',
  'button[class*="play"]',
  'a[class*="run_game"]',
  'a[class*="play"]',
  '.game_frame button',
  '#game_frame button',
  '.iframe_wrap button',
];

// Text-based searches — matches any clickable element containing these strings
// Case-insensitive partial match
const PLAY_BTN_TEXT = [
  'Run game',
  'Play game',
  'Play now',
  'Launch game',
  'Start game',
  'Load game',
  'Play in browser',
  'Run in browser',
  'Restore game',
];

// ARIA label searches
const PLAY_BTN_ARIA = [
  '[aria-label*="run" i]',
  '[aria-label*="play" i]',
  '[aria-label*="launch" i]',
  '[aria-label*="game" i]',
];

// ── Login/auth prompt indicators ──────────────────────────────────────────────
// Any of these in the post-click page = login prompt confirmed
const LOGIN_INDICATORS = [
  'Log in', 'Sign in', 'Create account', 'itch.io account',
  'login_form', 'register_form', 'itch.io/login', 'itch.io/register',
  'You need an account', 'to play this game',
];

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sbGet(path) {
  return new Promise((resolve) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return resolve(null);
    const url = new URL(`${SUPABASE_URL}${path}`);
    const req = https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchConfig() {
  const [targets, referrers, config] = await Promise.all([
    sbGet('/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1&select=url'),
    sbGet('/rest/v1/referrers?enabled=eq.true&select=url,name&order=created_at.asc'),
    sbGet('/rest/v1/monitor_config?select=key,value'),
  ]);

  const targetUrl     = (Array.isArray(targets) && targets[0]?.url) || FALLBACK_TARGET;
  const referrerList  = Array.isArray(referrers) ? referrers : [];
  const configMap     = {};
  if (Array.isArray(config)) config.forEach(r => { configMap[r.key] = r.value; });
  const clickCheckPct = parseInt(configMap['click_check_percentage'] || '30');

  console.log(`Target: ${targetUrl} | Referrers: ${referrerList.map(r => r.name).join(', ') || 'none'} | Click-check: ${clickCheckPct}%`);
  return { targetUrl, referrerList, clickCheckPct };
}

const pick   = arr => arr[Math.floor(Math.random() * arr.length)];
const randMs = (min, max) => Math.floor(Math.random() * (max - min)) + min;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ── Multi-strategy embed detection ───────────────────────────────────────────
// Tries all strategies in parallel with a shared timeout.
// Returns { found: bool, method: string }
async function detectGameEmbed(page, pageContent) {
  // Strategy 1: CSS selectors (parallel race)
  const cssPromise = Promise.any(
    EMBED_CSS_SELECTORS.map(sel =>
      page.waitForSelector(sel, { timeout: 5000 })
        .then(() => `css:${sel}`)
    )
  ).catch(() => null);

  // Strategy 2: Page source markers (instant, no timeout needed)
  const sourceFound = EMBED_SOURCE_MARKERS.find(m => pageContent.includes(m));
  const sourcePromise = sourceFound
    ? Promise.resolve(`source:${sourceFound}`)
    : Promise.resolve(null);

  const [cssResult, sourceResult] = await Promise.all([cssPromise, sourcePromise]);
  const method = cssResult || sourceResult;

  if (method) console.log(`Game embed found via: ${method}`);
  else        console.log('Game embed NOT found by any strategy');

  return { found: !!method, method };
}

// ── Multi-strategy play button finder ────────────────────────────────────────
// Tries CSS selectors, text content, and aria labels simultaneously.
// Returns the element handle or null.
async function findPlayButton(page) {
  // Try all CSS selectors
  for (const sel of PLAY_BTN_CSS) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`Play button found via CSS: ${sel}`);
        return el;
      }
    } catch (_) {}
  }

  // Try text-based search across all clickable elements
  for (const text of PLAY_BTN_TEXT) {
    try {
      // Playwright's :has-text is case-sensitive — use getByText for case-insensitive
      const el = page.getByRole('button', { name: new RegExp(text, 'i') });
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Play button found via role+text: "${text}"`);
        return await el.elementHandle();
      }
    } catch (_) {}

    try {
      // Fallback: any element with matching text
      const el = page.locator(`text=${text}`).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Play button found via text locator: "${text}"`);
        return await el.elementHandle();
      }
    } catch (_) {}
  }

  // Try ARIA labels
  for (const sel of PLAY_BTN_ARIA) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) {
        console.log(`Play button found via ARIA: ${sel}`);
        return el;
      }
    } catch (_) {}
  }

  // Log all visible buttons/links on page to aid future debugging
  try {
    const allClickable = await page.$$eval(
      'button, a[href], input[type="submit"], [role="button"]',
      els => els
        .filter(el => el.offsetParent !== null) // visible only
        .map(el => `${el.tagName}:"${el.textContent?.trim().substring(0, 40)}" class="${el.className?.substring(0, 40)}"`)
        .slice(0, 20)
    );
    console.log(`Play button NOT found. Visible clickables:\n  ${allClickable.join('\n  ')}`);
  } catch (_) {}

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { targetUrl, referrerList, clickCheckPct } = await fetchConfig();
  const chosenReferrer = referrerList.length > 0 ? pick(referrerList) : null;
  const acceptLanguage = ACCEPT_LANGUAGE[REGION] || 'en-US,en;q=0.9';
  const doClickCheck   = Math.random() * 100 < clickCheckPct;

  console.log(`Region: ${REGION} | Referrer: ${chosenReferrer?.url || 'none'} | Click-check: ${doClickCheck}`);

  const result = {
    region: REGION, ok: false, ttfb_ms: null,
    page_title: null, game_iframe_loaded: false,
    js_errors: [], page_blocked: false, render_error: null,
    content_language: null, accept_language_sent: acceptLanguage, cf_colo: null,
    referrer_used: chosenReferrer?.url || null,
    click_check_done: false, login_prompt_shown: null,
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--no-first-run', '--no-zygote',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      locale: acceptLanguage.split(',')[0].split(';')[0].trim(),
      extraHTTPHeaders: { 'Accept-Language': acceptLanguage },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();

    // ── Step 1: Visit referrer ────────────────────────────────────────────────
    if (chosenReferrer) {
      try {
        await page.goto(chosenReferrer.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(randMs(2000, 4000));
      } catch (e) {
        console.log(`Referrer failed: ${e.message.substring(0, 80)}, going direct.`);
      }
    }

    // ── Step 2: Navigate to target ────────────────────────────────────────────
    const jsErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text().substring(0, 300)); });
    page.on('pageerror', err => { jsErrors.push(`PageError: ${err.message}`.substring(0, 300)); });

    let ttfb = null, responseStatus = null, contentLanguage = null;
    const startTime = Date.now();
    page.on('response', res => {
      const u = res.url();
      if ((u === targetUrl || u.startsWith(targetUrl.split('?')[0])) && ttfb === null) {
        ttfb = Date.now() - startTime;
        responseStatus = res.status();
        contentLanguage = res.headers()['content-language'] || null;
      }
    });

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    } catch (e) {
      if (!e.message.includes('timeout')) result.render_error = `Navigation failed: ${e.message.substring(0, 200)}`;
    }

    result.ttfb_ms          = ttfb || (Date.now() - startTime);
    result.content_language = contentLanguage;

    if (!result.render_error) {
      try { await page.waitForSelector('body', { timeout: 5000 }); } catch (_) {}

      const pageContent = await page.content().catch(() => '');
      const pageTitle   = await page.title().catch(() => '');
      result.page_title = pageTitle;

      const isBlocked = BLOCK_INDICATORS.some(i => pageContent.includes(i) || pageTitle.includes(i));
      result.page_blocked = isBlocked;

      if (isBlocked) {
        result.render_error = 'Page blocked by Cloudflare challenge';
      } else if (responseStatus && responseStatus >= 400) {
        result.render_error = `HTTP ${responseStatus}`;
      } else {
        const hasExpectedContent =
          pageContent.includes('itch.io') || pageContent.includes('bug-seek') ||
          pageContent.includes('Bug Seek') || pageContent.includes('Bug &amp; Seek') ||
          pageTitle.toLowerCase().includes('itch');

        if (!hasExpectedContent) result.render_error = 'Expected content not found';

        // ── Step 3: Detect game embed (multi-strategy, independent) ───────────
        const { found: embedFound } = await detectGameEmbed(page, pageContent);
        result.game_iframe_loaded = embedFound;

        // ── Step 4: Click-check (multi-strategy, INDEPENDENT of embed check) ──
        // Runs regardless of whether the embed was detected.
        // Uses every available strategy to find the play button.
        if (doClickCheck) {
          result.click_check_done = true;
          const playBtn = await findPlayButton(page);

          if (playBtn) {
            try {
              await playBtn.click();
              await sleep(3000);
              const postClick = await page.content().catch(() => '');
              result.login_prompt_shown = LOGIN_INDICATORS.some(i => postClick.includes(i));
              console.log(`Click-check: login_prompt_shown=${result.login_prompt_shown}`);
            } catch (e) {
              console.log(`Click-check click error: ${e.message.substring(0, 100)}`);
              result.click_check_done = false;
            }
          } else {
            result.click_check_done = false;
          }
        }

        // ── Step 5: Dwell ─────────────────────────────────────────────────────
        await sleep(randMs(3000, 6000));

        result.js_errors = jsErrors.slice(0, 10);
        const httpOk = !responseStatus || (responseStatus >= 200 && responseStatus < 400);
        result.ok = hasExpectedContent && !isBlocked && httpOk;
        if (jsErrors.length >= 3) { result.render_error = `${jsErrors.length} JS errors`; result.ok = false; }
      }
    }

    if (result.page_blocked || (responseStatus && responseStatus >= 400)) result.ok = false;

  } catch (e) {
    result.render_error = `Browser error: ${e.message.substring(0, 200)}`;
    result.ok = false;
  } finally {
    if (browser) await browser.close();
  }

  const resultJson = JSON.stringify(result);
  console.log('MONITOR RESULT:', resultJson);
  fs.appendFileSync(process.env.GITHUB_ENV, `MONITOR_RESULT=${resultJson}\n`);
  process.exit(0);
}

run().catch(e => {
  console.error('Monitor script error:', e);
  const fallback = JSON.stringify({ ok: false, render_error: e.message, js_errors: [], game_iframe_loaded: false });
  fs.appendFileSync(process.env.GITHUB_ENV, `MONITOR_RESULT=${fallback}\n`);
  process.exit(0);
});

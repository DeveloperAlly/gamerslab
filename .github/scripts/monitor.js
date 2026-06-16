/**
 * GamersLab Geo Monitor — Playwright headless browser check
 *
 * CLICK-CHECK BEHAVIOUR:
 * - Finds and clicks play button using all strategies in parallel
 * - Retries up to click_check_max_retries times until login page confirmed
 * - Login confirmation via URL change, DOM elements, iframe, or text
 *
 * DWELL CHECK (post-click):
 * - After login page confirmed, stays on page for dwell_check_seconds_min
 *   to dwell_check_seconds_max seconds (random, configurable)
 * - Capped at DWELL_MAX_SECONDS (120s) to prevent GitHub Actions job timeout
 * - Monitors continuously for: page crashes, JS errors, console errors,
 *   navigation away from expected domain, blank/white page
 * - Reports all errors found during dwell period
 * - Records dwell_crash (bool) and dwell_errors (JSON array) in result
 *
 * JS ERROR HANDLING:
 * - Known itch.io noise errors are filtered before counting
 * - ok:false only triggered when JS_ERROR_THRESHOLD (5) genuine errors found
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

const REGION          = process.env.REGION       || 'unknown';
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_KEY;
const FALLBACK_TARGET = process.env.TARGET_URL   || 'https://uprisinglabs.itch.io/bug-seek-expedition-edition';
const TIMEOUT         = 35000; // raised from 25s — VPN adds latency

// Hard cap on dwell to prevent job timeout cancellations.
// GitHub job timeout is 15min; install+VPN+Playwright takes ~5min,
// leaving ~10min. 120s dwell gives comfortable headroom.
const DWELL_MAX_SECONDS = 120;

// Number of genuine JS errors required to mark ok:false
// Raised from 3 to 5 — itch.io consistently generates 1-3 noise errors
const JS_ERROR_THRESHOLD = 5;

// Known itch.io noise errors to filter — not indicative of game health
const JS_ERROR_NOISE_PATTERNS = [
  'Error parsing menu buttons JSON',   // broken itch.io store API response
  'SyntaxError: Unexpected end of JSON', // same, different form
  'CreateInstallStoreIcons',            // itch.io store icon loading
  'ERR_NAME_NOT_RESOLVED',              // DNS for external assets (fonts, analytics)
  'ERR_CONNECTION_RESET',               // transient network resets from VPN
  'favicon',                            // favicon load failures
  'googletagmanager',                   // analytics
  'google-analytics',                   // analytics
  'doubleclick',                        // ads
];

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

const EMBED_CSS_SELECTORS = [
  'iframe#game_drop', '.game_frame iframe', '#game_frame iframe',
  '#game_frame', '.game_frame', '.iframe_wrap iframe', '.iframe_wrap',
  '.html_embed_widget iframe', '.html_embed_widget',
  'div[class*="game_frame"]', 'div[class*="game_drop"]', 'div[id*="game"]',
];
const EMBED_SOURCE_MARKERS = [
  'game_drop', 'game_frame', 'iframe_wrap', 'html_embed_widget',
  'load_iframe_btn', 'Run game', 'Restore game', 'data-iframe',
];

const PLAY_BTN_CSS = [
  'button.load_iframe_btn', '.run_game_btn', '[data-action="load_iframe"]',
  '.play_btn', 'button[class*="load"]', 'button[class*="run"]',
  'button[class*="play"]', 'a[class*="run_game"]', 'a[class*="play"]',
  '.game_frame button', '#game_frame button', '.iframe_wrap button',
];
const PLAY_BTN_TEXT = [
  'Run game', 'Play game', 'Play now', 'Launch game', 'Start game',
  'Load game', 'Play in browser', 'Run in browser', 'Restore game', 'Play',
];
const PLAY_BTN_ARIA = [
  '[aria-label*="run" i]', '[aria-label*="play" i]',
  '[aria-label*="launch" i]', '[aria-label*="game" i]',
];

const LOGIN_URL_PATTERNS = [
  'itch.io/login', 'itch.io/register', 'itch.io/user/login',
];
const LOGIN_DOM_SELECTORS = [
  'form[action*="login"]', 'form[action*="register"]',
  'input[name="username"]', 'input[name="password"]',
  'input[type="password"]', '#login_form', '#register_form',
  '.login_form', '.sign_in_form',
];
const LOGIN_TEXT_INDICATORS = [
  'Log in with itch.io', 'Sign in to itch.io', 'Create an itch.io account',
  'Forgot password', 'You need to log in', 'login required',
];

const CRASH_INDICATORS = [
  'Aw, Snap!', 'He\'s Dead, Jim', 'Something went wrong',
  'ERR_', 'chrome-error://', 'about:blank',
];

// ── JS error filtering ────────────────────────────────────────────────────────
function isNoiseError(errorText) {
  return JS_ERROR_NOISE_PATTERNS.some(pattern =>
    errorText.toLowerCase().includes(pattern.toLowerCase())
  );
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sbGet(path) {
  return new Promise((resolve) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return resolve(null);
    const url = new URL(`${SUPABASE_URL}${path}`);
    const req = https.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Range-Unit': 'items',
        Range: '0-99',
      },
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

  const targetUrl    = (Array.isArray(targets) && targets[0]?.url) || FALLBACK_TARGET;
  const referrerList = Array.isArray(referrers) ? referrers : [];
  const configMap    = {};
  if (Array.isArray(config)) config.forEach(r => { configMap[r.key] = r.value; });

  const clickCheckPct      = parseInt(configMap['click_check_percentage']    || '30');
  const clickCheckWaitSecs = parseInt(configMap['click_check_wait_seconds']  || '5');
  const clickCheckMaxRetry = parseInt(configMap['click_check_max_retries']   || '3');
  // Dwell: use configured values but hard-cap at DWELL_MAX_SECONDS
  const dwellMinSecs       = Math.min(parseInt(configMap['dwell_check_seconds_min'] || '30'), DWELL_MAX_SECONDS);
  const dwellMaxSecs       = Math.min(parseInt(configMap['dwell_check_seconds_max'] || '120'), DWELL_MAX_SECONDS);

  console.log(`Target: ${targetUrl}`);
  console.log(`Referrers: ${referrerList.map(r => r.name).join(', ') || 'none'}`);
  console.log(`Click-check: ${clickCheckPct}% | Wait: ${clickCheckWaitSecs}s | Retries: ${clickCheckMaxRetry}`);
  console.log(`Dwell check: ${dwellMinSecs}s–${dwellMaxSecs}s (hard cap: ${DWELL_MAX_SECONDS}s)`);
  console.log(`JS error threshold: ${JS_ERROR_THRESHOLD} genuine errors`);

  return { targetUrl, referrerList, clickCheckPct, clickCheckWaitSecs, clickCheckMaxRetry, dwellMinSecs, dwellMaxSecs };
}

const pick   = arr => arr[Math.floor(Math.random() * arr.length)];
const randMs = (min, max) => Math.floor(Math.random() * (max - min)) + min;
const randSecs = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ── Game embed detection ──────────────────────────────────────────────────────
async function detectGameEmbed(page, pageContent) {
  const cssPromise = Promise.any(
    EMBED_CSS_SELECTORS.map(sel =>
      page.waitForSelector(sel, { timeout: 5000 }).then(() => `css:${sel}`)
    )
  ).catch(() => null);

  const sourceFound   = EMBED_SOURCE_MARKERS.find(m => pageContent.includes(m));
  const sourcePromise = sourceFound ? Promise.resolve(`source:${sourceFound}`) : Promise.resolve(null);

  const [cssResult, sourceResult] = await Promise.all([cssPromise, sourcePromise]);
  const method = cssResult || sourceResult;
  console.log(method ? `Embed found: ${method}` : 'Embed NOT found');
  return { found: !!method, method };
}

// ── Play button finder ────────────────────────────────────────────────────────
async function findPlayButton(page) {
  for (const sel of PLAY_BTN_CSS) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) { console.log(`  Play btn CSS: ${sel}`); return el; }
    } catch (_) {}
  }
  for (const text of PLAY_BTN_TEXT) {
    try {
      const el = page.getByRole('button', { name: new RegExp(text, 'i') });
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`  Play btn role: "${text}"`);
        return await el.elementHandle();
      }
    } catch (_) {}
    try {
      const el = page.locator(`text=${text}`).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`  Play btn text: "${text}"`);
        return await el.elementHandle();
      }
    } catch (_) {}
  }
  for (const sel of PLAY_BTN_ARIA) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) { console.log(`  Play btn ARIA: ${sel}`); return el; }
    } catch (_) {}
  }

  try {
    const all = await page.$$eval(
      'button, a[href], input[type="submit"], [role="button"]',
      els => els
        .filter(el => el.offsetParent !== null)
        .map(el => `${el.tagName}:"${el.textContent?.trim().substring(0, 40)}" class="${el.className?.substring(0, 40)}"`)
        .slice(0, 20)
    );
    console.log(`  Play button NOT FOUND. Visible clickables:\n    ${all.join('\n    ')}`);
  } catch (_) {}

  return null;
}

// ── Login page confirmation ───────────────────────────────────────────────────
async function confirmLoginPage(page) {
  const currentUrl = page.url();
  const urlMatch = LOGIN_URL_PATTERNS.find(p => currentUrl.includes(p));
  if (urlMatch) return { confirmed: true, method: 'url', detail: currentUrl };

  for (const sel of LOGIN_DOM_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return { confirmed: true, method: 'dom', detail: sel };
    } catch (_) {}
  }

  try {
    for (const frame of page.frames()) {
      if (LOGIN_URL_PATTERNS.some(p => frame.url().includes(p))) {
        return { confirmed: true, method: 'iframe', detail: frame.url() };
      }
    }
  } catch (_) {}

  const pageContent = await page.content().catch(() => '');
  const textMatch = LOGIN_TEXT_INDICATORS.find(t =>
    pageContent.toLowerCase().includes(t.toLowerCase())
  );
  if (textMatch) return { confirmed: true, method: 'text', detail: textMatch };

  const title = await page.title().catch(() => '');
  console.log(`Login NOT confirmed. URL: ${currentUrl} | Title: ${title}`);
  console.log(`Page excerpt: ${pageContent.substring(0, 500)}`);

  return { confirmed: false, method: 'none', detail: `url=${currentUrl}` };
}

// ── Click-check with retries ──────────────────────────────────────────────────
async function runClickCheck(page, waitSecs, maxRetries) {
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    attempts = attempt;
    console.log(`\nClick-check attempt ${attempt}/${maxRetries}:`);

    const btn = await findPlayButton(page);

    if (!btn) {
      console.log(`  Button not found on attempt ${attempt}.`);
      if (attempt < maxRetries) { await sleep(2000); continue; }
      console.log(`  All ${maxRetries} attempts exhausted — button never found.`);
      return { done: false, loginShown: false, attempts, finalMethod: 'button_not_found' };
    }

    try {
      await btn.click();
      console.log(`  Clicked. Waiting ${waitSecs}s...`);
      await sleep(waitSecs * 1000);

      const { confirmed, method, detail } = await confirmLoginPage(page);
      console.log(`  Login confirmed: ${confirmed} | method: ${method} | detail: ${detail}`);

      if (confirmed) return { done: true, loginShown: true, attempts, finalMethod: method };

      console.log(`  Not confirmed. Retrying...`);
      const title = await page.title().catch(() => '');
      console.log(`  Current: "${title}" | ${page.url()}`);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleep(1000);

    } catch (e) {
      console.log(`  Click error: ${e.message.substring(0, 100)}`);
    }
  }

  console.log(`  All ${maxRetries} attempts exhausted — login page never confirmed.`);
  try {
    const content = await page.content().catch(() => '');
    console.log(`  Final page (first 800 chars):\n  ${content.substring(0, 800)}`);
  } catch (_) {}

  return { done: true, loginShown: false, attempts, finalMethod: 'exhausted' };
}

// ── Dwell check ───────────────────────────────────────────────────────────────
async function runDwellCheck(page, dwellSecs, existingJsErrors) {
  const cappedDwell = Math.min(dwellSecs, DWELL_MAX_SECONDS);
  console.log(`\n=== DWELL CHECK START: staying ${cappedDwell}s (configured: ${dwellSecs}s, cap: ${DWELL_MAX_SECONDS}s), polling every 5s ===`);

  const dwellErrors = [];
  const startUrl    = page.url();
  let crashed       = false;
  const pollInterval = 5000;
  const deadline    = Date.now() + cappedDwell * 1000;

  const dwellJsErrors = [];
  const errorListener = msg => {
    if (msg.type() === 'error') {
      const text = msg.text().substring(0, 300);
      if (!isNoiseError(text)) dwellJsErrors.push(`[console.error] ${text}`);
    }
  };
  const crashListener = err => {
    const text = err.message.substring(0, 300);
    if (!isNoiseError(text)) dwellJsErrors.push(`[pageerror] ${text}`);
  };
  page.on('console', errorListener);
  page.on('pageerror', crashListener);

  while (Date.now() < deadline) {
    const waitMs = Math.min(pollInterval, deadline - Date.now());
    if (waitMs > 0) await sleep(waitMs);

    try {
      const currentUrl   = page.url();
      const currentTitle = await page.title().catch(() => '');
      const content      = await page.content().catch(() => '');
      const elapsed      = Math.round((Date.now() - (deadline - cappedDwell * 1000)) / 1000);

      const crashMatch = CRASH_INDICATORS.find(i => content.includes(i) || currentTitle.includes(i));
      if (crashMatch) {
        crashed = true;
        dwellErrors.push(`[${elapsed}s] PAGE CRASHED: "${crashMatch}" detected`);
        console.log(`  [${elapsed}s] CRASH DETECTED: ${crashMatch}`);
        break;
      }

      if (currentUrl !== startUrl && !currentUrl.includes('itch.io')) {
        dwellErrors.push(`[${elapsed}s] Unexpected navigation: ${currentUrl}`);
        console.log(`  [${elapsed}s] Navigated away: ${currentUrl}`);
      }

      if (content.length < 200 && !content.includes('itch.io')) {
        dwellErrors.push(`[${elapsed}s] Page appears blank (${content.length} bytes)`);
        console.log(`  [${elapsed}s] Page appears blank`);
      }

      console.log(`  [${elapsed}s/${cappedDwell}s] ok — "${currentTitle}" | genuine_js_errors: ${dwellJsErrors.length}`);

    } catch (e) {
      crashed = true;
      dwellErrors.push(`Page context destroyed: ${e.message.substring(0, 100)}`);
      console.log(`  Page context destroyed — likely crashed: ${e.message.substring(0, 100)}`);
      break;
    }
  }

  page.off('console', errorListener);
  page.off('pageerror', crashListener);

  if (dwellJsErrors.length > 0) {
    dwellErrors.push(...dwellJsErrors.slice(0, 20));
    console.log(`  Genuine dwell JS errors: ${dwellJsErrors.length}`);
  }

  console.log(`=== DWELL CHECK END: crashed=${crashed} errors=${dwellErrors.length} dwell=${cappedDwell}s ===\n`);
  return { crashed, dwellErrors, dwellSecs: cappedDwell };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const {
    targetUrl, referrerList, clickCheckPct, clickCheckWaitSecs,
    clickCheckMaxRetry, dwellMinSecs, dwellMaxSecs,
  } = await fetchConfig();

  const chosenReferrer = referrerList.length > 0 ? pick(referrerList) : null;
  const acceptLanguage = ACCEPT_LANGUAGE[REGION] || 'en-US,en;q=0.9';
  const doClickCheck   = Math.random() * 100 < clickCheckPct;
  const dwellSecs      = randSecs(dwellMinSecs, dwellMaxSecs);

  console.log(`Region: ${REGION} | Referrer: ${chosenReferrer?.url || 'none'} | Click-check: ${doClickCheck} | Dwell: ${dwellSecs}s`);

  const result = {
    region: REGION, ok: false, ttfb_ms: null,
    page_title: null, game_iframe_loaded: false,
    js_errors: [], page_blocked: false, render_error: null,
    content_language: null, accept_language_sent: acceptLanguage, cf_colo: null,
    referrer_used: chosenReferrer?.url || null,
    click_check_done: false, login_prompt_shown: null,
    dwell_crash: null, dwell_errors: null, dwell_seconds: null,
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
        console.log('Referrer done, navigating to target.');
      } catch (e) {
        console.log(`Referrer failed: ${e.message.substring(0, 80)}, going direct.`);
      }
    }

    // ── Step 2: Navigate to target ────────────────────────────────────────────
    // Collect ALL JS errors but filter noise before deciding ok/fail
    const allJsErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') allJsErrors.push(msg.text().substring(0, 300));
    });
    page.on('pageerror', err => {
      allJsErrors.push(`PageError: ${err.message}`.substring(0, 300));
    });

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

        // ── Step 3: Game embed detection ──────────────────────────────────────
        const { found: embedFound } = await detectGameEmbed(page, pageContent);
        result.game_iframe_loaded = embedFound;

        // ── Step 4: Click-check with retries ──────────────────────────────────
        if (doClickCheck) {
          console.log('\n=== CLICK-CHECK START ===');
          const { done, loginShown, attempts, finalMethod } = await runClickCheck(
            page, clickCheckWaitSecs, clickCheckMaxRetry
          );
          result.click_check_done   = done;
          result.login_prompt_shown = loginShown;
          console.log(`=== CLICK-CHECK END: done=${done} login=${loginShown} attempts=${attempts} method=${finalMethod} ===`);

          // ── Step 5: Dwell check ───────────────────────────────────────────
          const { crashed, dwellErrors, dwellSecs: actualDwell } = await runDwellCheck(
            page, dwellSecs, allJsErrors
          );
          result.dwell_crash   = crashed;
          result.dwell_errors  = JSON.stringify(dwellErrors.slice(0, 20));
          result.dwell_seconds = actualDwell;

        } else {
          await sleep(randMs(3000, 6000));
        }

        // Filter noise before storing and before deciding ok/fail
        const genuineErrors = allJsErrors.filter(e => !isNoiseError(e));
        result.js_errors = allJsErrors.slice(0, 10); // store all for visibility
        console.log(`JS errors: ${allJsErrors.length} total, ${genuineErrors.length} genuine (threshold: ${JS_ERROR_THRESHOLD})`);

        const httpOk = !responseStatus || (responseStatus >= 200 && responseStatus < 400);
        result.ok = hasExpectedContent && !isBlocked && httpOk;

        // Only fail on genuine errors above threshold — not itch.io noise
        if (genuineErrors.length >= JS_ERROR_THRESHOLD) {
          result.render_error = `${genuineErrors.length} genuine JS errors`;
          result.ok = false;
        }
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

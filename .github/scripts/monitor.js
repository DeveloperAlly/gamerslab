/**
 * GamersLab Geo Monitor — Playwright headless browser check
 *
 * CLICK-CHECK BEHAVIOUR:
 * - Tries to find and click the play button using all strategies
 * - After clicking, waits click_check_wait_seconds then checks for login page
 * - If no login page found: RETRIES up to click_check_max_retries times
 *   (re-scans for button, clicks again, checks again)
 * - Only marks click_check_done=true and login_prompt_shown=true when login
 *   page is CONFIRMED via URL change, DOM elements, or iframe
 * - If all retries exhausted without login page: logs full page state for debugging
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

// Game embed detection
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

// Play button — CSS selectors
const PLAY_BTN_CSS = [
  'button.load_iframe_btn', '.run_game_btn', '[data-action="load_iframe"]',
  '.play_btn', 'button[class*="load"]', 'button[class*="run"]',
  'button[class*="play"]', 'a[class*="run_game"]', 'a[class*="play"]',
  '.game_frame button', '#game_frame button', '.iframe_wrap button',
];

// Play button — text strings (case-insensitive)
const PLAY_BTN_TEXT = [
  'Run game', 'Play game', 'Play now', 'Launch game', 'Start game',
  'Load game', 'Play in browser', 'Run in browser', 'Restore game', 'Play',
];

// Play button — ARIA labels
const PLAY_BTN_ARIA = [
  '[aria-label*="run" i]', '[aria-label*="play" i]',
  '[aria-label*="launch" i]', '[aria-label*="game" i]',
];

// Login confirmation — URL (strongest signal)
const LOGIN_URL_PATTERNS = [
  'itch.io/login', 'itch.io/register', 'itch.io/user/login',
];

// Login confirmation — DOM selectors (strong)
const LOGIN_DOM_SELECTORS = [
  'form[action*="login"]', 'form[action*="register"]',
  'input[name="username"]', 'input[name="password"]',
  'input[type="password"]', '#login_form', '#register_form',
  '.login_form', '.sign_in_form',
];

// Login confirmation — text (weakest, last resort only)
const LOGIN_TEXT_INDICATORS = [
  'Log in with itch.io', 'Sign in to itch.io', 'Create an itch.io account',
  'Forgot password', 'You need to log in', 'login required',
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

  const targetUrl    = (Array.isArray(targets) && targets[0]?.url) || FALLBACK_TARGET;
  const referrerList = Array.isArray(referrers) ? referrers : [];
  const configMap    = {};
  if (Array.isArray(config)) config.forEach(r => { configMap[r.key] = r.value; });

  const clickCheckPct      = parseInt(configMap['click_check_percentage']   || '30');
  const clickCheckWaitSecs = parseInt(configMap['click_check_wait_seconds'] || '5');
  const clickCheckMaxRetry = parseInt(configMap['click_check_max_retries']  || '3');

  console.log(`Target: ${targetUrl}`);
  console.log(`Referrers: ${referrerList.map(r => r.name).join(', ') || 'none'}`);
  console.log(`Click-check: ${clickCheckPct}% | Wait: ${clickCheckWaitSecs}s | Max retries: ${clickCheckMaxRetry}`);

  return { targetUrl, referrerList, clickCheckPct, clickCheckWaitSecs, clickCheckMaxRetry };
}

const pick   = arr => arr[Math.floor(Math.random() * arr.length)];
const randMs = (min, max) => Math.floor(Math.random() * (max - min)) + min;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ── Multi-strategy embed detection ───────────────────────────────────────────
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

// ── Multi-strategy play button finder ────────────────────────────────────────
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
  return null;
}

// ── Strong login page confirmation ────────────────────────────────────────────
// Returns { confirmed: bool, method: string, detail: string }
async function confirmLoginPage(page) {
  // 1. URL change (most reliable)
  const currentUrl = page.url();
  const urlMatch = LOGIN_URL_PATTERNS.find(p => currentUrl.includes(p));
  if (urlMatch) return { confirmed: true, method: 'url', detail: currentUrl };

  // 2. DOM elements (strong)
  for (const sel of LOGIN_DOM_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return { confirmed: true, method: 'dom', detail: sel };
    } catch (_) {}
  }

  // 3. Login iframe (itch.io sometimes embeds login in an iframe)
  try {
    for (const frame of page.frames()) {
      if (LOGIN_URL_PATTERNS.some(p => frame.url().includes(p))) {
        return { confirmed: true, method: 'iframe', detail: frame.url() };
      }
    }
  } catch (_) {}

  // 4. Text indicators (weakest)
  const pageContent = await page.content().catch(() => '');
  const textMatch = LOGIN_TEXT_INDICATORS.find(t =>
    pageContent.toLowerCase().includes(t.toLowerCase())
  );
  if (textMatch) return { confirmed: true, method: 'text', detail: textMatch };

  return { confirmed: false, method: 'none', detail: `url=${currentUrl}` };
}

// ── Click-check with retries ──────────────────────────────────────────────────
// Keeps trying until login is confirmed or retries exhausted.
// Returns { done: bool, loginShown: bool, attempts: number, finalMethod: string }
async function runClickCheck(page, waitSecs, maxRetries) {
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    attempts = attempt;
    console.log(`\nClick-check attempt ${attempt}/${maxRetries}:`);

    const btn = await findPlayButton(page);

    if (!btn) {
      // Log all visible clickables to help debug missing button
      try {
        const all = await page.$$eval(
          'button, a[href], input[type="submit"], [role="button"]',
          els => els
            .filter(el => el.offsetParent !== null)
            .map(el => `${el.tagName}:"${el.textContent?.trim().substring(0, 40)}" class="${el.className?.substring(0, 40)}"`)
            .slice(0, 20)
        );
        console.log(`  Play button NOT FOUND on attempt ${attempt}. Visible clickables:\n    ${all.join('\n    ')}`);
      } catch (_) {}

      if (attempt < maxRetries) {
        console.log(`  Waiting 2s before retry...`);
        await sleep(2000);
        continue;
      }
      console.log(`  All ${maxRetries} attempts exhausted — button never found.`);
      return { done: false, loginShown: false, attempts, finalMethod: 'button_not_found' };
    }

    // Button found — click it
    try {
      await btn.click();
      console.log(`  Clicked. Waiting ${waitSecs}s for login page to appear...`);
      await sleep(waitSecs * 1000);

      const { confirmed, method, detail } = await confirmLoginPage(page);
      console.log(`  Login confirmed: ${confirmed} | method: ${method} | detail: ${detail}`);

      if (confirmed) {
        return { done: true, loginShown: true, attempts, finalMethod: method };
      }

      // Not confirmed — log page state and retry
      console.log(`  Login page NOT confirmed after ${waitSecs}s. Retrying...`);
      const title = await page.title().catch(() => '');
      const url   = page.url();
      console.log(`  Current page: "${title}" | ${url}`);

      // Scroll and wait a bit more before next attempt
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleep(1000);

    } catch (e) {
      console.log(`  Click error: ${e.message.substring(0, 100)}`);
    }
  }

  console.log(`  All ${maxRetries} attempts exhausted — login page never confirmed.`);
  // Final debug: dump full page excerpt
  try {
    const content = await page.content().catch(() => '');
    console.log(`  Final page excerpt (first 800 chars):\n  ${content.substring(0, 800)}`);
  } catch (_) {}

  return { done: true, loginShown: false, attempts, finalMethod: 'exhausted' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { targetUrl, referrerList, clickCheckPct, clickCheckWaitSecs, clickCheckMaxRetry } = await fetchConfig();
  const chosenReferrer = referrerList.length > 0 ? pick(referrerList) : null;
  const acceptLanguage = ACCEPT_LANGUAGE[REGION] || 'en-US,en;q=0.9';
  const doClickCheck   = Math.random() * 100 < clickCheckPct;

  console.log(`Region: ${REGION} | Referrer: ${chosenReferrer?.url || 'none'} | Do click-check: ${doClickCheck}`);

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
        console.log('Referrer done, navigating to target.');
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
          console.log(`=== CLICK-CHECK END: done=${done} login=${loginShown} attempts=${attempts} method=${finalMethod} ===\n`);
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

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
 *   2. Dwell 2–4s
 *   3. Navigate to target URL (Referer header set naturally by browser)
 *   4. Verify page loads, iframe present
 *   5. If this run is selected for click-check: click "Run game" button,
 *      verify itch.io login/auth prompt appears (confirms game embed is live)
 *   6. Dwell 3–6s
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

const REGION       = process.env.REGION       || 'unknown';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FALLBACK_TARGET = process.env.TARGET_URL || 'https://uprisinglabs.itch.io/bug-seek-expedition-edition';

const TIMEOUT = 25000;

const ACCEPT_LANGUAGE = {
  'us-east':      'en-US,en;q=0.9',
  'eu-west':      'fr-FR,fr;q=0.9,en;q=0.8',
  'ap-southeast': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sa-east':      'pt-BR,pt;q=0.9,en;q=0.8',
  'me-south':     'ar-SA,ar;q=0.9,en;q=0.8',
  'af-south':     'sw-KE,sw;q=0.9,en;q=0.8',
};

const BLOCK_INDICATORS = [
  'cf-browser-verification',
  'Attention Required',
  'Just a moment',
  'Enable JavaScript and cookies',
  'Access denied',
];

const GAME_IFRAME_SELECTORS = [
  'iframe#game_drop',
  'iframe.game_frame',
  'div#game_frame iframe',
  '#game_frame',
];

// Login/auth prompt indicators — what itch.io shows after clicking "Run game"
// when the game requires an account
const LOGIN_PROMPT_INDICATORS = [
  'Log in',
  'Sign in',
  'Create account',
  'itch.io account',
  'You need to',
  'login_form',
  'register_form',
  'iframe[src*="itch.io/login"]',
];

// ── Supabase fetch ────────────────────────────────────────────────────────────

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

  const targetUrl = (Array.isArray(targets) && targets[0]?.url) || FALLBACK_TARGET;
  const referrerList = Array.isArray(referrers) ? referrers : [];
  const configMap = {};
  if (Array.isArray(config)) config.forEach(r => { configMap[r.key] = r.value; });

  const clickCheckPct = parseInt(configMap['click_check_percentage'] || '30');

  console.log(`Target: ${targetUrl}`);
  console.log(`Referrers: ${referrerList.map(r => r.name || r.url).join(', ') || 'none'}`);
  console.log(`Click-check rate: ${clickCheckPct}%`);

  return { targetUrl, referrerList, clickCheckPct };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const randMs = (min, max) => Math.floor(Math.random() * (max - min)) + min;
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { targetUrl, referrerList, clickCheckPct } = await fetchConfig();
  const chosenReferrer = referrerList.length > 0 ? pick(referrerList) : null;
  const acceptLanguage = ACCEPT_LANGUAGE[REGION] || 'en-US,en;q=0.9';
  const doClickCheck   = Math.random() * 100 < clickCheckPct;

  console.log(`Click-check this run: ${doClickCheck}`);

  const result = {
    region: REGION,
    ok: false,
    ttfb_ms: null,
    page_title: null,
    game_iframe_loaded: false,
    js_errors: [],
    page_blocked: false,
    render_error: null,
    content_language: null,
    accept_language_sent: acceptLanguage,
    cf_colo: null,
    referrer_used: chosenReferrer?.url || null,
    click_check_done: false,
    login_prompt_shown: null,
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
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
      console.log(`Visiting referrer: ${chosenReferrer.url}`);
      try {
        await page.goto(chosenReferrer.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(randMs(2000, 4000));
        console.log(`Referrer done. Navigating to target.`);
      } catch (e) {
        console.log(`Referrer failed (${e.message.substring(0, 80)}), going direct.`);
      }
    }

    // ── Step 2: Navigate to target ────────────────────────────────────────────
    const jsErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text().substring(0, 300)); });
    page.on('pageerror', err => { jsErrors.push(`PageError: ${err.message}`.substring(0, 300)); });

    let ttfb = null, responseStatus = null, contentLanguage = null;
    const startTime = Date.now();

    page.on('response', response => {
      const url = response.url();
      if ((url === targetUrl || url.startsWith(targetUrl.split('?')[0])) && ttfb === null) {
        ttfb = Date.now() - startTime;
        responseStatus = response.status();
        contentLanguage = response.headers()['content-language'] || null;
      }
    });

    let navError = null;
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    } catch (e) { navError = e.message; }

    result.ttfb_ms = ttfb || (Date.now() - startTime);
    result.content_language = contentLanguage;

    if (navError && !navError.includes('timeout')) {
      result.render_error = `Navigation failed: ${navError.substring(0, 200)}`;
    } else {
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
        const hasExpectedContent = (
          pageContent.includes('itch.io') ||
          pageContent.includes('bug-seek') ||
          pageContent.includes('Bug Seek') ||
          pageTitle.toLowerCase().includes('itch')
        );

        if (!hasExpectedContent) result.render_error = 'Expected content not found';

        // ── Step 3: Wait for game iframe ──────────────────────────────────────
        let iframeFound = false;
        for (const selector of GAME_IFRAME_SELECTORS) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            const src = await page.$eval(selector, el => el.src || el.dataset.src || '').catch(() => '');
            if (src && src !== 'about:blank') { iframeFound = true; break; }
          } catch (_) {}
        }
        result.game_iframe_loaded = iframeFound;

        // ── Step 4: Click-through check (configurable %) ──────────────────────
        if (doClickCheck && iframeFound) {
          console.log(`Running click-check — clicking "Run game" button`);
          result.click_check_done = true;

          try {
            // Find and click the Run game button
            const runBtn = await page.$('button.load_iframe_btn, .run_game_btn, button:has-text("Run game"), [data-action="load_iframe"]');
            if (runBtn) {
              await runBtn.click();
              console.log(`Clicked "Run game". Waiting for login/auth prompt...`);

              // Wait up to 8s for login prompt to appear
              await sleep(3000);
              const postClickContent = await page.content().catch(() => '');

              const loginPromptShown = LOGIN_PROMPT_INDICATORS.some(indicator => {
                if (indicator.startsWith('iframe[')) {
                  // Check for login iframe
                  return postClickContent.includes('itch.io/login') || postClickContent.includes('itch.io/register');
                }
                return postClickContent.includes(indicator);
              });

              result.login_prompt_shown = loginPromptShown;
              console.log(`Login prompt shown: ${loginPromptShown}`);

              if (!loginPromptShown) {
                // Not necessarily a failure — game might load directly if already logged in
                // or may use a different auth flow. Log as warning not hard fail.
                console.log(`No login prompt detected — game may have loaded directly or auth flow differs`);
              }
            } else {
              console.log(`"Run game" button not found — may already be in play state or different layout`);
              result.click_check_done = false;
            }
          } catch (e) {
            console.log(`Click-check error: ${e.message.substring(0, 100)}`);
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

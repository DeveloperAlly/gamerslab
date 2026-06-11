/**
 * GamersLab Geo Monitor — Playwright headless browser check
 *
 * Fetches the active target URL and referrer list from Supabase at runtime
 * so changes in the dashboard propagate immediately without touching secrets.
 *
 * Visit flow (referrer simulation):
 *   1. Navigate to a randomly chosen referrer URL (e.g. bugnseek.com or t.co/...)
 *   2. Wait 2–4 seconds (simulates reading the referrer page)
 *   3. Navigate to the target URL — Referer header is set by the browser naturally
 *   4. Wait 3–6 seconds on the game page (simulates dwell time)
 *
 * Checks:
 *   - Page loads without navigation error
 *   - Page title contains expected content
 *   - Game iframe is present with a valid src
 *   - No JavaScript console errors (3+ = hard fail)
 *   - Page is not blocked by Cloudflare challenge
 *   - TTFB measured from first response event on the target URL
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

const REGION = process.env.REGION || 'unknown';
const MODE   = process.env.MODE   || 'standard';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
// Fallback target if Supabase fetch fails
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
  'div.iframe_placeholder',
  '#game_frame',
];

// ── Supabase helpers ──────────────────────────────────────────────────────────

function sbGet(path) {
  return new Promise((resolve, reject) => {
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
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchConfig() {
  // Fetch active target and enabled referrers in parallel
  const [targets, referrers] = await Promise.all([
    sbGet('/rest/v1/targets?active=eq.true&order=set_at.desc&limit=1&select=url'),
    sbGet('/rest/v1/referrers?enabled=eq.true&select=url,name&order=created_at.asc'),
  ]);

  const targetUrl = (Array.isArray(targets) && targets[0]?.url) || FALLBACK_TARGET;
  const referrerList = Array.isArray(referrers) ? referrers : [];

  console.log(`Target: ${targetUrl}`);
  console.log(`Referrers available: ${referrerList.map(r => r.name || r.url).join(', ') || 'none'}`);

  return { targetUrl, referrerList };
}

// ── Random helpers ────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randMs(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const { targetUrl, referrerList } = await fetchConfig();
  const chosenReferrer = referrerList.length > 0 ? pick(referrerList) : null;
  const acceptLanguage = ACCEPT_LANGUAGE[REGION] || 'en-US,en;q=0.9';

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

    // Remove navigator.webdriver fingerprint
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();

    // ── Step 1: Visit referrer first (if available) ───────────────────────────
    if (chosenReferrer) {
      console.log(`Visiting referrer: ${chosenReferrer.url}`);
      try {
        await page.goto(chosenReferrer.url, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        // Dwell on referrer page: 2–4 seconds
        await sleep(randMs(2000, 4000));
        console.log(`Referrer loaded. Now navigating to target.`);
      } catch (e) {
        // Referrer visit failed — continue to target directly, not a hard failure
        console.log(`Referrer visit failed (${e.message.substring(0, 80)}), proceeding to target directly.`);
      }
    }

    // ── Step 2: Navigate to target ────────────────────────────────────────────
    const jsErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') jsErrors.push(msg.text().substring(0, 300));
    });
    page.on('pageerror', err => {
      jsErrors.push(`PageError: ${err.message}`.substring(0, 300));
    });

    let ttfb = null;
    let responseStatus = null;
    let contentLanguage = null;
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
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT,
      });
    } catch (e) {
      navError = e.message;
    }

    result.ttfb_ms = ttfb || (Date.now() - startTime);
    result.content_language = contentLanguage;

    if (navError && !navError.includes('timeout')) {
      result.render_error = `Navigation failed: ${navError.substring(0, 200)}`;
    } else {
      try { await page.waitForSelector('body', { timeout: 5000 }); } catch (_) {}

      const pageContent = await page.content().catch(() => '');
      const pageTitle   = await page.title().catch(() => '');
      result.page_title = pageTitle;

      const isBlocked = BLOCK_INDICATORS.some(i =>
        pageContent.includes(i) || pageTitle.includes(i)
      );
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

        if (!hasExpectedContent) {
          result.render_error = 'Expected content not found in page';
        }

        // ── Step 3: Wait for game iframe ─────────────────────────────────────
        let iframeFound = false;
        for (const selector of GAME_IFRAME_SELECTORS) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            const iframeSrc = await page.$eval(selector, el => el.src || el.dataset.src || '').catch(() => '');
            if (iframeSrc && iframeSrc !== 'about:blank') {
              iframeFound = true;
              break;
            }
          } catch (_) {}
        }
        result.game_iframe_loaded = iframeFound;

        // ── Step 4: Dwell on game page ────────────────────────────────────────
        // Simulates a real user spending time on the page
        await sleep(randMs(3000, 6000));

        result.js_errors = jsErrors.slice(0, 10);

        const httpOk = !responseStatus || (responseStatus >= 200 && responseStatus < 400);
        result.ok = hasExpectedContent && !isBlocked && httpOk;

        if (jsErrors.length >= 3) {
          result.render_error = `${jsErrors.length} JS console errors`;
          result.ok = false;
        }
      }
    }

    if (result.page_blocked || (responseStatus && responseStatus >= 400)) {
      result.ok = false;
    }

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

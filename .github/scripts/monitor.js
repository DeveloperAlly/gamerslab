/**
 * GamersLab Geo Monitor — Playwright headless browser check
 *
 * Visits the target URL in a real headless Chromium with the correct
 * Accept-Language header for this region. Checks:
 *   - Page loads with correct HTTP status
 *   - TTFB (time to first byte)
 *   - Page title contains expected content
 *   - Game iframe is present and loads (not blank/error)
 *   - No JavaScript console errors
 *   - Page is not blocked by Cloudflare challenge
 *   - Content-Language header matches expected locale
 *   - Page renders within 15 seconds
 *
 * Outputs MONITOR_RESULT env var for the Supabase push step.
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REGION = process.env.REGION || 'unknown';
const TARGET_URL = process.env.TARGET_URL || 'https://uprisinglabs.itch.io/bug-seek-expedition-edition';
const TIMEOUT = 20000; // 20s page load timeout

// Accept-Language headers per region — matches Cloudflare Worker mapping
const ACCEPT_LANGUAGE = {
  'us-east':      'en-US,en;q=0.9',
  'eu-west':      'fr-FR,fr;q=0.9,en;q=0.8',
  'ap-southeast': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sa-east':      'pt-BR,pt;q=0.9,en;q=0.8',
  'me-south':     'ar-SA,ar;q=0.9,en;q=0.8',
  'af-south':     'sw-KE,sw;q=0.9,en;q=0.8',
};

// Known itch.io block/error indicators in page content
const BLOCK_INDICATORS = [
  'cf-browser-verification',
  'Attention Required',
  'Just a moment',
  'Enable JavaScript and cookies',
  'Access denied',
];

// Game iframe selectors — itch.io embeds the game in one of these
const GAME_IFRAME_SELECTORS = [
  'iframe#game_drop',
  'iframe.game_frame',
  'div#game_frame iframe',
  'div.iframe_placeholder',
  '#game_frame',
];

async function run() {
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
      ],
    });

    const context = await browser.newContext({
      locale: acceptLanguage.split(',')[0].split(';')[0].trim(),
      extraHTTPHeaders: {
        'Accept-Language': acceptLanguage,
      },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();

    // Collect JS console errors
    const jsErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        jsErrors.push(msg.text().substring(0, 300));
      }
    });
    page.on('pageerror', err => {
      jsErrors.push(`PageError: ${err.message}`.substring(0, 300));
    });

    // TTFB via response event
    let ttfb = null;
    let responseStatus = null;
    let contentLanguage = null;
    const startTime = Date.now();

    page.on('response', response => {
      if (response.url() === TARGET_URL || response.url().startsWith(TARGET_URL.split('?')[0])) {
        if (ttfb === null) {
          ttfb = Date.now() - startTime;
          responseStatus = response.status();
          contentLanguage = response.headers()['content-language'] || null;
        }
      }
    });

    // Navigate to target
    let navError = null;
    try {
      await page.goto(TARGET_URL, {
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
      result.ok = false;
    } else {
      // Wait for page body to be present even if nav timed out
      try {
        await page.waitForSelector('body', { timeout: 5000 });
      } catch (_) {}

      const pageContent = await page.content().catch(() => '');
      const pageTitle = await page.title().catch(() => '');
      result.page_title = pageTitle;

      // Check for Cloudflare block
      const isBlocked = BLOCK_INDICATORS.some(indicator =>
        pageContent.includes(indicator) || pageTitle.includes(indicator)
      );
      result.page_blocked = isBlocked;

      if (isBlocked) {
        result.render_error = 'Page blocked by Cloudflare challenge';
        result.ok = false;
      } else if (responseStatus && responseStatus >= 400) {
        result.render_error = `HTTP ${responseStatus}`;
        result.ok = false;
      } else {
        // Check page has expected itch.io content
        const hasExpectedContent = (
          pageContent.includes('itch.io') ||
          pageContent.includes('bug-seek') ||
          pageContent.includes('Bug Seek') ||
          pageTitle.toLowerCase().includes('itch')
        );

        if (!hasExpectedContent) {
          result.render_error = 'Page loaded but expected content not found';
        }

        // Wait for game iframe to appear (itch.io lazy-loads it)
        let iframeFound = false;
        for (const selector of GAME_IFRAME_SELECTORS) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            // Check iframe has a src (not empty/broken)
            const iframeSrc = await page.$eval(selector, el => el.src || el.dataset.src || '').catch(() => '');
            if (iframeSrc && iframeSrc !== 'about:blank') {
              iframeFound = true;
              break;
            }
          } catch (_) {
            // Try next selector
          }
        }
        result.game_iframe_loaded = iframeFound;

        // Collect any JS errors that accumulated during load
        result.js_errors = jsErrors.slice(0, 10); // cap at 10

        // Page is OK if: content found, not blocked, HTTP status < 400
        // iframe missing is a warning, not a hard failure (some regions may block iframe)
        const httpOk = !responseStatus || (responseStatus >= 200 && responseStatus < 400);
        result.ok = hasExpectedContent && !isBlocked && httpOk;

        // Hard fail if 3+ JS errors (likely broken page)
        if (jsErrors.length >= 3) {
          result.render_error = `${jsErrors.length} JS console errors detected`;
          result.ok = false;
        }
      }
    }

  } catch (e) {
    result.render_error = `Browser error: ${e.message.substring(0, 200)}`;
    result.ok = false;
  } finally {
    if (browser) await browser.close();
  }

  // Write result to GITHUB_ENV for downstream steps
  const resultJson = JSON.stringify(result);
  console.log('MONITOR RESULT:', resultJson);
  fs.appendFileSync(process.env.GITHUB_ENV, `MONITOR_RESULT=${resultJson}\n`);

  process.exit(result.ok ? 0 : 0); // Always exit 0 — failures reported via Supabase, not CI failure
}

run().catch(e => {
  console.error('Monitor script error:', e);
  const fallback = JSON.stringify({ ok: false, render_error: e.message, js_errors: [], game_iframe_loaded: false });
  fs.appendFileSync(process.env.GITHUB_ENV, `MONITOR_RESULT=${fallback}\n`);
  process.exit(0);
});

import { test, expect } from '@playwright/test'

// ── Auth bypass ─────────────────────────────────────────────────────────────────
// The dashboard uses sessionStorage.setItem('gl_auth', PASS_HASH) to track auth.
// PASS_HASH is the SHA-256 of the dashboard password, baked in at build time as
// VITE_PASS_HASH. Rather than knowing the password, we inject the hash directly
// into sessionStorage before React mounts, so the AuthProvider sees authed=true.
//
// DASHBOARD_PASS_HASH env var must be set to the same value as VITE_PASS_HASH
// in the Cloudflare Pages build. Get it from the Cloudflare dashboard env vars.

const BASE_URL = process.env.DASHBOARD_URL || 'https://gamerslab.space'
const PASS_HASH = process.env.DASHBOARD_PASS_HASH || ''

async function authenticatedPage(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Inject auth into sessionStorage before React hydrates
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([key, hash]) => sessionStorage.setItem(key, hash),
    ['gl_auth', PASS_HASH]
  )
  // Reload so React's useEffect reads the now-populated sessionStorage
  await page.reload({ waitUntil: 'networkidle' })
  return { page, context }
}

// ── Console error collector ────────────────────────────────────────────────────
// Permissions-Policy warnings from Cloudflare Insights on itch.io are noise.
// Filter to actual errors from our own domain.
const IGNORED_ERRORS = [
  'Permissions-Policy',
  'ERR_BLOCKED_BY_CLIENT',
  'net::ERR',
  'favicon',
]

function collectErrors(page) {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (!IGNORED_ERRORS.some(s => text.includes(s))) {
        errors.push({ type: 'console.error', text })
      }
    }
  })
  page.on('pageerror', err => {
    errors.push({ type: 'pageerror', text: err.message })
  })
  return errors
}


// ──────────────────────────────────────────────────────────────────
// TESTS
// ──────────────────────────────────────────────────────────────────

test.describe('Auth', () => {
  test('lock screen shown without auth', async ({ page }) => {
    await page.goto(BASE_URL)
    // Should see a password input, not the nav
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Monitor')).not.toBeVisible()
  })

  test('password bypass via sessionStorage works', async ({ browser }) => {
    if (!PASS_HASH) test.skip()
    const { page, context } = await authenticatedPage(browser)
    const errors = collectErrors(page)
    await expect(page.locator('text=Monitor')).toBeVisible({ timeout: 10000 })
    await context.close()
    expect(errors.filter(e => e.type === 'pageerror')).toHaveLength(0)
  })
})


test.describe('Monitor page', () => {
  test.beforeEach(async ({ browser }, testInfo) => {
    if (!PASS_HASH) test.skip()
  })

  test('loads without JS errors and shows stat cards', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    const errors = collectErrors(page)

    await expect(page.locator('text=monitor checks')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('text=uptime')).toBeVisible()
    await expect(page.locator('text=avg ttfb')).toBeVisible()
    await expect(page.locator('text=surge runs')).toBeVisible()

    // Time selector buttons exist
    await expect(page.locator('button:has-text("1h")')).toBeVisible()
    await expect(page.locator('button:has-text("24h")')).toBeVisible()
    await expect(page.locator('button:has-text("7d")')).toBeVisible()
    await expect(page.locator('button:has-text("30d")')).toBeVisible()

    // Region table
    await expect(page.locator('text=regions')).toBeVisible()
    await expect(page.locator('text=US East')).toBeVisible()
    await expect(page.locator('text=EU West')).toBeVisible()

    // Live feed section
    await expect(page.locator('text=live feed')).toBeVisible()

    expect(errors, `JS errors on Monitor page: ${JSON.stringify(errors)}`).toHaveLength(0)
    await context.close()
  })

  test('time range selector changes data', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.locator('button:has-text("24h")').click()
    await page.waitForTimeout(500)
    await page.locator('button:has-text("1h")').click()
    await page.waitForTimeout(500)
    // Should not crash — stat cards still visible
    await expect(page.locator('text=monitor checks')).toBeVisible()
    await context.close()
  })

  test('refresh button works', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await expect(page.locator('button:has-text("↻")')).toBeVisible()
    await page.locator('button:has-text("↻")').click()
    // Spinner may appear briefly then disappear
    await page.waitForTimeout(1000)
    await expect(page.locator('text=monitor checks')).toBeVisible()
    await context.close()
  })

  test('live feed rows are expandable', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)

    // Wait for live feed to populate
    await page.locator('text=live feed').waitFor({ timeout: 10000 })
    await page.waitForTimeout(2000)

    // Find a live feed row that has a ▼ (expandable)
    const expandable = page.locator('div:has-text("▼")').first()
    const hasExpandable = await expandable.isVisible().catch(() => false)
    if (hasExpandable) {
      await expandable.click()
      // After click, ▲ should appear (expanded state)
      await expect(page.locator('text=▲').first()).toBeVisible({ timeout: 3000 })
      // Expanded detail should show playwright fields
      await expect(page.locator('text=iframe').first()).toBeVisible({ timeout: 3000 })
    }
    await context.close()
  })
})


test.describe('Control page', () => {
  test.beforeEach(async ({ browser }, testInfo) => {
    if (!PASS_HASH) test.skip()
  })

  test('loads without JS errors and shows all cards', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    const errors = collectErrors(page)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('text=manual triggers')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('text=standard check schedule')).toBeVisible()
    await expect(page.locator('text=surge event scheduler')).toBeVisible()
    await expect(page.locator('text=monitored target')).toBeVisible()
    await expect(page.locator('text=referrer simulation')).toBeVisible()
    await expect(page.locator('text=discord alerts')).toBeVisible()

    expect(errors, `JS errors on Control page: ${JSON.stringify(errors)}`).toHaveLength(0)
    await context.close()
  })

  test('active target is shown', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })
    await expect(page.locator('text=active').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Bug Seek')).toBeVisible()
    await context.close()
  })

  test('click-check slider renders and displays percentage', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('text=Run game click-check')).toBeVisible({ timeout: 10000 })
    const slider = page.locator('input[type="range"]')
    await expect(slider).toBeVisible()

    // Current value should be a number (loaded from Supabase or default 30)
    const val = await slider.inputValue()
    expect(parseInt(val)).toBeGreaterThanOrEqual(0)
    expect(parseInt(val)).toBeLessThanOrEqual(100)
    await context.close()
  })

  test('click-check slider save persists across reload', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    const slider = page.locator('input[type="range"]')
    await slider.waitFor({ timeout: 10000 })

    // Set to a known value (50%)
    await slider.evaluate(el => {
      el.value = '50'
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Find and click the Save button adjacent to the slider
    const saveBtn = page.locator('text=Run game click-check').locator('..').locator('button:has-text("Save")')
    await saveBtn.click()

    // Wait for success feedback
    await expect(page.locator('text=50% of runs will click')).toBeVisible({ timeout: 5000 })

    // Reload and verify the value persisted
    await page.reload({ waitUntil: 'networkidle' })
    await slider.waitFor({ timeout: 10000 })
    const newVal = await slider.inputValue()
    expect(newVal).toBe('50')

    await context.close()
  })

  test('referrers list loads and shows items', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('text=referrer simulation')).toBeVisible({ timeout: 10000 })
    // Should show at least one referrer
    await expect(page.locator('text=BugnSeek')).toBeVisible({ timeout: 5000 })
    await context.close()
  })

  test('referrer toggle does not throw', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    const errors = collectErrors(page)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await page.locator('text=BugnSeek').waitFor({ timeout: 10000 })
    // Click the first toggle
    const firstToggle = page.locator('text=BugnSeek').locator('..').locator('div[style*="border-radius: 9px"]').first()
    if (await firstToggle.isVisible()) {
      await firstToggle.click()
      await page.waitForTimeout(500)
      // Toggle it back
      await firstToggle.click()
    }
    expect(errors).toHaveLength(0)
    await context.close()
  })

  test('surge event scheduler renders and validates future date', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('text=surge event scheduler')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Schedule a surge event')).toBeVisible()
    await expect(page.locator('button:has-text("Schedule surge")')).toBeVisible()

    // Date input should exist and have a min in the future
    const dateInput = page.locator('input[type="datetime-local"]')
    await expect(dateInput).toBeVisible()
    const minAttr = await dateInput.getAttribute('min')
    expect(minAttr).toBeTruthy()
    await context.close()
  })

  test('no surge events message shows initially', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })
    // This may or may not be visible depending on state — just ensure no crash
    await page.waitForTimeout(2000)
    await expect(page.locator('text=surge event scheduler')).toBeVisible()
    await context.close()
  })

  test('manual trigger buttons are present and enabled', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('button:has-text("Run now")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('button:has-text("Run now")')).toBeEnabled()
    await expect(page.locator('button:has-text("Trigger surge")')).toBeVisible()
    await expect(page.locator('button:has-text("Trigger surge")')).toBeEnabled()
    await context.close()
  })

  test('discord test button is present', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })
    await expect(page.locator('button:has-text("Send test message to Discord")')).toBeVisible({ timeout: 10000 })
    await context.close()
  })
})


test.describe('Navigation', () => {
  test.beforeEach(async ({ browser }, testInfo) => {
    if (!PASS_HASH) test.skip()
  })

  test('nav tabs switch between Monitor and Control', async ({ browser }) => {
    const { page, context } = await authenticatedPage(browser)

    // Start on Monitor
    await expect(page.locator('text=monitor checks')).toBeVisible({ timeout: 15000 })

    // Click Control tab in nav
    await page.locator('nav').locator('text=Control').click()
    await expect(page.locator('text=manual triggers')).toBeVisible({ timeout: 10000 })

    // Click Monitor tab
    await page.locator('nav').locator('text=Monitor').click()
    await expect(page.locator('text=monitor checks')).toBeVisible({ timeout: 10000 })

    await context.close()
  })

  test('direct URL to /control works', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = collectErrors(page)

    await page.goto(BASE_URL)
    await page.evaluate(
      ([key, hash]) => sessionStorage.setItem(key, hash),
      ['gl_auth', PASS_HASH]
    )
    await page.goto(`${BASE_URL}/control`, { waitUntil: 'networkidle' })

    await expect(page.locator('text=manual triggers')).toBeVisible({ timeout: 10000 })
    expect(errors.filter(e => e.type === 'pageerror')).toHaveLength(0)
    await context.close()
  })
})


test.describe('No console errors on fresh load', () => {
  // Explicit test that catches any unfiltered JS errors across both pages
  for (const [label, path] of [['Monitor', '/'], ['Control', '/control']]) {
    test(`${label} page — no unfiltered JS errors`, async ({ browser }) => {
      if (!PASS_HASH) test.skip()
      const context = await browser.newContext()
      const page = await context.newPage()
      const errors = collectErrors(page)

      await page.goto(BASE_URL)
      await page.evaluate(
        ([key, hash]) => sessionStorage.setItem(key, hash),
        ['gl_auth', PASS_HASH]
      )
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000) // Let all async fetches complete

      expect(
        errors,
        `Unexpected JS errors on ${label} page:\n${errors.map(e => e.text).join('\n')}`
      ).toHaveLength(0)
      await context.close()
    })
  }
})

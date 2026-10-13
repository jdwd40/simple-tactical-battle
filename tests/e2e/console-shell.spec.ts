// The console opens in genuine turn-1 planning against the real engine and controller.
// These checks cover the initial state, layout, focus order and accessibility; the full
// plot/commit/playback/assessment flow is covered in game.spec.ts.

import { expect, test, type Page } from '@playwright/test'

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

async function box(page: Page, selector: string) {
  const result = await page.locator(selector).boundingBox()
  if (!result) throw new Error(`No layout box for ${selector}`)
  return result
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    vertical: document.documentElement.scrollHeight - window.innerHeight,
  }))
}

test('opens in genuine turn-1 planning with own data only and a deliberate Commit Turn', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/?seed=17')
  await page.getByRole('button', { name: 'Begin mission' }).click()

  await expect(page).toHaveTitle('Shadow-Dancer — Tactical Space Battle')
  await expect(page.getByRole('heading', { level: 1, name: 'Shadow-Dancer' })).toBeVisible()
  await expect(page.getByTestId('seed')).toHaveText('17')
  await expect(page.getByText(/drill|interim/i)).toHaveCount(0)
  await expect(page.getByTestId('opponent-note')).toHaveCount(0)
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.locator('[aria-current="step"]')).toHaveText('Planning')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(1)

  const own = page.getByRole('region', { name: 'Own ship', exact: true })
  await expect(own.locator('.resource-value')).toHaveText(['100.0 / 100.0', '40 / 40', '100 / 100'])
  await expect(own.locator('dd')).toHaveText(['6 / 6', 'Ready', 'Ready', 'Passive', 'On', 'Not exposed'])
  const readout = page.locator('#plot-readout')
  await expect(readout).toContainText('Positioncolumn 3, row 10')
  await expect(readout).toContainText('No contacts.')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')

  const commit = page.getByRole('button', { name: 'Commit turn 1' })
  await expect(commit).not.toHaveAttribute('aria-disabled')
  await expect(commit).toHaveAccessibleDescription('Locks these orders and plays the 10-second turn.')
  for (const name of ['Back', 'Play', 'Forward', 'Skip to end']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true')
  }
  for (const name of ['Abandon', 'Restart']) {
    await expect(page.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-disabled')
  }
  expect(errors).toEqual([])
})

test('gives the battlefield the dominant share of a 1366x768 console without page scrolling', async ({ page }, testInfo) => {
  await page.goto('/?seed=17')
  await page.getByRole('button', { name: 'Begin mission' }).click()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()

  expect(await pageOverflow(page)).toEqual({ horizontal: 0, vertical: 0 })

  const viewport = page.viewportSize()!
  const plot = await box(page, '.deck-plot')
  const ship = await box(page, '.deck-ship')
  const command = await box(page, '.deck-command')
  const transport = await box(page, '.deck-transport')
  const commit = await box(page, '.commit-station [data-variant="commit"]')

  expect(plot.width * plot.height).toBeGreaterThan(0.4 * viewport.width * viewport.height)
  expect(plot.width).toBeGreaterThan(Math.max(ship.width, command.width) * 2)
  expect(ship.x + ship.width).toBeLessThanOrEqual(plot.x)
  expect(command.x).toBeGreaterThanOrEqual(plot.x + plot.width)
  expect(transport.y).toBeGreaterThanOrEqual(plot.y + plot.height)
  expect(commit.y + commit.height).toBeLessThanOrEqual(viewport.height)

  await page.screenshot({ path: testInfo.outputPath('console-1366x768.png') })
})

test('keyboard reaches every control in planning-flow order with a visible focus ring', async ({ page }, testInfo) => {
  await page.goto('/?seed=17')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  // The briefing opens first with its action focused; Enter starts at the orders.
  await expect(page.getByRole('button', { name: 'Begin mission' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#command-rail')).toBeFocused()
  const expectFocusRing = async (name: string) => {
    const focused = page.locator(':focus')
    await expect(focused).toHaveAccessibleName(name)
    const outline = await focused.evaluate((element) => {
      const style = getComputedStyle(element)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)
  }
  for (const name of ['Column', 'Row', 'Set destination', 'Hold position', 'Passive', 'On', 'Hold fire', 'Commit turn 1']) {
    await page.keyboard.press('Tab')
    await expectFocusRing(name)
  }
  await page.screenshot({ path: testInfo.outputPath('commit-focus-1366x768.png') })

  // From the top of the page: skip link, header, playback, then the orders.
  await page.locator('.skip-link').focus()
  await expectFocusRing('Skip to orders')
  for (const name of ['Copy seed link', 'Briefing', 'Abandon', 'Restart', 'Back', 'Play', 'Forward', 'Skip to end', 'Column']) {
    await page.keyboard.press('Tab')
    // A rail that overflows is a named keyboard scroll stop (Chromium focusable scrollers).
    if (name === 'Back' && await page.locator(':focus').getAttribute('aria-label') === 'Ship status') await page.keyboard.press('Tab')
    await expectFocusRing(name)
  }
  await page.locator('.skip-link').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#command-rail')).toBeFocused()
})

for (const viewport of [{ width: 1024, height: 700 }, { width: 390, height: 844 }]) {
  test(`keeps every console region reachable at ${viewport.width}x${viewport.height} without horizontal scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/?seed=17')
    await page.getByRole('button', { name: 'Begin mission' }).click()
    await page.evaluate(() => document.fonts.ready)

    expect((await pageOverflow(page)).horizontal).toBe(0)
    const plot = await box(page, '.deck-plot')
    expect(plot.y).toBeLessThan(viewport.height / 2)
    // On phones the Ship and Log panels are behind tabs; on wider layouts all are shown.
    const tabs = page.getByRole('tablist', { name: 'Console panels' })
    for (const [region, panelTab] of [['Orders', 'Orders'], ['Own ship', 'Ship'], ['Plot readout', 'Ship'], ['Event log', 'Log']] as const) {
      if (await tabs.isVisible()) await tabs.getByRole('tab', { name: panelTab }).click()
      await expect(page.getByRole('region', { name: region, exact: true })).toBeVisible()
    }
    if (await tabs.isVisible()) await tabs.getByRole('tab', { name: 'Orders' }).click()
    const commit = page.getByRole('button', { name: 'Commit turn 1' })
    await commit.scrollIntoViewIfNeeded()
    await expect(commit).toBeInViewport()
    // Header controls wrap rather than clip: each is wholly inside the page width.
    for (const name of ['Copy seed link', 'Briefing', 'Abandon', 'Restart']) {
      const control = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(control, name).not.toBeNull()
      expect(control!.x, name).toBeGreaterThanOrEqual(0)
      expect(control!.x + control!.width, name).toBeLessThanOrEqual(viewport.width)
    }

    await page.screenshot({ path: testInfo.outputPath(`console-${viewport.width}x${viewport.height}.png`), fullPage: true })
  })
}

test('respects reduced-motion preferences for control transitions', async ({ page }) => {
  const commitTransition = () => page.getByRole('button', { name: 'Commit turn 1' }).evaluate((element) => getComputedStyle(element).transitionDuration)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?seed=17')
  await page.getByRole('button', { name: 'Begin mission' }).click()
  expect((await commitTransition()).split(', ').some((duration) => duration !== '0s')).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect((await commitTransition()).split(', ').every((duration) => duration === '0s')).toBe(true)
})

test('serves the font licence as plain text rather than the application page', async ({ request }) => {
  const response = await request.get('/assets/barlow-fonts-OFL.txt')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toMatch(/^text\/plain/)
  const body = await response.text()
  expect(body).toContain('Copyright 2017 The Barlow Project Authors')
  expect(body).toContain('SIL OPEN FONT LICENSE Version 1.1')
  expect(body).not.toContain('<div id="root">')
})

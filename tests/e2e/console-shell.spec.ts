import { expect, test, type Page } from '@playwright/test'

// M0 loads public scenario and own initial data. Engine/controller/PixiJS remain
// unconnected; these checks prove startup presentation and accessibility, not gameplay.

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

test('loads public terrain and own initial data while gameplay remains unbound', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await expect(page).toHaveTitle('Shadow-Dancer — Tactical Space Battle')
  await expect(page.getByRole('heading', { level: 1, name: 'Shadow-Dancer' })).toBeVisible()
  await expect(page.getByText('Scenario loaded · M0')).toBeVisible()
  await expect(page.getByText('Static public terrain · own marker (3, 10). Movement engine pending; no encounter is running.')).toBeVisible()
  const own = page.getByRole('region', { name: 'Own ship', exact: true })
  await expect(own.locator('dd')).toHaveText(['100 / 100', '40 / 40', '100 / 100', '6 / 6', 'Passive', 'Active'])
  const plotReadout = page.getByRole('region', { name: 'Plot readout', exact: true })
  await expect(plotReadout.locator('dd')).toHaveText(['(3, 10)', '0', '0'])
  const scenario = page.getByRole('region', { name: 'Scenario', exact: true })
  await expect(scenario.locator('dd')).toHaveText(['20 × 20', '12'])
  await expect(page.getByRole('img', { name: 'Public scenario terrain' })).toHaveAccessibleDescription('20 by 20 grid with 12 known asteroid cells. Own ship at cell (3, 10). No enemy contacts.')
  await expect(page.locator('[data-own-cell]')).toHaveAttribute('data-own-cell', '3,10')
  expect(await page.locator('[data-asteroid-cell]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-asteroid-cell')))).toEqual(['7,4', '7,5', '8,5', '12,5', '13,5', '13,6', '6,13', '7,13', '7,14', '12,13', '12,14', '13,14'])
  await expect(page.locator('[data-contact-alias], [data-enemy-position]')).toHaveCount(0)

  const phases = page.getByRole('list', { name: 'Turn phases' }).getByRole('listitem')
  await expect(phases).toHaveText(['Planning', 'Commit', 'Execution', 'Assessment'])
  await expect(page.locator('[aria-current]')).toHaveCount(0)

  const commit = page.getByRole('button', { name: 'Commit turn' })
  await expect(commit).toHaveAttribute('aria-disabled', 'true')
  await expect(commit).toHaveAccessibleDescription('Orders can be committed once the simulation engine is connected.')
  for (const name of ['Back', 'Play', 'Forward', 'Skip to end', 'Abandon', 'Restart']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-disabled', 'true')
  }

  await commit.click({ force: true })
  await expect(page.locator('[aria-current]')).toHaveCount(0)
  await expect(page.getByText('Scenario loaded · M0')).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click({ force: true })
  await expect(plotReadout.locator('dd')).toHaveText(['(3, 10)', '0', '0'])
  expect(errors).toEqual([])
})

test('gives the battlefield the dominant share of a 1366x768 console without page scrolling', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)

  expect(await pageOverflow(page)).toEqual({ horizontal: 0, vertical: 0 })

  const viewport = page.viewportSize()!
  const plot = await box(page, '.deck-plot')
  const ship = await box(page, '.deck-ship')
  const command = await box(page, '.deck-command')
  const transport = await box(page, '.deck-transport')
  const commit = await box(page, '[data-variant="commit"]')

  expect(plot.width * plot.height).toBeGreaterThan(0.4 * viewport.width * viewport.height)
  expect(plot.width).toBeGreaterThan(Math.max(ship.width, command.width) * 2)
  expect(ship.x + ship.width).toBeLessThanOrEqual(plot.x)
  expect(command.x).toBeGreaterThanOrEqual(plot.x + plot.width)
  expect(transport.y).toBeGreaterThanOrEqual(plot.y + plot.height)
  expect(commit.y + commit.height).toBeLessThanOrEqual(viewport.height)

  await page.screenshot({ path: testInfo.outputPath('console-1366x768.png') })
})

test('keyboard reaches every control in planning-flow order with a visible focus ring', async ({ page }, testInfo) => {
  await page.goto('/')
  const expected = ['Skip to orders', 'Abandon', 'Restart', 'Back', 'Play', 'Forward', 'Skip to end', 'Commit turn']

  for (const name of expected) {
    await page.keyboard.press('Tab')
    const focused = page.locator(':focus')
    await expect(focused).toHaveAccessibleName(name)
    const outline = await focused.evaluate((element) => {
      const style = getComputedStyle(element)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)
  }
  await page.screenshot({ path: testInfo.outputPath('commit-focus-1366x768.png') })

  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Commit turn' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('[aria-current]')).toHaveCount(0)

  await page.goto('/')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('#command-rail')).toBeFocused()
})

for (const viewport of [{ width: 1024, height: 700 }, { width: 390, height: 844 }]) {
  test(`keeps every console region reachable at ${viewport.width}x${viewport.height} without horizontal scrolling`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)

    expect((await pageOverflow(page)).horizontal).toBe(0)
    const plot = await box(page, '.deck-plot')
    expect(plot.y).toBeLessThan(viewport.height / 2)
    for (const region of ['Own ship', 'Plot readout', 'Orders', 'Event log']) {
      await expect(page.getByRole('region', { name: region })).toBeAttached()
    }
    const commit = page.getByRole('button', { name: 'Commit turn' })
    await commit.scrollIntoViewIfNeeded()
    await expect(commit).toBeInViewport()

    await page.screenshot({ path: testInfo.outputPath(`console-${viewport.width}x${viewport.height}.png`), fullPage: true })
  })
}

test('respects reduced-motion preferences for control transitions', async ({ page }) => {
  const commitTransition = () => page.getByRole('button', { name: 'Commit turn' }).evaluate((element) => getComputedStyle(element).transitionDuration)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
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

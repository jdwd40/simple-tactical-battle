import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'

// TSB-11C: the real application (controller + headless engine + PixiJS plot) in the dev
// server. `?seed=` makes the encounter reproducible; the patrol is the interim drill script.

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /too many active webgl contexts|context lost/i.test(message.text())) errors.push(message.text())
  })
  return errors
}

async function open(page: Page, seed = 17) {
  await page.goto(`/?seed=${seed}`)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const diagnostics = (page: Page) => page.evaluate(() => (window as unknown as { __plotDiagnostics: () => RendererDiagnostics }).__plotDiagnostics())
async function drawn(page: Page): Promise<DrawSummary> {
  const last = (await diagnostics(page)).last
  if (!last) throw new Error('Nothing drawn yet')
  return last
}

async function clickCell(page: Page, column: number, row: number) {
  const { origin, cellPx } = await drawn(page)
  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  await page.mouse.click(box.x + origin.x + (column + 0.5) * cellPx, box.y + origin.y + (row + 0.5) * cellPx)
}

const phase = (page: Page) => page.locator('[aria-current="step"]')
const turn = (page: Page) => page.getByTestId('turn-number')
const readout = (page: Page) => page.locator('#plot-readout')
const assessmentPanel = (page: Page) => page.getByRole('region', { name: /^Turn \d+ assessment$/ })

async function commitTo(page: Page, column: number, row: number, turnNumber = 1) {
  await page.getByLabel('Column').fill(String(column))
  await page.getByLabel('Row').fill(String(row))
  await page.getByLabel('Row').press('Enter')
  await expect(page.getByTestId('movement-order')).toHaveText(`Column ${column}, row ${row}`)
  await page.getByRole('button', { name: `Commit turn ${turnNumber}` }).click()
  await expect(phase(page)).toHaveText('Execution')
}

test('plots, commits and watches a genuine turn, then assesses, replays and plans the next', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await open(page)

  await clickCell(page, 16, 10)
  await expect(page.getByTestId('movement-order')).toHaveText('Column 16, row 10')
  await expect.poll(async () => (await drawn(page)).plan).toBe('preview')
  await expect(page.getByText('Column 13, row 10 (predicted)')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('planning-draft-1366x768.png') })

  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await expect(phase(page)).toHaveText('Execution')
  await expect(page.getByLabel('Column')).toHaveAttribute('readonly', '')
  await expect(page.getByRole('button', { name: 'Commit turn 1' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(15)
  await expect.poll(async () => (await drawn(page)).plan).toBe('committed')
  await page.screenshot({ path: testInfo.outputPath('execution-1366x768.png') })

  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(phase(page)).toHaveText('Assessment')
  await expect(assessmentPanel(page)).toContainText('Moved from column 3, row 10 to column 13, row 10.')
  await expect(assessmentPanel(page)).toContainText('Destination column 16, row 10 not reached yet; the course carries into your next plan.')
  expect((await drawn(page)).trailPoints).toBeGreaterThan(10)
  await page.screenshot({ path: testInfo.outputPath('assessment-1366x768.png') })

  await page.getByRole('button', { name: 'Replay turn 1' }).click()
  await expect(page.getByRole('region', { name: 'Replaying turn 1' })).toBeVisible()
  await expect(phase(page)).toHaveText('Execution')
  await expect.poll(async () => (await drawn(page)).tick).toBeLessThan(20)
  await page.getByRole('button', { name: 'Back to assessment' }).click()
  await expect(phase(page)).toHaveText('Assessment')

  await page.getByRole('button', { name: 'Plan turn 2' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(turn(page)).toHaveText('2')
  await expect(page.getByTestId('movement-order')).toHaveText('Column 16, row 10')
  await expect(readout(page)).toContainText('Positioncolumn 13, row 10')
  await expect.poll(async () => (await drawn(page)).trailPoints).toBe(1)
  await expect.poll(async () => (await drawn(page)).plan).toBe('preview')
  await expect(page.getByLabel('Column')).not.toHaveAttribute('readonly')
  expect(errors).toEqual([])
})

test('duplicate commit clicks and key presses resolve a single turn', async ({ page }) => {
  await open(page)
  await page.getByLabel('Column').fill('9')
  await page.getByLabel('Row').fill('10')
  await page.getByLabel('Row').press('Enter')
  const commit = page.getByRole('button', { name: 'Commit turn 1' })
  await commit.dblclick()
  await commit.press('Enter')
  await commit.press('Space')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessmentPanel(page)).toHaveAccessibleName('Turn 1 assessment')
  await page.getByRole('button', { name: 'Plan turn 2' }).click()
  await expect(turn(page)).toHaveText('2')
  await expect(readout(page)).toContainText('Positioncolumn 9, row 10')
})

test('the cursor prefix shows nothing ahead of playback, and the result is independent of playback', async ({ browser }) => {
  const results: string[] = []
  for (const pattern of ['skip', 'mixed'] as const) {
    const page = await browser.newPage()
    await open(page)
    await commitTo(page, 16, 10)
    if (pattern === 'skip') {
      await page.getByRole('button', { name: 'Skip to end' }).click()
    } else {
      await page.locator('.speed-option', { hasText: '4×' }).click()
      await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(30)
      await page.getByRole('button', { name: 'Pause' }).click()
      await page.getByLabel('Playback position').fill('5')
      await expect.poll(async () => (await drawn(page)).tick).toBe(5)
      expect((await drawn(page)).trailPoints).toBeLessThanOrEqual(6)
      await expect(page.locator('#plot-readout')).toContainText('No contacts.')
      await page.getByRole('button', { name: 'Play' }).click()
    }
    await expect(phase(page)).toHaveText('Assessment', { timeout: 10_000 })

    // Find when the patrol was first detected, then confirm it is absent one tick earlier.
    const detected = page.locator('.event-item[data-kind="contact-acquired"] .event-time').first()
    await expect(detected).toBeVisible()
    const seconds = Number((await detected.textContent())!.replace(' s', ''))
    const tick = Math.round(seconds * 10)
    await page.getByLabel('Playback position').fill(String(tick - 1))
    await expect.poll(async () => (await drawn(page)).tick).toBe(tick - 1)
    expect((await drawn(page)).contacts).toEqual([])
    await expect(page.locator('.event-item[data-kind="contact-acquired"]')).toHaveCount(0)
    await page.getByLabel('Playback position').fill(String(tick))
    await expect.poll(async () => (await drawn(page)).contacts.map(({ kind }) => kind)).toEqual(['current'])
    await page.getByRole('button', { name: 'Back to assessment' }).click()

    const summary = await assessmentPanel(page).locator('li').allTextContents()
    await page.getByRole('button', { name: 'Plan turn 2' }).click()
    const own = await page.getByRole('region', { name: 'Own ship', exact: true }).locator('dd').allTextContents()
    results.push(JSON.stringify({ summary, own, readout: await readout(page).textContent(), detectedAt: tick }))
    await page.close()
  }
  expect(results[1]).toBe(results[0])
})

test('restart during execution and repeated restarts leave one fresh encounter and renderer', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await open(page)
  await commitTo(page, 16, 10)
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(5)

  const before = await page.locator('.battlefield-canvas').getAttribute('data-encounter')
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(turn(page)).toHaveText('1')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect(readout(page)).toContainText('Positioncolumn 3, row 10')
  await expect(page.locator('.battlefield-canvas')).not.toHaveAttribute('data-encounter', before!)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  // Stale playback timers from the abandoned turn cannot advance the fresh encounter.
  await page.waitForTimeout(1500)
  await expect(phase(page)).toHaveText('Planning')
  expect(await drawn(page)).toMatchObject({ tick: 0, trailPoints: 1, contacts: [] })

  for (let i = 0; i < 4; i += 1) {
    await commitTo(page, 10 + i, 9)
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await expect(phase(page)).toHaveText('Planning')
  }
  await expect(page.locator('canvas')).toHaveCount(1)
  const lifecycle = await diagnostics(page)
  expect(lifecycle.live).toBe(1)
  expect(lifecycle.created - lifecycle.destroyed).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('after-restarts-1366x768.png') })
  expect(errors).toEqual([])
})

test('restart clears encounter-local entry fields and pointer readout, keeping focus on Restart', async ({ page }, testInfo) => {
  await open(page)
  const column = page.getByLabel('Column')
  const row = page.getByLabel('Row')
  await expect(column).toHaveValue('')
  await expect(row).toHaveValue('')
  const restart = page.getByRole('button', { name: 'Restart', exact: true })

  // Typed but uncommitted entry, plus a hovered cell, during planning.
  await column.fill('16')
  await row.fill('10')
  const { origin, cellPx } = await drawn(page)
  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  await page.mouse.move(box.x + origin.x + 8.5 * cellPx, box.y + origin.y + 4.5 * cellPx)
  await expect(readout(page)).toContainText('Pointercolumn 8, row 4')
  await restart.click()
  await expect(column).toHaveValue('')
  await expect(row).toHaveValue('')
  await expect(readout(page)).not.toContainText('Pointer')
  await expect(restart).toBeFocused()

  // Committed course, restarted mid-execution.
  await commitTo(page, 16, 10)
  await expect(column).toHaveValue('16')
  await restart.click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect(column).toHaveValue('')
  await expect(row).toHaveValue('')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('restart-cleared-entry.png') })

  // Abandoned, then restarted from the encounter-ended panel.
  await commitTo(page, 12, 9)
  await page.getByRole('button', { name: 'Abandon' }).click()
  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(column).toHaveValue('')
  await expect(row).toHaveValue('')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
})

test('abandon stops the encounter without inventing a combat result', async ({ page }) => {
  await open(page)
  await commitTo(page, 16, 10)
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(3)
  await page.getByRole('button', { name: 'Abandon' }).click()

  await expect(page.getByRole('region', { name: 'Encounter ended' })).toContainText('You abandoned the encounter. No combat result was recorded.')
  await expect(phase(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abandon' })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText(/victory|defeat|mutual/i)).toHaveCount(0)
  const frozen = (await drawn(page)).tick
  await page.waitForTimeout(800)
  expect((await drawn(page)).tick).toBe(frozen)

  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(turn(page)).toHaveText('1')
})

test('a keyboard-only turn: grid entry, commit, skip, assess and plan the next', async ({ page }, testInfo) => {
  await open(page)
  await page.getByLabel('Column').focus()
  await page.keyboard.type('10')
  await page.keyboard.press('Tab')
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('movement-order')).toHaveText('Column 10, row 9')
  for (const name of ['Set destination', 'Hold position', 'Commit turn 1']) {
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveAccessibleName(name)
  }
  await page.keyboard.press('Enter')
  await expect(phase(page)).toHaveText('Execution')

  await page.getByRole('button', { name: 'Skip to end' }).focus()
  await page.keyboard.press('Enter')
  await expect(phase(page)).toHaveText('Assessment')
  const planNext = page.getByRole('button', { name: 'Plan turn 2' })
  await planNext.focus()
  expect(await planNext.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none')
  await page.screenshot({ path: testInfo.outputPath('assessment-focus.png') })
  await page.keyboard.press('Enter')
  await expect(turn(page)).toHaveText('2')
  await expect(page.locator('#command-rail')).toBeFocused()
})

test('reduced motion plays the turn by snapping between recorded ticks', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await commitTo(page, 16, 10)
  const seen = new Set<string>()
  for (let i = 0; i < 20; i += 1) {
    seen.add((await drawn(page)).transition)
    await page.waitForTimeout(50)
  }
  expect(seen).toEqual(new Set(['snap']))
  await page.screenshot({ path: testInfo.outputPath('reduced-motion-execution.png') })
})

import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { HIDE_AND_SEEK, MISSION_SEED } from '../scenes/mission'
import { expectReadableLabels } from './support/labels'

// TSB-41: the MAIN game (App) with the real engine and the accepted patrol AI (TSB-40), from
// the briefing to a real outcome. No scripted opponent or fixture is involved here.
function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /too many active webgl contexts|context lost/i.test(message.text())) errors.push(message.text())
  })
  return errors
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
const briefing = (page: Page) => page.getByRole('dialog', { name: 'Patrol encounter' })
const phase = (page: Page) => page.locator('[aria-current="step"]')
const assessment = (page: Page) => page.getByRole('region', { name: /^Turn \d+ assessment$/ })
const ending = (page: Page) => page.getByRole('region', { name: 'Encounter over' })
const radio = (page: Page, group: string, name: string) => page.getByRole('group', { name: group }).getByRole('radio', { name })
async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

test('the briefing sets the scene without spoilers and never changes the encounter', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await page.goto(`/?seed=${MISSION_SEED}`)
  await expect(briefing(page)).toBeVisible()
  for (const text of ['colonial war', 'The Federation holds the colonies; Earth is still free', 'Shadow-Dancer', 'Federation patrol frigate', 'Destroy the frigate and survive', 'Time stops while you plan', 'both ships act at once for 10 seconds', 'within 6 cells', `Seed ${MISSION_SEED}.`]) {
    await expect(briefing(page)).toContainText(text)
  }
  // Public knowledge only: no frigate position, route or condition.
  await expect(briefing(page)).not.toContainText(/column|row \d|hull \d|shields \d/i)
  await expect(page.getByRole('button', { name: 'Begin mission' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Patrol encounter' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'Begin mission' })).toBeInViewport({ ratio: 1 })
  await expect(page.locator('[aria-current="step"]')).toHaveText('Planning')
  await page.screenshot({ path: testInfo.outputPath('mission-briefing-1366x768.png') })
  await page.keyboard.press('Enter')
  await expect(briefing(page)).toBeHidden()
  await expect(page.locator('#command-rail')).toBeFocused()

  // A draft survives reopening the briefing; Escape closes it and returns focus.
  await page.getByLabel('Column', { exact: true }).fill('9')
  await page.getByLabel('Row', { exact: true }).fill('12')
  await page.getByLabel('Row', { exact: true }).press('Enter')
  await radio(page, 'Cloak', 'Off').check()
  await page.getByRole('button', { name: 'Briefing' }).click()
  await expect(briefing(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to the console' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(briefing(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Briefing' })).toBeFocused()
  await expect(page.getByTestId('movement-order')).toHaveText('Column 9, row 12')
  await expect(radio(page, 'Cloak', 'Off')).toBeChecked()
  await expect(page.getByTestId('turn-number')).toHaveText('1')

  // During playback the briefing pauses it, and the turn resumes exactly where it stopped.
  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(5)
  await page.getByRole('button', { name: 'Briefing' }).click()
  const paused = (await drawn(page)).tick
  await page.waitForTimeout(600)
  expect((await drawn(page)).tick).toBe(paused)
  await page.getByRole('button', { name: 'Return to the console' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  expect(errors).toEqual([])
})

test('the seed is plain reproduction data with a link that reopens the same encounter', async ({ page, context, baseURL }) => {
  const errors = trackErrors(page)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/?seed=${MISSION_SEED}`)
  await page.getByRole('button', { name: 'Begin mission' }).click()
  await expect(page.getByTestId('seed')).toHaveText(String(MISSION_SEED))
  await page.getByRole('button', { name: 'Copy seed link' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Seed link copied.' })).toBeAttached()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/?seed=${MISSION_SEED}`)

  // Same-seed restart keeps it; a new encounter draws a fresh seed outside the engine.
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(page.getByTestId('seed')).toHaveText(String(MISSION_SEED))
  await page.getByRole('button', { name: 'Abandon' }).click()
  await page.getByRole('button', { name: 'New encounter' }).click()
  await expect(page.getByTestId('seed')).not.toHaveText(String(MISSION_SEED))
  const fresh = (await page.getByTestId('seed').textContent())!
  await page.getByRole('button', { name: 'Copy seed link' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toBe(`${baseURL}/?seed=${fresh}`)
  const reopened = await context.newPage()
  await reopened.goto(link)
  await expect(reopened.getByTestId('seed')).toHaveText(fresh)
  await reopened.close()
  expect(errors).toEqual([])
})

test('the full mission against the patrol AI: orders, combat, losing and regaining contact, a real outcome, replay and restart', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors = trackErrors(page)
  // Count document loads: a dev-server reload (for example a tracked file edited in its root
  // during the run) must be reported as such, never mistaken for restart reopening the briefing.
  let loads = 0
  page.on('load', () => { loads += 1 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/?seed=${MISSION_SEED}`)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('button', { name: 'Begin mission' }).click()

  for (const [index, turn] of HIDE_AND_SEEK.entries()) {
    const number = index + 1
    if (number === 2) {
      // Indecisive drafting: none of this may change the frigate's plan for the turn.
      await radio(page, 'Sensor', 'Active pulse').check()
      await clickCell(page, 0, 0)
      await radio(page, 'Weapon', 'Missile').check()
      await page.keyboard.press('Escape')
      await radio(page, 'Sensor', 'Passive').check()
    }
    await radio(page, 'Cloak', turn.cloak ? 'On' : 'Off').check()
    if (turn.destination) {
      await page.getByLabel('Column', { exact: true }).fill(String(turn.destination.column))
      await page.getByLabel('Row', { exact: true }).fill(String(turn.destination.row))
      await page.getByLabel('Row', { exact: true }).press('Enter')
    } else {
      await page.getByRole('button', { name: 'Hold position', exact: true }).click()
    }
    await radio(page, 'Weapon', turn.laser ? 'Laser' : 'Hold fire').check()
    if (number === 1) {
      await expectReadableLabels(page, 'turn 1 planning')
      await page.screenshot({ path: testInfo.outputPath('mission-planning-turn1-1366x768.png') })
    }
    await page.getByRole('button', { name: `Commit turn ${number}` }).focus()
    await page.keyboard.press('Enter')
    await expect(phase(page)).toHaveText('Execution')
    if (number === 1) {
      await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(5)
      expect((await drawn(page)).transition).toBe('snap')
    }
    if (number === 2) {
      // The exchange at 101, cue by cue: nothing before it, everything that was observed at it.
      await page.getByRole('button', { name: 'Pause' }).click()
      await seek(page, 100)
      await expect(page.getByTestId('combat-feed')).toBeEmpty()
      expect((await drawn(page)).effects).toEqual([])
      await seek(page, 101)
      await expect(page.getByTestId('combat-feed')).toContainText('Laser hit contact-1.')
      await expect(page.getByTestId('combat-feed')).toContainText('Hit: −35 shields (contact-1 fired its laser this tick).')
      expect((await drawn(page)).effects).toEqual(expect.arrayContaining(['own-beam', 'hit-laser', 'hostile-beam', 'own-hit']))
      await expect(page.getByRole('region', { name: 'Own ship', exact: true }).getByTestId('lost-shields')).toHaveText(' −35')
      await expectReadableLabels(page, 'turn 2 exchange')
      await page.screenshot({ path: testInfo.outputPath('mission-hit-exchange-1366x768.png') })
      // Rewind clears the later cues again.
      await seek(page, 100)
      await expect(page.getByTestId('combat-feed')).toBeEmpty()
    }
    if (number === HIDE_AND_SEEK.length) break
    await page.getByRole('button', { name: 'Skip to end' }).click()
    await expect(phase(page)).toHaveText('Assessment')
    if (number === 2) {
      // After Skip, the summary leads the assessment.
      await expect(page.getByTestId('combat-summary')).toContainText('Laser hit contact-1.')
      await expect(page.getByTestId('damage-taken')).toHaveText('✖ Damage taken: 35 shields, 0 hull')
      await expect(page.getByText('Hit: 35 shields and 0 hull lost.')).toBeVisible()
      await expectReadableLabels(page, 'turn 2 current contact')
      await page.screenshot({ path: testInfo.outputPath('mission-exchange-turn2-1366x768.png') })
    }
    if (number === 3) {
      await expect(assessment(page)).toContainText('contact-1 lost at 4.6 s; now a last-known position.')
      await expectReadableLabels(page, 'turn 3 last-known contact')
      await page.screenshot({ path: testInfo.outputPath('mission-withdrawn-cloaked-turn3-1366x768.png') })
    }
    if (number === 4) await expect(assessment(page)).toContainText('contact-1 detected at 6.2 s.')
    await page.getByRole('button', { name: `Plan turn ${number + 1}` }).click()
  }

  // Final turn: own destruction at its tick, the turn completes, and defeat waits for the boundary.
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 836)
  await expect(page.locator('.event-item[data-kind="own-destruction"]')).toHaveCount(0)
  await seek(page, 837)
  await expect(page.locator('.event-item[data-kind="own-destruction"]')).toContainText('Shadow-Dancer destroyed.')
  await expect(page.getByTestId('combat-feed')).toContainText('Shadow-Dancer destroyed.')
  await expect(page.locator('.event-item[data-kind="observed-shot"]')).toHaveCount(1)
  await seek(page, 899)
  await expect(ending(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')
  await expect(page.getByTestId('outcome')).toBeInViewport()
  await expect(page.locator('p.sr-only[aria-live="polite"]')).toHaveText('Encounter over: Defeat')
  await expectReadableLabels(page, 'defeat')
  await page.screenshot({ path: testInfo.outputPath('mission-defeat-1366x768.png') })

  await page.getByRole('button', { name: 'Replay final turn' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 820)
  await expect(ending(page)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Replaying the final turn' })).toBeVisible()
  await expectReadableLabels(page, 'final-turn replay')
  await page.screenshot({ path: testInfo.outputPath('mission-replay-final-turn-1366x768.png') })
  await page.getByRole('button', { name: 'Back to result' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')

  expect(loads, 'the page reloaded during the mission (dev-server file change?), so its state is not from this run').toBe(1)
  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.getByTestId('seed')).toHaveText(String(MISSION_SEED))
  // Restart is in-page: no navigation, and so no opening briefing.
  await page.waitForTimeout(500)
  expect(loads, 'restart must not reload the page').toBe(1)
  await expect(page.locator('#plot-readout')).toContainText('No contacts.')
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(briefing(page)).toBeHidden()
  expect(errors).toEqual([])
})

test('on a plain-http origin the fallback copy keeps focus on the button and copies the exact link', async ({ page, context }) => {
  // A genuine insecure origin: requests to it are served by the dev server, but the page is not
  // a secure context, so the async clipboard API is unavailable and the fallback copy runs.
  const origin = 'http://tsb-copy.invalid:4272'
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4272' })
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ response: await context.request.get(`http://127.0.0.1:4272${url.pathname}${url.search}`) })
  })
  await page.goto(`${origin}/?seed=${MISSION_SEED}`)
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  await page.getByRole('button', { name: 'Begin mission' }).click()
  await page.getByLabel('Column', { exact: true }).fill('9')
  await page.getByLabel('Row', { exact: true }).fill('12')
  await page.getByLabel('Row', { exact: true }).press('Enter')

  const copy = page.getByRole('button', { name: 'Copy seed link' })
  await copy.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Seed link copied.' })).toBeAttached()
  await expect(copy).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Briefing' })).toBeFocused()
  await expect(page.getByTestId('movement-order')).toHaveText('Column 9, row 12')
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

  // Read the system clipboard back from a secure page in the same browser.
  const reader = await context.newPage()
  await reader.goto('http://127.0.0.1:4272/tests/fixtures/battlefield/index.html')
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/?seed=${MISSION_SEED}`)
  await reader.close()
})

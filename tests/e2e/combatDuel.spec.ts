import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { LASER_DUEL } from '../harness/duel/sequence'

// TSB-31 on the REAL engine and controller (lasers, damage batches, destruction, outcomes).
// These exact-tick scenes use the test-only duel page (tests/harness/duel): the same controller
// composed with a labelled scripted opponent (the former drill patrol, a firing one or a
// retaliating one), each planning from its own observation. The main game, with the real
// patrol AI, is covered by mission.spec.ts. The player orders are LASER_DUEL throughout.
const DUEL_PAGE = '/tests/harness/duel/index.html'

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
async function open(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}
const phase = (page: Page) => page.locator('[aria-current="step"]')
const weapon = (page: Page) => page.getByRole('group', { name: 'Weapon' })
const assessment = (page: Page) => page.getByRole('region', { name: /^Turn \d+ assessment$/ })
const ending = (page: Page) => page.getByRole('region', { name: 'Encounter over' })
async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

/** Plans one LASER_DUEL turn through the console, commits it and returns once execution starts. */
async function planAndCommit(page: Page, index: number) {
  const turn = LASER_DUEL[index]
  if (index === 0) await page.getByRole('group', { name: 'Cloak' }).getByRole('radio', { name: 'Off' }).check()
  if (turn.destination) {
    await page.getByLabel('Column', { exact: true }).fill(String(turn.destination.column))
    await page.getByLabel('Row', { exact: true }).fill(String(turn.destination.row))
    await page.getByLabel('Row', { exact: true }).press('Enter')
    await expect(page.getByTestId('movement-order')).toHaveText(`Column ${turn.destination.column}, row ${turn.destination.row}`)
  } else {
    await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  }
  if (turn.laser) {
    await weapon(page).getByRole('radio', { name: 'Laser' }).check()
    await expect(page.getByRole('radio', { name: /^contact-1, / })).toBeChecked()
  }
  await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
  await expect(phase(page)).toHaveText('Execution')
}

async function playTurns(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await planAndCommit(page, index)
    await page.getByRole('button', { name: 'Skip to end' }).click()
    if (index < count - 1) {
      await expect(phase(page)).toHaveText('Assessment')
      await page.getByRole('button', { name: `Plan turn ${index + 2}` }).click()
    }
  }
}

test('laser duel to victory: lock, cost, cooldown, replay before effects, reveal only at its tick, restart', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await open(page, '/tests/harness/duel/index.html?seed=17&opponent=scripted')
  await expect(page.getByText('Test page: scripted opponent', { exact: true })).toBeVisible()
  await expect(weapon(page).getByRole('radio', { name: 'Laser' })).toBeDisabled()
  await expect(weapon(page).getByRole('radio', { name: 'Missile' })).toBeEnabled()
  await expect(page.getByText('No known contact to aim a laser at.', { exact: true })).toBeVisible()

  await playTurns(page, 2)
  await page.getByRole('button', { name: 'Plan turn 3' }).click()

  // Turn 3: a current lock in range; cost and cooldown shown before commit.
  await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  await weapon(page).getByRole('radio', { name: 'Laser' }).check()
  await expect(page.getByRole('radio', { name: 'contact-1, current' })).toBeChecked()
  await expect(page.getByLabel('Laser effects')).toContainText('18.0 energy when it fires')
  await expect(page.getByTestId('energy-plan')).toContainText('Up to 18.0')
  await expect.poll(async () => (await drawn(page)).weaponPlan).toBe('laser')
  await page.screenshot({ path: testInfo.outputPath('duel-laser-planning-1366x768.png') })
  await page.getByRole('button', { name: 'Commit turn 3' }).click()
  await expect(weapon(page).getByRole('radio', { name: 'Laser' })).toBeDisabled()
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).toContainText('Laser fired at 0.1 s.')
  await expect(page.getByText('Energy −18.0 (laser).')).toBeVisible()

  // Replay: nothing before tick 201, the beam and impact at 201, cooldown until 251.
  await page.getByRole('button', { name: 'Replay turn 3' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 200)
  expect((await drawn(page)).effects).toEqual([])
  await expect(page.getByTestId('own-laser')).toHaveText('Ready')
  await seek(page, 201)
  expect((await drawn(page)).effects).toEqual(['own-beam', 'hit-laser'])
  await expect(page.getByTestId('own-laser')).toHaveText('Cooling, 5.0 s')
  await page.screenshot({ path: testInfo.outputPath('duel-laser-beam-1366x768.png') })
  await seek(page, 251)
  await expect(page.getByTestId('own-laser')).toHaveText('Ready')
  await page.getByRole('button', { name: 'Back to assessment' }).click()
  await page.getByRole('button', { name: 'Plan turn 4' }).click()

  // Turn 4, then turn 5 at a last-known contact: the lock conditional shows before commit.
  await planAndCommit(page, 3)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await page.getByRole('button', { name: 'Plan turn 5' }).click()
  const turn5 = LASER_DUEL[4].destination!
  await page.getByLabel('Column', { exact: true }).fill(String(turn5.column))
  await page.getByLabel('Row', { exact: true }).fill(String(turn5.row))
  await page.getByLabel('Row', { exact: true }).press('Enter')
  await weapon(page).getByRole('radio', { name: 'Laser' }).check()
  await expect(page.getByRole('radio', { name: /contact-1, last known .* fires only if detected again/ })).toBeChecked()
  await expect(page.getByText('Fires only once contact-1 is detected again this turn.')).toBeVisible()
  await expect.poll(async () => (await drawn(page)).weaponPlan).toBe('laser')
  await page.screenshot({ path: testInfo.outputPath('duel-laser-awaiting-lock-1366x768.png') })
  await page.getByRole('button', { name: 'Commit turn 5' }).click()
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).toContainText('Laser fired at 3.3 s.')
  await page.getByRole('button', { name: 'Plan turn 6' }).click()
  await planAndCommit(page, 5)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await page.getByRole('button', { name: 'Plan turn 7' }).click()

  // Turn 7: the patrol is seen destroyed at 601, but the result waits for the boundary.
  await planAndCommit(page, 6)
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 650)
  await expect(phase(page)).toHaveText('Execution')
  await expect(ending(page)).toHaveCount(0)
  await expect(page.locator('.event-item[data-kind="observed-destruction"]')).toHaveCount(1)
  await expect(page.locator('.event-item[data-kind="outcome"]')).toHaveCount(0)
  expect((await drawn(page)).contacts[0]).toMatchObject({ alias: 'contact-1' })
  await page.screenshot({ path: testInfo.outputPath('duel-observed-destruction-before-reveal-1366x768.png') })
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(ending(page)).toBeVisible()
  await expect(page.getByTestId('outcome')).toHaveText('Victory')
  await expect(page.getByTestId('outcome')).toBeInViewport()
  await expect(page.locator('.event-item[data-kind="outcome"]')).toHaveText(/Encounter result: victory\./)
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Encounter over: Victory')
  await page.screenshot({ path: testInfo.outputPath('duel-victory-1366x768.png') })

  // Replay of the finished duel hides the result until playback reaches it again.
  await page.getByRole('button', { name: 'Replay final turn' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 650)
  await expect(page.getByRole('region', { name: 'Replaying the final turn' })).toBeVisible()
  await expect(ending(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abandon' })).toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: 'Back to result' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Victory')

  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.locator('#plot-readout')).toContainText('No contacts.')
  await expect(weapon(page).getByRole('radio', { name: 'Hold fire' })).toBeChecked()
  await expect(page.locator('canvas')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('defeat against a firing opponent: own destruction at its tick, the turn completes, defeat at the boundary', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await open(page, `${DUEL_PAGE}?seed=17&opponent=firing`)
  await playTurns(page, 2)
  await page.getByRole('button', { name: 'Plan turn 3' }).click()
  await planAndCommit(page, 2)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByText('Hit: 35 shields and 0 hull lost.')).toBeVisible()
  await expect(assessment(page)).toContainText('Shields -35, hull 0.')
  await page.getByRole('button', { name: 'Replay turn 3' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 201)
  expect((await drawn(page)).effects).toEqual(expect.arrayContaining(['own-beam', 'hostile-beam', 'own-hit']))
  await page.screenshot({ path: testInfo.outputPath('duel-exchange-1366x768.png') })
  await page.getByRole('button', { name: 'Back to assessment' }).click()
  for (const index of [3, 4]) {
    await page.getByRole('button', { name: `Plan turn ${index + 1}` }).click()
    await planAndCommit(page, index)
    await page.getByRole('button', { name: 'Skip to end' }).click()
  }
  await page.getByRole('button', { name: 'Plan turn 6' }).click()
  await planAndCommit(page, 5)
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 500)
  await expect(page.locator('.event-item[data-kind="own-destruction"]')).toHaveCount(0)
  await seek(page, 501)
  await expect(page.getByText('Shadow-Dancer destroyed.')).toBeVisible()
  expect((await drawn(page)).ownState).toBe('destroyed')
  await seek(page, 599)
  await expect(phase(page)).toHaveText('Execution')
  await expect(ending(page)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('duel-own-destruction-1366x768.png') })
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')
  await expect(ending(page)).toContainText('Shadow-Dancer is destroyed; the patrol frigate survives.')
  await page.screenshot({ path: testInfo.outputPath('duel-defeat-1366x768.png') })
  await page.getByRole('button', { name: 'New encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  expect(errors).toEqual([])
})

test('mutual destruction when both lethal shots share tick 601', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await open(page, `${DUEL_PAGE}?seed=17&opponent=retaliating`)
  await playTurns(page, 6)
  await page.getByRole('button', { name: 'Plan turn 7' }).click()
  await planAndCommit(page, 6)
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 601)
  await expect(page.locator('.event-item[data-kind="own-destruction"]')).toHaveCount(1)
  await expect(page.locator('.event-item[data-kind="observed-destruction"]')).toHaveCount(1)
  expect((await drawn(page)).ownState).toBe('destroyed')
  await page.screenshot({ path: testInfo.outputPath('duel-mutual-lethal-tick-1366x768.png') })
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Mutual destruction')
  await page.screenshot({ path: testInfo.outputPath('duel-mutual-destruction-1366x768.png') })
  expect(errors).toEqual([])
})

test('an unfired laser at a last-known contact is explained from the assessment, ordered by keyboard under reduced motion', async ({ page }) => {
  const errors = trackErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, '/tests/harness/duel/index.html?seed=17&opponent=scripted')
  for (const [index, cell] of [[0, { column: 16, row: 10 }], [1, { column: 2, row: 18 }]] as const) {
    await page.getByLabel('Column', { exact: true }).fill(String(cell.column))
    await page.getByLabel('Row', { exact: true }).fill(String(cell.row))
    await page.getByLabel('Row', { exact: true }).press('Enter')
    await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
    await page.getByRole('button', { name: 'Skip to end' }).click()
    await page.getByRole('button', { name: `Plan turn ${index + 2}` }).click()
  }
  await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  await weapon(page).getByRole('radio', { name: 'Hold fire' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(weapon(page).getByRole('radio', { name: 'Laser' })).toBeChecked()
  await expect(weapon(page).getByRole('radio', { name: 'Laser' })).toBeFocused()
  await expect(page.getByText('Fires only once contact-1 is detected again this turn.')).toBeVisible()
  await expect(page.getByText('A successful scan or shot breaks cloak until a later turn.')).toBeVisible()
  await page.getByRole('button', { name: 'Commit turn 3' }).focus()
  await page.keyboard.press('Enter')
  await expect(phase(page)).toHaveText('Execution')
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(205)
  expect((await drawn(page)).transition).toBe('snap')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).toContainText('Laser did not fire: the target was never detected as current. The intent does not carry into the next turn.')
  await expect(page.getByTestId('own-laser')).toHaveText('Ready')
  expect(errors).toEqual([])
})

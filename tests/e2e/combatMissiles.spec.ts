import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { DEAD_LAUNCHER, EVASION, type MissileTurn } from '../harness/duel/sequence'

// TSB-31 missiles and automatic aftermath on the REAL engine (TSB-30B), seed 17. The drill
// patrol scene runs in the application; scenes needing a firing opponent use the test-only
// duel page (tests/harness/duel). Every tick and position below is real engine output.
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
async function clickCell(page: Page, column: number, row: number) {
  const { origin, cellPx } = await drawn(page)
  const box = (await page.locator('.battlefield-canvas canvas').boundingBox())!
  await page.mouse.click(box.x + origin.x + (column + 0.5) * cellPx, box.y + origin.y + (row + 0.5) * cellPx)
}
const phase = (page: Page) => page.locator('[aria-current="step"]')
const weapon = (page: Page) => page.getByRole('group', { name: 'Weapon' })
const assessment = (page: Page) => page.getByRole('region', { name: /^Turn \d+ assessment$/ })
const readout = (page: Page) => page.locator('#plot-readout')
async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

/** Plans one scripted turn (cloak off from turn 1), commits it and pauses at the turn start. */
async function planAndCommit(page: Page, turns: readonly MissileTurn[], index: number) {
  const turn = turns[index]
  if (index === 0) await page.getByRole('group', { name: 'Cloak' }).getByRole('radio', { name: 'Off' }).check()
  if (turn.destination) {
    await page.getByLabel('Column', { exact: true }).fill(String(turn.destination.column))
    await page.getByLabel('Row', { exact: true }).fill(String(turn.destination.row))
    await page.getByLabel('Row', { exact: true }).press('Enter')
  } else {
    await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  }
  if (turn.laser) await weapon(page).getByRole('radio', { name: 'Laser' }).check()
  if (turn.missileAim) {
    await weapon(page).getByRole('radio', { name: 'Missile' }).check()
    await page.getByLabel('Aim column', { exact: true }).fill(String(turn.missileAim.column))
    await page.getByLabel('Aim row', { exact: true }).fill(String(turn.missileAim.row))
    await page.getByLabel('Aim row', { exact: true }).press('Enter')
    await expect(page.getByTestId('missile-aim')).toContainText(`Aimed at column ${turn.missileAim.column}, row ${turn.missileAim.row}.`)
  }
  await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
  await expect(phase(page)).toHaveText('Execution')
  await page.getByRole('button', { name: 'Pause' }).click()
}

async function playTurns(page: Page, turns: readonly MissileTurn[], count: number) {
  for (let index = 0; index < count; index += 1) {
    await planAndCommit(page, turns, index)
    await page.getByRole('button', { name: 'Skip to end' }).click()
    await expect(phase(page)).toHaveText('Assessment')
    await page.getByRole('button', { name: `Plan turn ${index + 2}` }).click()
  }
}

test('a missile aimed on the plot flies straight and stops on an asteroid face, replayed before and at impact', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors = trackErrors(page)
  await open(page, '/?seed=17')
  await playTurns(page, EVASION, 2)

  // Turn 3: aim on the plot in the deliberate mode; costs and cooldown before commit.
  await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  await weapon(page).getByRole('radio', { name: 'Missile' }).check()
  await expect(page.getByRole('status').filter({ hasText: 'Aiming the missile' })).toBeVisible()
  await clickCell(page, 6, 4)
  await expect(page.getByTestId('missile-aim')).toContainText('Aimed at column 6, row 4.')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect(page.getByLabel('Missile effects')).toContainText('10.0 energy and 1 missile (6 left)')
  await expect(page.getByTestId('energy-plan')).toContainText('Upkeep: missile 10.0.')
  await expect.poll(async () => (await drawn(page)).weaponPlan).toBe('missile')
  await page.screenshot({ path: testInfo.outputPath('missile-aim-planning-1366x768.png') })
  await page.getByRole('button', { name: 'Commit turn 3' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()

  await seek(page, 215)
  expect((await drawn(page)).ownMissiles.map((missile) => missile.id)).toHaveLength(1)
  await expect(readout(page)).toContainText('Own missile at')
  await expect(page.getByTestId('own-launcher')).toHaveText(/^Cooling, /)
  await page.screenshot({ path: testInfo.outputPath('missile-in-flight-1366x768.png') })
  await seek(page, 222)
  expect((await drawn(page)).effects).toEqual([])
  await seek(page, 223)
  expect(await drawn(page)).toMatchObject({ ownMissiles: [], effects: ['impact-missile'] })
  await expect(page.getByText('Missile impact observed at column 7, row 6.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('missile-asteroid-impact-1366x768.png') })
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).toContainText('Missile fired at 0.1 s.')
  await expect(page.getByRole('region', { name: 'Own ship', exact: true })).toContainText('5 / 6')
  expect(errors).toEqual([])
})

test('a hostile missile is tracked without aim and evaded by moving; a lost track stays a last sighting', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, `${DUEL_PAGE}?seed=17&opponent=missile`)
  await expect(page.getByTestId('opponent-note')).toContainText('launches a missile')
  await playTurns(page, EVASION, 2)
  await planAndCommit(page, EVASION, 2)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByText('Hit: 40 shields and 5 hull lost.')).toBeVisible()
  await page.getByRole('button', { name: 'Plan turn 4' }).click()

  // Turn 4: move away; the missile launched at 301 lands on its aimed cell at 327, harmlessly.
  await planAndCommit(page, EVASION, 3)
  await seek(page, 301)
  expect((await drawn(page)).hostileMissiles.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'missile-2', kind: 'current' }])
  await expect(readout(page)).toContainText('Hostile missile-2 at')
  await page.screenshot({ path: testInfo.outputPath('missile-hostile-track-1366x768.png') })
  await seek(page, 327)
  const landed = await drawn(page)
  expect(landed.effects).toEqual(['impact-missile'])
  expect(landed.hostileMissiles).toEqual([])
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).not.toContainText('Shields')
  await expect(page.locator('.event-item[data-kind="own-damage"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('missile-evaded-1366x768.png') })

  // Same seed, a different turn 4: the track is lost behind cover and carried into planning.
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await playTurns(page, EVASION, 3)
  await planAndCommit(page, [...EVASION.slice(0, 3), { destination: { column: 6, row: 17 } }], 3)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await page.getByRole('button', { name: 'Plan turn 5' }).click()
  const track = (await drawn(page)).hostileMissiles
  expect(track.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'missile-2', kind: 'stale' }])
  expect(track[0].radiusPx).toBeGreaterThan(0)
  await expect(readout(page)).toContainText('Its aim is unknown.')
  await page.screenshot({ path: testInfo.outputPath('missile-hostile-last-sighting-planning-1366x768.png') })
  expect(errors).toEqual([])
})

test('a destroyed launcher\'s missile flies on through one automatic window; defeat appears only at its reveal', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await open(page, `${DUEL_PAGE}?seed=17&opponent=firing`)
  await playTurns(page, DEAD_LAUNCHER, 5)
  await planAndCommit(page, DEAD_LAUNCHER, 5)

  await seek(page, 501)
  expect(await drawn(page)).toMatchObject({ ownState: 'destroyed' })
  expect((await drawn(page)).ownMissiles).toHaveLength(1)
  await seek(page, 599)
  await expect(page.getByText('9.9 / 10.0 s')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Shadow-Dancer destroyed' })).toHaveCount(0)
  // Reaching the turn's end begins exactly one more known window.
  await seek(page, 600)
  await expect(page.getByText('10.0 / 20.0 s')).toBeVisible()
  await seek(page, 605)
  await expect(page.getByRole('region', { name: 'Shadow-Dancer destroyed' })).toBeVisible()
  await expect(page.getByTestId('automatic-note')).toContainText('the patrol plans from its own observation')
  await expect(page.getByRole('button', { name: /^Commit turn/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Orders' })).toHaveCount(0)
  await expect(page.getByTestId('turn-number')).toHaveText('7')
  expect((await drawn(page)).ownMissiles).toHaveLength(1)
  await expect(page.locator('[aria-live="polite"]')).toHaveText('Automatic turn 7 playing')
  await page.screenshot({ path: testInfo.outputPath('missile-automatic-aftermath-1366x768.png') })
  await seek(page, 611)
  expect((await drawn(page)).ownMissiles).toEqual([])
  await seek(page, 699)
  await expect(page.getByRole('region', { name: 'Encounter over' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')
  await expect(page.getByTestId('outcome')).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('missile-aftermath-defeat-1366x768.png') })

  // Replay covers the committed turn and its automatic window from recordings only.
  await page.getByRole('button', { name: 'Replay final turn' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 650)
  await expect(page.getByRole('region', { name: 'Replaying the final turn' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Encounter over' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to result' }).click()
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')
  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.getByRole('region', { name: 'Own ship', exact: true })).toContainText('6 / 6')
  expect((await drawn(page)).ownMissiles).toEqual([])
  expect(errors).toEqual([])
})

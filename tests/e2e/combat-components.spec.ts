import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'

// TSB-31 component checks: the real console and PixiJS plot against the static public frames
// in tests/fixtures/combat. A fixture controller only replays those frames; no engine runs.
// Real-engine combat acceptance is separate (it needs the TSB-30 engine).
const HARNESS = '/tests/fixtures/combat/index.html'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /too many active webgl contexts|context lost/i.test(message.text())) errors.push(message.text())
  })
  return errors
}
const diagnostics = (page: Page) => page.evaluate(() => window.__plotDiagnostics()) as Promise<RendererDiagnostics>
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
const weapon = (page: Page) => page.getByRole('group', { name: 'Weapon' })
const lastCommand = (page: Page) => page.getByTestId('harness-log').locator('li').first()
async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

test('targets a laser at a known alias and aims a missile only in a deliberate mode', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await page.goto(HARNESS)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.getByText('Combat drill', { exact: true })).toBeVisible()

  // Laser from the keyboard: arrow from Hold fire to Laser, which targets the current contact.
  await weapon(page).getByRole('radio', { name: 'Hold fire' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(weapon(page).getByRole('radio', { name: 'Laser' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'contact-1, current' })).toBeChecked()
  await expect(lastCommand(page)).toContainText('"weapon":{"kind":"laser","contactAlias":"contact-1"}')
  await expect(page.getByLabel('Laser effects')).toContainText('18.0 energy when it fires')
  await expect.poll(async () => (await drawn(page)).weaponPlan).toBe('laser')
  await page.screenshot({ path: testInfo.outputPath('combat-laser-planning-1366x768.png') })

  // Missile: choosing it enters aiming mode; the order stays hold fire until a cell is chosen.
  await weapon(page).getByRole('radio', { name: 'Missile' }).check()
  await expect(lastCommand(page)).toContainText('"weapon":{"kind":"hold"}')
  await expect(page.getByTestId('missile-aim')).toHaveText('No aim yet: the order stays Hold fire until you choose a cell.')
  await expect(page.getByRole('status').filter({ hasText: 'Aiming the missile' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('status').filter({ hasText: 'Aiming the missile' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Aim on plot' }).click()
  await clickCell(page, 12, 9)
  await expect(lastCommand(page)).toContainText('"movement":{"kind":"hold"},"weapon":{"kind":"missile","aim":{"column":12,"row":9}}')
  await expect(page.getByTestId('missile-aim')).toContainText('Aimed at column 12, row 9.')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect.poll(async () => (await drawn(page)).weaponPlan).toBe('missile')
  await page.screenshot({ path: testInfo.outputPath('combat-missile-aim-1366x768.png') })

  // Out of aiming mode, a plot click is a movement order again, and the aim is kept.
  await clickCell(page, 9, 12)
  await expect(page.getByTestId('movement-order')).toHaveText('Column 9, row 12')
  await expect(lastCommand(page)).toContainText('"weapon":{"kind":"missile","aim":{"column":12,"row":9}}')

  // Grid-reference aim, keyboard only.
  await page.getByLabel('Aim column', { exact: true }).fill('14')
  await page.getByLabel('Aim row', { exact: true }).fill('3')
  await page.getByLabel('Aim row', { exact: true }).press('Enter')
  await expect(lastCommand(page)).toContainText('"aim":{"column":14,"row":3}')
  expect(errors).toEqual([])
})

test('shots, hits, telemetry and hostile tracks appear only from their recorded tick, snapping under reduced motion', async ({ page }, testInfo) => {
  const errors = trackErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(HARNESS)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await expect(page.locator('[aria-current="step"]')).toHaveText('Execution')
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(3)
  expect((await drawn(page)).transition).toBe('snap')
  await page.getByRole('button', { name: 'Pause' }).click()

  await seek(page, 4)
  expect((await drawn(page)).effects).toEqual([])
  await seek(page, 5)
  expect((await drawn(page)).effects).toEqual(['own-beam', 'impact-laser'])
  await expect(page.getByTestId('own-laser')).toHaveText('Cooling, 5.0 s')

  await seek(page, 12)
  expect((await drawn(page)).effects).toEqual(['hostile-beam', 'own-hit'])
  await expect(page.locator('.event-item').first()).toContainText('Hit: 35 shields and 0 hull lost.')
  await page.screenshot({ path: testInfo.outputPath('combat-hostile-laser-hit-1366x768.png') })

  await seek(page, 14)
  expect((await drawn(page)).ownMissiles).toEqual([])
  await seek(page, 20)
  const flying = await drawn(page)
  expect(flying.ownMissiles.map((missile) => missile.id)).toEqual(['own-missile-1'])
  expect(flying.hostileMissiles.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'missile-1', kind: 'current' }])
  await expect(page.locator('#plot-readout')).toContainText('Own missile at')
  await expect(page.locator('#plot-readout')).toContainText('Hostile missile-1 at')
  await page.screenshot({ path: testInfo.outputPath('combat-missiles-in-flight-1366x768.png') })

  await seek(page, 28)
  const lost = (await drawn(page)).hostileMissiles[0]
  expect(lost).toMatchObject({ alias: 'missile-1', kind: 'stale' })
  expect(lost.radiusPx).toBeGreaterThan(0)
  await expect(page.locator('#plot-readout')).toContainText('Its aim is unknown.')

  await seek(page, 30)
  const detonated = await drawn(page)
  expect(detonated.ownMissiles).toEqual([])
  expect(detonated.effects).toEqual(['impact-missile'])
  await page.screenshot({ path: testInfo.outputPath('combat-missile-impact-1366x768.png') })

  // Back before the launch: the missile, the track and their marks are gone again.
  await seek(page, 10)
  expect(await drawn(page)).toMatchObject({ ownMissiles: [], hostileMissiles: [], effects: [] })
  await expect(page.locator('.event-item[data-kind="own-shot"]')).toHaveCount(1)
  expect(errors).toEqual([])
})

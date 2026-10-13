import { expect, test, type Page } from '@playwright/test'
import type { RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { HIDE_AND_SEEK, MISSION_SEED } from '../scenes/mission'

// Main App, accepted nine-turn seed-17 reference, real patrol AI. No fixture page/opponent override.
const phase = (page: Page) => page.locator('[aria-current="step"]')
const diagnostics = (page: Page) => page.evaluate(() => (window as unknown as { __plotDiagnostics: () => RendererDiagnostics }).__plotDiagnostics())
const radio = (page: Page, group: string, name: string) => page.getByRole('group', { name: group }).getByRole('radio', { name })
async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await diagnostics(page)).last?.tick).toBe(tick)
}
async function visibleResources(page: Page) {
  return page.getByRole('region', { name: 'Own ship', exact: true }).locator('.readouts > div').evaluateAll((rows) =>
    Object.fromEntries(rows.map((row) => [row.querySelector('dt')!.textContent, row.querySelector('dd')!.textContent])))
}
async function playMission(page: Page, mixed: boolean) {
  for (const [index, turn] of HIDE_AND_SEEK.entries()) {
    await expect(phase(page)).toHaveText('Planning')
    await radio(page, 'Cloak', turn.cloak ? 'On' : 'Off').check()
    if (turn.destination) {
      await page.getByLabel('Column', { exact: true }).fill(String(turn.destination.column))
      await page.getByLabel('Row', { exact: true }).fill(String(turn.destination.row))
      await page.getByLabel('Row', { exact: true }).press('Enter')
    } else await page.getByRole('button', { name: 'Hold position', exact: true }).click()
    await radio(page, 'Weapon', turn.laser ? 'Laser' : 'Hold fire').check()
    await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
    await expect(phase(page)).toHaveText('Execution')
    if (mixed) {
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await seek(page, index * 100 + 2)
      await page.getByRole('group', { name: 'Playback speed' }).getByRole('radio', { name: '4×' }).check()
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await expect.poll(async () => (await diagnostics(page)).last?.tick ?? 0).toBeGreaterThan(index * 100 + 3)
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await seek(page, index * 100 + 1)
      await expect(page.getByRole('region', { name: 'Encounter over' })).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Skip to end' }).click()
    if (index < HIDE_AND_SEEK.length - 1) await page.getByRole('button', { name: `Plan turn ${index + 2}` }).click()
  }
  await expect(page.getByTestId('outcome')).toHaveText('Defeat')
  await expect.poll(async () => (await diagnostics(page)).last?.tick).toBe(900)
  return { outcome: await page.getByTestId('outcome').textContent(), own: await visibleResources(page), plot: (await diagnostics(page)).last }
}

test('a full real-AI encounter repeats on the same page after restart with different playback choices', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' || /context lost|too many active webgl contexts/i.test(message.text())) errors.push(message.text()) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/?seed=${MISSION_SEED}`)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.getByRole('button', { name: 'Begin mission' }).click()
  const initial = await visibleResources(page)
  const first = await playMission(page, false)
  await page.screenshot({ path: testInfo.outputPath('first-ending-1366x768.png') })
  await page.getByRole('button', { name: 'Restart encounter' }).click()
  await expect(phase(page)).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.getByTestId('seed')).toHaveText(String(MISSION_SEED))
  expect(await visibleResources(page)).toEqual(initial)
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect(radio(page, 'Sensor', 'Passive')).toBeChecked()
  await expect(radio(page, 'Weapon', 'Hold fire')).toBeChecked()
  await expect(page.getByLabel('Playback position')).toHaveCount(0)
  await expect(page.locator('.event-item')).toHaveCount(0)
  await expect.poll(async () => (await diagnostics(page)).last?.tick).toBe(0)
  expect((await diagnostics(page)).last).toMatchObject({ contacts: [], ownMissiles: [], hostileMissiles: [], weaponPlan: null })
  await expect(page.locator('canvas')).toHaveCount(1)
  expect((await diagnostics(page)).live).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('same-seed-reset-1366x768.png') })
  const repeated = await playMission(page, true)
  expect(repeated).toEqual(first)
  expect((await diagnostics(page)).live).toBe(1)
  await expect(page.locator('canvas')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('repeated-ending-1366x768.png') })
  expect(errors).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'

// TSB-21 on the real engine and controller. Seed 17 with this route acquires the patrol at
// tick 94, loses it at 161 and forgets it at 760; holding cloak drains energy until upkeep
// fails at 799. Every number below is engine output observed through the public view.
const SEQUENCE = [{ column: 16, row: 10 }, { column: 2, row: 18 }, null, null, null, null, null, null] as const

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
const phase = (page: Page) => page.locator('[aria-current="step"]')
const readout = (page: Page) => page.locator('#plot-readout')
const assessment = (page: Page) => page.getByRole('region', { name: /^Turn \d+ assessment$/ })
const group = (page: Page, name: 'Sensor' | 'Cloak') => page.getByRole('group', { name })

async function playTurn(page: Page, index: number) {
  const cell = SEQUENCE[index]
  if (cell) {
    await page.getByLabel('Column').fill(String(cell.column))
    await page.getByLabel('Row').fill(String(cell.row))
    await page.getByLabel('Row').press('Enter')
    await expect(page.getByTestId('movement-order')).toHaveText(`Column ${cell.column}, row ${cell.row}`)
  } else {
    await page.getByRole('button', { name: 'Hold position', exact: true }).click()
    await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  }
  await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
  await expect(phase(page)).toHaveText('Execution')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(phase(page)).toHaveText('Assessment')
}

async function seek(page: Page, tick: number) {
  await page.getByLabel('Playback position').fill(String(tick))
  await expect.poll(async () => (await drawn(page)).tick).toBe(tick)
}

test('contact acquisition, loss and expiry, cloak upkeep failure and replay before first detection', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const errors = trackErrors(page)
  await page.goto('/?seed=17')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // Planning: passive and cloak on, with costs, nominal reach and no contacts.
  await expect(group(page, 'Sensor').getByRole('radio', { name: 'Passive' })).toBeChecked()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'On' })).toBeChecked()
  await expect(page.getByTestId('energy-plan')).toContainText('Up to 30.0')
  await expect(readout(page)).toContainText('No contacts.')
  await expect.poll(async () => (await drawn(page)).sensorRings.map((ring) => ring.kind)).toEqual(['passive'])
  expect((await drawn(page)).ownState).toBe('cloaked')

  // Turn 1: orders lock during execution; acquisition at 9.4 s.
  const first = SEQUENCE[0]
  await page.getByLabel('Column').fill(String(first.column))
  await page.getByLabel('Row').fill(String(first.row))
  await page.getByLabel('Row').press('Enter')
  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await expect(phase(page)).toHaveText('Execution')
  for (const radio of await page.locator('.segmented input[type="radio"]').all()) await expect(radio).toBeDisabled()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'On' })).toBeChecked()
  await expect(page.getByTestId('cloak-now')).toHaveText('Requested on. Cloak is on.')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(phase(page)).toHaveText('Assessment')
  await expect(assessment(page)).toContainText('contact-1 detected at 9.4 s.')
  await expect(readout(page).locator('[data-alias="contact-1"]')).toHaveAttribute('data-kind', 'current')
  await page.screenshot({ path: testInfo.outputPath('sensors-acquired-1366x768.png') })

  // Selection marks the plot; replay before tick 94 shows no contact, log entry or selection.
  await readout(page).getByRole('button', { name: /contact-1/ }).click()
  await expect(readout(page).getByRole('button', { name: /contact-1/ })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await drawn(page)).contacts.map(({ alias, selected }) => ({ alias, selected }))).toEqual([{ alias: 'contact-1', selected: true }])
  await page.getByRole('button', { name: 'Replay turn 1' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 93)
  await expect(readout(page)).toContainText('No contacts.')
  await expect(page.locator('.event-item[data-kind="contact-acquired"]')).toHaveCount(0)
  expect((await drawn(page)).contacts).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('sensors-replay-before-detection-1366x768.png') })
  await seek(page, 94)
  await expect(page.locator('.event-item[data-kind="contact-acquired"]')).toHaveCount(1)
  await expect.poll(async () => (await drawn(page)).contacts.map(({ kind, selected }) => ({ kind, selected }))).toEqual([{ kind: 'current', selected: true }])
  await page.getByRole('button', { name: 'Back to assessment' }).click()
  await page.getByRole('button', { name: 'Plan turn 2' }).click()

  // Turn 2: retreat south-west; the contact becomes an aged, uncertain last-known marker.
  await playTurn(page, 1)
  await expect(assessment(page)).toContainText('contact-1 lost at 6.1 s; now a last-known position.')
  const lost = (await drawn(page)).contacts[0]
  expect(lost).toMatchObject({ alias: 'contact-1', kind: 'stale', selected: true })
  expect(lost.radiusPx).toBeGreaterThan(0)
  expect(lost.label).toBe('contact-1 (last known, 4.0 s ago)')
  await expect(readout(page).locator('[data-alias="contact-1"]')).toContainText('Seen 4.0 s ago')
  await page.screenshot({ path: testInfo.outputPath('sensors-last-known-1366x768.png') })

  for (let index = 2; index < 7; index += 1) {
    await page.getByRole('button', { name: `Plan turn ${index + 1}` }).click()
    await playTurn(page, index)
  }

  // Turn 8 planning: 9.8 energy cannot carry a full turn of cloak upkeep.
  await page.getByRole('button', { name: 'Plan turn 8' }).click()
  await expect(page.getByTestId('energy-short')).toBeVisible()
  await playTurn(page, 7)
  await expect(assessment(page)).toContainText('Memory of contact-1 expired at 6.0 s.')
  await expect(assessment(page)).toContainText('Cloak failed: not enough energy (1 time).')
  await expect(assessment(page)).toContainText('Cloak stays off until you request it again when planning.')
  await expect(page.getByTestId('own-cloak')).toHaveText('Off, requested: no energy')
  await expect(readout(page)).toContainText('No contacts.')
  expect((await drawn(page)).ownState).toBe('plain')
  await page.screenshot({ path: testInfo.outputPath('sensors-expired-unfunded-1366x768.png') })

  // Replay of turn 8 still shows the last-known marker until the recorded expiry tick.
  await page.getByRole('button', { name: 'Replay turn 8' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 759)
  expect((await drawn(page)).contacts.map(({ kind }) => kind)).toEqual(['stale'])
  await seek(page, 760)
  expect((await drawn(page)).contacts).toEqual([])
  await page.getByRole('button', { name: 'Back to assessment' }).click()

  // Turn 9 planning: the draft carries the actual (off) cloak and asks for a fresh request.
  await page.getByRole('button', { name: 'Plan turn 9' }).click()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'Off' })).toBeChecked()
  await expect(page.getByText('Last turn cloak upkeep ran out of energy. Select On to request it again.')).toBeVisible()
  expect(errors).toEqual([])
})

test('cloak is ordered from the keyboard and its upkeep and signature follow the draft', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/?seed=17')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  const on = group(page, 'Cloak').getByRole('radio', { name: 'On' })
  await on.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'Off' })).toBeChecked()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'Off' })).toBeFocused()
  await expect(page.getByLabel('Uncloaked signature')).toContainText('7 cells passive, 10 by a pulse')
  await expect(page.getByTestId('energy-plan')).toContainText('None')

  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(phase(page)).toHaveText('Assessment')
  await expect(page.getByTestId('own-cloak')).toHaveText('Off')
  await expect(assessment(page)).toContainText('Energy +0.0 over the turn.')
  await page.getByRole('button', { name: 'Plan turn 2' }).click()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'Off' })).toBeChecked()
  expect((await drawn(page)).ownState).toBe('plain')
  expect(errors).toEqual([])
})

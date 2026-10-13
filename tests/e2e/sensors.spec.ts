import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'

// TSB-21 on the real engine and controller. The exact-tick scenes assume the former drill patrol,
// so they run on the test-only real-engine page with that scripted opponent (tests/harness/duel);
// the keyboard cloak check runs in the main game against the real patrol AI. Seed 17 with this route acquires the patrol at
// tick 94, loses it at 161 and forgets it at 760; holding cloak drains energy until upkeep
// fails at 799, and a pulse ordered on 9.8 energy fails at 701. Every number below is
// engine output observed through the public view.
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
  await page.goto('/tests/harness/duel/index.html?seed=17&opponent=scripted')
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

  // Turn 8 planning: 9.8 energy cannot carry a full turn of cloak upkeep, and a pulse is
  // forecast to fail. It stays a legal order.
  await page.getByRole('button', { name: 'Plan turn 8' }).click()
  await expect(page.getByTestId('energy-short')).toBeVisible()
  await group(page, 'Sensor').getByRole('radio', { name: 'Active pulse' }).check()
  const orders = page.getByRole('region', { name: 'Orders' })
  await expect(orders.locator('.issue[data-severity="conditional"]')).toContainText('Will fail')
  await expect(orders).toContainText('The pulse needs 12 energy on the first tick;')
  await expect(orders).toContainText('A successful scan or shot breaks cloak until a later turn.')
  await page.screenshot({ path: testInfo.outputPath('sensors-pulse-forecast-fail-1366x768.png') })
  await playTurn(page, 7)
  await expect(assessment(page)).toContainText('Active pulse failed on the first tick for lack of energy. It did not retry and did not expose you.')
  await expect(page.getByText('Active pulse failed: not enough energy, so no scan and no exposure.')).toBeVisible()
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
  await seek(page, 701)
  await expect(page.getByTestId('pulse-progress')).toHaveText('Pulse failed: not enough energy. No scan and no exposure.')
  await expect(page.getByTestId('own-exposure')).toHaveText('Not exposed')
  await expect(page.getByTestId('own-cloak')).toHaveText('On')
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

test('a keyboard-ordered pulse finds the patrol early, breaks cloak and exposes the ship, replayed at the cursor under reduced motion', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors = trackErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tests/harness/duel/index.html?seed=17&opponent=scripted')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // Turn 1 to column 10, row 12: passive sensing sees nothing yet.
  await page.getByLabel('Column').fill('10')
  await page.getByLabel('Row').fill('12')
  await page.getByLabel('Row').press('Enter')
  await page.getByRole('button', { name: 'Commit turn 1' }).click()
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(assessment(page)).toContainText('No contacts known at the end of the turn.')
  await page.getByRole('button', { name: 'Plan turn 2' }).click()

  // Turn 2 planning from the keyboard: hold, then arrow from Passive to Active pulse.
  await page.getByRole('button', { name: 'Hold position', exact: true }).click()
  await group(page, 'Sensor').getByRole('radio', { name: 'Passive' }).focus()
  await page.keyboard.press('ArrowRight')
  const pulse = group(page, 'Sensor').getByRole('radio', { name: 'Active pulse' })
  await expect(pulse).toBeChecked()
  await expect(pulse).toBeFocused()
  const orders = page.getByRole('region', { name: 'Orders' })
  await expect(page.getByLabel('Active pulse effects')).toContainText('12.0 energy, first tick only')
  await expect(page.getByLabel('Active pulse effects')).toContainText('3.0 s, seen within 12 cells')
  await expect(orders.locator('.issue[data-severity="warning"]')).toContainText('A successful scan or shot breaks cloak until a later turn.')
  await expect(page.getByTestId('energy-plan')).toContainText('Up to 42.0')
  await expect.poll(async () => (await drawn(page)).sensorRings.map((ring) => ring.kind)).toEqual(['passive', 'pulse-preview'])
  const outline = await pulse.evaluate((element) => getComputedStyle(element.nextElementSibling!).outlineStyle)
  expect(outline).not.toBe('none')
  await page.screenshot({ path: testInfo.outputPath('sensors-pulse-planning-keyboard-1366x768.png') })

  // Live playback under reduced motion snaps tick to tick; orders are locked.
  await page.getByRole('button', { name: 'Commit turn 2' }).click()
  await expect(phase(page)).toHaveText('Execution')
  await expect(pulse).toBeDisabled()
  await expect.poll(async () => (await drawn(page)).tick, { timeout: 5000 }).toBeGreaterThanOrEqual(105)
  expect((await drawn(page)).transition).toBe('snap')
  await page.screenshot({ path: testInfo.outputPath('sensors-pulse-live-reduced-motion-1366x768.png') })
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(phase(page)).toHaveText('Assessment')
  for (const line of [
    'Active pulse succeeded: tracking for 2.0 s, and your ship was exposed for 3.0 s.',
    'Your scan or shot broke cloak for the rest of the turn. Request it again when planning.',
    'contact-1 detected at 0.1 s.', 'contact-1 lost at 2.1 s; now a last-known position.', 'contact-1 detected at 2.6 s.',
  ]) await expect(assessment(page)).toContainText(line)
  await expect(page.getByText('Energy −12.0 (active pulse).')).toBeVisible()
  await expect(page.getByText('Cloak broken by your scan or shot; it stays off until you request it again.')).toBeVisible()

  // Replay: every readout follows the cursor, never the turn's end.
  await page.getByRole('button', { name: 'Replay turn 2' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()
  await seek(page, 100)
  await expect(readout(page)).toContainText('No contacts.')
  await expect(page.getByTestId('own-sensor')).toHaveText('Passive')
  await expect(page.getByTestId('own-cloak')).toHaveText('On')
  await expect(page.getByTestId('pulse-progress')).toHaveText('Pulse fires on the first tick of the turn.')
  await expect(page.locator('.event-item')).toHaveCount(0)
  expect(await drawn(page)).toMatchObject({ ownState: 'cloaked', contacts: [], sensorRings: [{ kind: 'passive' }] })

  await seek(page, 101)
  await expect(page.getByTestId('own-sensor')).toHaveText('Tracking, 2.0 s left')
  await expect(page.getByTestId('own-exposure')).toHaveText('Exposed, 3.0 s left')
  await expect(page.getByTestId('own-cloak')).toHaveText('Off, requested: broken')
  await expect(page.getByTestId('pulse-progress')).toHaveText('Pulse succeeded: tracking for 2.0 s more.')
  await expect(readout(page).locator('[data-alias="contact-1"]')).toHaveAttribute('data-kind', 'current')
  await expect(readout(page)).toContainText('10 cells (tracking)')
  expect(await drawn(page)).toMatchObject({ ownState: 'exposed', sensorRings: [{ kind: 'tracking' }], contacts: [{ alias: 'contact-1', kind: 'current' }] })
  await page.screenshot({ path: testInfo.outputPath('sensors-pulse-tracking-exposed-1366x768.png') })

  await seek(page, 121)
  await expect(page.getByTestId('own-sensor')).toHaveText('Passive')
  await expect(page.getByTestId('own-exposure')).toHaveText('Exposed, 1.0 s left')
  await expect(page.getByTestId('pulse-progress')).toHaveText('Pulse succeeded; tracking has ended.')
  expect(await drawn(page)).toMatchObject({ sensorRings: [{ kind: 'passive' }], contacts: [{ alias: 'contact-1', kind: 'stale' }] })
  await page.screenshot({ path: testInfo.outputPath('sensors-pulse-tracking-ended-1366x768.png') })
  await seek(page, 126)
  expect((await drawn(page)).contacts.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'contact-1', kind: 'current' }])
  await seek(page, 131)
  await expect(page.getByTestId('own-exposure')).toHaveText('Not exposed')
  expect((await drawn(page)).ownState).toBe('plain')
  await page.getByRole('button', { name: 'Back to assessment' }).click()

  // Turn 3: a fresh planning pulse is offered; the broken cloak needs a new request.
  await page.getByRole('button', { name: 'Plan turn 3' }).click()
  await expect(group(page, 'Sensor').getByRole('radio', { name: 'Passive' })).toBeChecked()
  await expect(pulse).toBeEnabled()
  await expect(group(page, 'Cloak').getByRole('radio', { name: 'Off' })).toBeChecked()
  await expect(page.getByText('Last turn your scan or shot broke cloak. Select On to request it again.')).toBeVisible()
  await group(page, 'Cloak').getByRole('radio', { name: 'On' }).check()
  await expect(page.getByTestId('energy-plan')).toContainText('Up to 30.0')
  expect(errors).toEqual([])
})

test('cloak is ordered from the keyboard and its upkeep and signature follow the draft', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/?seed=17')
  await page.getByRole('button', { name: 'Begin mission' }).click()
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

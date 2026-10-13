import { expect, test, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { HIDE_AND_SEEK, MISSION_SEED } from '../scenes/mission'

// TSB-50: the MAIN game (real engine + patrol AI) on touch phones, portrait and landscape.
// Everything is done by tapping: no hover, no physical keyboard.
const PHONES = [
  { name: 'portrait 390x844', viewport: { width: 390, height: 844 } },
  { name: 'portrait 360x800', viewport: { width: 360, height: 800 } },
  { name: 'landscape 844x390', viewport: { width: 844, height: 390 } },
] as const

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /too many active webgl contexts|context lost/i.test(message.text())) errors.push(message.text())
  })
  return errors
}
const drawn = async (page: Page): Promise<DrawSummary> => {
  const last = (await page.evaluate(() => (window as unknown as { __plotDiagnostics: () => RendererDiagnostics }).__plotDiagnostics())).last
  if (!last) throw new Error('Nothing drawn yet')
  return last
}
async function tapCell(page: Page, column: number, row: number) {
  const { origin, cellPx } = await drawn(page)
  const canvas = page.locator('.battlefield-canvas canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.touchscreen.tap(box.x + origin.x + (column + 0.5) * cellPx, box.y + origin.y + (row + 0.5) * cellPx)
}
const option = (page: Page, group: string, name: string) => page.getByRole('group', { name: group }).getByRole('radio', { name })
const tab = (page: Page, name: 'Orders' | 'Ship' | 'Log') => page.getByRole('tab', { name })
const phase = (page: Page) => page.locator('[aria-current="step"]')

async function expectNoHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
}
async function expectTouchSized(page: Page, names: readonly string[]) {
  for (const name of names) {
    const box = await page.getByRole('button', { name, exact: true }).first().boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.height, `${name} touch height`).toBeGreaterThanOrEqual(43.5)
  }
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

    test('an intentional phone layout: status strip, square plot, playback, panel tabs and a pinned commit', async ({ page }, testInfo) => {
      const errors = trackErrors(page)
      await page.goto(`/?seed=${MISSION_SEED}`)
      await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: testInfo.outputPath(`phone-briefing-${phone.viewport.width}x${phone.viewport.height}.png`) })
      await page.getByRole('button', { name: 'Begin mission' }).tap()
      await expectNoHorizontalScroll(page)

      const plot = (await page.locator('.deck-plot').boundingBox())!
      expect(plot.width).toBeGreaterThan(Math.min(phone.viewport.width, phone.viewport.height) * 0.7)
      expect(plot.x).toBeGreaterThanOrEqual(0)
      expect(plot.x + plot.width).toBeLessThanOrEqual(phone.viewport.width)
      await expect(page.locator('.deck-hud')).toBeVisible()
      await expect(page.locator('.deck-hud [data-resource="hull"]')).toContainText('100 / 100')
      await expect(page.locator('canvas')).toHaveCount(1)

      // Tabs switch one set of panels; Commit Turn stays reachable from every tab.
      await expect(tab(page, 'Orders')).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('region', { name: 'Orders' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Own ship', exact: true })).toBeHidden()
      await tab(page, 'Ship').tap()
      await expect(page.getByRole('region', { name: 'Own ship', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Orders' })).toBeHidden()
      await tab(page, 'Log').tap()
      await expect(page.getByRole('region', { name: 'Event log' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Commit turn 1' })).toBeInViewport()
      await tab(page, 'Orders').tap()
      await expect(page.getByLabel('Column', { exact: true })).toHaveCount(1)

      await expectTouchSized(page, ['Commit turn 1', 'Orders', 'Ship', 'Log', 'Play', 'Skip to end', 'Briefing', 'Restart'])
      for (const name of ['Copy seed link', 'Briefing', 'Abandon', 'Restart']) {
        const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
        expect(box.x, name).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, name).toBeLessThanOrEqual(phone.viewport.width)
      }
      await page.screenshot({ path: testInfo.outputPath(`phone-planning-${phone.viewport.width}x${phone.viewport.height}.png`) })
      expect(errors).toEqual([])
    })
  })
}

test.describe('touch-only mission', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })

  test('course, sensor, cloak, weapon, commit, playback, assessment, outcome, replay and restart by tapping only', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors = trackErrors(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/?seed=${MISSION_SEED}`)
    await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
    await page.getByRole('button', { name: 'Begin mission' }).tap()

    for (const [index, turn] of HIDE_AND_SEEK.entries()) {
      const number = index + 1
      if (number === 1) {
        // Sensor by touch: choose a pulse, then go back to passive (this turn stays passive).
        await option(page, 'Sensor', 'Active pulse').tap()
        await expect(option(page, 'Sensor', 'Active pulse')).toBeChecked()
        await option(page, 'Sensor', 'Passive').tap()
      }
      await option(page, 'Cloak', turn.cloak ? 'On' : 'Off').tap()
      if (turn.destination) await tapCell(page, turn.destination.column, turn.destination.row)
      else await page.getByRole('button', { name: 'Hold position', exact: true }).tap()
      if (turn.destination) await expect(page.getByTestId('movement-order')).toHaveText(`Column ${turn.destination.column}, row ${turn.destination.row}`)
      await option(page, 'Weapon', turn.laser ? 'Laser' : 'Hold fire').tap()
      if (turn.laser) await expect(page.getByRole('radio', { name: /^contact-1, / })).toBeChecked()
      await page.getByRole('button', { name: `Commit turn ${number}` }).tap()
      await expect(phase(page)).toHaveText('Execution')
      if (number === 2) {
        await page.getByRole('button', { name: 'Pause' }).tap()
        await page.getByLabel('Playback position').fill('101')
        await expect(page.getByTestId('combat-feed')).toContainText('Laser hit contact-1.')
        await expect(page.getByTestId('combat-feed')).toContainText('Hit: −35 shields')
        await expect(page.locator('.deck-hud [data-testid="lost-shields"]')).toHaveText(' −35')
        await page.screenshot({ path: testInfo.outputPath('phone-exchange-390x844.png') })
      }
      if (number === HIDE_AND_SEEK.length) break
      await page.getByRole('button', { name: 'Skip to end' }).tap()
      await expect(phase(page)).toHaveText('Assessment')
      await expect(tab(page, 'Orders')).toHaveAttribute('aria-selected', 'true')
      if (number === 2) {
        await expect(page.getByTestId('combat-summary')).toContainText('Laser hit contact-1.')
        await expect(page.getByTestId('damage-taken')).toContainText('Damage taken: 35 shields, 0 hull')
        await page.screenshot({ path: testInfo.outputPath('phone-assessment-390x844.png') })
      }
      await page.getByRole('button', { name: `Plan turn ${number + 1}` }).tap()
    }

    await page.getByRole('button', { name: 'Skip to end' }).tap()
    await expect(page.getByTestId('outcome')).toHaveText('Defeat')
    await expect(page.getByTestId('combat-summary')).toContainText('Shadow-Dancer destroyed.')
    await page.screenshot({ path: testInfo.outputPath('phone-defeat-390x844.png') })
    await page.getByRole('button', { name: 'Replay final turn' }).tap()
    await expect(page.getByRole('region', { name: 'Replaying the final turn' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to result' }).tap()
    await page.getByRole('button', { name: 'Restart encounter' }).tap()
    await expect(phase(page)).toHaveText('Planning')
    await expect(page.getByTestId('turn-number')).toHaveText('1')
    await expect(page.locator('canvas')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

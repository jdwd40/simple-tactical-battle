// Exact contact timings assume the former drill patrol: runs on the test-only real-engine page
// (tests/harness/duel) with that scripted opponent.
import { expect, test } from '@playwright/test'
import type { RendererDiagnostics } from '../../src/rendering/BattlefieldRenderer'
import { LIFECYCLE_SEQUENCE } from '../../src/tests/game/lifecycleSequence'

const diagnostics = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __plotDiagnostics: () => RendererDiagnostics }).__plotDiagnostics())

test('restart after acquired/lost contacts clears markers, trail and log with one live renderer', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' || /context lost|too many active webgl contexts/i.test(message.text())) errors.push(message.text()) })
  await page.goto('/tests/harness/duel/index.html?seed=17&opponent=scripted')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  for (const [index, movement] of LIFECYCLE_SEQUENCE.entries()) {
    if (movement.kind !== 'destination') throw new Error('Contact-history fixture needs a destination')
    await page.getByLabel('Column').fill(String(movement.cell.column))
    await page.getByLabel('Row').fill(String(movement.cell.row))
    await page.getByLabel('Row').press('Enter')
    await page.getByRole('button', { name: `Commit turn ${index + 1}` }).click()
    await page.getByRole('button', { name: 'Skip to end' }).click()
    await expect(page.locator('[aria-current="step"]')).toHaveText('Assessment')
    if (index === 0) {
      await expect(page.locator('.event-item[data-kind="contact-acquired"]')).not.toHaveCount(0)
    }
    if (index < LIFECYCLE_SEQUENCE.length - 1) await page.getByRole('button', { name: `Plan turn ${index + 2}` }).click()
  }
  await expect(page.locator('.event-item[data-kind="contact-lost"]')).not.toHaveCount(0)
  await expect.poll(async () => (await diagnostics(page)).last?.contacts.some((contact) => contact.kind === 'stale')).toBe(true)
  expect((await diagnostics(page)).last!.trailPoints).toBeGreaterThan(10)
  await page.screenshot({ path: testInfo.outputPath('contact-history-before-restart.png') })
  const encounter = await page.locator('.battlefield-canvas').getAttribute('data-encounter')
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(page.locator('.battlefield-canvas')).not.toHaveAttribute('data-encounter', encounter!)
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await expect(page.locator('[aria-current="step"]')).toHaveText('Planning')
  await expect(page.getByTestId('turn-number')).toHaveText('1')
  await expect(page.getByTestId('movement-order')).toHaveText('Hold position')
  await expect(page.locator('#plot-readout')).toContainText('No contacts.')
  await expect(page.locator('.event-item')).toHaveCount(0)
  await expect.poll(async () => (await diagnostics(page)).last).toMatchObject({ tick: 0, contacts: [], trailPoints: 1, plan: 'hold' })
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect.poll(async () => {
    const state = await diagnostics(page)
    return { live: state.live, remaining: state.created - state.destroyed }
  }).toEqual({ live: 1, remaining: 1 })
  await page.screenshot({ path: testInfo.outputPath('contact-history-cleared.png') })
  expect(errors).toEqual([])
})

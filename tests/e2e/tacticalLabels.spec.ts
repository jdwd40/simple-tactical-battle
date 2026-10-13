import { expect, test } from '@playwright/test'
import { expectReadableLabels } from './support/labels'

// TSB-50: label placement and uncertainty on the crowded public-fixture frame (no engine).
test('crowded markers at the map edge keep every label readable, and a large uncertainty area is outline only', async ({ page }, testInfo) => {
  await page.goto('/tests/fixtures/combat/index.html?scene=crowded')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(async () => (await page.evaluate(() => window.__plotDiagnostics())).last?.labels.length ?? 0).toBeGreaterThanOrEqual(9)
  const summary = await expectReadableLabels(page, 'crowded fixture')
  expect(summary.labels.map((label) => label.key).sort()).toEqual(expect.arrayContaining([
    'contact:contact-1', 'contact:contact-2', 'contact:contact-3', 'destination', 'hostile-missile:missile-1', 'missile-aim', 'nominal', 'own-missile:own-missile-2', 'own-state',
  ]))
  // Current versus last known stays readable in text, not colour alone.
  expect(summary.contacts.map(({ alias, label }) => [alias, label])).toEqual([
    ['contact-1', 'contact-1 (current)'], ['contact-2', 'contact-2 (last known, 30.0 s ago)'], ['contact-3', 'contact-3 (last known, 1.5 s ago)'],
  ])
  const byAlias = Object.fromEntries(summary.contacts.map((contact) => [contact.alias, contact]))
  expect(byAlias['contact-2']).toMatchObject({ kind: 'stale', filled: false })
  expect(byAlias['contact-2'].radiusPx).toBeGreaterThan(summary.cellPx * 10)
  expect(byAlias['contact-3']).toMatchObject({ kind: 'stale', filled: true })
  await page.screenshot({ path: testInfo.outputPath('labels-crowded-edge-1366x768.png') })
})

import { expect, test } from '@playwright/test'
import { expectReadableLabels } from './support/labels'

// TSB-50: label placement and uncertainty on the crowded public-fixture frame (no engine).
test('crowded markers at the map edge keep every label readable, and a large uncertainty area is outline only', async ({ page }, testInfo) => {
  await page.goto('/tests/fixtures/combat/index.html?scene=crowded')
  await expect(page.locator('.battlefield-canvas[data-ready="true"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(async () => (await page.evaluate(() => window.__plotDiagnostics())).last?.labels.length ?? 0).toBeGreaterThanOrEqual(9)
  const summary = await expectReadableLabels(page, 'crowded fixture')
  // Every label naming a ship, contact, missile, the own state or the course is placed.
  const keys = summary.labels.map((label) => label.key)
  expect(keys).toEqual(expect.arrayContaining([
    'contact:contact-1', 'contact:contact-2', 'contact:contact-3', 'destination', 'hostile-missile:missile-1', 'own-missile:own-missile-2', 'own-state',
  ]))
  // Supplementary labels may be left out when nothing is clear; their information stays in the orders panel.
  expect(keys.filter((key) => !/^(contact|hostile-missile|own-missile):|^(destination|own-state)$/.test(key)).every((key) => ['nominal', 'missile-aim', 'laser-range', 'laser-target'].includes(key) || key.startsWith('ring:'))).toBe(true)
  await expect(page.getByText('Column 19, row 10 (predicted)')).toBeVisible()
  await expect(page.getByTestId('missile-aim')).toContainText('Aimed at column 17, row 9.')
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

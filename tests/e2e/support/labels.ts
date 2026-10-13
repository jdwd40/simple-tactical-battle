import { expect, type Page } from '@playwright/test'
import type { DrawSummary, RendererDiagnostics } from '../../../src/rendering/BattlefieldRenderer'

// TSB-50 readability check on the drawn plot: every tactical label inside the map, no two
// labels overlapping, and no label covering a ship, contact or missile marker.
const drawnSummary = async (page: Page): Promise<DrawSummary> => {
  const summary = (await page.evaluate(() => (window as unknown as { __plotDiagnostics: () => RendererDiagnostics }).__plotDiagnostics())).last
  if (!summary) throw new Error('Nothing drawn yet')
  return summary
}

export async function expectReadableLabels(page: Page, context: string) {
  const summary = await drawnSummary(page)
  const map = { left: summary.origin.x, top: summary.origin.y, right: summary.origin.x + 20 * summary.cellPx, bottom: summary.origin.y + 20 * summary.cellPx }
  const markers = [summary.ownShip, ...summary.contacts.map((contact) => contact.at), ...summary.ownMissiles.map((missile) => missile.at), ...summary.hostileMissiles.map((missile) => missile.at)]
  const problems: string[] = []
  for (const [index, { key, rect }] of summary.labels.entries()) {
    if (rect.left < map.left - 1 || rect.top < map.top - 1 || rect.right > map.right + 1 || rect.bottom > map.bottom + 1) problems.push(`${key} leaves the map`)
    for (const other of summary.labels.slice(index + 1)) {
      const overlap = Math.max(0, Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left)) * Math.max(0, Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top))
      if (overlap > 1) problems.push(`${key} overlaps ${other.key}`)
    }
    for (const marker of markers) {
      if (marker.x > rect.left && marker.x < rect.right && marker.y > rect.top && marker.y < rect.bottom) problems.push(`${key} covers a marker at ${Math.round(marker.x)},${Math.round(marker.y)}`)
    }
  }
  expect(problems, `${context}: ${summary.labels.map((label) => label.text).join(' / ')}`).toEqual([])
  return summary
}

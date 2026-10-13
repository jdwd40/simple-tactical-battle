import { describe, expect, it } from 'vitest'
import { layoutLabels, overlapArea, rectAt, spotsAround, type LabelRequest, type Rect } from './labelLayout'

const bounds: Rect = { left: 0, top: 0, right: 600, bottom: 600 }
const label = (key: string, x: number, y: number, priority: number, width = 90): LabelRequest => {
  const { spots, nearSpots } = spotsAround(x, y, 8)
  return { key, width, height: 16, priority, spots, nearSpots, marker: { x, y } }
}
const marker = (x: number, y: number, half = 8): Rect => ({ left: x - half, top: y - half, right: x + half, bottom: y + half })

describe('tactical label layout', () => {
  it('keeps the preferred spot when nothing is in the way', () => {
    const [placed] = layoutLabels([label('contact', 200, 200, 80)], [marker(200, 200)], bounds)
    expect(placed.spot).toMatchObject({ x: 213, y: 200, anchorX: 0 })
    expect(placed).toMatchObject({ overlap: 0, displaced: false })
  })

  it('flips a label inward at the map edge instead of clipping it', () => {
    const [placed] = layoutLabels([label('contact', 590, 300, 80)], [marker(590, 300)], bounds)
    expect(placed.rect.right).toBeLessThanOrEqual(bounds.right)
    expect(placed.spot.anchorX).toBe(1)
    expect(placed.overlap).toBe(0)
  })

  it('separates labels of markers that share a cell, by priority, never stacking text or covering markers', () => {
    const requests = [label('destination', 300, 300, 60), label('contact', 302, 298, 80), label('own-state', 300, 304, 90, 60)]
    const markers = [marker(300, 300), marker(302, 298), marker(300, 304, 12)]
    const placed = layoutLabels(requests, markers, bounds)
    expect(placed.map((entry) => entry.key)).toEqual(['own-state', 'contact', 'destination'])
    for (const [index, a] of placed.entries()) {
      expect(a.overlap).toBe(0)
      for (const b of placed.slice(index + 1)) expect(overlapArea(a.rect, b.rect)).toBe(0)
      for (const m of markers) expect(overlapArea(a.rect, m)).toBe(0)
      expect(overlapArea(a.rect, bounds)).toBe((a.rect.right - a.rect.left) * (a.rect.bottom - a.rect.top))
    }
  })

  it('moves a crowded label further out and marks it for a leader line', () => {
    const many = Array.from({ length: 9 }, (_, index) => label(`l${index}`, 300, 300, 100 - index, 70))
    const placed = layoutLabels(many, [marker(300, 300)], bounds)
    expect(placed.filter((entry) => entry.displaced).length).toBeGreaterThan(0)
    expect(placed.filter((entry) => entry.overlap === 0).length).toBeGreaterThanOrEqual(6)
    // Never two labels on the same rectangle, even when space runs out.
    expect(new Set(placed.map((entry) => `${entry.rect.left},${entry.rect.top}`)).size).toBe(placed.length)
  })

  it('leaves out a supplementary label with no clear spot instead of overlapping', () => {
    const blocked = { key: 'note', width: 400, height: 16, priority: 10, spots: [{ x: 300, y: 300, anchorX: 0, anchorY: 0.5 }], optional: true }
    expect(layoutLabels([label('contact', 300, 300, 80), blocked], [marker(300, 300)], bounds).map((entry) => entry.key)).toEqual(['contact'])
  })

  it('anchors rectangles from the text anchor', () => {
    expect(rectAt({ x: 100, y: 50, anchorX: 1, anchorY: 0.5 }, 40, 10)).toEqual({ left: 60, top: 45, right: 100, bottom: 55 })
  })
})

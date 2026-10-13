import { describe, expect, it } from 'vitest'
import { dashCircle, dashPolyline } from './dashes'

const length = (segments: ReturnType<typeof dashPolyline>) => segments.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)

describe('dash helpers', () => {
  it('dashes a straight line in the requested proportion', () => {
    const segments = dashPolyline([{ x: 0, y: 0 }, { x: 110, y: 0 }], 6, 5)
    expect(segments).toHaveLength(10)
    expect(length(segments)).toBeCloseTo(60)
  })

  it('continues the pattern across a corner instead of restarting it', () => {
    // 22px path, period 11: dashes cover 0-6 and 11-17 (12px). Restarting at the corner would give 6 + 9 = 15px.
    const corner = dashPolyline([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 14 }], 6, 5)
    expect(length(corner)).toBeCloseTo(12)
  })

  it('splits a circle into evenly spaced arcs', () => {
    const arcs = dashCircle(40, 5, 6)
    expect(arcs.length).toBeGreaterThanOrEqual(4)
    expect(arcs[1][0] - arcs[0][0]).toBeCloseTo((2 * Math.PI) / arcs.length)
  })
})

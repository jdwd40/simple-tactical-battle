import type { ScreenPoint } from './plotGeometry'

export type Segment = readonly [ScreenPoint, ScreenPoint]

/** Split a screen-space polyline into dash segments, continuing the pattern across vertices. */
export function dashPolyline(points: readonly ScreenPoint[], dash: number, gap: number): Segment[] {
  const segments: Segment[] = []
  const period = dash + gap
  let phase = 0
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (length === 0) continue
    const at = (distance: number): ScreenPoint => ({
      x: start.x + ((end.x - start.x) * distance) / length,
      y: start.y + ((end.y - start.y) * distance) / length,
    })
    let travelled = 0
    while (travelled < length) {
      const inDash = phase < dash
      const step = Math.min(length - travelled, (inDash ? dash : period) - phase)
      if (inDash) segments.push([at(travelled), at(travelled + step)])
      travelled += step
      phase = (phase + step) % period
    }
  }
  return segments
}

/** Arc angle pairs for a dashed circle with an even number of dashes sized close to `dash` pixels. */
export function dashCircle(radius: number, dash: number, gap: number): Array<readonly [number, number]> {
  const circumference = 2 * Math.PI * radius
  const count = Math.max(4, Math.floor(circumference / (dash + gap)))
  const step = (2 * Math.PI) / count
  const dashAngle = step * (dash / (dash + gap))
  return Array.from({ length: count }, (_, index) => [index * step, index * step + dashAngle] as const)
}

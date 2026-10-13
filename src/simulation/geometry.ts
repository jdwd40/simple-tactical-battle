import type { Cell, HeadingMilliDegrees, Position, PublicMap, Ruleset } from '../contracts/public'

// Integer world geometry. Decisions use exact integer (or BigInt) comparisons so that
// results never depend on engine-specific rounding of transcendental functions.

interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

export function floorSqrt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('floorSqrt requires a safe nonnegative integer')
  let root = Math.floor(Math.sqrt(value))
  while (root * root > value) root -= 1
  while ((root + 1) * (root + 1) <= value) root += 1
  return root
}
export function ceilSqrt(value: number): number {
  const root = floorSqrt(value)
  return root * root === value ? root : root + 1
}
/** Euclidean distance rounded to the nearest integer unit: 1000 cardinal, 1414 diagonal between centres. */
export function distanceUnits(a: Position, b: Position): number {
  const squared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  const root = floorSqrt(squared)
  return squared - root * root > root ? root + 1 : root
}
/** Exact inclusive range test in integer units (no square-root rounding). */
export function withinRange(a: Position, b: Position, rangeUnits: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy <= rangeUnits * rangeUnits
}
export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}
/** Point `along` units from a towards b; truncation keeps it on the segment and is recomputed from a, so no drift. */
export function interpolate(a: Position, b: Position, along: number, length: number): Position {
  return { x: a.x + Math.trunc(((b.x - a.x) * along) / length), y: a.y + Math.trunc(((b.y - a.y) * along) / length) }
}
/** Clockwise milli-degrees from north (rows/y increase south). Null for a zero vector. */
export function headingOf(from: Position, to: Position): HeadingMilliDegrees | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return null
  if (dx === 0) return dy < 0 ? 0 : 180_000
  if (dy === 0) return dx > 0 ? 90_000 : 270_000
  if (Math.abs(dx) === Math.abs(dy)) {
    if (dx > 0) return dy < 0 ? 45_000 : 135_000
    return dy > 0 ? 225_000 : 315_000
  }
  // Grid routes only produce the eight exact directions above; this fallback is not reached by them.
  const milli = Math.round((Math.atan2(dx, -dy) * 180_000) / Math.PI)
  return (milli + 360_000) % 360_000
}
export function cellOf(position: Position, rules: Ruleset): Cell {
  const units = rules.geometry.unitsPerCell
  return { column: Math.floor(position.x / units), row: Math.floor(position.y / units) }
}

function asteroidRects(map: PublicMap, rules: Ruleset): Rect[] {
  const units = rules.geometry.unitsPerCell
  return map.asteroidCells.map(({ column, row }) => ({
    x0: column * units, y0: row * units, x1: (column + 1) * units, y1: (row + 1) * units,
  }))
}
/** Exact Liang–Barsky test against a closed rectangle using rational comparisons. */
function segmentTouchesRect(a: Position, b: Position, rect: Rect): boolean {
  let enterN = 0
  let enterD = 1
  let exitN = 1
  let exitD = 1
  const axes = [[a.x, b.x - a.x, rect.x0, rect.x1], [a.y, b.y - a.y, rect.y0, rect.y1]] as const
  for (const [start, delta, low, high] of axes) {
    if (delta === 0) {
      if (start < low || start > high) return false
      continue
    }
    const [n0, n1, denominator] = delta > 0 ? [low - start, high - start, delta] : [start - high, start - low, -delta]
    if (n0 * enterD > enterN * denominator) { enterN = n0; enterD = denominator }
    if (n1 * exitD < exitN * denominator) { exitN = n1; exitD = denominator }
  }
  return enterN * exitD <= exitN * enterD
}
function pointRectDistanceSquared(p: Position, rect: Rect): number {
  const dx = Math.max(rect.x0 - p.x, 0, p.x - rect.x1)
  const dy = Math.max(rect.y0 - p.y, 0, p.y - rect.y1)
  return dx * dx + dy * dy
}
/** True when p lies strictly closer than radius to segment ab. */
function pointNearSegment(p: Position, a: Position, b: Position, radius: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const px = p.x - a.x
  const py = p.y - a.y
  const radiusSquared = radius * radius
  const lengthSquared = dx * dx + dy * dy
  const dot = px * dx + py * dy
  if (lengthSquared === 0 || dot <= 0) return px * px + py * py < radiusSquared
  if (dot >= lengthSquared) return (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < radiusSquared
  const cross = BigInt(px * dy - py * dx)
  return cross * cross < BigInt(radiusSquared) * BigInt(lengthSquared)
}
/** A circle of `radius` swept from a to b overlaps the rectangle (touching is allowed). */
function sweepOverlapsRect(a: Position, b: Position, radius: number, rect: Rect): boolean {
  if (segmentTouchesRect(a, b, rect)) return true
  const radiusSquared = radius * radius
  if (pointRectDistanceSquared(a, rect) < radiusSquared || pointRectDistanceSquared(b, rect) < radiusSquared) return true
  const corners = [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x0, y: rect.y1 }, { x: rect.x1, y: rect.y1 }]
  return corners.some((corner) => pointNearSegment(corner, a, b, radius))
}

/** Asteroid cells are closed solid rectangles; a sightline touching one is blocked. */
export function hasLineOfSight(a: Position, b: Position, map: PublicMap, rules: Ruleset): boolean {
  return asteroidRects(map, rules).every((rect) => !segmentTouchesRect(a, b, rect))
}
/** Swept circle stays inside the arena and does not overlap an asteroid along a→b. */
export function sweepClear(a: Position, b: Position, radius: number, map: PublicMap, rules: Ruleset): boolean {
  const width = map.columns * rules.geometry.unitsPerCell
  const height = map.rows * rules.geometry.unitsPerCell
  const inside = (p: Position) => p.x >= radius && p.y >= radius && p.x <= width - radius && p.y <= height - radius
  if (!inside(a) || !inside(b)) return false
  return asteroidRects(map, rules).every((rect) => !sweepOverlapsRect(a, b, radius, rect))
}
/** Furthest integer point along a→b whose sweep from a is clear; a itself when nothing is. */
export function lastSafePoint(a: Position, b: Position, radius: number, map: PublicMap, rules: Ruleset): Position {
  if (sweepClear(a, b, radius, map, rules)) return b
  const length = distanceUnits(a, b)
  let safe = 0
  let blocked = length
  while (blocked - safe > 1) {
    const middle = Math.floor((safe + blocked) / 2)
    if (sweepClear(a, interpolate(a, b, middle, length), radius, map, rules)) safe = middle
    else blocked = middle
  }
  return interpolate(a, b, safe, length)
}

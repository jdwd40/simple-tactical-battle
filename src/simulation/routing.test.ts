import { describe, expect, it } from 'vitest'
import type { PublicMap } from '../contracts/public'
import { DUEL_MAP, DUEL_RULES } from '../scenarios/public'
import { distanceUnits, floorSqrt, hasLineOfSight, headingOf, lastSafePoint, sweepClear } from './geometry'
import { findPath } from './pathfinding'
import { advanceRoute, buildRoute, routePosition } from './route'
import { deriveStream, nextRandom } from './random'

const cells = (path: ReturnType<typeof findPath>) => path?.map(({ column, row }) => [column, row])
const OPEN: PublicMap = { columns: 20, rows: 20, asteroidCells: [] }

describe('octile A* routing', () => {
  it('routes straight along a free row', () => {
    expect(cells(findPath({ column: 3, row: 10 }, { column: 8, row: 10 }, DUEL_MAP, DUEL_RULES)))
      .toEqual([[3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [8, 10]])
  })
  it('breaks equal-cost ties by (f, h, row, column) and N,E,S,W,NE,SE,SW,NW enumeration', () => {
    // E+SE and SE+E both cost 2414; the SE node has the lower h and is expanded first.
    expect(cells(findPath({ column: 5, row: 5 }, { column: 7, row: 6 }, OPEN, DUEL_RULES))).toEqual([[5, 5], [6, 6], [7, 6]])
    expect(cells(findPath({ column: 5, row: 5 }, { column: 7, row: 6 }, OPEN, DUEL_RULES)))
      .toEqual(cells(findPath({ column: 5, row: 5 }, { column: 7, row: 6 }, OPEN, DUEL_RULES)))
  })
  it('never cuts an asteroid corner diagonally', () => {
    // (8,4) -> (9,5) diagonal would clip asteroid (8,5); the route goes round via (9,4).
    expect(cells(findPath({ column: 8, row: 4 }, { column: 9, row: 5 }, DUEL_MAP, DUEL_RULES))).toEqual([[8, 4], [9, 4], [9, 5]])
  })
  it('treats a cell sealed except for diagonal gaps as unreachable, and rejects blocked/outside cells', () => {
    const sealed: PublicMap = { columns: 5, rows: 5, asteroidCells: [{ column: 1, row: 0 }, { column: 0, row: 1 }, { column: 2, row: 1 }, { column: 1, row: 2 }] }
    expect(findPath({ column: 3, row: 3 }, { column: 1, row: 1 }, sealed, DUEL_RULES)).toBeNull()
    expect(findPath({ column: 3, row: 10 }, { column: 7, row: 4 }, DUEL_MAP, DUEL_RULES)).toBeNull()
    expect(findPath({ column: 3, row: 10 }, { column: 20, row: 4 }, DUEL_MAP, DUEL_RULES)).toBeNull()
  })
  it('routes around an asteroid cluster with an optimal octile cost', () => {
    const path = findPath({ column: 6, row: 5 }, { column: 9, row: 5 }, DUEL_MAP, DUEL_RULES)
    expect(path).not.toBeNull()
    expect(path?.some((cell) => DUEL_MAP.asteroidCells.some((rock) => rock.column === cell.column && rock.row === cell.row))).toBe(false)
    // Both diagonals into/out of row 6 would clip asteroids (7,5)/(8,5), so the detour is all cardinal.
    expect(cells(path)).toEqual([[6, 5], [6, 6], [7, 6], [8, 6], [9, 6], [9, 5]])
    const route = buildRoute({ x: 6500, y: 5500 }, { column: 9, row: 5 }, DUEL_MAP, DUEL_RULES)
    expect(route?.remainingDistanceUnits).toBe(5000)
  })
})

describe('integer geometry and sweeps', () => {
  it('uses exact integer distances matching route costs', () => {
    expect(distanceUnits({ x: 500, y: 500 }, { x: 1500, y: 500 })).toBe(1000)
    expect(distanceUnits({ x: 500, y: 500 }, { x: 1500, y: 1500 })).toBe(1414)
    expect(floorSqrt(4_000_000_000_000)).toBe(2_000_000)
    expect(floorSqrt(4_000_000_000_000 - 1)).toBe(1_999_999)
  })
  it('reports compass headings clockwise from north with rows increasing south', () => {
    const o = { x: 1000, y: 1000 }
    expect([[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dy]) => headingOf(o, { x: 1000 + dx * 7, y: 1000 + dy * 7 })))
      .toEqual([0, 45_000, 90_000, 135_000, 180_000, 225_000, 270_000, 315_000])
    expect(headingOf(o, o)).toBeNull()
  })
  it('stops a swept ship circle at the last safe point before an asteroid', () => {
    // Asteroid (7,4) spans x 7000..8000; a 250-unit circle on y=4500 must stop at x=6750.
    expect(lastSafePoint({ x: 5500, y: 4500 }, { x: 9500, y: 4500 }, 250, DUEL_MAP, DUEL_RULES)).toEqual({ x: 6750, y: 4500 })
    expect(sweepClear({ x: 5500, y: 4500 }, { x: 6750, y: 4500 }, 250, DUEL_MAP, DUEL_RULES)).toBe(true)
    expect(sweepClear({ x: 5500, y: 4500 }, { x: 6751, y: 4500 }, 250, DUEL_MAP, DUEL_RULES)).toBe(false)
    expect(sweepClear({ x: 249, y: 500 }, { x: 500, y: 500 }, 250, OPEN, DUEL_RULES)).toBe(false)
  })
  it('blocks sightlines through or touching closed asteroid rectangles', () => {
    expect(hasLineOfSight({ x: 3500, y: 10_500 }, { x: 16_500, y: 10_500 }, DUEL_MAP, DUEL_RULES)).toBe(true)
    expect(hasLineOfSight({ x: 6500, y: 4500 }, { x: 9500, y: 4500 }, DUEL_MAP, DUEL_RULES)).toBe(false)
    // Passes exactly through the (7000,4000) corner of asteroid (7,4).
    expect(hasLineOfSight({ x: 6000, y: 3000 }, { x: 8000, y: 5000 }, { columns: 20, rows: 20, asteroidCells: [{ column: 7, row: 4 }] }, DUEL_RULES)).toBe(false)
  })
  it('advances fixed-point progress without cumulative drift across diagonal segments', () => {
    const route = buildRoute({ x: 500, y: 500 }, { column: 9, row: 9 }, OPEN, DUEL_RULES)
    expect(route?.remainingDistanceUnits).toBe(9 * 1414)
    if (route === null) throw new Error('route expected')
    let stepped = route
    for (let tick = 0; tick < 77; tick++) {
      stepped = advanceRoute(stepped, 100)
      const position = routePosition(stepped)
      expect(Number.isSafeInteger(position?.x)).toBe(true)
    }
    expect(stepped).toEqual(advanceRoute(route, 7700))
    expect(routePosition(stepped)).toEqual({ x: 500 + 5000 + Math.trunc((1000 * (7700 - 5 * 1414)) / 1414), y: 500 + 5000 + Math.trunc((1000 * (7700 - 5 * 1414)) / 1414) })
  })
})

describe('explicit random streams', () => {
  it('derives deterministic independent uint32 streams and steps them purely', () => {
    expect(deriveStream(42, 1)).toBe(deriveStream(42, 1))
    expect(new Set([deriveStream(42, 1), deriveStream(42, 2), deriveStream(42, 3), deriveStream(43, 1)]).size).toBe(4)
    const first = nextRandom(deriveStream(42, 2))
    expect(first).toEqual(nextRandom(deriveStream(42, 2)))
    expect(first.value).toBeGreaterThanOrEqual(0)
    expect(first.value).toBeLessThanOrEqual(0xffff_ffff)
    expect(nextRandom(first.state).value).not.toBe(first.value)
    expect(() => deriveStream(-1, 1)).toThrow('uint32')
    expect(() => deriveStream(2 ** 32, 1)).toThrow('uint32')
  })
})

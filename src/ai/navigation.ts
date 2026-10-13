import type { Cell, Position, PublicMap, Ruleset } from '../contracts'
import { cellCentre, isAsteroidCell, isMapCell } from '../contracts'

/** Planner-local geometry over the public map only (no engine routing or hidden positions). */
export const isOpen = (cell: Cell, map: PublicMap): boolean => isMapCell(cell, map) && !isAsteroidCell(cell, map)
export const cellAt = (position: Position, rules: Ruleset): Cell => ({
  column: Math.floor(position.x / rules.geometry.unitsPerCell), row: Math.floor(position.y / rules.geometry.unitsPerCell),
})
export const sameCell = (a: Cell | null, b: Cell): boolean => a !== null && a.column === b.column && a.row === b.row
export const chebyshev = (a: Cell, b: Cell): number => Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row))
export const distance = (a: Position, b: Position): number => Math.hypot(b.x - a.x, b.y - a.y)
export const clampToMap = (p: Position, map: PublicMap, rules: Ruleset): Position => {
  const units = rules.geometry.unitsPerCell
  return { x: Math.min(Math.max(p.x, 0), map.columns * units - 1), y: Math.min(Math.max(p.y, 0), map.rows * units - 1) }
}

const STEPS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]
/**
 * Open cells reachable from `start` by the engine's movement rule (eight neighbours, a diagonal
 * only when both orthogonal neighbours are open), in breadth-first order.
 */
export function reachableCells(start: Cell, map: PublicMap): Cell[] {
  if (!isOpen(start, map)) return []
  const seen = new Set([`${start.column},${start.row}`])
  const order: Cell[] = [start]
  for (let index = 0; index < order.length; index++) {
    const { column, row } = order[index]
    for (const [dc, dr] of STEPS) {
      const next = { column: column + dc, row: row + dr }
      const key = `${next.column},${next.row}`
      if (seen.has(key) || !isOpen(next, map)) continue
      if (dc !== 0 && dr !== 0 && !(isOpen({ column: column + dc, row }, map) && isOpen({ column, row: row + dr }, map))) continue
      seen.add(key)
      order.push(next)
    }
  }
  return order
}

/** Segment a→b stays clear of asteroid rectangles grown by `margin` (closed, so touching blocks). */
export function segmentClear(a: Position, b: Position, map: PublicMap, rules: Ruleset, margin = 0): boolean {
  const units = rules.geometry.unitsPerCell
  return map.asteroidCells.every(({ column, row }) => {
    let enter = 0
    let exit = 1
    const axes = [[a.x, b.x - a.x, column * units - margin, (column + 1) * units + margin], [a.y, b.y - a.y, row * units - margin, (row + 1) * units + margin]] as const
    for (const [start, delta, low, high] of axes) {
      if (delta === 0) {
        if (start < low || start > high) return true
        continue
      }
      const t0 = (low - start) / delta
      const t1 = (high - start) / delta
      enter = Math.max(enter, Math.min(t0, t1))
      exit = Math.min(exit, Math.max(t0, t1))
      if (enter > exit) return true
    }
    return false
  })
}

/** Lowest-scoring candidate; ties fall to breadth-first order, so results are deterministic. */
export function best(cells: readonly Cell[], score: (cell: Cell, centre: Position) => number, rules: Ruleset): Cell | null {
  let chosen: Cell | null = null
  let lowest = Infinity
  for (const cell of cells) {
    const value = score(cell, cellCentre(cell, rules))
    if (value < lowest) {
      lowest = value
      chosen = cell
    }
  }
  return chosen
}

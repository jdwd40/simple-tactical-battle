import type { Cell, PublicMap, Ruleset } from '../contracts/public'

/** Enumeration order fixed by WEGO_SPEC: N, E, S, W, NE, SE, SW, NW (rows increase south). */
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]] as const

function precedes(rank: readonly number[], other: readonly number[]): boolean {
  for (let index = 0; index < rank.length; index++) {
    if (rank[index] !== other[index]) return rank[index] < other[index]
  }
  return false
}

/**
 * Deterministic octile A* over free cells. Diagonal steps need both orthogonal cells free
 * (no corner cutting). The open node is chosen by (f, h, row, column); an equal-cost
 * alternative never replaces an existing parent. Returns start..goal inclusive, or null.
 */
export function findPath(start: Cell, goal: Cell, map: PublicMap, rules: Ruleset): Cell[] | null {
  const { cardinalRouteCost: cardinal, diagonalRouteCost: diagonal } = rules.geometry
  const key = (column: number, row: number) => row * map.columns + column
  const blocked = new Set(map.asteroidCells.map((cell) => key(cell.column, cell.row)))
  const free = (column: number, row: number) => Number.isSafeInteger(column) && Number.isSafeInteger(row)
    && column >= 0 && row >= 0 && column < map.columns && row < map.rows && !blocked.has(key(column, row))
  if (!free(start.column, start.row) || !free(goal.column, goal.row)) return null
  const heuristic = (column: number, row: number) => {
    const dx = Math.abs(column - goal.column)
    const dy = Math.abs(row - goal.row)
    return cardinal * (Math.max(dx, dy) - Math.min(dx, dy)) + diagonal * Math.min(dx, dy)
  }
  const cost = new Map<number, number>([[key(start.column, start.row), 0]])
  const parent = new Map<number, number>()
  const closed = new Set<number>()
  const open = new Map<number, Cell>([[key(start.column, start.row), { column: start.column, row: start.row }]])
  while (open.size > 0) {
    let best: Cell | null = null
    let bestRank: readonly number[] = []
    for (const cell of open.values()) {
      const h = heuristic(cell.column, cell.row)
      const rank = [(cost.get(key(cell.column, cell.row)) ?? 0) + h, h, cell.row, cell.column]
      if (best === null || precedes(rank, bestRank)) {
        best = cell
        bestRank = rank
      }
    }
    if (best === null) break
    const current = key(best.column, best.row)
    if (best.column === goal.column && best.row === goal.row) {
      const path: Cell[] = [best]
      let cursor = current
      while (parent.has(cursor)) {
        cursor = parent.get(cursor) as number
        path.push({ column: cursor % map.columns, row: Math.floor(cursor / map.columns) })
      }
      return path.reverse()
    }
    open.delete(current)
    closed.add(current)
    for (const [dx, dy] of NEIGHBOURS) {
      const column = best.column + dx
      const row = best.row + dy
      if (!free(column, row)) continue
      const isDiagonal = dx !== 0 && dy !== 0
      if (isDiagonal && (!free(best.column + dx, best.row) || !free(best.column, best.row + dy))) continue
      const next = key(column, row)
      if (closed.has(next)) continue
      const tentative = (cost.get(current) ?? 0) + (isDiagonal ? diagonal : cardinal)
      const known = cost.get(next)
      if (known === undefined || tentative < known) {
        cost.set(next, tentative)
        parent.set(next, current)
        open.set(next, { column, row })
      }
    }
  }
  return null
}

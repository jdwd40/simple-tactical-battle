import type { Cell, Position, PublicMap, Ruleset } from '../contracts/public'

export function isMapCell(cell: Cell, map: PublicMap): boolean {
  return Number.isSafeInteger(cell.column) && Number.isSafeInteger(cell.row)
    && cell.column >= 0 && cell.row >= 0 && cell.column < map.columns && cell.row < map.rows
}
export function isAsteroidCell(cell: Cell, map: PublicMap): boolean {
  return map.asteroidCells.some((asteroid) => asteroid.column === cell.column && asteroid.row === cell.row)
}
export function cellCentre(cell: Cell, rules: Ruleset): Position {
  const units = rules.geometry.unitsPerCell
  const x = cell.column * units + units / 2
  const y = cell.row * units + units / 2
  if (!Number.isSafeInteger(cell.column) || !Number.isSafeInteger(cell.row)
    || cell.column < 0 || cell.row < 0 || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error('Cell centre requires nonnegative integral cell coordinates and safe world units')
  }
  return { x, y }
}

import type { Cell, PublicMap } from '../contracts'

export interface ScreenPoint { readonly x: number; readonly y: number }
export interface WorldPoint { readonly x: number; readonly y: number }

/** Square-cell fit of the public map inside a viewport, leaving room for coordinate labels. */
export interface PlotTransform {
  readonly columns: number
  readonly rows: number
  readonly unitsPerCell: number
  /** Screen pixels per world unit. */
  readonly scale: number
  readonly cellPx: number
  readonly originX: number
  readonly originY: number
}

export const PLOT_MARGIN = { left: 30, top: 24, right: 12, bottom: 12 } as const

export function fitPlot(viewWidth: number, viewHeight: number, map: PublicMap, unitsPerCell: number): PlotTransform {
  const availableWidth = Math.max(1, viewWidth - PLOT_MARGIN.left - PLOT_MARGIN.right)
  const availableHeight = Math.max(1, viewHeight - PLOT_MARGIN.top - PLOT_MARGIN.bottom)
  const cellPx = Math.max(1, Math.min(availableWidth / map.columns, availableHeight / map.rows))
  return {
    columns: map.columns,
    rows: map.rows,
    unitsPerCell,
    scale: cellPx / unitsPerCell,
    cellPx,
    originX: PLOT_MARGIN.left + (availableWidth - cellPx * map.columns) / 2,
    originY: PLOT_MARGIN.top + (availableHeight - cellPx * map.rows) / 2,
  }
}

export function toScreen(transform: PlotTransform, point: WorldPoint): ScreenPoint {
  return { x: transform.originX + point.x * transform.scale, y: transform.originY + point.y * transform.scale }
}

export function cellRect(transform: PlotTransform, cell: Cell) {
  return {
    x: transform.originX + cell.column * transform.cellPx,
    y: transform.originY + cell.row * transform.cellPx,
    size: transform.cellPx,
  }
}

/** The map cell under a screen point, or null outside the map. */
export function cellAtScreen(transform: PlotTransform, x: number, y: number): Cell | null {
  const column = Math.floor((x - transform.originX) / transform.cellPx)
  const row = Math.floor((y - transform.originY) / transform.cellPx)
  if (column < 0 || row < 0 || column >= transform.columns || row >= transform.rows) return null
  return { column, row }
}

/** The cell containing a world position (positions on the far edge belong to the last cell). */
export function cellOfPosition(point: WorldPoint, unitsPerCell: number, map: PublicMap): Cell {
  const clamp = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.floor(value / unitsPerCell)))
  return { column: clamp(point.x, map.columns), row: clamp(point.y, map.rows) }
}

/**
 * Contract headings are integer milli-degrees clockwise from north with rows increasing
 * down. A symbol drawn pointing to screen-up therefore rotates by the same clockwise angle.
 */
export function headingToRotation(headingMilliDegrees: number): number {
  return (headingMilliDegrees / 1000) * (Math.PI / 180)
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const

export function compassName(headingMilliDegrees: number): (typeof COMPASS)[number] {
  const degrees = ((headingMilliDegrees / 1000) % 360 + 360) % 360
  return COMPASS[Math.round(degrees / 45) % 8]
}

/** Clockwise-from-north heading of a velocity, in milli-degrees, or null when stationary. */
export function velocityHeading(xPerTick: number, yPerTick: number): number | null {
  if (xPerTick === 0 && yPerTick === 0) return null
  const degrees = (Math.atan2(xPerTick, -yPerTick) * 180) / Math.PI
  return Math.round(((degrees % 360) + 360) % 360 * 1000)
}

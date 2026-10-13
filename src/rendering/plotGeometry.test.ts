import { describe, expect, it } from 'vitest'
import { DUEL_MAP } from '../contracts'
import { cellAtScreen, cellOfPosition, compassName, fitPlot, headingToRotation, PLOT_MARGIN, toScreen, velocityHeading } from './plotGeometry'

describe('plot geometry', () => {
  const transform = fitPlot(732, 635, DUEL_MAP, 1000)

  it('fits square cells inside the margins and centres the map', () => {
    expect(transform.cellPx).toBeCloseTo((635 - PLOT_MARGIN.top - PLOT_MARGIN.bottom) / 20)
    expect(transform.originY).toBeCloseTo(PLOT_MARGIN.top)
    const width = transform.cellPx * 20
    expect(transform.originX - PLOT_MARGIN.left).toBeCloseTo(732 - PLOT_MARGIN.left - PLOT_MARGIN.right - width - (transform.originX - PLOT_MARGIN.left))
  })

  it('maps cell centres to screen and back to the same cell', () => {
    const centre = toScreen(transform, { x: 12_500, y: 8500 })
    expect(cellAtScreen(transform, centre.x, centre.y)).toEqual({ column: 12, row: 8 })
    expect(cellAtScreen(transform, transform.originX - 1, centre.y)).toBeNull()
    expect(cellAtScreen(transform, centre.x, transform.originY + transform.cellPx * 20 + 1)).toBeNull()
  })

  it('assigns world positions to cells, clamping the far edge', () => {
    expect(cellOfPosition({ x: 3500, y: 10_500 }, 1000, DUEL_MAP)).toEqual({ column: 3, row: 10 })
    expect(cellOfPosition({ x: 20_000, y: 20_000 }, 1000, DUEL_MAP)).toEqual({ column: 19, row: 19 })
  })

  it('follows the contract heading convention: clockwise milli-degrees from north, rows down', () => {
    expect(headingToRotation(0)).toBe(0)
    expect(headingToRotation(90_000)).toBeCloseTo(Math.PI / 2)
    expect(compassName(90_000)).toBe('east')
    expect(compassName(225_000)).toBe('south-west')
    expect(velocityHeading(0, -10)).toBe(0)
    expect(velocityHeading(-60, 0)).toBe(270_000)
    expect(velocityHeading(10, 10)).toBe(135_000)
    expect(velocityHeading(0, 0)).toBeNull()
  })
})

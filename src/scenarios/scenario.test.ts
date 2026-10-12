import { describe, expect, it } from 'vitest'
import { DUEL_SCENARIO, createScenario, publicScenario } from './private'
import { DUEL_MAP, DUEL_PUBLIC_SCENARIO, DUEL_RULES } from './public'
import { cellCentre, isMapCell, isAsteroidCell } from './geometry'

describe('authored duel', () => {
  it('has the exact public 20x20 terrain and twelve approved obstacles', () => {
    expect(DUEL_MAP.columns).toBe(20)
    expect(DUEL_MAP.rows).toBe(20)
    expect(DUEL_MAP.asteroidCells.map(({ column, row }) => [column, row])).toEqual([
      [7, 4], [7, 5], [8, 5], [12, 5], [13, 5], [13, 6],
      [6, 13], [7, 13], [7, 14], [12, 13], [12, 14], [13, 14],
    ])
    expect(publicScenario(DUEL_SCENARIO)).toEqual(DUEL_PUBLIC_SCENARIO)
    expect(Object.isFrozen(DUEL_MAP.asteroidCells[0])).toBe(true)
  })
  it('keeps spawns private with the approved cells, ship classes and starting orders', () => {
    expect(DUEL_SCENARIO.spawns.player).toEqual({ cell: { column: 3, row: 10 }, shipClass: 'shadow-dancer', headingMilliDegrees: 90_000, initialOrders: { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } } })
    expect(DUEL_SCENARIO.spawns.patrol).toEqual({ cell: { column: 16, row: 10 }, shipClass: 'patrol-frigate', headingMilliDegrees: 270_000, initialOrders: { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } } })
    expect(Object.isFrozen(DUEL_SCENARIO.spawns.player.initialOrders)).toBe(true)
  })
  it('converts cell centres using axes increasing right and down', () => {
    expect(cellCentre({ column: 0, row: 0 }, DUEL_RULES)).toEqual({ x: 500, y: 500 })
    expect(cellCentre({ column: 19, row: 19 }, DUEL_RULES)).toEqual({ x: 19_500, y: 19_500 })
    expect(cellCentre(DUEL_SCENARIO.spawns.player.cell, DUEL_RULES)).toEqual({ x: 3500, y: 10_500 })
    expect(() => cellCentre({ column: 0.5, row: 0 }, DUEL_RULES)).toThrow()
    expect(() => cellCentre({ column: -1, row: 0 }, DUEL_RULES)).toThrow()
    expect(isMapCell({ column: 20, row: 0 }, DUEL_MAP)).toBe(false)
    expect(isMapCell({ column: 0, row: -1 }, DUEL_MAP)).toBe(false)
    expect(isAsteroidCell({ column: 7, row: 4 }, DUEL_MAP)).toBe(true)
    expect(isAsteroidCell({ column: 3, row: 10 }, DUEL_MAP)).toBe(false)
  })
  it.each([{ column: 20, row: 10 }, { column: -1, row: 10 }, { column: 3.5, row: 10 }, { column: 7, row: 4 }])('rejects invalid/blocked spawn %j', (cell) => {
    expect(() => createScenario({ ...DUEL_SCENARIO, spawns: { ...DUEL_SCENARIO.spawns, player: { ...DUEL_SCENARIO.spawns.player, cell } } }, DUEL_RULES)).toThrow('free map cell')
  })
  it.each([0, -20, 20.5])('rejects invalid map size %s', (columns) => {
    expect(() => createScenario({ ...DUEL_SCENARIO, map: { ...DUEL_MAP, columns } }, DUEL_RULES)).toThrow('dimensions')
  })
  it('rejects duplicate and out-of-map obstacles', () => {
    expect(() => createScenario({ ...DUEL_SCENARIO, map: { ...DUEL_MAP, asteroidCells: [...DUEL_MAP.asteroidCells, DUEL_MAP.asteroidCells[0]] } }, DUEL_RULES)).toThrow('Duplicate')
    expect(() => createScenario({ ...DUEL_SCENARIO, map: { ...DUEL_MAP, asteroidCells: [{ column: 0, row: 20 }] } }, DUEL_RULES)).toThrow('outside map')
  })
  it('rejects invalid headings and unavailable initial equipment', () => {
    expect(() => createScenario({ ...DUEL_SCENARIO, spawns: { ...DUEL_SCENARIO.spawns, player: { ...DUEL_SCENARIO.spawns.player, headingMilliDegrees: 360_000 } } }, DUEL_RULES)).toThrow('Heading')
    const patrol = DUEL_SCENARIO.spawns.patrol
    expect(() => createScenario({ ...DUEL_SCENARIO, spawns: { ...DUEL_SCENARIO.spawns, patrol: { ...patrol, initialOrders: { ...patrol.initialOrders, cloak: true } } } }, DUEL_RULES)).toThrow('unavailable cloak')
  })
})

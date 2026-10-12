import type { Scenario, Spawn } from '../contracts/private'
import type { PublicMap, PublicScenario, Ruleset, Side } from '../contracts/public'
import { freezeData } from './freeze'
import { cellCentre, isAsteroidCell, isMapCell } from './geometry'
import { DUEL_PUBLIC_SCENARIO, DUEL_RULES } from './public'

/** Whitelist projection. Never forward a Scenario through a spread or type cast. */
export function publicScenario(scenario: Scenario): PublicScenario {
  return freezeData({
    id: scenario.id, version: scenario.version, title: scenario.title,
    map: {
      columns: scenario.map.columns, rows: scenario.map.rows,
      asteroidCells: scenario.map.asteroidCells.map(({ column, row }) => ({ column, row })),
    },
  })
}
function validateMap(map: PublicMap): void {
  if (!Number.isSafeInteger(map.columns) || !Number.isSafeInteger(map.rows) || map.columns <= 0 || map.rows <= 0) {
    throw new Error('Map dimensions must be positive safe integers')
  }
  const seen = new Set<string>()
  for (const cell of map.asteroidCells) {
    if (!isMapCell(cell, map)) throw new Error('Asteroid outside map or fractional cell')
    const key = `${cell.column},${cell.row}`
    if (seen.has(key)) throw new Error('Duplicate asteroid cell')
    seen.add(key)
  }
}
export function createScenario(input: Scenario, rules: Ruleset): Scenario {
  if (!input.id.trim() || !input.version.trim() || !input.title.trim()) throw new Error('Scenario metadata must not be empty')
  validateMap(input.map)
  const validateSpawn = (side: Side, spawn: Spawn): Spawn => {
    if (!isMapCell(spawn.cell, input.map) || isAsteroidCell(spawn.cell, input.map)) throw new Error('Spawn must be in a free map cell')
    const spec = rules.ships[spawn.shipClass]
    if (!spec) throw new Error('Unknown ship class')
    if (!Number.isSafeInteger(spawn.headingMilliDegrees) || spawn.headingMilliDegrees < 0 || spawn.headingMilliDegrees >= 360_000) {
      throw new Error('Heading must be integral milli-degrees in [0, 360000)')
    }
    if (spawn.initialOrders.turnIndex !== 0 || spawn.initialOrders.movement.kind !== 'hold'
      || spawn.initialOrders.sensor !== 'passive' || spawn.initialOrders.weapon.kind !== 'hold') {
      throw new Error('Initial orders must be turn zero, holding and passive')
    }
    if (spawn.initialOrders.cloak && !spec.equipment.cloak) throw new Error(`${side} cannot start with unavailable cloak`)
    const position = cellCentre(spawn.cell, rules)
    if (!Number.isSafeInteger(input.map.columns * rules.geometry.unitsPerCell)
      || !Number.isSafeInteger(input.map.rows * rules.geometry.unitsPerCell)
      || position.x < rules.geometry.shipRadiusUnits || position.y < rules.geometry.shipRadiusUnits) {
      throw new Error('Spawn geometry must be safe integral world units')
    }
    return structuredClone(spawn)
  }
  return freezeData({
    ...publicScenario(input),
    spawns: { player: validateSpawn('player', input.spawns.player), patrol: validateSpawn('patrol', input.spawns.patrol) },
  })
}
export const DUEL_SCENARIO: Scenario = createScenario({
  ...DUEL_PUBLIC_SCENARIO,
  spawns: {
    player: { cell: { column: 3, row: 10 }, shipClass: 'shadow-dancer', headingMilliDegrees: 90_000, initialOrders: { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } } },
    patrol: { cell: { column: 16, row: 10 }, shipClass: 'patrol-frigate', headingMilliDegrees: 270_000, initialOrders: { turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } } },
  },
}, DUEL_RULES)

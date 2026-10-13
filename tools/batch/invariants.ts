import type { Scenario, SimulationState } from '../../src/contracts/private'
import type { Ruleset, SideObservation } from '../../src/contracts'
import { sweepClear } from '../../src/simulation/geometry'

const bounded = (n: number, max: number, label: string) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`${label} out of bounds: ${n} (max ${max})`)
}
function finite(value: unknown, path = 'state'): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} is not finite`)
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`)
}
export function checkObservation(view: SideObservation, rules: Ruleset, world: Scenario): void {
  const own = view.ownShip
  const spec = rules.ships[own.shipClass]
  bounded(own.energy.currentMilli, spec.maxEnergyMilli, `${view.side}.energy`)
  bounded(own.ammunition.current, spec.missileAmmunition, `${view.side}.ammunition`)
  bounded(own.hull.current, spec.maxHull, `${view.side}.hull`)
  bounded(own.shields.current, spec.maxShields, `${view.side}.shields`)
  bounded(own.position.x, world.map.columns * rules.geometry.unitsPerCell, `${view.side}.x`)
  bounded(own.position.y, world.map.rows * rules.geometry.unitsPerCell, `${view.side}.y`)
  if (!sweepClear(own.position, own.position, rules.geometry.shipRadiusUnits, world.map, rules)) throw new Error(`${view.side} overlaps terrain/arena`)
  for (const [name, tick] of Object.entries(own.clocks)) bounded(tick, Number.MAX_SAFE_INTEGER, `${view.side}.${name}`)
}
export function checkState(state: SimulationState, rules: Ruleset, world: Scenario, previous?: SimulationState): void {
  finite(state)
  bounded(state.tick, Number.MAX_SAFE_INTEGER, 'tick')
  bounded(state.turnIndex, Number.MAX_SAFE_INTEGER, 'turnIndex')
  for (const rng of [state.random.simulation, ...Object.values(state.random.planners)]) bounded(rng, 0xffffffff, 'rng')
  for (const side of ['player', 'patrol'] as const) {
    const ship = state.ships[side]
    const spec = rules.ships[ship.shipClass]
    bounded(ship.energyMilli, spec.maxEnergyMilli, `${side}.energy`)
    bounded(ship.ammunition, spec.missileAmmunition, `${side}.ammunition`)
    bounded(ship.hull, spec.maxHull, `${side}.hull`)
    bounded(ship.shields, spec.maxShields, `${side}.shields`)
    if (ship.alive !== (ship.hull > 0) || ship.alive !== (ship.destructionTick === null)) throw new Error(`${side} inconsistent destruction`)
    if (previous) {
      const before = previous.ships[side]
      if (ship.ammunition > before.ammunition || ship.hull > before.hull || ship.shields > before.shields
        || ship.laserReadyTick < before.laserReadyTick || ship.missileReadyTick < before.missileReadyTick) throw new Error(`${side} resource/cooldown regression`)
    }
  }
  if (new Set(state.missiles.map((m) => m.id)).size !== state.missiles.length) throw new Error('Duplicate missile IDs')
  for (const m of state.missiles) {
    bounded(m.distanceTravelledUnits, Number.MAX_SAFE_INTEGER, `${m.id}.travel`)
    bounded(m.position.x, world.map.columns * rules.geometry.unitsPerCell, `${m.id}.x`)
    bounded(m.position.y, world.map.rows * rules.geometry.unitsPerCell, `${m.id}.y`)
    if (m.launchTick > state.tick || m.expiresAtTick <= state.tick || m.expiresAtTick - m.launchTick !== rules.timing.missileLifetimeTicks) throw new Error(`${m.id} lifetime mismatch`)
  }
}

import type {
  Cell, ContactMemory, PlannerMemory, PlanOpponent, Position, Ruleset, SensorOrder, SideObservation, TurnOrders, WeaponOrder,
} from '../contracts'
import { cellCentre } from '../contracts'
import { best, cellAt, chebyshev, clampToMap, distance, isOpen, reachableCells, sameCell, segmentClear } from './navigation'
import { randomStream } from './random'

/** Behaviour thresholds: planner hypotheses within the approved rules, tunable later (TSB-51). */
export const PLANNER_TUNING = Object.freeze({
  /** Energy kept after any discharge or scan so propulsion stays funded. */
  reserveMilli: 20_000,
  /** At or below this hull the ship breaks contact instead of closing. */
  disengageHull: 35,
  /** Hostile missile tracks within this many cells, seen within `threatMaxAgeTicks`, trigger evasion. */
  threatCells: 6, threatMaxAgeTicks: 30,
  /** Preferred engagement standoff, and the window in which a laser intent is worth committing. */
  standoffCells: 5, laserCommitExtraCells: 1,
  /** Plotted-missile window; the lower bound keeps the ship out of its own blast. */
  missileMinCells: 3, missileMaxCells: 10,
  /** Evasion and disengagement destinations stay within these many cells of the ship. */
  evadeCells: 4, disengageCells: 8,
  /** Per-turn pulse probabilities when a pulse can help. */
  searchScanChance: 0.5, patrolScanChance: 0.25,
})

/** Patrol waypoints over the public map; the seed chooses their order. */
const PATROL_WAYPOINTS: readonly Cell[] = [
  { column: 16, row: 3 }, { column: 10, row: 3 }, { column: 3, row: 3 }, { column: 3, row: 16 },
  { column: 10, row: 16 }, { column: 16, row: 16 }, { column: 10, row: 10 }, { column: 16, row: 10 },
]

type Policy = PlannerMemory['policy']

/** Freshest ship contact: a current one, otherwise the most recently measured stale one. */
function pickContact(contacts: readonly ContactMemory[]): ContactMemory | undefined {
  let chosen: ContactMemory | undefined
  for (const contact of contacts) {
    if (contact.observedDestructionTick !== undefined) continue
    if (chosen === undefined || contact.ageTicks < chosen.ageTicks) chosen = contact
  }
  return chosen
}

/** Last measurement advanced by its estimated velocity, never further than its uncertainty, inside the map. */
function predicted(contact: ContactMemory, ticksAhead: number, observation: SideObservation, rules: Ruleset): Position {
  const { position } = contact.measurement
  const velocity = contact.estimatedVelocity ?? { xUnitsPerTick: 0, yUnitsPerTick: 0 }
  let dx = velocity.xUnitsPerTick * ticksAhead
  let dy = velocity.yUnitsPerTick * ticksAhead
  const limit = contact.kind === 'stale' ? contact.uncertaintyRadiusUnits : Infinity
  const length = Math.hypot(dx, dy)
  if (length > limit) {
    dx *= limit / length
    dy *= limit / length
  }
  return clampToMap({ x: position.x + dx, y: position.y + dy }, observation.map, rules)
}

function nextPolicy(previous: PlannerMemory, contact: ContactMemory | undefined, here: Cell): Policy {
  if (contact === undefined) return 'PATROL'
  if (contact.kind === 'current') return 'ENGAGE'
  if (previous.policy === 'ENGAGE' || previous.policy === 'PATROL') return 'INVESTIGATE'
  if (previous.policy === 'INVESTIGATE') {
    const target = previous.searchDestination
    return target === null || chebyshev(target, here) > 1 ? 'INVESTIGATE' : 'SEARCH'
  }
  return 'SEARCH'
}

/**
 * Builds a PlanOpponent for one public ruleset. Each call is a pure function of the observation,
 * planner memory and uint32 random state; it reads no clock, global or engine state and never
 * sees the opponent's orders, true position or health. One call fixes a whole turn's orders.
 */
export function createOpponentPlanner(rules: Ruleset, tuning: typeof PLANNER_TUNING = PLANNER_TUNING): PlanOpponent {
  const units = rules.geometry.unitsPerCell
  return (observation, memory, plannerRandomState) => {
    const rng = randomStream(plannerRandomState)
    const own = observation.ownShip
    const hold = (): TurnOrders => ({ turnIndex: observation.turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
    if (own.status === 'destroyed') return { orders: hold(), memory, plannerRandomState }
    const { map } = observation
    const here = cellAt(own.position, rules)
    const reachable = reachableCells(here, map)
    const nearby = (cells: number) => reachable.filter((cell) => chebyshev(cell, here) <= cells)
    const energy = own.energy.currentMilli
    const destroyedTick = observation.observedOpponentDestructionTick ?? memory.observedOpponentDestructionTick
    const contact = destroyedTick === undefined ? pickContact(observation.contacts) : undefined
    const policy = nextPolicy(memory, contact, here)
    let { patrolOrder, patrolIndex, searchDestination } = memory

    // Policy destination from own knowledge only.
    let destination: Cell | null = null
    if (policy === 'ENGAGE' && contact !== undefined) {
      const target = contact.measurement.position
      const weak = own.hull.current <= tuning.disengageHull
      destination = weak
        // Break contact: far from the contact, ideally out of its sightline.
        ? best(nearby(tuning.disengageCells), (_cell, centre) => -distance(centre, target)
          + (segmentClear(centre, target, map, rules) ? 0 : -3 * units) + 0.2 * distance(centre, own.position), rules)
        // Close to the standoff range with a clear sightline for the laser.
        : best(reachable, (_cell, centre) => Math.abs(distance(centre, target) - tuning.standoffCells * units)
          + (segmentClear(centre, target, map, rules) ? 0 : 5 * units) + 0.3 * distance(centre, own.position), rules)
      searchDestination = null
    } else if ((policy === 'INVESTIGATE' || policy === 'SEARCH') && contact !== undefined) {
      const fresh = policy !== memory.policy || searchDestination === null || chebyshev(searchDestination, here) <= 1
        || !reachable.some((cell) => sameCell(searchDestination, cell))
      if (fresh) {
        const centre = predicted(contact, contact.ageTicks, observation, rules)
        if (policy === 'INVESTIGATE') {
          searchDestination = best(reachable, (_cell, at) => distance(at, centre), rules)
        } else {
          // A seeded point inside the uncertainty disc, away from the current cell.
          const radius = Math.min(contact.uncertaintyRadiusUnits, 6 * units) + units
          const inDisc = reachable.filter((cell) => chebyshev(cell, here) > 1 && distance(cellCentre(cell, rules), centre) <= radius)
          const pool = inDisc.length > 0 ? inDisc : nearby(6).filter((cell) => chebyshev(cell, here) > 1)
          searchDestination = pool.length > 0 ? pool[rng.index(pool.length)] : null
        }
      }
      destination = searchDestination
    } else {
      searchDestination = null
      if (patrolOrder.length === 0) {
        const open = PATROL_WAYPOINTS.filter((cell) => reachable.some((candidate) => sameCell(candidate, cell)))
        const shuffled = [...open]
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = rng.index(i + 1)
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        patrolOrder = shuffled
        patrolIndex = 0
      }
      if (patrolOrder.length > 0) {
        patrolIndex %= patrolOrder.length
        if (chebyshev(patrolOrder[patrolIndex], here) <= 1) patrolIndex = (patrolIndex + 1) % patrolOrder.length
        const waypoint = patrolOrder[patrolIndex]
        destination = reachable.some((cell) => sameCell(cell, waypoint)) ? waypoint : null
      }
    }

    // Evade known hostile ordnance first: its aim is unknown, so leave both it and the current cell behind.
    const threats = observation.hostileMissiles.filter((missile) => missile.ageTicks <= tuning.threatMaxAgeTicks
      && distance(missile.measurement.position, own.position) <= tuning.threatCells * units)
    if (threats.length > 0) {
      destination = best(nearby(tuning.evadeCells), (_cell, centre) => -distance(centre, own.position)
        - Math.min(...threats.map((missile) => distance(centre, missile.measurement.position))), rules)
    } else if (destroyedTick !== undefined) {
      destination = null // confirmed kill and no known ordnance nearby: keep station
    }

    // One weapon intent from own knowledge: legal alias lasers or plotted predictive missiles.
    let weapon: WeaponOrder = { kind: 'hold' }
    const affords = (cost: number) => energy >= cost + tuning.reserveMilli
    const turnEnd = observation.tick + rules.timing.turnTicks
    if (contact !== undefined && own.equipment.laser) {
      const range = distance(own.position, contact.measurement.position)
      const laserSoon = own.clocks.laserReadyTick <= observation.tick + rules.timing.turnTicks / 2
      const missileReady = own.equipment.missileLauncher && own.ammunition.current > 0 && own.clocks.missileReadyTick <= observation.tick + 1
      if (contact.kind === 'current' && laserSoon && affords(rules.laser.costMilli) && range <= rules.laser.rangeUnits + tuning.laserCommitExtraCells * units) {
        weapon = { kind: 'laser', contactAlias: contact.alias }
      } else if (contact.kind === 'current' && missileReady && affords(rules.missile.costMilli)
        && range >= tuning.missileMinCells * units && range <= tuning.missileMaxCells * units) {
        // Lead the measured motion by the flight time; the plotted cell never moves afterwards.
        const flightTicks = Math.ceil(range / rules.missile.speedUnitsPerTick) + 1
        const aimCell = cellAt(predicted(contact, flightTicks, observation, rules), rules)
        const aimCentre = cellCentre(aimCell, rules)
        const legal = isOpen(aimCell, map) && distance(own.position, aimCentre) >= tuning.missileMinCells * units
        if (legal && segmentClear(own.position, aimCentre, map, rules, rules.geometry.missileRadiusUnits)) weapon = { kind: 'missile', aim: aimCell }
      }
      if (weapon.kind === 'hold' && own.clocks.laserReadyTick < turnEnd && affords(rules.laser.costMilli)) {
        // Conditional: waits in-turn for a fresh lock, range, sightline, cooldown and energy.
        weapon = { kind: 'laser', contactAlias: contact.alias }
      }
    }
    if (policy === 'ENGAGE' && own.hull.current <= tuning.disengageHull && weapon.kind === 'laser') weapon = { kind: 'hold' }

    // A pulse only where it can find something, and never at the cost of the chosen weapon's energy.
    const weaponCost = weapon.kind === 'laser' ? rules.laser.costMilli : weapon.kind === 'missile' ? rules.missile.costMilli : 0
    const scanAffordable = own.equipment.activeSensor && destroyedTick === undefined && affords(rules.sensors.pulseCostMilli + weaponCost)
    let sensor: SensorOrder = 'passive'
    if (scanAffordable && threats.length === 0) {
      if ((policy === 'INVESTIGATE' || policy === 'SEARCH') && contact !== undefined) {
        const near = distance(own.position, predicted(contact, contact.ageTicks, observation, rules)) <= rules.sensors.activeUncloakedRangeUnits
        if (near && rng.chance(tuning.searchScanChance)) sensor = 'activePulse'
      } else if (policy === 'PATROL' && rng.chance(tuning.patrolScanChance)) {
        sensor = 'activePulse'
      }
    }
    // Concealment for a cloak-equipped ship when it is not about to act.
    const cloak = own.equipment.cloak && sensor === 'passive' && weapon.kind === 'hold' && affords(rules.ships[own.shipClass].cloakMilliPerTick * rules.timing.turnTicks)

    const orders: TurnOrders = {
      turnIndex: observation.turnIndex,
      movement: destination === null ? { kind: 'hold' } : { kind: 'destination', cell: { column: destination.column, row: destination.row } },
      sensor, cloak, weapon,
    }
    const nextMemory: PlannerMemory = {
      policy, patrolOrder: patrolOrder.map((cell) => ({ column: cell.column, row: cell.row })), patrolIndex,
      rememberedContacts: observation.contacts.map((remembered) => structuredClone(remembered)),
      searchDestination: searchDestination === null ? null : { column: searchDestination.column, row: searchDestination.row },
      ...(destroyedTick === undefined ? {} : { observedOpponentDestructionTick: destroyedTick }),
    }
    return { orders, memory: nextMemory, plannerRandomState: rng.state }
  }
}

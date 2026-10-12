import type { PrivateKnowledge, Scenario, ShipState, SimulationState } from '../contracts/private'
import type {
  CloakObservation, CloakState, OwnInterruption, OwnShipObservation, PublicMap, Ruleset, Side, SideObservation, Tick, VisibleEvent,
} from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { publicScenario } from '../scenarios/private'

export function assertSessionMatches(state: SimulationState, rules: Ruleset, scenario: Scenario): void {
  if (state.rulesVersion !== rules.version || state.scenarioId !== scenario.id || state.scenarioVersion !== scenario.version) {
    throw new Error('Rules/scenario do not match the session')
  }
}

export function cloakObservation(ship: ShipState, tick: Tick): CloakObservation {
  let state: CloakState = 'off'
  if (ship.cloakActive) state = 'active'
  else if (ship.cloakRequested && ship.cloakLatch === 'activity') state = 'latched-activity'
  else if (ship.cloakRequested && ship.cloakLatch === 'unfunded') state = 'latched-unfunded'
  else if (ship.cloakRequested && ship.exposureUntilTick > tick) state = 'suppressed-exposure'
  return { requested: ship.cloakRequested, actual: ship.cloakActive, state }
}

/** Explicitly constructed own facts; exact copies, never authoritative references. */
function ownShipObservation(ship: ShipState, rules: Ruleset, tick: Tick, interruptions: readonly OwnInterruption[]): OwnShipObservation {
  const spec = rules.ships[ship.shipClass]
  return {
    shipClass: ship.shipClass, name: spec.name, status: ship.alive ? 'alive' : 'destroyed',
    position: { x: ship.position.x, y: ship.position.y }, headingMilliDegrees: ship.headingMilliDegrees,
    hull: { current: ship.hull, max: spec.maxHull }, shields: { current: ship.shields, max: spec.maxShields },
    energy: { currentMilli: ship.energyMilli, maxMilli: spec.maxEnergyMilli },
    ammunition: { current: ship.ammunition, max: spec.missileAmmunition },
    equipment: { ...spec.equipment },
    destination: ship.destination === null ? null : { column: ship.destination.column, row: ship.destination.row },
    route: {
      waypoints: ship.route.waypoints.map(({ x, y }) => ({ x, y })), segmentIndex: ship.route.segmentIndex,
      distanceAlongSegmentUnits: ship.route.distanceAlongSegmentUnits, remainingDistanceUnits: ship.route.remainingDistanceUnits,
    },
    cloak: cloakObservation(ship, tick),
    sensor: ship.trackingUntilTick > tick ? 'tracking' : 'passive',
    clocks: {
      laserReadyTick: ship.laserReadyTick, missileReadyTick: ship.missileReadyTick,
      exposureUntilTick: ship.exposureUntilTick, trackingUntilTick: ship.trackingUntilTick,
    },
    turnActions: { pulseAttemptSpent: ship.pulseAttemptSpent, weaponIntentSpent: ship.weaponIntentSpent },
    interruptions: interruptions.map(({ tick: at, reason }) => ({ tick: at, reason })),
  }
}

export interface ProjectionInput {
  readonly side: Side; readonly turnIndex: number; readonly tick: Tick; readonly map: PublicMap
  readonly ship: ShipState; readonly knowledge: PrivateKnowledge; readonly outcome: SimulationState['outcome']
}
/** Whitelisted observer projection: no entity IDs, opposing state, orders or future data. */
export function projectObservation(
  input: ProjectionInput, rules: Ruleset, events: readonly VisibleEvent[], interruptions: readonly OwnInterruption[],
): SideObservation {
  const { knowledge, tick, outcome } = input
  return {
    side: input.side, turnIndex: input.turnIndex, tick, map: input.map,
    ownShip: ownShipObservation(input.ship, rules, tick, interruptions),
    contacts: knowledge.contacts.map(({ contact }) => structuredClone(contact)),
    ownMissiles: knowledge.ownMissiles.map((missile) => structuredClone(missile)),
    hostileMissiles: knowledge.hostileMissiles.map(({ memory }) => structuredClone(memory)),
    events,
    ...(knowledge.observedOpponentDestructionTick === undefined ? {} : { observedOpponentDestructionTick: knowledge.observedOpponentDestructionTick }),
    ...(outcome !== null && tick >= outcome.revealTick ? { outcome: { outcome: outcome.outcome, revealTick: outcome.revealTick } } : {}),
  }
}

/** Current planning observation for one side: no events, no interruptions yet for the coming turn. */
export function observeSide(state: SimulationState, side: Side, rules: Ruleset, scenario: Scenario): SideObservation {
  assertSessionMatches(state, rules, scenario)
  return freezeData(projectObservation({
    side, turnIndex: state.turnIndex, tick: state.tick, map: publicScenario(scenario).map,
    ship: state.ships[side], knowledge: state.knowledge[side], outcome: state.outcome,
  }, rules, [], []))
}

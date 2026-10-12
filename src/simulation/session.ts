import type { InitialiseSession, PrivateKnowledge, ShipState, Spawn } from '../contracts/private'
import type { PlannerMemory, Ruleset, Side } from '../contracts/public'
import { freezeData } from '../scenarios/freeze'
import { cellCentre } from '../scenarios/geometry'
import { createScenario } from '../scenarios/private'
import { deriveStream, STREAM_PURPOSE } from './random'
import { idleRoute } from './route'

function initialShip(side: Side, spawn: Spawn, rules: Ruleset): ShipState {
  const spec = rules.ships[spawn.shipClass]
  return {
    entityId: `${side}-ship`, side, shipClass: spawn.shipClass, alive: true, destructionTick: null,
    position: cellCentre(spawn.cell, rules), headingMilliDegrees: spawn.headingMilliDegrees,
    hull: spec.maxHull, shields: spec.maxShields, energyMilli: spec.startingEnergyMilli, ammunition: spec.missileAmmunition,
    destination: null, route: idleRoute(), orders: null,
    laserReadyTick: 0, missileReadyTick: 0, exposureUntilTick: 0, trackingUntilTick: 0,
    pulseAttemptSpent: false, weaponIntentSpent: false,
    // Initial cloak is actual state at tick 0; sustain is charged from the first resolved tick.
    cloakRequested: spawn.initialOrders.cloak, cloakActive: spawn.initialOrders.cloak && spec.equipment.cloak, cloakLatch: 'none',
    propulsionInterrupted: false,
  }
}
function emptyKnowledge(): PrivateKnowledge {
  return { contacts: [], hostileMissiles: [], ownMissiles: [], nextContactAlias: 1, nextMissileAlias: 1 }
}
/** Patrol ordering is chosen by the planner from its own stream (TSB-40), not here. */
function initialPlannerMemory(): PlannerMemory {
  return { policy: 'PATROL', patrolOrder: [], patrolIndex: 0, rememberedContacts: [], searchDestination: null }
}

/** Fresh private state. The design gives neither side an initial contact. */
export const initialiseSession: InitialiseSession = (scenario, rules, seed) => {
  const checked = createScenario(scenario, rules)
  return freezeData({
    rulesVersion: rules.version, scenarioId: checked.id, scenarioVersion: checked.version, seed,
    random: {
      simulation: deriveStream(seed, STREAM_PURPOSE.simulation),
      planners: { player: deriveStream(seed, STREAM_PURPOSE.playerPlanner), patrol: deriveStream(seed, STREAM_PURPOSE.patrolPlanner) },
    },
    tick: 0, turnIndex: 0,
    ships: { player: initialShip('player', checked.spawns.player, rules), patrol: initialShip('patrol', checked.spawns.patrol, rules) },
    missiles: [],
    knowledge: { player: emptyKnowledge(), patrol: emptyKnowledge() },
    plannerMemory: { player: initialPlannerMemory(), patrol: initialPlannerMemory() },
    acceptedTurns: [], terminalPending: false, outcome: null,
  })
}

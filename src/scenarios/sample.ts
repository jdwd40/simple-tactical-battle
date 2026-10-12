import type { SideObservation } from '../contracts/public'
import { freezeData } from './freeze'
import { DUEL_MAP, DUEL_RULES } from './public'

/** Static contract example, not a session initializer. It includes no opposing spawn. */
const spec = DUEL_RULES.ships['shadow-dancer']
export const SAMPLE_PLAYER_OBSERVATION: SideObservation = freezeData({
  side: 'player', turnIndex: 0, tick: 0, map: DUEL_MAP,
  ownShip: {
    shipClass: 'shadow-dancer', name: spec.name, status: 'alive',
    position: { x: 3500, y: 10_500 }, headingMilliDegrees: 90_000,
    hull: { current: spec.maxHull, max: spec.maxHull }, shields: { current: spec.maxShields, max: spec.maxShields },
    energy: { currentMilli: spec.startingEnergyMilli, maxMilli: spec.maxEnergyMilli },
    ammunition: { current: spec.missileAmmunition, max: spec.missileAmmunition }, equipment: spec.equipment,
    destination: null, route: { waypoints: [], segmentIndex: 0, distanceAlongSegmentUnits: 0, remainingDistanceUnits: 0 },
    cloak: { requested: true, actual: true, state: 'active' }, sensor: 'passive',
    clocks: { laserReadyTick: 0, missileReadyTick: 0, exposureUntilTick: 0, trackingUntilTick: 0 }, interruptions: [],
    turnActions: { pulseAttemptSpent: false, weaponIntentSpent: false },
  },
  contacts: [], ownMissiles: [], hostileMissiles: [], events: [],
})

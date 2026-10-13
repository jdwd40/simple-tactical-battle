/**
 * Hand-authored PUBLIC observer frames for the combat component harness (TSB-31). Static
 * test data shaped by src/contracts/index.ts, not simulation output: every shot, hit, track
 * and missile position is written here, and nothing models lasers, missiles or damage.
 *
 * Authored turn (ticks 0..40, own ship holding at column 6, row 10):
 *   5   own laser at contact-1 (own-shot, observed-impact)
 *   12  contact-1 fires a laser at us (observed-shot, own-damage 35 shields)
 *   15  own missile launched towards column 12, row 9; telemetry every tick
 *   18  hostile missile-1 sighted; measured each tick until 26, then a last sighting
 *   30  own missile detonates at its aim (observed-impact, missile)
 */
import {
  DUEL_RULES, SAMPLE_PLAYER_OBSERVATION, cellCentre,
  type ContactMemory, type HostileOrdnanceMemory, type OwnMissileTelemetry, type Position, type PublicReplayFrame, type SideObservation, type VisibleEvent,
} from '../../../src/contracts'

export const rules = DUEL_RULES
export const map = SAMPLE_PLAYER_OBSERVATION.map
export const TURN_START = 0
export const TURN_END = 40
export const OWN_POSITION: Position = cellCentre({ column: 6, row: 10 }, rules)
export const MISSILE_AIM = { column: 12, row: 9 } as const
const AIM_POSITION = cellCentre(MISSILE_AIM, rules)

const contactPosition = (tick: number): Position => ({ x: 11_500 - tick * 10, y: 10_500 })
function contactAt(tick: number): ContactMemory {
  return { alias: 'contact-1', kind: 'current', measurement: { position: contactPosition(tick), tick }, ageTicks: 0, uncertaintyRadiusUnits: 0 }
}

const LAUNCH = 15
const DETONATION = 30
function ownMissileAt(tick: number): OwnMissileTelemetry | null {
  if (tick < LAUNCH) return null
  const t = Math.min(1, (tick - LAUNCH) / (DETONATION - LAUNCH))
  const position = { x: Math.round(OWN_POSITION.x + (AIM_POSITION.x - OWN_POSITION.x) * t), y: Math.round(OWN_POSITION.y + (AIM_POSITION.y - OWN_POSITION.y) * t) }
  return { id: 'own-missile-1', position, aim: MISSILE_AIM, launchTick: LAUNCH, updatedTick: tick, status: tick >= DETONATION ? 'detonated' : 'flying' }
}

const SIGHTED = 18
const LAST_SIGHTING = 26
const hostilePosition = (tick: number): Position => ({ x: 14_500 - (tick - SIGHTED) * 150, y: 4500 + (tick - SIGHTED) * 150 })
function hostileAt(tick: number): HostileOrdnanceMemory | null {
  if (tick < SIGHTED) return null
  if (tick <= LAST_SIGHTING) return { alias: 'missile-1', kind: 'current', measurement: { position: hostilePosition(tick), tick }, ageTicks: 0, uncertaintyRadiusUnits: 0 }
  const age = tick - LAST_SIGHTING
  return { alias: 'missile-1', kind: 'stale', measurement: { position: hostilePosition(LAST_SIGHTING), tick: LAST_SIGHTING }, ageTicks: age, uncertaintyRadiusUnits: age * rules.missile.speedUnitsPerTick }
}

function eventsAt(tick: number): VisibleEvent[] {
  const id = (n: number) => `t${tick}-00${n}`
  switch (tick) {
    case 5: return [
      { id: id(0), tick, kind: 'own-shot', position: OWN_POSITION, weapon: { kind: 'laser', contactAlias: 'contact-1' } },
      { id: id(1), tick, kind: 'own-energy', deltaMilli: -rules.laser.costMilli, reason: 'laser' },
      { id: id(2), tick, kind: 'observed-impact', position: contactPosition(tick), weapon: 'laser', contactAlias: 'contact-1' },
    ]
    case 12: return [
      { id: id(0), tick, kind: 'observed-shot', sourceAlias: 'contact-1', position: contactPosition(tick), weapon: 'laser' },
      { id: id(1), tick, kind: 'own-damage', shieldsLost: 35, hullLost: 0 },
    ]
    case LAUNCH: return [
      { id: id(0), tick, kind: 'own-shot', position: OWN_POSITION, weapon: { kind: 'missile', aim: MISSILE_AIM } },
      { id: id(1), tick, kind: 'own-ammunition', delta: -1 },
    ]
    case SIGHTED: return [{ id: id(0), tick, kind: 'hostile-missile-sighted', missile: hostileAt(tick)! }]
    case LAST_SIGHTING + 1: return [{ id: id(0), tick, kind: 'hostile-missile-lost', missile: hostileAt(tick)! }]
    case DETONATION: return [
      { id: id(0), tick, kind: 'own-missile', missile: ownMissileAt(tick)! },
      { id: id(1), tick, kind: 'observed-impact', position: AIM_POSITION, weapon: 'missile' },
    ]
    default: return []
  }
}

function frameAt(tick: number, turnIndex: number, withEvents = true): PublicReplayFrame {
  const base = SAMPLE_PLAYER_OBSERVATION
  const missile = ownMissileAt(tick)
  const hostile = hostileAt(tick)
  const events = withEvents ? eventsAt(tick) : []
  const own = base.ownShip
  return {
    tick,
    events,
    observation: {
      ...base, turnIndex, tick, events,
      ownShip: {
        ...own, position: OWN_POSITION,
        shields: { current: tick >= 12 ? own.shields.max - 35 : own.shields.max, max: own.shields.max },
        ammunition: { current: own.ammunition.current - (tick >= LAUNCH ? 1 : 0), max: own.ammunition.max },
        clocks: { ...own.clocks, laserReadyTick: tick >= 5 ? 5 + rules.timing.laserCooldownTicks : 0, missileReadyTick: tick >= LAUNCH ? LAUNCH + rules.timing.missileCooldownTicks : 0 },
      },
      contacts: [contactAt(tick)],
      ownMissiles: missile ? [missile] : [],
      hostileMissiles: hostile ? [hostile] : [],
    },
  }
}

/** The whole authored turn. Only the fixture controller holds it; the console sees cursor prefixes. */
export const TURN_FRAMES: readonly PublicReplayFrame[] = Array.from({ length: TURN_END + 1 }, (_, tick) => frameAt(tick, 0))
/** Planning frame before that turn: a current contact five cells east, weapons ready. */
export const PLANNING_FRAME: PublicReplayFrame = frameAt(0, 0, false)

/**
 * Crowded planning frame for label-placement checks (TSB-50): the own ship one cell from the
 * right edge with markers on every side, a stale contact with a map-sized uncertainty area,
 * and own and hostile ordnance near each other. Hand-written public data, no simulation.
 */
export const CROWDED_OWN = cellCentre({ column: 18, row: 10 }, rules)
export const CROWDED_DESTINATION = { column: 19, row: 10 } as const
export const CROWDED_AIM = { column: 17, row: 9 } as const
export const CROWDED_FRAME: PublicReplayFrame = (() => {
  const base = SAMPLE_PLAYER_OBSERVATION
  const tick = 400
  const observation = {
    ...base, tick, turnIndex: 4, events: [],
    ownShip: { ...base.ownShip, position: CROWDED_OWN, destination: CROWDED_DESTINATION },
    contacts: [
      { alias: 'contact-1', kind: 'current', measurement: { position: cellCentre({ column: 19, row: 9 }, rules), tick }, ageTicks: 0, uncertaintyRadiusUnits: 0 },
      { alias: 'contact-2', kind: 'stale', measurement: { position: cellCentre({ column: 17, row: 11 }, rules), tick: tick - 300 }, ageTicks: 300, uncertaintyRadiusUnits: 300 * rules.maxShipSpeedUnitsPerTick },
      { alias: 'contact-3', kind: 'stale', measurement: { position: cellCentre({ column: 18, row: 12 }, rules), tick: tick - 15 }, ageTicks: 15, uncertaintyRadiusUnits: 15 * rules.maxShipSpeedUnitsPerTick },
    ],
    ownMissiles: [{ id: 'own-missile-2', position: cellCentre({ column: 18, row: 9 }, rules), aim: { column: 15, row: 9 }, launchTick: 392, updatedTick: tick, status: 'flying' }],
    hostileMissiles: [{ alias: 'missile-1', kind: 'current', measurement: { position: cellCentre({ column: 19, row: 11 }, rules), tick }, ageTicks: 0, uncertaintyRadiusUnits: 0 }],
  } satisfies SideObservation
  return { tick, observation, events: [] }
})()
export const cellCentreOf = (cell: { readonly column: number; readonly row: number }) => cellCentre(cell, rules)

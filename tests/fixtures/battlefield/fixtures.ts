/**
 * Hand-authored PUBLIC observer frames for the battlefield harness. These are static test
 * data shaped by src/contracts/index.ts, not simulation output: the waypoints and contact
 * track are written by hand and nothing here models pathfinding, sensing or combat.
 */
import {
  DUEL_RULES, SAMPLE_PLAYER_OBSERVATION, cellCentre, isAsteroidCell,
  type Cell, type ContactMemory, type OwnRoutePreview, type Position, type PublicReplayFrame,
  type SideObservation, type ValidationIssue, type VisibleEvent,
} from '../../../src/contracts'

export const rules = DUEL_RULES
export const map = SAMPLE_PLAYER_OBSERVATION.map
const UNITS = rules.geometry.unitsPerCell

/** Authored route: east along row 10, diagonal to row 8, then east towards column 15. */
const WAYPOINTS: readonly Position[] = [
  { x: 3500, y: 10_500 }, { x: 9500, y: 10_500 }, { x: 11_500, y: 8500 }, { x: 15_500, y: 8500 },
]
export const DESTINATION: Cell = { column: 15, row: 8 }
const SHIP_UNITS_PER_TICK = 100
const HEADINGS = [90_000, 45_000, 90_000]

function routeAt(distance: number) {
  let remaining = distance
  for (let index = 0; index < WAYPOINTS.length - 1; index += 1) {
    const a = WAYPOINTS[index]
    const b = WAYPOINTS[index + 1]
    const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y))
    if (remaining <= length || index === WAYPOINTS.length - 2) {
      const along = Math.min(remaining, length)
      return {
        position: { x: Math.round(a.x + ((b.x - a.x) * along) / length), y: Math.round(a.y + ((b.y - a.y) * along) / length) },
        segmentIndex: index, along, heading: HEADINGS[index],
        remainingDistance: length - along + WAYPOINTS.slice(index + 1).reduce((sum, point, k, rest) => (
          k + 1 < rest.length ? sum + Math.round(Math.hypot(rest[k + 1].x - point.x, rest[k + 1].y - point.y)) : sum), 0),
      }
    }
    remaining -= length
  }
  throw new Error('unreachable')
}

/** Contact track: detected at tick 20, measured each tick until 55, then lost. */
const CONTACT_FIRST = 20
const CONTACT_LAST = 55
const CONTACT_START: Position = { x: 17_500, y: 13_500 }
const CONTACT_VELOCITY = { xUnitsPerTick: -60, yUnitsPerTick: -40 }
const contactPosition = (tick: number): Position => ({
  x: CONTACT_START.x + CONTACT_VELOCITY.xUnitsPerTick * (tick - CONTACT_FIRST),
  y: CONTACT_START.y + CONTACT_VELOCITY.yUnitsPerTick * (tick - CONTACT_FIRST),
})

function contactAt(tick: number): ContactMemory | null {
  if (tick < CONTACT_FIRST) return null
  if (tick <= CONTACT_LAST) {
    const measurement = { position: contactPosition(tick), tick }
    return tick === CONTACT_FIRST
      ? { alias: 'contact-1', kind: 'current', measurement, ageTicks: 0, uncertaintyRadiusUnits: 0 }
      : {
        alias: 'contact-1', kind: 'current', measurement, ageTicks: 0, uncertaintyRadiusUnits: 0,
        previousMeasurement: { position: contactPosition(tick - 1), tick: tick - 1 }, estimatedVelocity: CONTACT_VELOCITY,
      }
  }
  const age = tick - CONTACT_LAST
  return {
    alias: 'contact-1', kind: 'stale', measurement: { position: contactPosition(CONTACT_LAST), tick: CONTACT_LAST },
    previousMeasurement: { position: contactPosition(CONTACT_LAST - 1), tick: CONTACT_LAST - 1 }, estimatedVelocity: CONTACT_VELOCITY,
    ageTicks: age, uncertaintyRadiusUnits: age * rules.maxShipSpeedUnitsPerTick,
  }
}

function eventsAt(tick: number): VisibleEvent[] {
  const contact = contactAt(tick)
  if (tick === CONTACT_FIRST && contact) return [{ id: `e${tick}-acquired`, tick, kind: 'contact-acquired', contact }]
  if (tick === CONTACT_LAST + 1 && contact) return [{ id: `e${tick}-lost`, tick, kind: 'contact-lost', contact }]
  return []
}

function observationAt(tick: number, turnIndex: number): SideObservation {
  const route = routeAt(tick * SHIP_UNITS_PER_TICK)
  const contact = contactAt(tick)
  return {
    ...SAMPLE_PLAYER_OBSERVATION,
    turnIndex,
    tick,
    ownShip: {
      ...SAMPLE_PLAYER_OBSERVATION.ownShip,
      position: route.position,
      headingMilliDegrees: tick === 0 ? SAMPLE_PLAYER_OBSERVATION.ownShip.headingMilliDegrees : route.heading,
      destination: DESTINATION,
      route: { waypoints: WAYPOINTS, segmentIndex: route.segmentIndex, distanceAlongSegmentUnits: route.along, remainingDistanceUnits: route.remainingDistance },
    },
    contacts: contact ? [contact] : [],
    events: eventsAt(tick),
  }
}

/** The whole authored turn. Only the harness holds this; components receive cursor prefixes. */
export const TURN_START = 0
export const TURN_END = rules.timing.turnTicks
export const TURN_FRAMES: readonly PublicReplayFrame[] = Array.from({ length: TURN_END + 1 }, (_, tick) => {
  const observation = observationAt(tick, 0)
  return { tick, observation, events: observation.events }
})

/** Planning frame after the authored turn: carried destination, stale contact memory. */
export const PLANNING_FRAME: PublicReplayFrame = (() => {
  const observation = { ...observationAt(TURN_END, 1), events: [] }
  return { tick: TURN_END, observation, events: [] }
})()

/**
 * Harness stand-in for the engine's preview/validation: a straight line to the chosen cell.
 * It exists only so the harness can show supplied data; production previews come from the engine.
 */
export function fixturePreview(from: Position, cell: Cell): { preview: OwnRoutePreview; issues: ValidationIssue[] } {
  if (isAsteroidCell(cell, map)) {
    const issues: ValidationIssue[] = [{ field: 'movement', severity: 'error', code: 'obstacle', details: { cell } }]
    return { preview: { kind: 'unavailable', issues }, issues }
  }
  const target = cellCentre(cell, rules)
  const distance = Math.hypot(target.x - from.x, target.y - from.y)
  const reach = Math.min(1, (SHIP_UNITS_PER_TICK * TURN_END) / Math.max(1, distance))
  return {
    preview: {
      kind: 'destination', destination: cell, waypoints: [from, target],
      nominalReachablePoint: { x: Math.round(from.x + (target.x - from.x) * reach), y: Math.round(from.y + (target.y - from.y) * reach) },
      predicted: true, conditionalOnPropulsionFunding: true,
    },
    issues: [{ field: 'movement', severity: 'conditional', code: 'propulsion-funding' }],
  }
}

export const unitsPerCell = UNITS

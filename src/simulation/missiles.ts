import type { MissileState, PrivateKnowledge } from '../contracts/private'
import type { HostileOrdnanceMemory, OwnMissileTelemetry, Position, PublicMap, Ruleset, Side, Tick } from '../contracts/public'
import { distanceUnits, hasLineOfSight, interpolate } from './geometry'
import { uncertaintyUnits } from './sensing'

export type MissileEnd = 'asteroid' | 'ship' | 'arrival' | 'exit' | 'expiry'
/** One ship's stage-3 motion for this tick, for ships alive at tick start (the pre-damage alive set). */
export interface ShipMotion { readonly entityId: string; readonly side: Side; readonly start: Position; readonly end: Position }
export interface MissileResolution {
  /** Time fraction of the tick in [0, 1]; the earliest wins, ties by asteroid → ship → arrival → exit/expiry. */
  readonly fraction: number; readonly reason: MissileEnd
  /** Exact impact point (may be fractional); public payloads round it. */
  readonly point: Position
  readonly directVictimId?: string
  /** Every eligible victim once: the direct victim plus splash within blast radius and line of sight. */
  readonly victimIds: readonly string[]
}
export type MissileStep = { readonly missile: MissileState; readonly resolution: MissileResolution | null }

const sub = (a: Position, b: Position): Position => ({ x: a.x - b.x, y: a.y - b.y })
const along = (p: Position, d: Position, u: number): Position => ({ x: p.x + u * d.x, y: p.y + u * d.y })

/** Earliest u in [0, 1] with |r0 + u·dr| ≤ radius (closed), or null. */
function circleEntry(r0: Position, dr: Position, radius: number): number | null {
  const c = r0.x * r0.x + r0.y * r0.y - radius * radius
  if (c <= 0) return 0
  const a = dr.x * dr.x + dr.y * dr.y
  const b = r0.x * dr.x + r0.y * dr.y
  if (a === 0 || b >= 0) return null
  const discriminant = b * b - a * c
  if (discriminant < 0) return null
  const u = (-b - Math.sqrt(discriminant)) / a
  return u <= 1 ? u : null
}
/** Earliest u in [0, 1] at which p + u·d lies in the closed box, or null. */
function boxEntry(p: Position, d: Position, x0: number, y0: number, x1: number, y1: number): number | null {
  let enter = 0
  let exit = 1
  for (const [start, delta, low, high] of [[p.x, d.x, x0, x1], [p.y, d.y, y0, y1]] as const) {
    if (delta === 0) {
      if (start < low || start > high) return null
      continue
    }
    const t0 = (low - start) / delta
    const t1 = (high - start) / delta
    enter = Math.max(enter, Math.min(t0, t1))
    exit = Math.min(exit, Math.max(t0, t1))
    if (enter > exit) return null
  }
  return enter
}
/** Earliest u at which a circle of `radius` swept along p + u·d touches an asteroid cell rectangle. */
function asteroidEntry(p: Position, d: Position, radius: number, map: PublicMap, rules: Ruleset): number | null {
  const units = rules.geometry.unitsPerCell
  let earliest: number | null = null
  for (const { column, row } of map.asteroidCells) {
    const x0 = column * units
    const y0 = row * units
    const x1 = x0 + units
    const y1 = y0 + units
    // Minkowski sum of rectangle and disc: two expanded boxes and four corner discs.
    const entries = [
      boxEntry(p, d, x0 - radius, y0, x1 + radius, y1), boxEntry(p, d, x0, y0 - radius, x1, y1 + radius),
      ...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => circleEntry(sub(p, { x, y }), d, radius)),
    ]
    for (const u of entries) if (u !== null && (earliest === null || u < earliest)) earliest = u
  }
  return earliest
}

/**
 * Stage 6 for one missile present at tick start. Integer progress along launch → aim is retained;
 * this tick's path segment is swept against asteroid rectangles and, relative to each opposing
 * ship's own start → end motion, against that ship's circle. Launch and aim lie inside the convex
 * arena, so a straight path never exits the map; `exit` stays a reserved end reason.
 */
export function stepMissile(missile: MissileState, ships: readonly ShipMotion[], now: Tick, rules: Ruleset, map: PublicMap): MissileStep {
  const speed = rules.missile.speedUnitsPerTick
  const length = distanceUnits(missile.launchPosition, missile.aimPosition)
  const travelled = Math.min(length, missile.distanceTravelledUnits + speed)
  const start = missile.position
  const end = length === 0 ? { ...missile.aimPosition } : interpolate(missile.launchPosition, missile.aimPosition, travelled, length)
  // Time fraction at which `end` is reached; u along start → end maps to fraction u·moveFraction.
  const moveFraction = (travelled - missile.distanceTravelledUnits) / speed
  const path = sub(end, start)
  const candidates: { fraction: number; rank: number; reason: MissileEnd; u: number; victim?: string }[] = []
  const rock = asteroidEntry(start, path, rules.geometry.missileRadiusUnits, map, rules)
  if (rock !== null) candidates.push({ fraction: rock * moveFraction, rank: 0, reason: 'asteroid', u: rock })
  const contactRadius = rules.geometry.missileRadiusUnits + rules.geometry.shipRadiusUnits
  for (const ship of ships) {
    if (ship.side === missile.launcherSide) continue // the launcher is excluded from direct collision
    const shipPath = sub(ship.end, ship.start)
    const u = circleEntry(sub(start, ship.start), { x: path.x - moveFraction * shipPath.x, y: path.y - moveFraction * shipPath.y }, contactRadius)
    if (u !== null) candidates.push({ fraction: u * moveFraction, rank: 1, reason: 'ship', u, victim: ship.entityId })
  }
  if (travelled === length) candidates.push({ fraction: moveFraction, rank: 2, reason: 'arrival', u: 1 })
  if (now >= missile.expiresAtTick) candidates.push({ fraction: 1, rank: 3, reason: 'expiry', u: 1 })
  const advanced = { ...missile, position: end, distanceTravelledUnits: travelled }
  if (candidates.length === 0) return { missile: advanced, resolution: null }
  const first = candidates.reduce((best, next) => (next.fraction < best.fraction || (next.fraction === best.fraction && next.rank < best.rank) ? next : best))
  const point = along(start, path, first.u)
  const victimIds = first.reason === 'expiry' || first.reason === 'exit' ? [] : ships.filter((ship) => {
    if (ship.entityId === first.victim) return true
    const at = along(ship.start, sub(ship.end, ship.start), first.fraction)
    const dx = at.x - point.x
    const dy = at.y - point.y
    return dx * dx + dy * dy <= rules.missile.blastRadiusUnits ** 2 && hasLineOfSight(point, at, map, rules)
  }).map((ship) => ship.entityId)
  return {
    missile: advanced,
    resolution: { fraction: first.fraction, reason: first.reason, point, ...(first.victim === undefined ? {} : { directVictimId: first.victim }), victimIds },
  }
}

export const roundedPosition = (p: Position): Position => ({ x: Math.round(p.x), y: Math.round(p.y) })

export type OrdnanceEvent =
  | { readonly kind: 'hostile-missile-sighted' | 'hostile-missile-lost'; readonly missile: HostileOrdnanceMemory }
  | { readonly kind: 'hostile-missile-expired'; readonly alias: string }

/**
 * One stage-7 hostile-ordnance update per tick. A sighted missile is current under a stable local
 * alias; an unseen one becomes an age-labelled last sighting whose uncertainty grows at the public
 * missile speed. Memory ends only when the observer itself saw the missile end, or after the public
 * lifetime bound since its last sighting; an unseen resolution never deletes it.
 */
export function updateHostileMissiles(
  knowledge: PrivateKnowledge, sightings: readonly { readonly missileId: string; readonly position: Position }[],
  endedInSight: ReadonlySet<string>, now: Tick, rules: Ruleset, map: PublicMap,
): { readonly knowledge: PrivateKnowledge; readonly events: readonly OrdnanceEvent[] } {
  const unseen = new Map(sightings.map((sighting) => [sighting.missileId, sighting.position]))
  const hostileMissiles: { missileId: string; memory: HostileOrdnanceMemory }[] = []
  const events: OrdnanceEvent[] = []
  const current = (alias: string, position: Position): HostileOrdnanceMemory =>
    ({ alias, measurement: { position: roundedPosition(position), tick: now }, kind: 'current', ageTicks: 0, uncertaintyRadiusUnits: 0 })
  for (const { missileId, memory } of knowledge.hostileMissiles) {
    const position = unseen.get(missileId)
    unseen.delete(missileId)
    const ageTicks = now - memory.measurement.tick
    if (endedInSight.has(missileId) || (position === undefined && ageTicks >= rules.timing.missileLifetimeTicks)) {
      events.push({ kind: 'hostile-missile-expired', alias: memory.alias })
      continue
    }
    if (position !== undefined) {
      const next = current(memory.alias, position)
      hostileMissiles.push({ missileId, memory: next })
      if (memory.kind === 'stale') events.push({ kind: 'hostile-missile-sighted', missile: next })
      continue
    }
    const stale: HostileOrdnanceMemory = {
      alias: memory.alias, measurement: memory.measurement, kind: 'stale', ageTicks,
      uncertaintyRadiusUnits: uncertaintyUnits(memory.measurement.position, ageTicks, rules.missile.speedUnitsPerTick, rules, map),
    }
    hostileMissiles.push({ missileId, memory: stale })
    if (memory.kind === 'current') events.push({ kind: 'hostile-missile-lost', missile: stale })
  }
  let nextMissileAlias = knowledge.nextMissileAlias
  for (const [missileId, position] of unseen) {
    if (endedInSight.has(missileId)) continue // first seen as it ended: only the impact is observed
    const memory = current(`missile-${nextMissileAlias}`, position)
    nextMissileAlias += 1
    hostileMissiles.push({ missileId, memory })
    events.push({ kind: 'hostile-missile-sighted', missile: memory })
  }
  return { knowledge: { ...knowledge, hostileMissiles, nextMissileAlias }, events }
}

/**
 * Own telemetry: launches appear as flying, flying missiles report position each tick and resolved
 * ones keep their final point and status. It continues after the launcher's destruction and never
 * names what was struck.
 */
export function updateOwnTelemetry(
  telemetry: readonly OwnMissileTelemetry[], flying: readonly MissileState[],
  resolved: readonly { readonly missile: MissileState; readonly resolution: MissileResolution }[], now: Tick,
): OwnMissileTelemetry[] {
  const status = (reason: MissileEnd): OwnMissileTelemetry['status'] => (reason === 'expiry' ? 'expired' : reason === 'exit' ? 'exited-map' : 'detonated')
  const next = telemetry.map((entry) => {
    const moving = flying.find((missile) => missile.id === entry.id)
    if (moving !== undefined) return { ...entry, position: { ...moving.position }, updatedTick: now }
    const ended = resolved.find(({ missile }) => missile.id === entry.id)
    return ended === undefined ? entry : { ...entry, position: roundedPosition(ended.resolution.point), updatedTick: now, status: status(ended.resolution.reason) }
  })
  for (const missile of flying) {
    if (next.some((entry) => entry.id === missile.id)) continue
    next.push({ id: missile.id, position: { ...missile.position }, aim: { ...missile.aim }, launchTick: missile.launchTick, updatedTick: now, status: 'flying' })
  }
  return next
}

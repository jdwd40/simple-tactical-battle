import type {
  Cell, ContactMemory, HostileOrdnanceMemory, OwnRoutePreview, Position, PublicReplayFrame, Ruleset, SensorOrder, Tick, Velocity, WeaponOrder,
} from '../contracts'

/**
 * Presentation-only description of what the plot draws. Built exclusively from public
 * replay frames (already limited to the playback cursor) and the supplied route preview.
 */
export interface PlotContact {
  readonly alias: string
  readonly kind: 'current' | 'stale'
  readonly position: Position
  readonly measurementTick: Tick
  readonly ageTicks: number
  readonly uncertaintyRadiusUnits: number
  readonly velocity: Velocity | null
  readonly destroyed: boolean
  /** Chosen in the contact list; marked on the plot with corner brackets. */
  readonly selected: boolean
}

/**
 * Nominal own sensor reach from the public rules: an uncloaked, stationary target in clear
 * line of sight. It is never derived from any hidden target and guarantees no detection.
 * `pulse-preview` is the draft's tracking reach, only if the pulse is funded.
 */
export interface PlotSensorRing {
  readonly kind: 'passive' | 'tracking' | 'pulse-preview'
  readonly radiusUnits: number
}

/** Own missile telemetry while it flies; its own aim is public to its launcher only. */
export interface PlotOwnMissile {
  readonly id: string
  readonly position: Position
  readonly aim: Cell
  readonly updatedTick: Tick
  /** Its own recent telemetry positions, oldest first (exhaust trail). */
  readonly trail: readonly Position[]
}

/** Observed hostile ordnance: a measured sighting or an aged last sighting. Never its aim. */
export interface PlotHostileMissile {
  readonly alias: string
  readonly kind: 'current' | 'stale'
  readonly position: Position
  readonly measurementTick: Tick
  readonly ageTicks: number
  readonly uncertaintyRadiusUnits: number
  /** Consecutive current sightings just before this one, oldest first; empty for a last sighting. */
  readonly trail: readonly Position[]
}

/** The draft (or committed, not yet fired) weapon intent as a plot preview. */
export type PlotWeaponPlan =
  | { readonly kind: 'laser'; readonly alias: string; readonly target: Position | null; readonly current: boolean; readonly rangeUnits: number }
  | { readonly kind: 'missile'; readonly aim: Cell; readonly blastRadiusUnits: number }

/**
 * Marks for recorded events at or before the shown tick, from published events only:
 *   beam      a laser discharge (own, to the contact's measured position; or an observed enemy shot at us)
 *   hit       an observed impact naming a contact: a confirmed hit on it
 *   impact    an observed impact naming no contact: an explosion, ship damage unconfirmed
 *   own-hit   damage this ship took (exact shields/hull lost; no invented source)
 *   destroyed an observed destruction at its published position
 *   scan      this ship's successful active pulse
 */
export type PlotEffect = { readonly ageTicks: number; readonly durationTicks: number } & (
  | { readonly kind: 'beam'; readonly from: Position; readonly to: Position; readonly own: boolean }
  | { readonly kind: 'hit'; readonly at: Position; readonly alias: string; readonly weapon: 'laser' | 'missile'; readonly radiusUnits: number }
  | { readonly kind: 'impact'; readonly at: Position; readonly weapon: 'laser' | 'missile'; readonly radiusUnits: number }
  | { readonly kind: 'own-hit'; readonly at: Position; readonly shieldsLost: number; readonly hullLost: number }
  | { readonly kind: 'launch'; readonly at: Position; readonly own: boolean }
  | { readonly kind: 'destroyed'; readonly at: Position; readonly own: boolean; readonly alias: string | null }
  | { readonly kind: 'scan'; readonly at: Position; readonly radiusUnits: number }
)

/**
 * How long each mark stays, in ticks after its own tick. Presentation only: it never changes
 * when anything happened, and seeking back before the tick removes it again.
 */
export const EFFECT_DURATION: Readonly<Record<PlotEffect['kind'], number>> = {
  beam: 12, hit: 30, impact: 25, 'own-hit': 30, launch: 10, destroyed: 45, scan: 15,
}
const LONGEST_EFFECT = Math.max(...Object.values(EFFECT_DURATION))
type WithoutDuration<T> = T extends unknown ? Omit<T, 'durationTicks'> : never
/** Missile trails use at most this many recent recorded positions. */
const TRAIL_FRAMES = 10

export type PlotPlan =
  | { readonly kind: 'hold' }
  /** Draft preview: engine-supplied waypoints and a predicted (not guaranteed) turn-end point. */
  | { readonly kind: 'preview'; readonly destination: Cell; readonly path: readonly Position[]; readonly nominal: Position }
  /** Committed destination and the remaining engine route at this frame. */
  | { readonly kind: 'committed'; readonly destination: Cell; readonly path: readonly Position[] }

export interface PlotScene {
  readonly tick: Tick
  readonly ownShip: {
    readonly position: Position; readonly headingMilliDegrees: number; readonly destroyed: boolean
    /** Actual cloak and exposure at this frame (not the request). */
    readonly cloaked: boolean; readonly exposed: boolean
    /** Own shields and hull at this frame as fractions of their maxima. */
    readonly shieldFraction: number; readonly hullFraction: number
    /** Moved since the previous recorded frame (engine glow). */
    readonly moving: boolean
  }
  readonly sensorRings: readonly PlotSensorRing[]
  /** Own positions through the current frame, oldest first. */
  readonly trail: readonly Position[]
  readonly plan: PlotPlan | null
  readonly contacts: readonly PlotContact[]
  readonly weaponPlan: PlotWeaponPlan | null
  readonly ownMissiles: readonly PlotOwnMissile[]
  readonly hostileMissiles: readonly PlotHostileMissile[]
  readonly effects: readonly PlotEffect[]
}

export interface SceneInput {
  /** Starting frame plus frames through the cursor; the last is the current frame. */
  readonly frames: readonly PublicReplayFrame[]
  /** Planning only. Omit during execution, assessment and replay. */
  readonly routePreview?: OwnRoutePreview | null
  /** Public sensor rules; when given, the plot shows own sensor reach. */
  readonly sensors?: Ruleset['sensors'] | null
  /** Planning draft sensor order; an active pulse adds its predicted reach. */
  readonly draftSensor?: SensorOrder | null
  /** Alias chosen in the contact list; ignored when this frame does not know it. */
  readonly selectedAlias?: string | null
  /** Weapon intent to preview: the draft, or the committed intent until it fires. */
  readonly weapon?: WeaponOrder | null
  /** Public weapon figures for the previews and blast marks. */
  readonly weaponRules?: { readonly laserRangeUnits: number; readonly blastRadiusUnits: number } | null
}

const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y

function withStart(start: Position, waypoints: readonly Position[]): Position[] {
  return waypoints.length > 0 && samePosition(start, waypoints[0]) ? [...waypoints] : [start, ...waypoints]
}

function toHostileMissile(memory: HostileOrdnanceMemory, frames: readonly PublicReplayFrame[]): PlotHostileMissile {
  // Trail only through consecutive current sightings: never across a gap in knowledge.
  const trail: Position[] = []
  if (memory.kind === 'current') {
    let expected = memory.measurement.tick - 1
    for (let index = frames.length - 2; index >= 0 && trail.length < TRAIL_FRAMES; index -= 1) {
      const seen = frames[index].observation.hostileMissiles.find((other) => other.alias === memory.alias)
      if (!seen || seen.kind !== 'current' || seen.measurement.tick !== expected) break
      trail.unshift(seen.measurement.position)
      expected -= 1
    }
  }
  return {
    alias: memory.alias, kind: memory.kind, position: memory.measurement.position, measurementTick: memory.measurement.tick,
    ageTicks: memory.ageTicks, uncertaintyRadiusUnits: memory.uncertaintyRadiusUnits, trail,
  }
}

function ownMissileTrail(id: string, frames: readonly PublicReplayFrame[]): Position[] {
  const trail: Position[] = []
  for (let index = frames.length - 2; index >= 0 && trail.length < TRAIL_FRAMES; index -= 1) {
    const telemetry = frames[index].observation.ownMissiles.find((missile) => missile.id === id && missile.status === 'flying')
    if (!telemetry) break
    trail.unshift(telemetry.position)
  }
  return trail
}

/** Marks for events recorded in recent frames (through the shown tick), using only those frames' data. */
function recentEffects(frames: readonly PublicReplayFrame[], tick: Tick, blastRadiusUnits: number, scanRadiusUnits: number): PlotEffect[] {
  const effects: PlotEffect[] = []
  const add = (effect: WithoutDuration<PlotEffect>) => {
    const durationTicks = EFFECT_DURATION[effect.kind]
    if (effect.ageTicks < durationTicks) effects.push({ ...effect, durationTicks } as PlotEffect)
  }
  for (let index = frames.length - 1; index >= 0 && frames[index].tick > tick - LONGEST_EFFECT; index -= 1) {
    const frame = frames[index]
    const ageTicks = tick - frame.tick
    const own = frame.observation.ownShip.position
    for (const event of frame.events) {
      if (event.kind === 'own-shot') {
        if (event.weapon.kind === 'laser') {
          const alias = event.weapon.contactAlias
          const target = frame.observation.contacts.find((contact) => contact.alias === alias)
          if (target) add({ kind: 'beam', from: event.position, to: target.measurement.position, own: true, ageTicks })
        } else add({ kind: 'launch', at: event.position, own: true, ageTicks })
      } else if (event.kind === 'observed-shot') {
        if (event.weapon === 'laser') add({ kind: 'beam', from: event.position, to: own, own: false, ageTicks })
        else add({ kind: 'launch', at: event.position, own: false, ageTicks })
      } else if (event.kind === 'observed-impact') {
        const radiusUnits = event.weapon === 'missile' ? blastRadiusUnits : 0
        if (event.contactAlias) add({ kind: 'hit', at: event.position, alias: event.contactAlias, weapon: event.weapon, radiusUnits, ageTicks })
        else add({ kind: 'impact', at: event.position, weapon: event.weapon, radiusUnits, ageTicks })
      } else if (event.kind === 'own-damage') {
        add({ kind: 'own-hit', at: own, shieldsLost: event.shieldsLost, hullLost: event.hullLost, ageTicks })
      } else if (event.kind === 'observed-destruction') {
        add({ kind: 'destroyed', at: event.position, own: false, alias: event.contactAlias, ageTicks })
      } else if (event.kind === 'own-destruction') {
        add({ kind: 'destroyed', at: event.position, own: true, alias: null, ageTicks })
      } else if (event.kind === 'own-energy' && event.reason === 'pulse' && scanRadiusUnits > 0) {
        add({ kind: 'scan', at: own, radiusUnits: scanRadiusUnits, ageTicks })
      }
    }
  }
  return effects
}

function toPlotContact(contact: ContactMemory, selectedAlias: string | null): PlotContact {
  return {
    alias: contact.alias,
    kind: contact.kind,
    position: contact.measurement.position,
    measurementTick: contact.measurement.tick,
    ageTicks: contact.ageTicks,
    uncertaintyRadiusUnits: contact.uncertaintyRadiusUnits,
    velocity: contact.estimatedVelocity ?? null,
    destroyed: contact.observedDestructionTick !== undefined,
    selected: contact.alias === selectedAlias,
  }
}

export function buildScene({ frames, routePreview = null, sensors = null, draftSensor = null, selectedAlias = null, weapon = null, weaponRules = null }: SceneInput): PlotScene {
  const current = frames.at(-1)
  if (!current) throw new Error('A plot scene needs at least the current frame')
  const own = current.observation.ownShip

  const trail: Position[] = []
  for (const frame of frames) {
    const position = frame.observation.ownShip.position
    if (trail.length === 0 || !samePosition(trail[trail.length - 1], position)) trail.push(position)
  }

  let plan: PlotPlan | null = null
  if (routePreview) {
    if (routePreview.kind === 'hold') plan = { kind: 'hold' }
    else if (routePreview.kind === 'destination') {
      plan = { kind: 'preview', destination: routePreview.destination, path: withStart(own.position, routePreview.waypoints), nominal: routePreview.nominalReachablePoint }
    }
  } else if (own.destination) {
    const remaining = own.route.waypoints.slice(own.route.segmentIndex + 1)
    plan = { kind: 'committed', destination: own.destination, path: withStart(own.position, remaining) }
  }

  const destroyed = own.status === 'destroyed'
  const sensorRings: PlotSensorRing[] = []
  if (sensors && !destroyed) {
    sensorRings.push(own.sensor === 'tracking'
      ? { kind: 'tracking', radiusUnits: sensors.activeUncloakedRangeUnits }
      : { kind: 'passive', radiusUnits: sensors.passiveUncloakedRangeUnits })
    if (draftSensor === 'activePulse' && own.sensor !== 'tracking') {
      sensorRings.push({ kind: 'pulse-preview', radiusUnits: sensors.activeUncloakedRangeUnits })
    }
  }

  let weaponPlan: PlotWeaponPlan | null = null
  if (weapon && weaponRules && !destroyed) {
    if (weapon.kind === 'laser') {
      const target = current.observation.contacts.find((contact) => contact.alias === weapon.contactAlias)
      weaponPlan = { kind: 'laser', alias: weapon.contactAlias, target: target?.measurement.position ?? null, current: target?.kind === 'current', rangeUnits: weaponRules.laserRangeUnits }
    } else if (weapon.kind === 'missile') {
      weaponPlan = { kind: 'missile', aim: weapon.aim, blastRadiusUnits: weaponRules.blastRadiusUnits }
    }
  }

  return {
    tick: current.tick,
    ownShip: {
      position: own.position, headingMilliDegrees: own.headingMilliDegrees, destroyed,
      cloaked: own.cloak.actual, exposed: own.clocks.exposureUntilTick > current.tick,
      shieldFraction: own.shields.max > 0 ? own.shields.current / own.shields.max : 0,
      hullFraction: own.hull.max > 0 ? own.hull.current / own.hull.max : 0,
      moving: frames.length > 1 && !samePosition(frames[frames.length - 2].observation.ownShip.position, own.position),
    },
    trail,
    plan,
    contacts: current.observation.contacts.map((contact) => toPlotContact(contact, selectedAlias)),
    sensorRings,
    weaponPlan,
    ownMissiles: current.observation.ownMissiles
      .filter((missile) => missile.status === 'flying')
      .map((missile) => ({ id: missile.id, position: missile.position, aim: missile.aim, updatedTick: missile.updatedTick, trail: ownMissileTrail(missile.id, frames) })),
    hostileMissiles: current.observation.hostileMissiles.map((memory) => toHostileMissile(memory, frames)),
    effects: recentEffects(frames, current.tick, weaponRules?.blastRadiusUnits ?? 0, sensors?.activeUncloakedRangeUnits ?? 0),
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpPosition = (a: Position, b: Position, t: number): Position => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })

/**
 * Presentation smoothing across one known interval n-1..n. Only the own ship and contacts
 * measured as current in both contiguous frames move between their recorded positions;
 * everything else shows frame n exactly. Uncertainty radii always come from the frames,
 * never from elapsed wall time, and nothing is extrapolated beyond frame n.
 */
export function interpolateScene(from: PlotScene, to: PlotScene, t: number): PlotScene {
  if (to.tick !== from.tick + 1 || t >= 1) return to
  const progress = Math.max(0, t)
  const shipPosition = to.ownShip.destroyed || from.ownShip.destroyed
    ? to.ownShip.position
    : lerpPosition(from.ownShip.position, to.ownShip.position, progress)

  const previous = new Map(from.contacts.map((contact) => [contact.alias, contact]))
  const contacts = to.contacts.map((contact) => {
    const before = previous.get(contact.alias)
    const continuous = before !== undefined && before.kind === 'current' && contact.kind === 'current'
      && before.measurementTick === from.tick && contact.measurementTick === to.tick
    return continuous ? { ...contact, position: lerpPosition(before.position, contact.position, progress) } : contact
  })

  // Own missiles report every tick; hostile ordnance moves only between two current sightings.
  const ownBefore = new Map(from.ownMissiles.map((missile) => [missile.id, missile]))
  const ownMissiles = to.ownMissiles.map((missile) => {
    const before = ownBefore.get(missile.id)
    return before && before.updatedTick === from.tick && missile.updatedTick === to.tick
      ? { ...missile, position: lerpPosition(before.position, missile.position, progress) } : missile
  })
  const hostileBefore = new Map(from.hostileMissiles.map((missile) => [missile.alias, missile]))
  const hostileMissiles = to.hostileMissiles.map((missile) => {
    const before = hostileBefore.get(missile.alias)
    const continuous = before !== undefined && before.kind === 'current' && missile.kind === 'current'
      && before.measurementTick === from.tick && missile.measurementTick === to.tick
    return continuous ? { ...missile, position: lerpPosition(before.position, missile.position, progress) } : missile
  })

  const trail = [...from.trail]
  if (trail.length === 0 || !samePosition(trail[trail.length - 1], shipPosition)) trail.push(shipPosition)
  return { ...to, ownShip: { ...to.ownShip, position: shipPosition }, trail, contacts, ownMissiles, hostileMissiles }
}

/** Split a path at the point closest to `nominal`, giving the predicted reach and the remainder. */
export function splitPathAt(path: readonly Position[], nominal: Position): { reach: Position[]; beyond: Position[] } {
  if (path.length < 2) return { reach: [...path], beyond: [] }
  let best = { index: 0, point: path[0], distance: Infinity }
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]
    const b = path[index]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((nominal.x - a.x) * dx + (nominal.y - a.y) * dy) / lengthSquared))
    const point = { x: a.x + dx * t, y: a.y + dy * t }
    const distance = Math.hypot(point.x - nominal.x, point.y - nominal.y)
    if (distance < best.distance) best = { index, point, distance }
  }
  return {
    reach: [...path.slice(0, best.index), best.point],
    beyond: [best.point, ...path.slice(best.index)],
  }
}

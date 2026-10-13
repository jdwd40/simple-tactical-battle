import type {
  Cell, ContactMemory, OwnRoutePreview, Position, PublicReplayFrame, Ruleset, SensorOrder, Tick, Velocity,
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
  }
  readonly sensorRings: readonly PlotSensorRing[]
  /** Own positions through the current frame, oldest first. */
  readonly trail: readonly Position[]
  readonly plan: PlotPlan | null
  readonly contacts: readonly PlotContact[]
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
}

const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y

function withStart(start: Position, waypoints: readonly Position[]): Position[] {
  return waypoints.length > 0 && samePosition(start, waypoints[0]) ? [...waypoints] : [start, ...waypoints]
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

export function buildScene({ frames, routePreview = null, sensors = null, draftSensor = null, selectedAlias = null }: SceneInput): PlotScene {
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

  return {
    tick: current.tick,
    ownShip: {
      position: own.position, headingMilliDegrees: own.headingMilliDegrees, destroyed,
      cloaked: own.cloak.actual, exposed: own.clocks.exposureUntilTick > current.tick,
    },
    trail,
    plan,
    contacts: current.observation.contacts.map((contact) => toPlotContact(contact, selectedAlias)),
    sensorRings,
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

  const trail = [...from.trail]
  if (trail.length === 0 || !samePosition(trail[trail.length - 1], shipPosition)) trail.push(shipPosition)
  return { ...to, ownShip: { ...to.ownShip, position: shipPosition }, trail, contacts }
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

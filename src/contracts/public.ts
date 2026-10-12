/** JSON data contracts. Coordinates, clocks and gauges use the units in README.md. */
export type Side = 'player' | 'patrol'
export type ShipClass = 'shadow-dancer' | 'patrol-frigate'
export type Tick = number
export type HeadingMilliDegrees = number
export interface Cell { readonly column: number; readonly row: number }
export interface Position { readonly x: number; readonly y: number }
export interface Velocity { readonly xUnitsPerTick: number; readonly yUnitsPerTick: number }
export interface PublicMap {
  readonly columns: number
  readonly rows: number
  readonly asteroidCells: readonly Cell[]
}
export interface ShipSpec {
  readonly name: string
  readonly speedUnitsPerSecond: number
  readonly speedUnitsPerTick: number
  readonly maxHull: number
  readonly maxShields: number
  readonly startingEnergyMilli: number
  readonly maxEnergyMilli: number
  readonly regenerationMilliPerSecond: number
  readonly regenerationMilliPerTick: number
  readonly propulsionMilliPerSecond: number
  readonly propulsionMilliPerTick: number
  readonly cloakMilliPerSecond: number
  readonly cloakMilliPerTick: number
  readonly missileAmmunition: number
  readonly equipment: Equipment
}
export interface Equipment {
  readonly cloak: boolean
  readonly activeSensor: boolean
  readonly laser: boolean
  readonly missileLauncher: boolean
}
export interface Ruleset {
  readonly version: string
  readonly timing: {
    readonly tickMs: number; readonly turnMs: number; readonly turnTicks: number
    readonly trackingTicks: number; readonly exposureTicks: number; readonly contactMemoryTicks: number
    readonly laserCooldownTicks: number; readonly missileCooldownTicks: number; readonly missileLifetimeTicks: number
  }
  readonly geometry: {
    readonly unitsPerCell: number; readonly shipRadiusUnits: number; readonly missileRadiusUnits: number
    readonly cardinalRouteCost: number; readonly diagonalRouteCost: number
  }
  readonly sensors: {
    readonly passiveUncloakedRangeUnits: number; readonly passiveCloakedRangeUnits: number
    readonly activeUncloakedRangeUnits: number; readonly activeCloakedRangeUnits: number
    readonly movingSignatureBonusUnits: number; readonly exposedRangeUnits: number
    readonly passiveMissileRangeUnits: number; readonly activeMissileRangeUnits: number
    readonly pulseCostMilli: number
  }
  readonly laser: { readonly costMilli: number; readonly damage: number; readonly rangeUnits: number }
  readonly missile: {
    readonly costMilli: number; readonly damage: number; readonly speedUnitsPerSecond: number
    readonly speedUnitsPerTick: number; readonly blastRadiusUnits: number
  }
  readonly ships: Readonly<Record<ShipClass, ShipSpec>>
  readonly maxShipSpeedUnitsPerTick: number
  /** ceil(missileLifetimeTicks / turnTicks); ammo-dependent bound uses this multiplier. */
  readonly aftermathWindowsPerLaunch: number
  readonly diagnosticTurnLimit: number
}
export interface PublicScenario {
  readonly id: string; readonly version: string; readonly title: string; readonly map: PublicMap
}
export type MovementOrder = { readonly kind: 'hold' } | { readonly kind: 'destination'; readonly cell: Cell }
export type SensorOrder = 'passive' | 'activePulse'
export type WeaponOrder =
  | { readonly kind: 'hold' }
  | { readonly kind: 'laser'; readonly contactAlias: string }
  | { readonly kind: 'missile'; readonly aim: Cell }
export interface TurnOrders {
  readonly turnIndex: number
  readonly movement: MovementOrder
  readonly sensor: SensorOrder
  readonly cloak: boolean
  readonly weapon: WeaponOrder
}
export type ValidationField = 'orders' | 'turnIndex' | 'movement' | 'sensor' | 'cloak' | 'weapon'
export type ValidationIssue = {
  readonly field: ValidationField
  readonly details?: {
    readonly cell?: Cell; readonly contactAlias?: string; readonly readyTick?: Tick
    readonly requiredEnergyMilli?: number; readonly availableEnergyMilli?: number; readonly rangeUnits?: number
  }
} & (
  | { readonly severity: 'error'; readonly code: 'invalid-shape' | 'invalid-turn' | 'out-of-bounds' | 'obstacle' | 'unreachable' | 'unknown-alias' | 'equipment-unavailable' | 'no-ammunition' | 'observed-opponent-destroyed' }
  | { readonly severity: 'conditional'; readonly code: 'awaiting-current-lock' | 'awaiting-range' | 'awaiting-line-of-sight' | 'awaiting-cooldown' | 'awaiting-energy' | 'propulsion-funding' | 'cloak-exposure' }
  | { readonly severity: 'warning'; readonly code: 'activity-breaks-cloak' }
)
export interface OrderValidation { readonly structurallyValid: boolean; readonly issues: readonly ValidationIssue[] }
export interface RouteProgress {
  readonly waypoints: readonly Position[]
  readonly segmentIndex: number
  readonly distanceAlongSegmentUnits: number
  readonly remainingDistanceUnits: number
}
export type OwnRoutePreview =
  | { readonly kind: 'hold'; readonly position: Position }
  | { readonly kind: 'destination'; readonly destination: Cell; readonly waypoints: readonly Position[]; readonly nominalReachablePoint: Position; readonly predicted: true; readonly conditionalOnPropulsionFunding: true }
  | { readonly kind: 'unavailable'; readonly issues: readonly ValidationIssue[] }
export type CloakState = 'off' | 'active' | 'suppressed-exposure' | 'latched-activity' | 'latched-unfunded'
export interface CloakObservation { readonly requested: boolean; readonly actual: boolean; readonly state: CloakState }
export type InterruptionReason = 'cloak-unfunded' | 'pulse-unfunded' | 'propulsion-unfunded'
export interface OwnInterruption { readonly tick: Tick; readonly reason: InterruptionReason }
export interface Gauge { readonly current: number; readonly max: number }
export interface OwnShipObservation {
  readonly shipClass: ShipClass; readonly name: string; readonly status: 'alive' | 'destroyed'
  readonly position: Position; readonly headingMilliDegrees: HeadingMilliDegrees
  readonly hull: Gauge; readonly shields: Gauge
  readonly energy: { readonly currentMilli: number; readonly maxMilli: number }
  readonly ammunition: Gauge
  readonly equipment: Equipment
  readonly destination: Cell | null; readonly route: RouteProgress
  readonly cloak: CloakObservation; readonly sensor: 'passive' | 'tracking'
  readonly clocks: { readonly laserReadyTick: Tick; readonly missileReadyTick: Tick; readonly exposureUntilTick: Tick; readonly trackingUntilTick: Tick }
  readonly turnActions: { readonly pulseAttemptSpent: boolean; readonly weaponIntentSpent: boolean }
  readonly interruptions: readonly OwnInterruption[]
}
export interface Measurement { readonly position: Position; readonly tick: Tick }
/** Aliases remain stable through loss/reacquisition until memory expiry. No entity ID. */
export type ContactMemory = {
  readonly alias: string; readonly measurement: Measurement
  readonly previousMeasurement?: Measurement; readonly estimatedVelocity?: Velocity
  readonly observedDestructionTick?: Tick
} & (
  | { readonly kind: 'current'; readonly ageTicks: 0; readonly uncertaintyRadiusUnits: 0 }
  | { readonly kind: 'stale'; readonly ageTicks: number; readonly uncertaintyRadiusUnits: number }
)
export type HostileOrdnanceMemory = {
  readonly alias: string; readonly measurement: Measurement
} & (
  | { readonly kind: 'current'; readonly ageTicks: 0; readonly uncertaintyRadiusUnits: 0 }
  | { readonly kind: 'stale'; readonly ageTicks: number; readonly uncertaintyRadiusUnits: number }
)
export interface OwnMissileTelemetry {
  readonly id: string; readonly position: Position; readonly aim: Cell
  readonly launchTick: Tick; readonly updatedTick: Tick
  readonly status: 'flying' | 'detonated' | 'expired' | 'exited-map'
}
export type Outcome = 'victory' | 'defeat' | 'mutual-destruction'
export interface RevealedOutcome { readonly outcome: Outcome; readonly revealTick: Tick }
export type VisibleEvent = { readonly id: string; readonly tick: Tick } & (
  | { readonly kind: 'own-energy'; readonly deltaMilli: number; readonly reason: 'regeneration' | 'cloak' | 'pulse' | 'propulsion' | 'laser' | 'missile' }
  | { readonly kind: 'own-ammunition'; readonly delta: number }
  | { readonly kind: 'own-interruption'; readonly reason: InterruptionReason }
  | { readonly kind: 'own-cloak'; readonly cloak: CloakObservation }
  | { readonly kind: 'own-shot'; readonly position: Position; readonly weapon: Exclude<WeaponOrder, { readonly kind: 'hold' }> }
  | { readonly kind: 'observed-shot'; readonly sourceAlias: string; readonly position: Position; readonly weapon: 'laser' | 'missile' }
  | { readonly kind: 'observed-impact'; readonly position: Position; readonly weapon: 'laser' | 'missile'; readonly contactAlias?: string }
  | { readonly kind: 'own-damage'; readonly shieldsLost: number; readonly hullLost: number }
  | { readonly kind: 'contact-acquired' | 'contact-updated' | 'contact-lost'; readonly contact: ContactMemory }
  | { readonly kind: 'contact-expired'; readonly alias: string }
  | { readonly kind: 'observed-destruction'; readonly contactAlias: string; readonly position: Position }
  | { readonly kind: 'own-destruction'; readonly position: Position }
  | { readonly kind: 'own-missile'; readonly missile: OwnMissileTelemetry }
  | { readonly kind: 'hostile-missile-sighted' | 'hostile-missile-lost'; readonly missile: HostileOrdnanceMemory }
  | { readonly kind: 'hostile-missile-expired'; readonly alias: string }
  | { readonly kind: 'outcome'; readonly outcome: Outcome }
)
export interface SideObservation {
  readonly side: Side; readonly turnIndex: number; readonly tick: Tick
  readonly map: PublicMap; readonly ownShip: OwnShipObservation
  readonly contacts: readonly ContactMemory[]
  readonly ownMissiles: readonly OwnMissileTelemetry[]
  readonly hostileMissiles: readonly HostileOrdnanceMemory[]
  /** Permitted events at this observation's tick only; same events as its replay frame. */
  readonly events: readonly VisibleEvent[]
  readonly observedOpponentDestructionTick?: Tick
  readonly outcome?: RevealedOutcome
}
export interface PlannerMemory {
  readonly policy: 'PATROL' | 'INVESTIGATE' | 'ENGAGE' | 'SEARCH'
  readonly patrolOrder: readonly Cell[]; readonly patrolIndex: number
  readonly rememberedContacts: readonly ContactMemory[]
  readonly searchDestination: Cell | null
  readonly observedOpponentDestructionTick?: Tick
}
export interface PublicReplayFrame {
  readonly tick: Tick; readonly observation: SideObservation
  /** This tick only, identical permitted events to observation.events. */
  readonly events: readonly VisibleEvent[]
}
export type UnfiredReason = 'no-current-lock' | 'out-of-range' | 'line-of-sight-blocked' | 'cooldown' | 'insufficient-energy' | 'own-destroyed'
export interface OwnAssessment {
  readonly turnIndex: number; readonly revealTick: Tick
  readonly startPosition: Position; readonly endPosition: Position
  readonly destination: Cell | null; readonly destinationReached: boolean
  readonly deltas: { readonly energyMilli: number; readonly hull: number; readonly shields: number; readonly ammunition: number }
  readonly interruptions: readonly OwnInterruption[]
  readonly sensorAttempt: { readonly kind: 'not-requested' | 'succeeded' } | { readonly kind: 'failed'; readonly reason: 'insufficient-energy' | 'own-destroyed' }
  readonly weaponAttempt: { readonly kind: 'not-requested' } | { readonly kind: 'fired'; readonly tick: Tick; readonly weapon: 'laser' | 'missile' } | { readonly kind: 'unfired'; readonly weapon: 'laser' | 'missile'; readonly reasons: readonly UnfiredReason[] }
  readonly contacts: readonly ContactMemory[]; readonly events: readonly VisibleEvent[]
  /** null means no safe pending explanation, not an authoritative assertion that ordnance is absent. */
  readonly ordnancePending: { readonly reason: 'known-own-missiles'; readonly missileIds: readonly string[] } | { readonly reason: 'observed-opponent-destroyed' } | null
}
export interface ReplayPrefix {
  readonly scope: 'latest-player-turn-with-aftermath'
  readonly startTick: Tick
  /** Scheduled known window boundary; never a precomputed future aftermath horizon. */
  readonly endTick: Tick
  readonly cursorTick: Tick
  /** Only starting frame and tick frames <= cursor; never the future TurnPresentation. */
  readonly frames: readonly PublicReplayFrame[]
  /** Accumulated through cursor, deduplicated by event ID and ordered by (tick, id). */
  readonly events: readonly VisibleEvent[]
  readonly playback: { readonly playing: boolean; readonly speed: 0.5 | 1 | 2 | 4 }
}
interface ViewBase {
  readonly encounterId: string; readonly revision: number; readonly rules: Ruleset
  readonly frame: PublicReplayFrame
}
export type GameView = ViewBase & (
  | { readonly phase: 'planning'; readonly draft: TurnOrders; readonly validation: OrderValidation; readonly routePreview: OwnRoutePreview; readonly replay: null }
  | { readonly phase: 'commit'; readonly lockedOwnOrders: TurnOrders; readonly replay: null }
  | {
    readonly phase: 'execution'; readonly replay: ReplayPrefix
    /** null on live playback; origin only after user replay from an assessed/terminal view. */
    readonly replayOf: null | 'assessment' | 'terminal'
  } & ({ readonly automatic: false; readonly lockedOwnOrders: TurnOrders } | { readonly automatic: true; readonly reason: 'own-destroyed'; readonly lockedOwnOrders: TurnOrders | null })
  | { readonly phase: 'assessment'; readonly lockedOwnOrders: TurnOrders | null; readonly replay: ReplayPrefix; readonly assessment: OwnAssessment }
  | { readonly phase: 'terminal'; readonly lockedOwnOrders: TurnOrders | null; readonly replay: ReplayPrefix | null; readonly result: { readonly kind: 'abandoned' } | { readonly kind: 'combat'; readonly outcome: RevealedOutcome; readonly assessment: OwnAssessment } }
)
export type CommitResult =
  | { readonly kind: 'accepted'; readonly turnIndex: number; readonly revision: number }
  | { readonly kind: 'rejected'; readonly validation: OrderValidation }
  | { readonly kind: 'ignored'; readonly reason: 'wrong-phase' | 'stale-turn' }
export type PlaybackCommand =
  | { readonly kind: 'play' | 'pause' | 'skipToEnd' }
  | { readonly kind: 'speed'; readonly speed: 0.5 | 1 | 2 | 4 }
  | { readonly kind: 'seek'; readonly tick: Tick }
  | { readonly kind: 'step'; readonly direction: -1 | 1 }
export type RestartCommand = { readonly kind: 'same-seed' | 'new-seed' }
export interface GameController {
  /** Stable immutable reference until an update; revision increases within an encounter. */
  getView(): GameView
  subscribe(listener: () => void): () => void
  setDraft(orders: TurnOrders): void
  commit(expectedTurnIndex: number): CommitResult
  /** Owns the presentation clock; publishes changed integer cursor/control state, never clocks simulation. */
  playback(command: PlaybackCommand): void
  finishAssessment(): void
  abandon(): void
  restart(command: RestartCommand): void
}
/** Engine-owned path logic; these signatures cannot receive hidden world state. */
export type ValidateOrders = (orders: TurnOrders, observation: SideObservation, rules: Ruleset) => OrderValidation
export type PreviewRoute = (movement: MovementOrder, ownShip: OwnShipObservation, map: PublicMap, rules: Ruleset) => OwnRoutePreview
/** Dedicated explicit uint32 planner stream; never shares simulation draws. */
export type PlanOpponent = (observation: SideObservation, memory: PlannerMemory, plannerRandomState: number) => {
  readonly orders: TurnOrders; readonly memory: PlannerMemory; readonly plannerRandomState: number
}

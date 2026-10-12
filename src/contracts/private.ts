/** Engine/application only. Never import from presentation or the AI planner. */
import type {
  Cell, ContactMemory, HeadingMilliDegrees, HostileOrdnanceMemory, Outcome,
  OwnAssessment, OwnMissileTelemetry, PlannerMemory, Position, PublicReplayFrame, PublicScenario,
  RouteProgress, Ruleset, ShipClass, Side, Tick, TurnOrders,
} from './public'

export interface Spawn {
  readonly cell: Cell; readonly shipClass: ShipClass; readonly headingMilliDegrees: HeadingMilliDegrees
  readonly initialOrders: TurnOrders
}
export interface Scenario extends PublicScenario { readonly spawns: Readonly<Record<Side, Spawn>> }
export interface RandomState {
  readonly simulation: number; readonly planners: Readonly<Record<Side, number>>
}
export interface PrivateKnowledge {
  readonly contacts: readonly { readonly entityId: string; readonly contact: ContactMemory }[]
  readonly hostileMissiles: readonly { readonly missileId: string; readonly memory: HostileOrdnanceMemory }[]
  readonly ownMissiles: readonly OwnMissileTelemetry[]
  readonly nextContactAlias: number; readonly nextMissileAlias: number
  readonly observedOpponentDestructionTick?: Tick
}
export interface ShipState {
  readonly entityId: string; readonly side: Side; readonly shipClass: ShipClass
  readonly alive: boolean; readonly destructionTick: Tick | null
  readonly position: Position; readonly headingMilliDegrees: HeadingMilliDegrees
  readonly hull: number; readonly shields: number; readonly energyMilli: number; readonly ammunition: number
  readonly destination: Cell | null; readonly route: RouteProgress; readonly orders: TurnOrders | null
  readonly laserReadyTick: Tick; readonly missileReadyTick: Tick
  readonly exposureUntilTick: Tick; readonly trackingUntilTick: Tick
  readonly pulseAttemptSpent: boolean; readonly weaponIntentSpent: boolean
  readonly cloakRequested: boolean; readonly cloakActive: boolean
  readonly cloakLatch: 'none' | 'activity' | 'unfunded'
  readonly propulsionInterrupted: boolean
}
export interface MissileState {
  readonly id: string; readonly launcherEntityId: string; readonly launcherSide: Side
  readonly position: Position; readonly aim: Cell; readonly aimPosition: Position
  readonly launchPosition: Position; readonly distanceTravelledUnits: number
  readonly launchTick: Tick; readonly expiresAtTick: Tick
}
export type InternalEvent = { readonly id: string; readonly tick: Tick } & (
  | { readonly kind: 'resource'; readonly entityId: string; readonly energyDeltaMilli: number; readonly ammunitionDelta: number; readonly reason: 'regeneration' | 'cloak' | 'pulse' | 'propulsion' | 'laser' | 'missile' }
  | { readonly kind: 'interruption'; readonly entityId: string; readonly reason: 'cloak-unfunded' | 'pulse-unfunded' | 'propulsion-unfunded' }
  | { readonly kind: 'movement'; readonly entityId: string; readonly start: Position; readonly end: Position }
  | { readonly kind: 'cloak'; readonly entityId: string; readonly active: boolean; readonly latch: 'none' | 'activity' | 'unfunded' }
  | { readonly kind: 'detection'; readonly observer: Side; readonly entityId: string; readonly position: Position }
  | { readonly kind: 'shot'; readonly entityId: string; readonly weapon: 'laser'; readonly targetEntityId: string; readonly position: Position }
  | { readonly kind: 'shot'; readonly entityId: string; readonly weapon: 'missile'; readonly missileId: string; readonly aim: Cell; readonly position: Position }
  | { readonly kind: 'missile-resolved'; readonly missileId: string; readonly position: Position; readonly fraction: number; readonly reason: 'asteroid' | 'ship' | 'arrival' | 'exit' | 'expiry'; readonly directVictimId?: string }
  | { readonly kind: 'damage'; readonly targetEntityId: string; readonly sourceIds: readonly string[]; readonly shieldsLost: number; readonly hullLost: number }
  | { readonly kind: 'destruction'; readonly entityId: string; readonly position: Position }
  | { readonly kind: 'outcome'; readonly outcome: Outcome }
)
export interface AcceptedTurn {
  readonly turnIndex: number; readonly startTick: Tick; readonly automatic: boolean
  readonly orders: Readonly<Record<Side, TurnOrders | null>>
}
export interface SimulationState {
  readonly rulesVersion: string; readonly scenarioId: string; readonly scenarioVersion: string
  readonly seed: number; readonly random: RandomState; readonly tick: Tick; readonly turnIndex: number
  readonly ships: Readonly<Record<Side, ShipState>>; readonly missiles: readonly MissileState[]
  readonly knowledge: Readonly<Record<Side, PrivateKnowledge>>
  readonly plannerMemory: Readonly<Record<Side, PlannerMemory>>
  readonly acceptedTurns: readonly AcceptedTurn[]
  readonly terminalPending: boolean
  readonly outcome: { readonly outcome: Outcome; readonly revealTick: Tick } | null
}
/** Observer-safe but contains FUTURE frames. Only application stores this, never GameView. */
export interface TurnPresentation {
  readonly side: Side; readonly startTick: Tick; readonly endTick: Tick
  readonly automatic: boolean; readonly frames: readonly PublicReplayFrame[]
  readonly assessment: OwnAssessment
}
export interface TurnResolution {
  readonly locked: AcceptedTurn; readonly nextState: SimulationState
  readonly internalEvents: readonly InternalEvent[]
  readonly presentations: Readonly<Record<Side, TurnPresentation>>
}
export type InitialiseSession = (scenario: Scenario, rules: Ruleset, seed: number) => SimulationState
export type ResolveTurn = (state: SimulationState, locked: AcceptedTurn, rules: Ruleset, scenario: Scenario) => TurnResolution

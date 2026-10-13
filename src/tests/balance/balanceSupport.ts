/**
 * Test-only support for TSB-51 balance evidence: the real engine and the real planner, driven the way the
 * application drives them. The patrol plans once per planning entry from its own observation; the player
 * side receives only its own observation. Paired examples branch alternative player orders from one
 * planned state, so both branches face the identical locked frigate plan.
 */
import type { InternalEvent, SimulationState, TurnResolution } from '../../contracts/private'
import type { Cell, ContactMemory, Position, Side, SideObservation, TurnOrders } from '../../contracts'
import { DUEL_RULES } from '../../contracts'
import { DUEL_SCENARIO } from '../../scenarios/private'
import { initialiseSession, observeSide, resolveTurn, validateOrders } from '../../simulation'
import { planOpponent } from '../../ai'
import type { Artifact } from '../../../tools/batch/encounter'

export const rules = DUEL_RULES
export const view = (state: SimulationState, side: Side): SideObservation => observeSide(state, side, DUEL_RULES, DUEL_SCENARIO)
export const start = (seed: number): SimulationState => initialiseSession(DUEL_SCENARIO, DUEL_RULES, seed)
export const cellOf = (p: Position): Cell => ({ column: Math.floor(p.x / rules.geometry.unitsPerCell), row: Math.floor(p.y / rules.geometry.unitsPerCell) })
export const range = (a: Position, b: Position): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Planning entry: the real planner's cached plan, with its memory and RNG written back before resolution. */
export interface Planned { readonly state: SimulationState; readonly patrol: TurnOrders | null; readonly patrolView: SideObservation | null }
export function planTurn(state: SimulationState): Planned {
  if (!state.ships.patrol.alive) return { state, patrol: null, patrolView: null }
  const patrolView = view(state, 'patrol')
  const planned = planOpponent(patrolView, state.plannerMemory.patrol, state.random.planners.patrol)
  if (!validateOrders(planned.orders, patrolView, rules).structurallyValid) throw new Error('Planner proposed invalid orders')
  return {
    patrol: planned.orders, patrolView,
    state: { ...state, plannerMemory: { ...state.plannerMemory, patrol: planned.memory }, random: { ...state.random, planners: { ...state.random.planners, patrol: planned.plannerRandomState } } },
  }
}

/** Resolves one normal turn with legal player orders (checked against the player's own observation). */
export function resolve(planned: Planned, player: TurnOrders): TurnResolution {
  const playerView = view(planned.state, 'player')
  if (!validateOrders(player, playerView, rules).structurallyValid) throw new Error(`Illegal player orders at turn ${playerView.turnIndex}`)
  const { state } = planned
  return resolveTurn(state, { turnIndex: state.turnIndex, startTick: state.tick, automatic: false, orders: { player, patrol: planned.patrol } }, rules, DUEL_SCENARIO)
}

export type PlayerScript = (own: SideObservation) => TurnOrders
export const playTurn = (state: SimulationState, script: PlayerScript): TurnResolution => {
  const planned = planTurn(state)
  return resolve(planned, script(view(planned.state, 'player')))
}

/** Replays a batch artifact's recorded envelopes (no replanning) and returns each turn's resolution. */
export function replaySteps(artifact: Artifact): TurnResolution[] {
  let state = artifact.initialState
  return artifact.steps.map((step) => {
    state = { ...state, plannerMemory: step.plannerMemory, random: { ...state.random, planners: step.plannerRandom } }
    const result = resolveTurn(state, step.locked, artifact.rules, artifact.scenario)
    state = result.nextState
    return result
  })
}

export const orders = (own: SideObservation, patch: Partial<Omit<TurnOrders, 'turnIndex'>> = {}): TurnOrders =>
  ({ turnIndex: own.turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' }, ...patch })
export const freshest = (own: SideObservation): ContactMemory | undefined =>
  [...own.contacts].filter((contact) => contact.observedDestructionTick === undefined).sort((a, b) => a.ageTicks - b.ageTicks)[0]

/** Plotted aim from own knowledge: the measured cell, or led by measured velocity over age plus flight time. */
export function plottedAim(own: SideObservation, contact: ContactMemory, lead: boolean): Cell {
  const at = contact.measurement.position
  const velocity = contact.estimatedVelocity ?? { xUnitsPerTick: 0, yUnitsPerTick: 0 }
  const ticks = lead ? contact.ageTicks + Math.ceil(range(own.ownShip.position, at) / rules.missile.speedUnitsPerTick) + 1 : 0
  return cellOf({ x: at.x + velocity.xUnitsPerTick * ticks, y: at.y + velocity.yUnitsPerTick * ticks })
}

type Damage = Extract<InternalEvent, { kind: 'damage' }>
type Shot = Extract<InternalEvent, { kind: 'shot' }>
type MissileEnd = Extract<InternalEvent, { kind: 'missile-resolved' }>
const entity = (result: TurnResolution, side: Side) => result.nextState.ships[side].entityId
export const damageTo = (result: TurnResolution, side: Side): { tick: number; amount: number; sources: readonly string[] }[] => result.internalEvents
  .filter((event): event is Damage => event.kind === 'damage' && event.targetEntityId === entity(result, side))
  .map((event) => ({ tick: event.tick, amount: event.shieldsLost + event.hullLost, sources: event.sourceIds }))
export const shotsBy = (result: TurnResolution, side: Side): { tick: number; weapon: string }[] => result.internalEvents
  .filter((event): event is Shot => event.kind === 'shot' && event.entityId === entity(result, side))
  .map((event) => ({ tick: event.tick, weapon: event.weapon }))
export const missileEnds = (result: TurnResolution): { tick: number; reason: string; cell: Cell }[] => result.internalEvents
  .filter((event): event is MissileEnd => event.kind === 'missile-resolved')
  .map((event) => ({ tick: event.tick, reason: event.reason, cell: cellOf(event.position) }))

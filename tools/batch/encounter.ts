import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { AcceptedTurn, Scenario, SimulationState } from '../../src/contracts/private'
import type { Outcome, PlanOpponent, Ruleset, Side, TurnOrders, ValidationIssue } from '../../src/contracts'
import { aftermathWindowBound, DUEL_RULES } from '../../src/contracts'
import { DUEL_SCENARIO } from '../../src/scenarios/private'
import { initialiseSession, observeSide, resolveTurn, validateOrders } from '../../src/simulation'
import { planOpponent } from '../../src/ai'
import { checkObservation, checkState } from './invariants'
import { holdOrders, playerPolicy, type PlayerPolicy, type PolicyName } from './policies'
import { diagnosticJSON } from './json'

export interface Step {
  readonly locked: AcceptedTurn
  readonly plannerMemory: SimulationState['plannerMemory']
  readonly plannerRandom: SimulationState['random']['planners']
}
type Counts = { scans: number; lasers: number; missiles: number }
export interface Metrics {
  seed: number; policy: PolicyName; sourceRevision: string; sourceDirty: boolean
  rulesVersion: string; scenarioId: string; scenarioVersion: string
  status: 'completed' | 'diagnostic-cutoff' | 'failure'; outcome: Outcome | null
  normalTurns: number; automaticTurns: number; automaticBound: number | null; normalTurnLimit: number
  transitions: { turn: number; policy: string }[]
  intents: Record<Side, Counts>; fired: Record<Side, Counts>
  rejections: { turn: number; side: Side; draft: TurnOrders; issues: readonly ValidationIssue[]; action: 'hold-fallback' | 'stop'; origin: 'diagnostic-policy' | 'production-planner' }[]
  invariantFailures: string[]
  staleContactTurns: Record<Side, number>; maximumStaleAgeTicks: Record<Side, number>; stalledMovementTurns: Record<Side, number>
  finalTick: number; finalStateHash: string
}
export interface Artifact {
  readonly format: 'tsb-batch-v1'
  readonly seed: number; readonly rules: Ruleset; readonly scenario: Scenario
  readonly initialState: SimulationState; readonly steps: readonly Step[]; readonly finalState: SimulationState
  readonly metrics: Metrics
  readonly failure: null | { readonly stage: string; readonly message: string; readonly pending: Step | null }
}
export interface RunOptions {
  readonly seed: number; readonly policy: PolicyName; readonly normalTurnLimit: number
  readonly sourceRevision: string; readonly sourceDirty?: boolean
  // Focused harness tests may inject a diagnostic policy or planner to demonstrate failure evidence.
  readonly player?: PlayerPolicy; readonly planner?: PlanOpponent
}
export const stateHash = (state: SimulationState) => createHash('sha256').update(diagnosticJSON(state)).digest('hex')
const counts = (): Counts => ({ scans: 0, lasers: 0, missiles: 0 })
export function validateRunInput(seed: number, limit: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DUEL_RULES.diagnosticTurnLimit) throw new Error(`Normal-turn limit must be 1..${DUEL_RULES.diagnosticTurnLimit}`)
}

export function runEncounter(options: RunOptions): Artifact {
  validateRunInput(options.seed, options.normalTurnLimit)
  const rules = DUEL_RULES
  const scenario = DUEL_SCENARIO
  const initialState = initialiseSession(scenario, rules, options.seed)
  let state = initialState
  const steps: Step[] = []
  let stage = 'initial-invariants'
  let pending: Step | null = null
  let failure: Artifact['failure'] = null
  const metrics: Metrics = { seed: options.seed, policy: options.policy, sourceRevision: options.sourceRevision, sourceDirty: options.sourceDirty ?? false,
    rulesVersion: rules.version, scenarioId: scenario.id, scenarioVersion: scenario.version,
    status: 'diagnostic-cutoff', outcome: null, normalTurns: 0, automaticTurns: 0, automaticBound: null, normalTurnLimit: options.normalTurnLimit,
    transitions: [{ turn: 0, policy: initialState.plannerMemory.patrol.policy }], intents: { player: counts(), patrol: counts() }, fired: { player: counts(), patrol: counts() },
    rejections: [], invariantFailures: [], staleContactTurns: { player: 0, patrol: 0 }, maximumStaleAgeTicks: { player: 0, patrol: 0 }, stalledMovementTurns: { player: 0, patrol: 0 },
    finalTick: 0, finalStateHash: '',
  }
  const policy = options.player ?? playerPolicy(options.policy, rules)
  const planner = options.planner ?? planOpponent
  try {
    checkState(state, rules, scenario)
    while (state.outcome === null) {
      const alive = state.ships.player.alive
      if (alive && metrics.normalTurns >= options.normalTurnLimit) break
      stage = 'automatic-bound'
      if (!alive) {
        metrics.automaticBound ??= aftermathWindowBound(rules, state.ships.patrol.alive ? state.ships.patrol.ammunition : 0)
        if (metrics.automaticTurns >= metrics.automaticBound) throw new Error(`Automatic window bound exceeded: ${metrics.automaticBound}`)
      }
      const before = state
      const orders: Record<Side, TurnOrders | null> = { player: null, patrol: null }
      for (const side of ['player', 'patrol'] as const) {
        if (!state.ships[side].alive) continue
        stage = `${side}-invariants`
        const view = observeSide(state, side, rules, scenario)
        checkObservation(view, rules, scenario)
        for (const contact of view.contacts) if (contact.kind === 'stale') {
          metrics.maximumStaleAgeTicks[side] = Math.max(metrics.maximumStaleAgeTicks[side], contact.ageTicks)
        }
        if (view.contacts.some((c) => c.kind === 'stale')) metrics.staleContactTurns[side]++
        stage = `${side}-planning`
        let draft: TurnOrders
        if (side === 'player') draft = policy(view)
        else {
          const planned = planner(view, state.plannerMemory.patrol, state.random.planners.patrol)
          draft = planned.orders
          state = { ...state, plannerMemory: { ...state.plannerMemory, patrol: planned.memory },
            random: { ...state.random, planners: { ...state.random.planners, patrol: planned.plannerRandomState } } }
          if (metrics.transitions.at(-1)?.policy !== planned.memory.policy) metrics.transitions.push({ turn: state.turnIndex, policy: planned.memory.policy })
        }
        stage = `${side}-validation`
        const validation = validateOrders(draft, view, rules)
        if (!validation.structurallyValid) {
          metrics.rejections.push({ turn: state.turnIndex, side, draft, issues: validation.issues,
            action: side === 'player' ? 'hold-fallback' : 'stop', origin: side === 'player' ? 'diagnostic-policy' : 'production-planner' })
          if (side === 'patrol') throw new Error('Production planner proposed structurally invalid orders')
          draft = holdOrders(view)
          if (!validateOrders(draft, view, rules).structurallyValid) throw new Error('Diagnostic hold fallback is invalid')
        }
        orders[side] = draft
        if (draft.sensor === 'activePulse') metrics.intents[side].scans++
        if (draft.weapon.kind === 'laser') metrics.intents[side].lasers++
        if (draft.weapon.kind === 'missile') metrics.intents[side].missiles++
      }
      pending = { locked: { turnIndex: state.turnIndex, startTick: state.tick, automatic: !alive, orders },
        plannerMemory: state.plannerMemory, plannerRandom: state.random.planners }
      stage = 'resolve'
      const result = resolveTurn(state, pending.locked, rules, scenario)
      steps.push(pending)
      pending = null
      state = result.nextState
      if (alive) metrics.normalTurns++; else metrics.automaticTurns++
      stage = 'resolved-invariants'
      checkState(state, rules, scenario, before)
      for (const side of ['player', 'patrol'] as const) {
        for (const frame of result.presentations[side].frames) checkObservation(frame.observation, rules, scenario)
        const order = orders[side]
        if (order?.movement.kind === 'destination' && before.ships[side].alive && state.ships[side].alive
          && isDeepStrictEqual(before.ships[side].position, state.ships[side].position)) metrics.stalledMovementTurns[side]++
        const ownId = state.ships[side].entityId
        for (const event of result.internalEvents) {
          if (event.kind === 'resource' && event.entityId === ownId && event.reason === 'pulse') metrics.fired[side].scans++
          if (event.kind === 'shot' && event.entityId === ownId) metrics.fired[side][event.weapon === 'laser' ? 'lasers' : 'missiles']++
        }
      }
    }
    if (state.outcome) { metrics.status = 'completed'; metrics.outcome = state.outcome.outcome }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failure = { stage, message, pending }
    metrics.status = 'failure'
    if (stage.includes('invariants') || stage === 'automatic-bound') metrics.invariantFailures.push(message)
  }
  metrics.finalTick = state.tick
  metrics.finalStateHash = stateHash(state)
  return { format: 'tsb-batch-v1', seed: options.seed, rules, scenario, initialState, steps, finalState: state, metrics, failure }
}

/** Replays recorded envelopes, including each pre-resolution planner state, without rerunning policies. */
export function replayArtifact(artifact: Artifact) {
  if (artifact.format !== 'tsb-batch-v1' || !Array.isArray(artifact.steps)) throw new Error('Unsupported reproduction format')
  validateRunInput(artifact.seed, artifact.metrics.normalTurnLimit)
  let state = initialiseSession(artifact.scenario, artifact.rules, artifact.seed)
  if (!isDeepStrictEqual(state, artifact.initialState)) throw new Error('Initial state differs from recorded seed/rules/scenario')
  let lastResult: ReturnType<typeof resolveTurn> | null = null
  let previous = state
  for (const step of artifact.steps) {
    previous = state
    state = { ...state, plannerMemory: step.plannerMemory, random: { ...state.random, planners: step.plannerRandom } }
    lastResult = resolveTurn(state, step.locked, artifact.rules, artifact.scenario)
    state = lastResult.nextState
  }
  // A planner/validation crash may have advanced planner memory/RNG before any envelope was accepted.
  if (artifact.failure && !artifact.failure.stage.startsWith('resolved')) {
    state = { ...state, plannerMemory: artifact.finalState.plannerMemory, random: { ...state.random, planners: artifact.finalState.random.planners } }
  }
  if (!isDeepStrictEqual(state, artifact.finalState) || stateHash(state) !== artifact.metrics.finalStateHash) throw new Error('Replay final state mismatch')
  let boundary: string | null = null
  if (artifact.failure) {
    if (artifact.failure.stage === 'resolve' && artifact.failure.pending) {
      try { resolveTurn(state, artifact.failure.pending.locked, artifact.rules, artifact.scenario) } catch (error) { boundary = error instanceof Error ? error.message : String(error) }
      if (boundary !== artifact.failure.message) throw new Error('Failing resolution boundary did not reproduce')
    } else if (artifact.failure.stage === 'patrol-validation') {
      const rejected = artifact.metrics.rejections.at(-1)
      if (!rejected || validateOrders(rejected.draft, observeSide(state, rejected.side, artifact.rules, artifact.scenario), artifact.rules).structurallyValid) throw new Error('Rejected planner boundary did not reproduce')
      boundary = 'reproduced invalid planner order'
    } else if (artifact.failure.stage.includes('invariants')) {
      try {
        checkState(state, artifact.rules, artifact.scenario, previous)
        for (const side of ['player', 'patrol'] as const) checkObservation(observeSide(state, side, artifact.rules, artifact.scenario), artifact.rules, artifact.scenario)
        if (lastResult) for (const side of ['player', 'patrol'] as const) for (const frame of lastResult.presentations[side].frames) checkObservation(frame.observation, artifact.rules, artifact.scenario)
      } catch (error) { boundary = error instanceof Error ? error.message : String(error) }
      if (boundary !== artifact.failure.message) throw new Error('Failing invariant boundary did not reproduce')
    } else if (artifact.failure.stage === 'automatic-bound') {
      if (artifact.metrics.automaticBound === null || artifact.metrics.automaticTurns < artifact.metrics.automaticBound || state.outcome !== null) throw new Error('Automatic bound failure did not reproduce')
      boundary = artifact.failure.message
    }
  }
  return { verified: true, sourceRevision: artifact.metrics.sourceRevision, status: artifact.metrics.status,
    outcome: state.outcome?.outcome ?? null, finalTick: state.tick, finalStateHash: stateHash(state), boundary }
}

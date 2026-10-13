import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Scenario, ShipState, SimulationState, TurnResolution } from '../../contracts/private'
import type { GameView, MovementOrder, PublicReplayFrame, SensorOrder, TurnOrders } from '../../contracts/public'
import { createGameController, createManualClock, SIMULATION_ENGINE, type EngineApi } from '../../game/index'
import { DUEL_RULES } from '../../scenarios/public'
import { HIDDEN_SCAN_ORDERS, HIDDEN_VARIANTS, MOVING_PULSE_ORDERS, MOVING_PULSE_SCENARIO, SCAN_SEEDS, scenarioWithSpawns } from './scanFixtures'

interface Inputs {
  readonly seed: number; readonly scenario: Scenario
  readonly player?: Partial<ShipState>; readonly patrol?: Partial<ShipState>
  readonly patrolSensor?: SensorOrder; readonly patrolMovement?: MovementOrder
}
function setup(inputs: Inputs) {
  const clock = createManualClock()
  const initial: SimulationState[] = []
  const results: TurnResolution[] = []
  const views: GameView[] = []
  const engine: EngineApi = {
    ...SIMULATION_ENGINE,
    initialiseSession(...args) {
      const state = SIMULATION_ENGINE.initialiseSession(...args)
      const patched = { ...state, ships: { player: { ...state.ships.player, ...inputs.player }, patrol: { ...state.ships.patrol, ...inputs.patrol } } }
      initial.push(patched)
      return patched
    },
    resolveTurn(...args) {
      const result = SIMULATION_ENGINE.resolveTurn(...args)
      results.push(result)
      return result
    },
  }
  const controller = createGameController({
    seed: inputs.seed, scenario: inputs.scenario, rules: DUEL_RULES, clock, engine,
    newSeed: () => { throw new Error('Scan fixtures never draw new-seed entropy') },
    planOpponent: (observation, memory, plannerRandomState) => ({
      orders: { turnIndex: observation.turnIndex, movement: inputs.patrolMovement ?? { kind: 'hold' }, sensor: inputs.patrolSensor ?? 'passive', cloak: false, weapon: { kind: 'hold' } },
      memory, plannerRandomState,
    }),
  })
  views.push(controller.getView())
  const unsubscribe = controller.subscribe(() => views.push(controller.getView()))
  return { inputs, clock, initial, results, views, controller, dispose: () => { unsubscribe(); controller.dispose() } }
}
type Context = ReturnType<typeof setup>
const planning = (view: GameView) => {
  if (view.phase !== 'planning') throw new Error(`Expected planning, got ${view.phase}`)
  return view
}
const execution = (view: GameView) => {
  if (view.phase !== 'execution') throw new Error(`Expected execution, got ${view.phase}`)
  return view
}
function commit(context: Context, orders: TurnOrders) {
  context.controller.setDraft(orders)
  expect(context.controller.commit(orders.turnIndex)).toMatchObject({ kind: 'accepted' })
  expect(context.results).toHaveLength(1)
  return context.results[0].presentations.player
}
function withReproduction(context: Context, orders: TurnOrders, check: () => void) {
  try { check() } catch (cause) {
    const path = join(mkdtempSync(join(tmpdir(), 'tsb-22-reproduction-')), 'failure.json')
    writeFileSync(path, JSON.stringify({ inputs: context.inputs, rules: DUEL_RULES, orders, initial: context.initial, results: context.results, views: context.views }, null, 2))
    throw new Error(`Scan publication seed=${context.inputs.seed}; complete reproduction ${path}`, { cause })
  } finally { context.dispose() }
}

const PRIVATE_KEYS = new Set(['entityId', 'sourceEntityId', 'targetEntityId', 'launcherEntityId', 'orders', 'seed', 'random', 'plannerMemory', 'knowledge', 'internalEvents', 'presentations', 'nextState', 'acceptedTurns', 'terminalPending', 'spawns', 'cloakLatch', 'cloakActive', 'cloakRequested', 'enemy', 'opponent'])
const OBSERVATION_KEYS = ['side', 'turnIndex', 'tick', 'map', 'ownShip', 'contacts', 'ownMissiles', 'hostileMissiles', 'events', 'observedOpponentDestructionTick', 'outcome']
const OWN_SHIP_KEYS = ['shipClass', 'name', 'status', 'position', 'headingMilliDegrees', 'hull', 'shields', 'energy', 'ammunition', 'equipment', 'destination', 'route', 'cloak', 'sensor', 'clocks', 'turnActions', 'interruptions']
const ROOT_KEYS: Record<GameView['phase'], readonly string[]> = {
  planning: ['encounterId', 'revision', 'rules', 'frame', 'phase', 'draft', 'validation', 'routePreview', 'replay'],
  commit: ['encounterId', 'revision', 'rules', 'frame', 'phase', 'lockedOwnOrders', 'replay'],
  execution: ['encounterId', 'revision', 'rules', 'frame', 'phase', 'replay', 'replayOf', 'automatic', 'lockedOwnOrders'],
  assessment: ['encounterId', 'revision', 'rules', 'frame', 'phase', 'lockedOwnOrders', 'replay', 'assessment'],
  terminal: ['encounterId', 'revision', 'rules', 'frame', 'phase', 'lockedOwnOrders', 'replay', 'result'],
}
/** Runtime publication checks; permitted own drafts/locked orders, gauges and assessment remain allowed. */
function checkPublicView(view: GameView, auditedObjects: Set<object>, auditedFrames: Set<PublicReplayFrame>) {
  expect(Object.keys(view).sort()).toEqual([...ROOT_KEYS[view.phase]].sort())
  const violations: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string' && value.includes('secret-patrol-')) violations.push(`Private identity ${value}`)
    if (value === null || typeof value !== 'object' || auditedObjects.has(value)) return
    auditedObjects.add(value)
    // Memoization is safe only because each published object is immutable.
    if (!Object.isFrozen(value)) violations.push('Mutable published object')
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(key)) violations.push(`Private field ${key}`)
      walk(child)
    }
  }
  walk(view)
  expect(violations).toEqual([])
  const checkFrame = (frame: PublicReplayFrame) => {
    if (auditedFrames.has(frame)) return
    auditedFrames.add(frame)
    expect(Object.keys(frame.observation).every((key) => OBSERVATION_KEYS.includes(key))).toBe(true)
    expect(Object.keys(frame.observation.ownShip).sort()).toEqual([...OWN_SHIP_KEYS].sort())
    expect(frame.observation.tick).toBe(frame.tick)
    expect(frame.observation.events).toEqual(frame.events)
    expect(frame.events.every((event) => event.tick === frame.tick)).toBe(true)
    if (frame.observation.outcome) expect(frame.observation.outcome.revealTick).toBeLessThanOrEqual(frame.tick)
    for (const contact of frame.observation.contacts) {
      expect(Object.keys(contact).every((key) => ['alias', 'measurement', 'previousMeasurement', 'estimatedVelocity', 'observedDestructionTick', 'kind', 'ageTicks', 'uncertaintyRadiusUnits'].includes(key))).toBe(true)
      expect(contact.measurement.tick).toBeLessThanOrEqual(frame.tick)
      if (contact.previousMeasurement) expect(contact.previousMeasurement.tick).toBeLessThan(contact.measurement.tick)
    }
  }
  checkFrame(view.frame)
  if (view.phase === 'execution' || view.phase === 'assessment') {
    const { replay } = view
    expect(view.frame.tick).toBe(replay.cursorTick)
    expect(replay.frames.every((frame) => frame.tick >= replay.startTick && frame.tick <= replay.cursorTick)).toBe(true)
    expect(replay.events.every((event) => event.tick <= replay.cursorTick)).toBe(true)
    expect(new Set(replay.events.map((event) => event.id)).size).toBe(replay.events.length)
    for (const frame of replay.frames) checkFrame(frame)
    if (view.phase === 'execution') expect('assessment' in view).toBe(false)
    else expect(view.assessment.revealTick).toBeLessThanOrEqual(replay.cursorTick)
  }
}
function checkPublicHistory(views: readonly GameView[]) {
  const objects = new Set<object>()
  const frames = new Set<PublicReplayFrame>()
  for (const view of views) checkPublicView(view, objects, frames)
}

describe('real controller scan publication', () => {
  it.each(SCAN_SEEDS)('unreachable hidden opponent variants publish identical entire view histories, seed=%s', (seed) => {
    let reference: GameView[] | undefined
    let initialOwn: ShipState | undefined
    const privateAttempts: unknown[] = []
    const privateLogs: string[] = []
    for (const variant of HIDDEN_VARIANTS) {
      const context = setup({ seed, scenario: scenarioWithSpawns({ column: 3, row: 10 }, variant.cell), patrol: variant.ship, patrolSensor: variant.sensor })
      withReproduction(context, HIDDEN_SCAN_ORDERS, () => {
        const own = context.initial[0].ships.player
        if (initialOwn) expect(own).toEqual(initialOwn)
        else initialOwn = own
        // Own x stays at 3500 and the opponent holds >=16500. Even exposed detection (12000) cannot reach it.
        expect(context.initial[0].ships.patrol.position.x - own.position.x).toBeGreaterThan(DUEL_RULES.sensors.exposedRangeUnits)
        context.controller.setDraft(HIDDEN_SCAN_ORDERS)
        expect(planning(context.controller.getView()).validation.structurallyValid).toBe(true)
        context.controller.setDraft({ ...HIDDEN_SCAN_ORDERS, movement: { kind: 'destination', cell: { column: 7, row: 4 } } })
        expect(planning(context.controller.getView()).validation.structurallyValid).toBe(false)
        commit(context, HIDDEN_SCAN_ORDERS)
        context.clock.advance(DUEL_RULES.timing.turnMs)
        expect(context.controller.getView().phase).toBe('assessment')
        expect(context.results[0].presentations.player.frames.every((frame) => frame.observation.ownShip.position.x === own.position.x && frame.observation.contacts.length === 0)).toBe(true)
        expect(context.results[0].nextState.ships.patrol.position).toEqual(context.initial[0].ships.patrol.position)
        privateAttempts.push(context.results[0].presentations.patrol.assessment.sensorAttempt)
        privateLogs.push(JSON.stringify(context.results[0].internalEvents))
        expect(context.results[0].locked.orders.patrol?.sensor).toBe(variant.sensor)
        checkPublicHistory(context.views)
        if (reference) expect(JSON.stringify(context.views) === JSON.stringify(reference), `Public views differ for ${variant.id}`).toBe(true)
        else reference = context.views
      })
    }
    // The fixture really changes private orders, costs/failure and internal events, not just an unused label.
    expect(privateAttempts).toEqual([{ kind: 'not-requested' }, { kind: 'succeeded' }, { kind: 'failed', reason: 'insufficient-energy' }])
    expect(new Set(privateLogs).size).toBe(3)
  })

  it('subscriptions and backward/forward replay reveal pulse acquisition and moving-target loss only at their recorded boundaries', () => {
    const context = setup({ seed: 22, scenario: MOVING_PULSE_SCENARIO, patrolMovement: { kind: 'destination', cell: { column: 19, row: 10 } } })
    withReproduction(context, MOVING_PULSE_ORDERS, () => {
      const presentation = commit(context, MOVING_PULSE_ORDERS)
      const acquired = presentation.assessment.events.find((event) => event.kind === 'contact-acquired')!
      const lost = presentation.assessment.events.find((event) => event.kind === 'contact-lost')!
      expect(acquired.tick).toBe(1)
      const expiry = presentation.frames[1].observation.ownShip.clocks.trackingUntilTick
      expect(expiry).toBe(1 + DUEL_RULES.timing.trackingTicks)
      expect(lost.tick).toBe(expiry)
      // Full private resolution already contains detection/loss, but every commit/cursor-0 publication is still initial knowledge.
      for (const view of context.views.filter((view) => view.phase === 'commit' || view.phase === 'execution')) {
        expect(view.frame.tick).toBe(0)
        expect(view.frame.observation.contacts).toEqual([])
        expect(view.frame.events).toEqual([])
        expect(view.frame.observation.ownShip).toMatchObject({ sensor: 'passive', turnActions: { pulseAttemptSpent: false }, clocks: { trackingUntilTick: 0, exposureUntilTick: 0 } })
        expect('assessment' in view).toBe(false)
      }
      context.clock.advance(DUEL_RULES.timing.tickMs)
      context.controller.playback({ kind: 'pause' })
      expect(execution(context.controller.getView()).frame.observation.contacts[0].kind).toBe('current')
      for (const cursor of [lost.tick - 1, lost.tick, 40, lost.tick - 1, 0, acquired.tick]) {
        context.controller.playback({ kind: 'seek', tick: cursor })
        const view = execution(context.controller.getView())
        expect(view.frame).toEqual(presentation.frames[cursor])
        expect(view.replay.frames).toEqual(presentation.frames.slice(0, cursor + 1))
        expect(view.replay.events).toEqual(presentation.assessment.events.filter((event) => event.tick <= cursor))
      }
      context.controller.playback({ kind: 'seek', tick: lost.tick })
      context.controller.playback({ kind: 'step', direction: -1 })
      expect(context.controller.getView().frame.observation.contacts[0].kind).toBe('current')
      context.controller.playback({ kind: 'step', direction: 1 })
      expect(context.controller.getView().frame.observation.contacts[0].kind).toBe('stale')
      context.controller.playback({ kind: 'seek', tick: 40 })
      const contact = context.controller.getView().frame.observation.contacts[0]
      const lastSeen = presentation.frames[lost.tick - 1].observation.contacts[0].measurement
      expect(contact.measurement).toEqual(lastSeen)
      expect(contact.ageTicks).toBe(40 - lastSeen.tick)
      expect(contact.uncertaintyRadiusUnits).toBe((40 - lastSeen.tick) * DUEL_RULES.maxShipSpeedUnitsPerTick)
      expect(context.results[0].presentations.patrol.frames[40].observation.ownShip.position).not.toEqual(contact.measurement.position)
      context.controller.playback({ kind: 'skipToEnd' })
      const assessed = context.controller.getView()
      if (assessed.phase !== 'assessment') throw new Error('Expected assessment at reveal')
      expect(assessed.assessment.sensorAttempt).toEqual({ kind: 'succeeded' })
      context.controller.playback({ kind: 'seek', tick: lost.tick - 1 })
      expect(execution(context.controller.getView()).replayOf).toBe('assessment')
      expect('assessment' in context.controller.getView()).toBe(false)
      checkPublicHistory(context.views)
      expect(context.results).toHaveLength(1)
    })
  })

  it('an unfunded pulse has a safe own conditional, publishes its failure at tick 1 and never reveals a future retry', () => {
    const orders: TurnOrders = { ...MOVING_PULSE_ORDERS, cloak: false }
    const context = setup({ seed: 22, scenario: scenarioWithSpawns({ column: 6, row: 10 }, { column: 15, row: 10 }, false), player: { energyMilli: 0 } })
    withReproduction(context, orders, () => {
      context.controller.setDraft(orders)
      const planned = planning(context.controller.getView())
      expect(planned.validation.structurallyValid).toBe(true)
      const issue = planned.validation.issues.find((issue) => issue.code === 'awaiting-energy')!
      expect(issue).toMatchObject({ field: 'sensor', severity: 'conditional', details: { requiredEnergyMilli: DUEL_RULES.sensors.pulseCostMilli } })
      expect(issue.details!.availableEnergyMilli!).toBeLessThan(issue.details!.requiredEnergyMilli!)
      const presentation = commit(context, orders)
      expect(execution(context.controller.getView()).replay.events).toEqual([])
      expect(context.controller.getView().frame.observation.ownShip.turnActions.pulseAttemptSpent).toBe(false)
      context.clock.advance(DUEL_RULES.timing.tickMs)
      context.controller.playback({ kind: 'pause' })
      expect(execution(context.controller.getView()).replay.events).toEqual([{ id: 't1-000', tick: 1, kind: 'own-interruption', reason: 'pulse-unfunded' }])
      for (const cursor of [2, 80, 0, 1, 99]) {
        context.controller.playback({ kind: 'seek', tick: cursor })
        const view = execution(context.controller.getView())
        expect(view.frame).toEqual(presentation.frames[cursor])
        expect(view.frame.observation.contacts).toEqual([])
        expect(view.frame.observation.ownShip).toMatchObject({ sensor: 'passive', clocks: { trackingUntilTick: 0, exposureUntilTick: 0 }, turnActions: { pulseAttemptSpent: cursor !== 0 } })
        expect(view.replay.events.filter((event) => event.kind === 'own-interruption')).toHaveLength(cursor === 0 ? 0 : 1)
      }
      expect(context.controller.getView().frame.observation.ownShip.energy.currentMilli).toBeGreaterThan(DUEL_RULES.sensors.pulseCostMilli)
      context.controller.playback({ kind: 'skipToEnd' })
      const assessed = context.controller.getView()
      if (assessed.phase !== 'assessment') throw new Error('Expected own failure assessment')
      expect(assessed.assessment.sensorAttempt).toEqual({ kind: 'failed', reason: 'insufficient-energy' })
      checkPublicHistory(context.views)
      expect(context.results).toHaveLength(1)
    })
  })
})

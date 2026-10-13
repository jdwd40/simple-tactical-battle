import { describe, expect, it, vi } from 'vitest'
import type { GameView, PlanOpponent, TurnOrders } from '../contracts/public'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_RULES } from '../scenarios/public'
import { createGameController, SIMULATION_ENGINE, type EngineApi } from './createGameController'
import { createManualClock, type PresentationClock } from './presentationClock'
import { scriptedPatrol } from './scriptedPatrol'

const EAST: TurnOrders['movement'] = { kind: 'destination', cell: { column: 16, row: 10 } }
const PRIVATE_KEYS = ['entityId', 'plannerMemory', 'random', 'seed', 'internalEvents', 'presentations', 'nextState', 'spawns', 'terminalPending', 'acceptedTurns', 'launcherEntityId', 'targetEntityId']

function setup(seed = 17, clock: PresentationClock = createManualClock()) {
  const engine = {
    ...SIMULATION_ENGINE,
    resolveTurn: vi.fn(SIMULATION_ENGINE.resolveTurn),
    initialiseSession: vi.fn(SIMULATION_ENGINE.initialiseSession),
  } satisfies EngineApi
  const planOpponent = vi.fn<PlanOpponent>(scriptedPatrol)
  const newSeed = vi.fn(() => 99)
  const controller = createGameController({ seed, newSeed, clock, engine, planOpponent })
  return { controller, engine, planOpponent, newSeed, clock: clock as ReturnType<typeof createManualClock> }
}

function planning(view: GameView) {
  if (view.phase !== 'planning') throw new Error(`expected planning, got ${view.phase}`)
  return view
}
function withReplay(view: GameView) {
  if (view.phase !== 'execution' && view.phase !== 'assessment') throw new Error(`expected playback, got ${view.phase}`)
  return view
}
function commitEast(controller: ReturnType<typeof setup>['controller']) {
  const draft = planning(controller.getView()).draft
  controller.setDraft({ ...draft, movement: EAST })
  return controller.commit(draft.turnIndex)
}
const json = (value: unknown) => JSON.stringify(value)

describe('createGameController: planning and view semantics', () => {
  it('starts in genuine turn-0 planning with carried initial state and no enemy knowledge', () => {
    const { controller } = setup()
    const view = planning(controller.getView())
    expect(view).toMatchObject({ encounterId: 'encounter-1', revision: 0, replay: null })
    expect(view.draft).toEqual({ turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } })
    expect(view.validation.structurallyValid).toBe(true)
    expect(view.routePreview).toEqual({ kind: 'hold', position: { x: 3500, y: 10_500 } })
    expect(view.frame.observation.contacts).toEqual([])
    expect(view.frame.observation.ownShip.position).toEqual({ x: 3500, y: 10_500 })
    expect(Object.isFrozen(view)).toBe(true)
  })

  it('returns the same view reference until an update, notifies subscribers and stops after unsubscribe', () => {
    const { controller } = setup()
    const first = controller.getView()
    expect(controller.getView()).toBe(first)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    controller.setDraft({ ...planning(first).draft, movement: EAST })
    const second = controller.getView()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(second).not.toBe(first)
    expect(second.revision).toBe(first.revision + 1)
    expect(controller.getView()).toBe(second)
    unsubscribe()
    controller.setDraft({ ...planning(second).draft, movement: { kind: 'hold' } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('validates and previews drafts with the engine, copying the input', () => {
    const { controller } = setup()
    const input = { ...planning(controller.getView()).draft, movement: { kind: 'destination', cell: { column: 7, row: 4 } } } as TurnOrders
    controller.setDraft(input)
    const rock = planning(controller.getView())
    expect(rock.validation.issues).toContainEqual({ field: 'movement', severity: 'error', code: 'obstacle', details: { cell: { column: 7, row: 4 } } })
    expect(rock.routePreview.kind).toBe('unavailable')
    ;(input.movement as { cell: { column: number } }).cell.column = 2
    expect(planning(controller.getView()).draft.movement).toEqual({ kind: 'destination', cell: { column: 7, row: 4 } })

    controller.setDraft({ ...rock.draft, movement: EAST })
    const preview = planning(controller.getView()).routePreview
    expect(preview).toMatchObject({ kind: 'destination', destination: { column: 16, row: 10 }, predicted: true, conditionalOnPropulsionFunding: true })
    if (preview.kind === 'destination') expect(preview.waypoints[0]).toEqual({ x: 3500, y: 10_500 })
  })

  it('plans the opponent once per planning entry from its own observation, never from player drafts', () => {
    const { controller, planOpponent } = setup()
    for (const column of [5, 9, 12]) controller.setDraft({ ...planning(controller.getView()).draft, movement: { kind: 'destination', cell: { column, row: 10 } } })
    expect(planOpponent).toHaveBeenCalledTimes(1)
    const [observation] = planOpponent.mock.calls[0]
    expect(observation.side).toBe('patrol')
    expect(json(observation)).not.toContain('"draft"')
  })
})

describe('createGameController: commitment', () => {
  it('rejects invalid drafts and ignores stale turns without resolving', () => {
    const { controller, engine } = setup()
    const draft = planning(controller.getView()).draft
    controller.setDraft({ ...draft, movement: { kind: 'destination', cell: { column: 7, row: 4 } } })
    expect(controller.commit(0)).toMatchObject({ kind: 'rejected' })
    expect(controller.commit(3)).toEqual({ kind: 'ignored', reason: 'stale-turn' })
    expect(engine.resolveTurn).not.toHaveBeenCalled()
    expect(controller.getView().phase).toBe('planning')
  })

  it('locks both envelopes, resolves exactly once and ignores duplicate commits and draft edits', () => {
    const { controller, engine } = setup()
    const phases: string[] = []
    controller.subscribe(() => phases.push(controller.getView().phase))
    expect(commitEast(controller)).toMatchObject({ kind: 'accepted', turnIndex: 0 })
    expect(phases.slice(-2)).toEqual(['commit', 'execution'])
    expect(controller.commit(0)).toEqual({ kind: 'ignored', reason: 'wrong-phase' })
    expect(engine.resolveTurn).toHaveBeenCalledTimes(1)
    const [, locked] = engine.resolveTurn.mock.calls[0]
    expect(locked.orders.player).toEqual({ turnIndex: 0, movement: EAST, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } })
    expect(locked.orders.patrol?.movement).toEqual({ kind: 'destination', cell: { column: 16, row: 4 } })

    const executing = controller.getView()
    controller.setDraft({ turnIndex: 0, movement: { kind: 'hold' }, sensor: 'passive', cloak: true, weapon: { kind: 'hold' } })
    expect(controller.getView()).toBe(executing)
    if (executing.phase !== 'execution') throw new Error('expected execution')
    expect(executing.lockedOwnOrders?.movement).toEqual(EAST)
  })
})

describe('createGameController: cursor-bounded playback', () => {
  it('publishes only frames and events through the cursor and withholds the assessment until the end', () => {
    const { controller, clock } = setup()
    commitEast(controller)
    let view = withReplay(controller.getView())
    expect(view.phase).toBe('execution')
    expect(view.replay).toMatchObject({ startTick: 0, endTick: 100, cursorTick: 0, playback: { playing: true, speed: 1 } })
    expect(view.replay.frames.map((frame) => frame.tick)).toEqual([0])
    expect(view.frame).toBe(view.replay.frames[0])
    expect('assessment' in view).toBe(false)

    clock.advance(100 * 37)
    view = withReplay(controller.getView())
    expect(view.replay.cursorTick).toBe(37)
    expect(view.replay.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: 38 }, (_, tick) => tick))
    expect(view.replay.events.every((event) => event.tick <= 37)).toBe(true)
    for (const key of PRIVATE_KEYS) expect(json(view)).not.toContain(`"${key}"`)
    expect(Object.keys(view).sort()).toEqual(['automatic', 'encounterId', 'frame', 'lockedOwnOrders', 'phase', 'replay', 'replayOf', 'revision', 'rules'])
  })

  it('advances one tick per tickMs/speed, pauses, steps, seeks and skips without resimulating', () => {
    const { controller, clock, engine } = setup()
    commitEast(controller)
    controller.playback({ kind: 'speed', speed: 4 })
    clock.advance(250)
    expect(withReplay(controller.getView()).replay.cursorTick).toBe(10)
    controller.playback({ kind: 'pause' })
    expect(clock.pending).toBe(0)
    clock.advance(5000)
    expect(withReplay(controller.getView()).replay.cursorTick).toBe(10)
    controller.playback({ kind: 'step', direction: 1 })
    controller.playback({ kind: 'step', direction: -1 })
    controller.playback({ kind: 'step', direction: -1 })
    expect(withReplay(controller.getView()).replay.cursorTick).toBe(9)
    controller.playback({ kind: 'seek', tick: -50 })
    expect(withReplay(controller.getView()).replay.cursorTick).toBe(0)
    controller.playback({ kind: 'seek', tick: 60 })
    expect(withReplay(controller.getView()).replay.frames).toHaveLength(61)
    controller.playback({ kind: 'skipToEnd' })
    const assessed = controller.getView()
    expect(assessed.phase).toBe('assessment')
    if (assessed.phase === 'assessment') expect(assessed.assessment.revealTick).toBe(100)
    expect(engine.resolveTurn).toHaveBeenCalledTimes(1)
  })

  it('reaches identical results whatever the playback pattern', () => {
    const results = [
      (c: ReturnType<typeof setup>) => { c.controller.playback({ kind: 'skipToEnd' }) },
      (c: ReturnType<typeof setup>) => { c.clock.advance(100 * 100) },
      (c: ReturnType<typeof setup>) => {
        c.controller.playback({ kind: 'speed', speed: 0.5 }); c.clock.advance(200 * 30)
        c.controller.playback({ kind: 'pause' }); c.controller.playback({ kind: 'seek', tick: 5 })
        c.controller.playback({ kind: 'speed', speed: 4 }); c.controller.playback({ kind: 'play' }); c.clock.advance(25 * 200)
      },
    ].map((pattern) => {
      const context = setup(4242)
      commitEast(context.controller)
      pattern(context)
      const assessed = context.controller.getView()
      if (assessed.phase !== 'assessment') throw new Error(`expected assessment, got ${assessed.phase}`)
      context.controller.finishAssessment()
      return { assessment: json(assessed.assessment), frames: json(assessed.replay.frames), next: json(planning(context.controller.getView()).frame) }
    })
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('replays an assessed turn from recorded frames and returns to the same assessment', () => {
    const { controller, clock, engine } = setup()
    commitEast(controller)
    controller.playback({ kind: 'skipToEnd' })
    const assessed = controller.getView()
    if (assessed.phase !== 'assessment') throw new Error('expected assessment')

    controller.playback({ kind: 'play' })
    let replay = controller.getView()
    expect(replay).toMatchObject({ phase: 'execution', replayOf: 'assessment' })
    expect(withReplay(replay).replay).toMatchObject({ cursorTick: 0, playback: { playing: true } })
    expect(withReplay(replay).replay.frames).toHaveLength(1)
    clock.advance(100 * 20)
    replay = withReplay(controller.getView())
    expect(withReplay(replay).replay.frames[20]).toBe(assessed.replay.frames[20])

    controller.playback({ kind: 'skipToEnd' })
    const again = controller.getView()
    if (again.phase !== 'assessment') throw new Error('expected assessment')
    expect(again.assessment).toBe(assessed.assessment)
    controller.playback({ kind: 'step', direction: -1 })
    expect(controller.getView()).toMatchObject({ phase: 'execution', replayOf: 'assessment' })
    expect(engine.resolveTurn).toHaveBeenCalledTimes(1)
  })

  it('enters the next planning phase with the carried course and actual cloak state', () => {
    const { controller, planOpponent } = setup()
    commitEast(controller)
    controller.playback({ kind: 'skipToEnd' })
    controller.finishAssessment()
    const next = planning(controller.getView())
    expect(next.draft).toEqual({ turnIndex: 1, movement: EAST, sensor: 'passive', cloak: next.frame.observation.ownShip.cloak.actual, weapon: { kind: 'hold' } })
    expect(next.replay).toBeNull()
    expect(next.frame.observation.ownShip.position.x).toBeGreaterThan(3500)
    expect(next.routePreview.kind).toBe('destination')
    expect(planOpponent).toHaveBeenCalledTimes(2)
  })
})

describe('createGameController: restart, abandon and disposal', () => {
  it('restarts during execution with fresh state, and stale timers cannot touch the new encounter', () => {
    const { controller, clock } = setup()
    const initial = controller.getView()
    commitEast(controller)
    clock.advance(1000)
    expect(clock.pending).toBe(1)
    controller.restart({ kind: 'same-seed' })
    expect(clock.pending).toBe(0)
    const fresh = planning(controller.getView())
    expect(fresh.encounterId).toBe('encounter-2')
    clock.advance(20_000)
    expect(controller.getView()).toBe(fresh)
    const strip = (view: GameView) => json({ ...view, encounterId: null, revision: null })
    expect(strip(fresh)).toEqual(strip(initial))
  })

  it('ignores a stale timer callback even when the clock fails to cancel it', () => {
    const fired: Array<() => void> = []
    const leaky: PresentationClock = { schedule: (_ms, callback) => { fired.push(callback); return () => {} } }
    const { controller } = setup(17, leaky)
    commitEast(controller)
    controller.restart({ kind: 'same-seed' })
    const fresh = controller.getView()
    for (const callback of fired) callback()
    expect(controller.getView()).toBe(fresh)
  })

  it('draws a new seed only for new-seed restarts', () => {
    const { controller, engine, newSeed } = setup(17)
    controller.restart({ kind: 'same-seed' })
    controller.restart({ kind: 'new-seed' })
    controller.restart({ kind: 'same-seed' })
    expect(newSeed).toHaveBeenCalledTimes(1)
    expect(engine.initialiseSession.mock.calls.map(([, , seed]) => seed)).toEqual([17, 17, 99, 99])
    expect(engine.initialiseSession.mock.calls.every(([scenario, rules]) => scenario === DUEL_SCENARIO && rules === DUEL_RULES)).toBe(true)
  })

  it('abandons into a stopped encounter with no result, revealing nothing beyond the shown frame', () => {
    const { controller, clock, engine } = setup()
    commitEast(controller)
    clock.advance(100 * 12)
    const shown = controller.getView().frame
    controller.abandon()
    const ended = controller.getView()
    expect(ended).toMatchObject({ phase: 'terminal', result: { kind: 'abandoned' }, replay: null, lockedOwnOrders: null })
    expect(ended.frame).toBe(shown)
    expect(clock.pending).toBe(0)
    controller.playback({ kind: 'play' })
    controller.setDraft({ turnIndex: 1, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
    expect(controller.commit(1)).toEqual({ kind: 'ignored', reason: 'wrong-phase' })
    controller.finishAssessment()
    clock.advance(10_000)
    expect(controller.getView()).toBe(ended)
    expect(engine.resolveTurn).toHaveBeenCalledTimes(1)
    controller.restart({ kind: 'same-seed' })
    expect(controller.getView().phase).toBe('planning')
  })

  it('dispose cancels timers and pauses; playback can resume afterwards', () => {
    const { controller, clock } = setup()
    commitEast(controller)
    controller.dispose()
    expect(clock.pending).toBe(0)
    expect(withReplay(controller.getView()).replay.playback.playing).toBe(false)
    controller.playback({ kind: 'play' })
    clock.advance(300)
    expect(withReplay(controller.getView()).replay.cursorTick).toBe(3)
  })
})

/** Every reachable object in a published view must be frozen; returns the first mutable path. */
function firstMutable(value: unknown, path = 'view', seen = new Set<object>()): string | null {
  if (value === null || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (!Object.isFrozen(value)) return path
  for (const [key, child] of Object.entries(value)) {
    const found = firstMutable(child, `${path}.${key}`, seen)
    if (found) return found
  }
  return null
}

describe('createGameController: published data is recursively immutable', () => {
  it('freezes every view in every phase, including hold and invalid previews and the terminal result', () => {
    const { controller, clock } = setup()
    const views: GameView[] = [controller.getView()]
    const hold = controller.getView()
    expect(planning(hold).routePreview.kind).toBe('hold')
    expect(Reflect.set((planning(hold).routePreview as { position: { x: number } }).position, 'x', 9999)).toBe(false)
    expect(controller.getView()).toBe(hold)
    expect(json(controller.getView())).not.toContain('9999')

    controller.setDraft({ ...planning(hold).draft, movement: { kind: 'destination', cell: { column: 7, row: 4 } } })
    views.push(controller.getView())
    commitEast(controller)
    views.push(controller.getView())
    clock.advance(1500)
    views.push(controller.getView())
    controller.playback({ kind: 'skipToEnd' })
    views.push(controller.getView())
    controller.playback({ kind: 'seek', tick: 40 })
    views.push(controller.getView())
    controller.abandon()
    views.push(controller.getView())
    expect(views.map((view) => view.phase)).toEqual(['planning', 'planning', 'execution', 'execution', 'assessment', 'execution', 'terminal'])
    for (const view of views) expect(firstMutable(view)).toBeNull()
  })
})

describe('createGameController: re-entrant lifecycle during commit publication', () => {
  for (const action of ['restart', 'abandon'] as const) {
    it(`a subscriber that calls ${action} on the commit phase keeps that result; the old commit cannot resume`, () => {
      const { controller, clock } = setup()
      const draft = planning(controller.getView()).draft
      controller.setDraft({ ...draft, movement: EAST })
      let acted = false
      controller.subscribe(() => {
        if (!acted && controller.getView().phase === 'commit') {
          acted = true
          if (action === 'restart') controller.restart({ kind: 'same-seed' })
          else controller.abandon()
        }
      })
      const result = controller.commit(0)
      const after = controller.getView()
      expect(result).toEqual({ kind: 'ignored', reason: 'wrong-phase' })
      if (action === 'restart') {
        expect(after).toMatchObject({ phase: 'planning', encounterId: 'encounter-2' })
        expect(planning(after).draft.movement).toEqual({ kind: 'hold' })
        expect(planning(after).frame.observation.ownShip.position).toEqual({ x: 3500, y: 10_500 })
      } else {
        expect(after).toMatchObject({ phase: 'terminal', encounterId: 'encounter-1', result: { kind: 'abandoned' } })
      }
      expect(clock.pending).toBe(0)
      clock.advance(20_000)
      expect(controller.getView()).toBe(after)
      expect(controller.commit(0)).toEqual(action === 'restart' ? expect.objectContaining({ kind: 'accepted' }) : { kind: 'ignored', reason: 'wrong-phase' })
    })
  }

  it('a restart on the execution publication leaves the fresh encounter untouched by the accepted turn', () => {
    const { controller, clock } = setup()
    controller.setDraft({ ...planning(controller.getView()).draft, movement: EAST })
    let acted = false
    controller.subscribe(() => {
      if (!acted && controller.getView().phase === 'execution') {
        acted = true
        controller.restart({ kind: 'same-seed' })
      }
    })
    const result = controller.commit(0)
    expect(result.kind).toBe('accepted')
    const after = controller.getView()
    expect(after).toMatchObject({ phase: 'planning', encounterId: 'encounter-2' })
    expect(clock.pending).toBe(0)
    clock.advance(20_000)
    expect(controller.getView()).toBe(after)
  })
})

describe('createGameController: capability metadata', () => {
  it('hands the composition root only frozen capability booleans from the injected engine', () => {
    expect(setup().controller.capabilities).toEqual({ ...SIMULATION_ENGINE.capabilities })
    const loose = { activePulse: 1, laser: 'yes', missile: false, resolveTurn: SIMULATION_ENGINE.resolveTurn } as unknown as EngineApi['capabilities']
    const controller = createGameController({ seed: 17, newSeed: () => 1, clock: createManualClock(), engine: { ...SIMULATION_ENGINE, capabilities: loose } })
    expect(controller.capabilities).toEqual({ activePulse: false, laser: false, missile: false })
    expect(Object.isFrozen(controller.capabilities)).toBe(true)
    expect(Object.keys(controller.capabilities).sort()).toEqual(['activePulse', 'laser', 'missile'])
    const pulse = createGameController({ seed: 17, newSeed: () => 1, clock: createManualClock(), engine: { ...SIMULATION_ENGINE, capabilities: { activePulse: true, laser: false, missile: false } } })
    expect(pulse.capabilities.activePulse).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimulationState, TurnResolution } from '../contracts/private'
import type { GameView, Outcome, PlanOpponent, Side } from '../contracts/public'
import { createGameController, SIMULATION_ENGINE, type EngineApi } from './createGameController'
import { createManualClock } from './presentationClock'
import { scriptedPatrol } from './scriptedPatrol'

// Application lifecycle for combat endings. The real engine resolves every turn; a test-only
// wrapper then marks ships destroyed and records an outcome in the PRIVATE next state, as the
// combat engine (TSB-30) will. Presentations stay the real engine's. This checks controller
// timing only; real combat scenes are verified against the TSB-30 engine itself.
type Script = readonly { readonly destroy?: readonly Side[]; readonly outcome?: Outcome }[]

function patched(resolution: TurnResolution, step: Script[number] | undefined): TurnResolution {
  if (!step) return resolution
  let next: SimulationState = resolution.nextState
  for (const side of step.destroy ?? []) {
    next = { ...next, ships: { ...next.ships, [side]: { ...next.ships[side], alive: false, destructionTick: next.tick - 40 } } }
  }
  if (step.outcome) next = { ...next, outcome: { outcome: step.outcome, revealTick: next.tick } }
  return { ...resolution, nextState: next }
}

function setup(script: Script) {
  const clock = createManualClock()
  let calls = 0
  const resolveTurn = vi.fn<EngineApi['resolveTurn']>((state, locked, rules, scenario) => patched(SIMULATION_ENGINE.resolveTurn(state, locked, rules, scenario), script[calls++]))
  const engine: EngineApi = { ...SIMULATION_ENGINE, resolveTurn }
  const planOpponent = vi.fn<PlanOpponent>(scriptedPatrol)
  const controller = createGameController({ seed: 17, newSeed: () => 5, clock, engine, planOpponent })
  return { controller, resolveTurn, planOpponent, clock }
}

const planning = (view: GameView) => {
  if (view.phase !== 'planning') throw new Error(`expected planning, got ${view.phase}`)
  return view
}
function commitHold(controller: ReturnType<typeof setup>['controller']) {
  const view = planning(controller.getView())
  controller.setDraft({ ...view.draft, movement: { kind: 'hold' } })
  expect(controller.commit(view.draft.turnIndex).kind).toBe('accepted')
}
const replayEnd = (view: GameView) => (view.replay ? view.replay.endTick : null)

afterEach(() => { vi.restoreAllMocks() })

describe('combat endings are revealed only at their recorded tick', () => {
  it('keeps a victory recorded at commit hidden until the cursor reaches its reveal tick', () => {
    const { controller, resolveTurn, clock } = setup([{ destroy: ['patrol'], outcome: 'victory' }])
    commitHold(controller)
    clock.advance(50 * 100)
    const mid = controller.getView()
    expect(mid).toMatchObject({ phase: 'execution', automatic: false, replayOf: null })
    expect(JSON.stringify(mid)).not.toContain('victory')
    controller.playback({ kind: 'seek', tick: 99 })
    expect(controller.getView().phase).toBe('execution')
    controller.playback({ kind: 'seek', tick: 100 })
    const ended = controller.getView()
    if (ended.phase !== 'terminal' || ended.result.kind !== 'combat') throw new Error(`expected combat ending, got ${ended.phase}`)
    expect(ended.result.outcome).toEqual({ outcome: 'victory', revealTick: 100 })
    expect(ended.replay?.cursorTick).toBe(100)
    expect(ended.lockedOwnOrders?.turnIndex).toBe(0)
    expect(clock.pending).toBe(0)
    expect(resolveTurn).toHaveBeenCalledTimes(1)
  })

  it('replays a finished encounter from its recordings, withholding the ending until reveal again', () => {
    const { controller, resolveTurn, clock } = setup([{ destroy: ['patrol'], outcome: 'victory' }])
    commitHold(controller)
    controller.playback({ kind: 'skipToEnd' })
    expect(controller.getView().phase).toBe('terminal')
    controller.playback({ kind: 'play' })
    const replaying = controller.getView()
    expect(replaying).toMatchObject({ phase: 'execution', replayOf: 'terminal' })
    expect(replaying.replay?.cursorTick).toBe(0)
    expect(JSON.stringify(replaying)).not.toContain('victory')
    clock.advance(30 * 100)
    expect(controller.getView().replay?.cursorTick).toBe(30)
    controller.abandon()
    expect(controller.getView().phase).toBe('execution')
    controller.playback({ kind: 'skipToEnd' })
    expect(controller.getView()).toMatchObject({ phase: 'terminal', result: { kind: 'combat', outcome: { outcome: 'victory' } } })
    expect(resolveTurn).toHaveBeenCalledTimes(1)
    controller.finishAssessment()
    expect(controller.getView().phase).toBe('terminal')
  })

  it('never lets an unobserved opponent destruction change planning, and stops asking a dead planner', () => {
    const { controller, resolveTurn, planOpponent } = setup([{ destroy: ['patrol'] }])
    expect(planOpponent).toHaveBeenCalledTimes(1)
    commitHold(controller)
    controller.playback({ kind: 'skipToEnd' })
    expect(controller.getView().phase).toBe('assessment')
    controller.finishAssessment()
    const next = planning(controller.getView())
    expect(next.validation.structurallyValid).toBe(true)
    expect(planOpponent).toHaveBeenCalledTimes(1)
    commitHold(controller)
    expect(resolveTurn.mock.calls[1][1].orders).toMatchObject({ patrol: null })
    expect(resolveTurn.mock.calls[1][1].automatic).toBe(false)
  })
})

describe('automatic aftermath after own destruction', () => {
  it('begins each window only when the previous ends, with the living opponent planning from its own view', () => {
    const { controller, resolveTurn, planOpponent, clock } = setup([{ destroy: ['player'] }, {}, { outcome: 'defeat' }])
    commitHold(controller)
    expect(planOpponent).toHaveBeenCalledTimes(1)
    controller.playback({ kind: 'seek', tick: 99 })
    expect(replayEnd(controller.getView())).toBe(100)
    expect(resolveTurn).toHaveBeenCalledTimes(1)

    controller.playback({ kind: 'play' })
    clock.advance(100)
    // The first automatic window begins at the committed turn's end: horizon 200, nothing beyond.
    const begun = controller.getView()
    expect(begun).toMatchObject({ phase: 'execution', automatic: false })
    expect(replayEnd(begun)).toBe(200)
    expect(resolveTurn).toHaveBeenCalledTimes(2)
    const [, automatic] = resolveTurn.mock.calls[1]
    expect(automatic).toMatchObject({ automatic: true, turnIndex: 1, startTick: 100, orders: { player: null } })
    expect(automatic.orders.patrol).not.toBeNull()
    expect(planOpponent).toHaveBeenCalledTimes(2)
    expect(planOpponent.mock.calls[1][0].side).toBe('patrol')

    clock.advance(100)
    const inWindow = controller.getView()
    expect(inWindow).toMatchObject({ phase: 'execution', automatic: true, reason: 'own-destroyed', lockedOwnOrders: null, replayOf: null })
    expect(inWindow.replay?.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: 102 }, (_, tick) => tick))

    controller.playback({ kind: 'skipToEnd' })
    const ended = controller.getView()
    expect(ended).toMatchObject({ phase: 'terminal', result: { kind: 'combat', outcome: { outcome: 'defeat', revealTick: 300 } } })
    expect(ended.replay?.endTick).toBe(300)
    expect(ended.replay?.frames).toHaveLength(301)
    expect(resolveTurn).toHaveBeenCalledTimes(3)
    expect(planOpponent).toHaveBeenCalledTimes(3)

    // Replay re-reads all recorded windows and resolves nothing again.
    controller.playback({ kind: 'play' })
    controller.playback({ kind: 'seek', tick: 250 })
    expect(controller.getView()).toMatchObject({ phase: 'execution', automatic: true, replayOf: 'terminal' })
    controller.playback({ kind: 'skipToEnd' })
    expect(controller.getView().phase).toBe('terminal')
    expect(resolveTurn).toHaveBeenCalledTimes(3)
  })

  it('drains ordnance with no planner calls when both ships are destroyed', () => {
    const { controller, resolveTurn, planOpponent } = setup([{ destroy: ['player', 'patrol'] }, { outcome: 'mutual-destruction' }])
    commitHold(controller)
    controller.playback({ kind: 'skipToEnd' })
    expect(controller.getView()).toMatchObject({ phase: 'terminal', result: { kind: 'combat', outcome: { outcome: 'mutual-destruction' } } })
    expect(resolveTurn.mock.calls[1][1].orders).toEqual({ player: null, patrol: null })
    expect(planOpponent).toHaveBeenCalledTimes(1)
  })

  it('stops at the approved aftermath bound instead of inventing a draw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Both destroyed with no ammunition left: at most two automatic windows.
    const { controller, resolveTurn } = setup([{ destroy: ['player', 'patrol'] }, {}, {}, {}, {}])
    commitHold(controller)
    controller.playback({ kind: 'skipToEnd' })
    const stopped = controller.getView()
    expect(stopped.phase).toBe('execution')
    expect(stopped.replay?.endTick).toBe(300)
    expect(stopped.replay?.cursorTick).toBe(300)
    expect(stopped.replay?.playback.playing).toBe(false)
    expect(resolveTurn).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('bound of 2 windows'))
    expect(JSON.stringify(stopped)).not.toMatch(/draw|victory|defeat/)
  })

  it('allows abandon during the aftermath, and restart builds a clean encounter', () => {
    const { controller } = setup([{ destroy: ['player'] }])
    commitHold(controller)
    controller.playback({ kind: 'seek', tick: 100 })
    controller.abandon()
    expect(controller.getView()).toMatchObject({ phase: 'terminal', result: { kind: 'abandoned' }, replay: null })
    controller.restart({ kind: 'same-seed' })
    expect(controller.getView()).toMatchObject({ phase: 'planning', encounterId: 'encounter-2', frame: { tick: 0 } })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { GameView, Outcome } from '../contracts/public'
import { DUEL_SEED, LASER_DUEL } from '../../tests/harness/duel/sequence'
import { OPPONENTS, type OpponentName } from '../../tests/harness/duel/opponents'
import { createGameController, SIMULATION_ENGINE, type EngineApi } from './createGameController'
import { createManualClock } from './presentationClock'

// TSB-31 application lifecycle on the REAL engine (lasers, damage, destruction, outcomes).
// The player orders are LASER_DUEL; only the scripted opponent differs between scenes.
const CONTACT_KEYS = new Set(['alias', 'measurement', 'previousMeasurement', 'estimatedVelocity', 'observedDestructionTick', 'kind', 'ageTicks', 'uncertaintyRadiusUnits'])

function play(opponent: OpponentName) {
  const resolveTurn = vi.fn<EngineApi['resolveTurn']>(SIMULATION_ENGINE.resolveTurn)
  const planOpponent = vi.fn(OPPONENTS[opponent])
  const newSeed = vi.fn(() => 99)
  const controller = createGameController({ seed: DUEL_SEED, newSeed, clock: createManualClock(), engine: { ...SIMULATION_ENGINE, resolveTurn }, planOpponent })
  const views: GameView[] = []
  controller.subscribe(() => views.push(controller.getView()))
  for (const [index, turn] of LASER_DUEL.entries()) {
    const view = controller.getView()
    if (view.phase !== 'planning') break
    const contact = view.frame.observation.contacts[0]
    controller.setDraft({
      ...view.draft, cloak: false,
      movement: turn.destination ? { kind: 'destination', cell: turn.destination } : { kind: 'hold' },
      weapon: turn.laser && contact ? { kind: 'laser', contactAlias: contact.alias } : { kind: 'hold' },
    })
    const planned = controller.getView()
    if (planned.phase !== 'planning' || !planned.validation.structurallyValid) throw new Error(`turn ${index + 1} orders invalid`)
    expect(controller.commit(view.draft.turnIndex).kind).toBe('accepted')
    controller.playback({ kind: 'pause' })
    controller.playback({ kind: 'seek', tick: view.frame.tick + 99 })
    const before = controller.getView()
    expect(before.phase).toBe('execution')
    expect(JSON.stringify(before)).not.toMatch(/"outcome"/)
    controller.playback({ kind: 'skipToEnd' })
    if (controller.getView().phase === 'terminal') break
    controller.finishAssessment()
  }
  return { controller, resolveTurn, planOpponent, newSeed, views }
}

function ending(view: GameView): { outcome: Outcome; revealTick: number } {
  if (view.phase !== 'terminal' || view.result.kind !== 'combat') throw new Error(`expected a combat ending, got ${view.phase}`)
  return view.result.outcome
}

describe('real-engine laser endings through the application controller', () => {
  it.each([
    ['scripted', 'victory', 700, 7],
    ['firing', 'defeat', 600, 6],
    ['retaliating', 'mutual-destruction', 700, 7],
  ] as const)('against the %s opponent the recorded %s is revealed at tick %i only', (opponent, outcome, revealTick, turns) => {
    const { controller, resolveTurn, views } = play(opponent)
    expect(ending(controller.getView())).toEqual({ outcome, revealTick })
    expect(resolveTurn).toHaveBeenCalledTimes(turns)
    expect(resolveTurn.mock.calls.every(([, locked]) => locked.automatic === false)).toBe(true)
    // No published view before the reveal tick carries an ending, terminal phase or outcome event.
    const early = views.filter((view) => view.frame.tick < revealTick)
    expect(early.some((view) => view.phase === 'terminal')).toBe(false)
    expect(early.some((view) => JSON.stringify(view).includes('"kind":"outcome"'))).toBe(false)
    // Contacts carry only public memory fields: no enemy health, energy or orders.
    for (const view of views) for (const contact of view.frame.observation.contacts) expect(Object.keys(contact).every((key) => CONTACT_KEYS.has(key))).toBe(true)
  })

  it('shows own destruction at its tick while the committed turn still completes, then defeat at the boundary', () => {
    const { controller } = play('firing')
    controller.playback({ kind: 'seek', tick: 500 })
    expect(controller.getView().frame.observation.ownShip.status).toBe('alive')
    controller.playback({ kind: 'seek', tick: 501 })
    const destroyed = controller.getView()
    expect(destroyed).toMatchObject({ phase: 'execution', replayOf: 'terminal', automatic: false })
    expect(destroyed.frame.observation.ownShip.status).toBe('destroyed')
    expect(destroyed.replay?.events.some((event) => event.kind === 'own-destruction' && event.tick === 501)).toBe(true)
    controller.playback({ kind: 'seek', tick: 599 })
    expect(controller.getView().phase).toBe('execution')
    controller.playback({ kind: 'skipToEnd' })
    expect(ending(controller.getView()).outcome).toBe('defeat')
  })

  it('replays a finished duel without resolving again, refuses abandon, and restarts cleanly', () => {
    const { controller, resolveTurn, newSeed } = play('retaliating')
    controller.playback({ kind: 'play' })
    expect(controller.getView()).toMatchObject({ phase: 'execution', replayOf: 'terminal' })
    controller.abandon()
    expect(controller.getView().phase).toBe('execution')
    controller.playback({ kind: 'seek', tick: 601 })
    const lethal = controller.getView()
    expect(lethal.replay?.events.filter((event) => event.tick === 601).map((event) => event.kind)).toEqual(expect.arrayContaining(['own-destruction', 'observed-destruction']))
    expect(lethal.phase).toBe('execution')
    controller.playback({ kind: 'skipToEnd' })
    expect(ending(controller.getView()).outcome).toBe('mutual-destruction')
    expect(resolveTurn).toHaveBeenCalledTimes(7)

    controller.restart({ kind: 'same-seed' })
    const fresh = controller.getView()
    expect(fresh).toMatchObject({ phase: 'planning', encounterId: 'encounter-2', frame: { tick: 0 } })
    expect(fresh.frame.observation.contacts).toEqual([])
    expect(fresh.frame.observation.ownShip.hull).toEqual({ current: 100, max: 100 })
    controller.restart({ kind: 'new-seed' })
    expect(newSeed).toHaveBeenCalledTimes(1)
    expect(controller.getView()).toMatchObject({ phase: 'planning', encounterId: 'encounter-3' })
  })
})

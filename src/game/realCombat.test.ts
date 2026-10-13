import { describe, expect, it, vi } from 'vitest'
import type { GameView, Outcome } from '../contracts/public'
import { ASTEROID_SHOT, DEAD_LAUNCHER, DUEL_SEED, EVASION, LASER_DUEL, STALE_TRACK, type MissileTurn } from '../../tests/harness/duel/sequence'
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

// TSB-31 missiles and automatic aftermath on the REAL engine (TSB-30B): no patched state.
function playMissileTurns(opponent: OpponentName, turns: readonly MissileTurn[]) {
  const resolveTurn = vi.fn<EngineApi['resolveTurn']>(SIMULATION_ENGINE.resolveTurn)
  const planOpponent = vi.fn(OPPONENTS[opponent])
  const controller = createGameController({ seed: DUEL_SEED, newSeed: () => 5, clock: createManualClock(), engine: { ...SIMULATION_ENGINE, resolveTurn }, planOpponent })
  const views: GameView[] = []
  controller.subscribe(() => views.push(controller.getView()))
  const assessments: GameView[] = []
  for (const [index, turn] of turns.entries()) {
    const view = controller.getView()
    if (view.phase !== 'planning') throw new Error(`turn ${index + 1}: expected planning, got ${view.phase}`)
    const contact = view.frame.observation.contacts.find((known) => known.kind === 'current') ?? view.frame.observation.contacts[0]
    controller.setDraft({
      ...view.draft, cloak: false,
      movement: turn.destination ? { kind: 'destination', cell: turn.destination } : { kind: 'hold' },
      weapon: turn.missileAim ? { kind: 'missile', aim: turn.missileAim } : turn.laser && contact ? { kind: 'laser', contactAlias: contact.alias } : { kind: 'hold' },
    })
    const planned = controller.getView()
    if (planned.phase !== 'planning' || !planned.validation.structurallyValid) throw new Error(`turn ${index + 1} orders invalid`)
    expect(controller.commit(view.draft.turnIndex).kind).toBe('accepted')
    controller.playback({ kind: 'pause' })
    if (index === turns.length - 1) break
    controller.playback({ kind: 'skipToEnd' })
    assessments.push(controller.getView())
    controller.finishAssessment()
  }
  const seek = (tick: number) => {
    controller.playback({ kind: 'seek', tick })
    return controller.getView()
  }
  return { controller, resolveTurn, planOpponent, views, assessments, seek }
}

const ownMissileEvent = (view: GameView, tick: number) => view.replay?.events.find((event) => event.kind === 'own-missile' && event.tick === tick)

describe('real-engine missiles, evasion and automatic aftermath', () => {
  it('stops a missile on an asteroid face before its aim, recorded only from its tick', () => {
    const { seek } = playMissileTurns('scripted', ASTEROID_SHOT)
    const flying = seek(222)
    expect(flying.frame.observation.ownMissiles.map((missile) => missile.status)).toEqual(['flying'])
    expect(flying.replay?.events.some((event) => event.kind === 'observed-impact')).toBe(false)
    const struck = seek(223)
    const detonation = ownMissileEvent(struck, 223)
    expect(detonation).toMatchObject({ missile: { status: 'detonated', position: { x: 7780, y: 6100 }, aim: { column: 6, row: 4 } } })
    expect(struck.replay?.events).toContainEqual(expect.objectContaining({ kind: 'observed-impact', tick: 223, weapon: 'missile', position: { x: 7780, y: 6100 } }))
  })

  it('lets the player evade a hostile missile and keeps a lost track as an aged last sighting without aim', () => {
    const hit = playMissileTurns('missile', EVASION)
    const turn3 = hit.assessments[2]
    expect(turn3.phase === 'assessment' && turn3.assessment.events.some((event) => event.kind === 'own-damage')).toBe(true)
    hit.controller.playback({ kind: 'skipToEnd' })
    const evaded = hit.controller.getView()
    if (evaded.phase !== 'assessment') throw new Error('expected assessment')
    expect(evaded.assessment.deltas).toMatchObject({ hull: 0, shields: 0 })
    expect(evaded.assessment.events.map((event) => event.kind)).toEqual(expect.arrayContaining(['hostile-missile-sighted', 'observed-impact', 'hostile-missile-expired']))
    expect(evaded.assessment.events.some((event) => event.kind === 'own-damage')).toBe(false)

    const lost = playMissileTurns('missile', STALE_TRACK)
    const planning = lost.assessments[3]
    expect(planning.phase).toBe('assessment')
    const next = lost.controller.getView()
    const track = next.frame.observation.hostileMissiles
    expect(track.map(({ alias, kind }) => ({ alias, kind }))).toEqual([{ alias: 'missile-2', kind: 'stale' }])
    expect(Object.keys(track[0])).not.toContain('aim')
    lost.controller.playback({ kind: 'skipToEnd' })
    expect(lost.controller.getView().replay?.events).toContainEqual(expect.objectContaining({ kind: 'hostile-missile-expired', tick: 469 }))
  })

  it('carries an own missile across the turn boundary into the next planning view', () => {
    const { controller } = playMissileTurns('scripted', [...DEAD_LAUNCHER, { destination: null }])
    controller.playback({ kind: 'skipToEnd' })
    const end = controller.getView()
    expect(end.replay?.events).toContainEqual(expect.objectContaining({ kind: 'own-missile', tick: 611, missile: expect.objectContaining({ status: 'detonated', launchTick: 501 }) }))
    expect(end.phase).toBe('assessment')
  })

  it('flies a destroyed launcher\'s missile on through one real automatic window, then reveals defeat', () => {
    const { controller, resolveTurn, planOpponent, views, seek } = playMissileTurns('firing', DEAD_LAUNCHER)
    const before = seek(599)
    expect(before).toMatchObject({ phase: 'execution', automatic: false, replay: { endTick: 600 } })
    expect(before.frame.observation.ownShip.status).toBe('destroyed')
    expect(before.frame.observation.ownMissiles.map((missile) => missile.status)).toEqual(['flying'])
    expect(resolveTurn).toHaveBeenCalledTimes(6)
    expect(planOpponent).toHaveBeenCalledTimes(6)

    // The automatic window begins only as the committed turn ends: one more known window.
    const begun = seek(600)
    expect(begun.replay?.endTick).toBe(700)
    expect(resolveTurn).toHaveBeenCalledTimes(7)
    const [, automatic] = resolveTurn.mock.calls[6]
    expect(automatic).toMatchObject({ automatic: true, startTick: 600, orders: { player: null } })
    expect(automatic.orders.patrol?.weapon).toEqual({ kind: 'hold' })
    expect(planOpponent).toHaveBeenCalledTimes(7)
    expect(planOpponent.mock.calls[6][0].side).toBe('patrol')

    const flying = seek(605)
    expect(flying).toMatchObject({ phase: 'execution', automatic: true, reason: 'own-destroyed', lockedOwnOrders: null })
    expect(flying.frame.observation.ownMissiles.map((missile) => missile.status)).toEqual(['flying'])
    expect(ownMissileEvent(seek(611), 611)).toMatchObject({ missile: { status: 'detonated', aim: { column: 0, row: 0 } } })
    expect(seek(699).phase).toBe('execution')
    controller.playback({ kind: 'skipToEnd' })
    expect(ending(controller.getView())).toEqual({ outcome: 'defeat', revealTick: 700 })
    expect(resolveTurn).toHaveBeenCalledTimes(7)
    // Private world fields never reach a published view.
    const published = JSON.stringify(views)
    for (const key of ['"alive":', '"missiles":', '"terminalPending"', '"entityId"', '"launcherEntityId"']) expect(published).not.toContain(key)
  })
})

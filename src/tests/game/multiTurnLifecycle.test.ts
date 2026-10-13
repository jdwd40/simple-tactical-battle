import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TurnResolution } from '../../contracts/private'
import type { GameView } from '../../contracts/public'
import { createGameController, createManualClock, SIMULATION_ENGINE, type EngineApi } from '../../game/index'
import { DUEL_SCENARIO } from '../../scenarios/private'
import { DUEL_RULES } from '../../scenarios/public'
import { LIFECYCLE_SEEDS, LIFECYCLE_SEQUENCE } from './lifecycleSequence'

type Schedule = 'skip' | 'regular' | 'mixed'
function failure(message: string, data: unknown, cause: unknown): Error {
  const artifact = join(mkdtempSync(join(tmpdir(), 'tsb-12b-reproduction-')), 'failure.json')
  writeFileSync(artifact, JSON.stringify(data, null, 2))
  return new Error(`${message}; complete reproduction saved to ${artifact}`, { cause })
}
function setup(seed: number) {
  const clock = createManualClock()
  const resolutions: TurnResolution[] = []
  const seeds: number[] = []
  const engine: EngineApi = {
    ...SIMULATION_ENGINE,
    initialiseSession(...args) {
      expect(args[0]).toBe(DUEL_SCENARIO)
      expect(args[1]).toBe(DUEL_RULES)
      seeds.push(args[2])
      return SIMULATION_ENGINE.initialiseSession(...args)
    },
    resolveTurn(...args) {
      const result = SIMULATION_ENGINE.resolveTurn(...args)
      resolutions.push(result)
      return result
    },
  }
  const controller = createGameController({ seed, clock, engine, newSeed: () => { throw new Error('Same-seed lifecycle must not draw entropy') } })
  return { controller, clock, resolutions, seeds }
}
type Context = ReturnType<typeof setup>
const planning = (view: GameView) => {
  if (view.phase !== 'planning') throw new Error(`Expected planning, got ${view.phase}`)
  return view
}
const assessment = (view: GameView) => {
  if (view.phase !== 'assessment') throw new Error(`Expected assessment, got ${view.phase}`)
  return view
}

function play(context: Context, schedule: Schedule) {
  const { controller, clock } = context
  const view = controller.getView()
  if (view.phase !== 'execution') throw new Error('Expected committed execution')
  const start = view.replay.startTick
  if (schedule === 'skip') controller.playback({ kind: 'skipToEnd' })
  else if (schedule === 'regular') clock.advance(DUEL_RULES.timing.turnMs)
  else {
    controller.playback({ kind: 'speed', speed: 0.5 })
    for (const ms of [17, 383, 601]) clock.advance(ms)
    controller.playback({ kind: 'pause' })
    const paused = controller.getView()
    expect(clock.pending).toBe(0)
    clock.advance(1234)
    expect(controller.getView()).toBe(paused)
    controller.playback({ kind: 'seek', tick: start + 3 })
    controller.playback({ kind: 'speed', speed: 4 })
    controller.playback({ kind: 'play' })
    for (const ms of [11, 139, 503]) clock.advance(ms)
    controller.playback({ kind: 'pause' })
    controller.playback({ kind: 'step', direction: 1 })
    controller.playback({ kind: 'step', direction: -1 })
    controller.playback({ kind: 'seek', tick: start + 18 })
    controller.playback({ kind: 'speed', speed: 2 })
    controller.playback({ kind: 'play' })
    for (const ms of [37, 219, 811, 10_000]) clock.advance(ms)
  }
  expect(controller.getView().phase).toBe('assessment')
  expect(clock.pending).toBe(0)
}

function runSequence(context: Context, schedule: Schedule): TurnResolution[] {
  const { controller, clock, resolutions } = context
  const offset = resolutions.length
  for (const [turnIndex, movement] of LIFECYCLE_SEQUENCE.entries()) {
    const draft = { turnIndex, movement, cloak: true, sensor: 'passive', weapon: { kind: 'hold' } } as const
    expect(planning(controller.getView()).draft.turnIndex).toBe(turnIndex)
    controller.setDraft(draft)
    expect(controller.commit(turnIndex)).toMatchObject({ kind: 'accepted', turnIndex })
    play(context, schedule)
    const resolved = resolutions[offset + turnIndex]
    expect(resolved.locked.orders.player).toEqual(draft)
    expect(resolutions).toHaveLength(offset + turnIndex + 1)
    const assessed = assessment(controller.getView())
    expect(assessed.replay.frames).toEqual(resolved.presentations.player.frames)
    expect(assessed.assessment).toEqual(resolved.presentations.player.assessment)

    // Replay each latest turn, including the second/third absolute-tick windows.
    const cursor = assessed.replay.startTick + 7
    controller.playback({ kind: 'seek', tick: cursor })
    controller.playback({ kind: 'pause' })
    const replay = controller.getView()
    if (replay.phase !== 'execution') throw new Error('Expected historical execution')
    expect(replay.replayOf).toBe('assessment')
    expect(replay.replay.frames).toEqual(assessed.replay.frames.slice(0, 8))
    expect(replay.replay.events).toEqual(assessed.replay.events.filter((event) => event.tick <= cursor))
    expect(replay.replay.frames.every((frame) => frame.tick >= turnIndex * DUEL_RULES.timing.turnTicks && frame.tick <= cursor)).toBe(true)
    expect('assessment' in replay).toBe(false)
    clock.advance(333)
    expect(controller.getView()).toBe(replay)
    controller.playback({ kind: 'step', direction: 1 })
    expect(controller.getView().frame).toEqual(assessed.replay.frames[8])
    // Leaving a historical replay must plan from the resolved final state, not its cursor.
    controller.finishAssessment()
    const next = planning(controller.getView())
    expect(next.frame.observation.ownShip.position).toEqual(resolved.nextState.ships.player.position)
    expect(next.frame.observation.ownShip.route).toEqual(resolved.nextState.ships.player.route)
    expect(next.draft.turnIndex).toBe(turnIndex + 1)
    expect(next.replay).toBeNull()
    expect(next.frame.events).toEqual([])
    expect(clock.pending).toBe(0)
    expect(resolutions).toHaveLength(offset + turnIndex + 1)
  }
  return resolutions.slice(offset)
}

describe.each(LIFECYCLE_SEEDS)('multi-turn real controller seed=%s', (seed) => {
  it('skip, regular and mixed playback produce identical COMPLETE private resolutions', () => {
    const recorded: string[] = []
    for (const schedule of ['skip', 'regular', 'mixed'] as const) {
      const context = setup(seed)
      try {
        recorded.push(JSON.stringify(runSequence(context, schedule)))
        expect(context.seeds).toEqual([seed])
        expect(context.resolutions).toHaveLength(3)
        // Compare every serialized byte; keep large failure data in the artifact, not stdout.
        expect(recorded.at(-1) === recorded[0], 'Complete private resolutions differ across playback schedules').toBe(true)
      } catch (cause) {
        throw failure(`Playback seed=${seed} schedule=${schedule}`, { seed, rules: DUEL_RULES, orders: LIFECYCLE_SEQUENCE, schedule, expectedResolutions: recorded[0] ? JSON.parse(recorded[0]) : null, actualResolutions: context.resolutions, actualView: context.controller.getView() }, cause)
      } finally { context.controller.dispose() }
    }
  })

  it('same-seed restart after acquired/lost contact history clears the view and reproduces every turn', () => {
    const context = setup(seed)
    const initial = context.controller.getView()
    try {
      const original = runSequence(context, 'mixed')
      const events = original.flatMap((turn) => turn.presentations.player.frames.flatMap((frame) => frame.events))
      expect(events.some((event) => event.kind === 'contact-acquired')).toBe(true)
      expect(events.some((event) => event.kind === 'contact-lost')).toBe(true)
      expect(context.controller.getView().frame.observation.contacts.some((contact) => contact.kind === 'stale')).toBe(true)
      context.controller.restart({ kind: 'same-seed' })
      const fresh = planning(context.controller.getView())
      expect(fresh.encounterId).not.toBe(initial.encounterId)
      expect(fresh.revision).toBeGreaterThan(initial.revision)
      const stripIdentity = (view: GameView) => ({ ...view, encounterId: null, revision: null })
      expect(stripIdentity(fresh)).toEqual(stripIdentity(initial))
      expect(fresh.frame).toMatchObject({ tick: 0, events: [], observation: { tick: 0, contacts: [], ownMissiles: [], hostileMissiles: [], events: [] } })
      expect(fresh.replay).toBeNull()
      expect(fresh.draft.movement).toEqual({ kind: 'hold' })
      expect(fresh.frame.observation.ownShip.route.waypoints).toEqual([])
      expect(context.clock.pending).toBe(0)
      context.clock.advance(20_000)
      expect(context.controller.getView()).toBe(fresh)
      expect(JSON.stringify(runSequence(context, 'regular')) === JSON.stringify(original), 'Complete private resolutions differ after same-seed restart').toBe(true)
      expect(context.seeds).toEqual([seed, seed])
      expect(context.resolutions).toHaveLength(6)
    } catch (cause) {
      throw failure(`Restart seed=${seed}`, { seed, rules: DUEL_RULES, orders: LIFECYCLE_SEQUENCE, actualResolutions: context.resolutions, actualView: context.controller.getView() }, cause)
    } finally { context.controller.dispose() }
  })
})

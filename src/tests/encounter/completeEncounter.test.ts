import { describe, expect, it } from 'vitest'
import type { GameView, TurnOrders } from '../../contracts'
import { aftermathWindowBound } from '../../contracts'
import { SIMULATION_ENGINE } from '../../game'
import { HIDE_AND_SEEK, HIDE_AND_SEEK_ENDING } from '../../../tests/scenes/mission'
import { BOTH_DEAD_RULES, DEAD_PATROL_RULES, DEAD_PLAYER_RULES, hold, laser, launchNorth, reproduce, setup, type Context } from './encounterFixtures'

function commit(context: Context, draft: TurnOrders) {
  context.controller.setDraft(draft)
  expect(context.controller.commit(draft.turnIndex)).toMatchObject({ kind: 'accepted' })
}
function execution(view: GameView) {
  if (view.phase !== 'execution') throw new Error(`Expected execution, got ${view.phase}`)
  return view
}
function planning(view: GameView) {
  if (view.phase !== 'planning') throw new Error(`Expected planning, got ${view.phase}`)
  return view
}
function checkPrefixes(context: Context) {
  for (const view of context.views) {
    expect(JSON.stringify(view)).not.toMatch(/"terminalPending"|"nextState"|"entityId"|"launcherEntityId"/)
    if (view.replay) {
      expect(view.replay.frames.every((f) => f.tick <= view.replay!.cursorTick)).toBe(true)
      expect(view.replay.events.every((e) => e.tick <= view.replay!.cursorTick)).toBe(true)
    }
    if (view.phase !== 'terminal') expect('result' in view).toBe(false)
  }
}
function drain(context: Context, bound: number) {
  let advances = 0
  while (context.controller.getView().phase === 'execution' && advances <= bound) {
    context.controller.playback({ kind: 'skipToEnd' })
    advances++
  }
  expect(context.controller.getView().phase).toBe('terminal')
  expect(context.results.filter((r) => r.locked.automatic).length).toBeLessThanOrEqual(bound)
  expect(context.clock.pending).toBe(0)
}

describe('real AI/controller complete encounters', () => {
  it('a surviving player evades a dead AI launcher’s real missile, without early outcome or further dead-planner calls', () => {
    const c = setup(DEAD_PATROL_RULES, 1000)
    reproduce(c, () => {
      commit(c, { ...hold(0), sensor: 'activePulse' })
      c.controller.playback({ kind: 'skipToEnd' })
      c.controller.finishAssessment()
      commit(c, { ...laser(1), movement: { kind: 'destination', cell: { column: 11, row: 10 } } })
      const kill = c.results[1]
      expect(kill.locked.orders.patrol?.weapon.kind).toBe('missile')
      expect(kill.nextState).toMatchObject({ outcome: null, terminalPending: true, ships: { player: { alive: true }, patrol: { alive: false } } })
      expect(kill.nextState.missiles).toMatchObject([{ launcherSide: 'patrol' }])
      expect(c.controller.getView().frame.observation.observedOpponentDestructionTick).toBeUndefined()
      c.controller.playback({ kind: 'skipToEnd' })
      const assessed = c.controller.getView()
      if (assessed.phase !== 'assessment') throw new Error('Expected surviving-player assessment')
      expect(assessed.assessment.ordnancePending).toEqual({ reason: 'observed-opponent-destroyed' })
      c.controller.finishAssessment()
      const evasive = planning(c.controller.getView())
      expect(evasive.draft.weapon).toEqual({ kind: 'hold' })
      expect(evasive.frame.observation.hostileMissiles.length).toBeGreaterThan(0)
      const planCount = c.plans.length
      const remaining = aftermathWindowBound(c.rules, 0)
      for (let n = 0; n < remaining && c.controller.getView().phase === 'planning'; n++) {
        const view = planning(c.controller.getView())
        const draft: TurnOrders = { ...hold(view.draft.turnIndex), movement: { kind: 'destination', cell: { column: 10, row: 12 } } }
        commit(c, draft)
        expect(c.results.at(-1)!.locked.orders.patrol).toBeNull()
        c.controller.playback({ kind: 'skipToEnd' })
        if (c.controller.getView().phase === 'assessment') c.controller.finishAssessment()
      }
      expect(c.plans.length).toBe(planCount)
      expect(c.results.slice(2).every((r) => !r.locked.automatic)).toBe(true)
      const final = c.results.at(-1)!
      expect(final.nextState.missiles).toEqual([])
      expect(final.nextState.ships.player.position).not.toEqual(kill.nextState.ships.player.position)
      expect(final.nextState.ships.player.hull).toBe(kill.nextState.ships.player.hull)
      expect(final.nextState.ships.player.shields).toBe(kill.nextState.ships.player.shields)
      const ending = c.controller.getView()
      if (ending.phase !== 'terminal' || ending.result.kind !== 'combat') throw new Error('Expected combat ending')
      expect(ending.result.outcome.outcome).toBe('victory')
      checkPrefixes(c)
    })
  })

  it('own destruction starts bounded automatic windows with real observation-only AI, null player orders and causal replay', () => {
    const c = setup(DEAD_PLAYER_RULES)
    reproduce(c, () => {
      commit(c, hold(0))
      c.controller.playback({ kind: 'skipToEnd' })
      c.controller.finishAssessment()
      commit(c, launchNorth(1))
      const killed = c.results[1].nextState
      expect(killed).toMatchObject({ outcome: null, terminalPending: true, ships: { player: { alive: false }, patrol: { alive: true } } })
      expect(killed.missiles).toMatchObject([{ launcherSide: 'player' }])
      expect(c.results).toHaveLength(2)
      expect(execution(c.controller.getView()).replay.endTick).toBe(20)
      c.controller.playback({ kind: 'seek', tick: 20 })
      expect(c.results).toHaveLength(3)
      expect(execution(c.controller.getView()).replay.endTick).toBe(30)
      expect(c.plans[2].input[0].hostileMissiles.length).toBeGreaterThan(0)
      expect(c.plans[2].output.orders.movement.kind).toBe('destination')
      c.controller.playback({ kind: 'pause' })
      c.controller.playback({ kind: 'step', direction: 1 })
      const automatic = execution(c.controller.getView())
      expect(automatic.automatic).toBe(true)
      expect(automatic.lockedOwnOrders).toBeNull()
      c.controller.setDraft(hold(2))
      expect(c.controller.commit(2)).toEqual({ kind: 'ignored', reason: 'wrong-phase' })
      expect(c.controller.getView()).toBe(automatic)
      drain(c, aftermathWindowBound(c.rules, killed.ships.patrol.ammunition))
      for (const [i, result] of c.results.entries()) {
        const planned = c.plans[i]
        expect(planned.input[0]).toEqual(SIMULATION_ENGINE.observeSide(c.inputs[i], 'patrol', c.rules, c.scenario))
        expect(JSON.stringify(planned.input[0])).not.toMatch(/"terminalPending"|"entityId"|"orders"|"random"/)
        expect(c.inputs[i].plannerMemory.patrol).toEqual(planned.output.memory)
        expect(c.inputs[i].random.planners.patrol).toBe(planned.output.plannerRandomState)
        if (i > 0) {
          expect(planned.input[1]).toEqual(c.results[i - 1].nextState.plannerMemory.patrol)
          expect(planned.input[2]).toBe(c.results[i - 1].nextState.random.planners.patrol)
        }
        if (result.locked.automatic) {
          expect(result.locked.orders.player).toBeNull()
          expect(planned.input[0].observedOpponentDestructionTick).toBe(killed.ships.player.destructionTick)
          expect(result.locked.orders.patrol?.weapon.kind).toBe('hold')
        }
      }
      const final = c.controller.getView()
      if (final.phase !== 'terminal' || final.result.kind !== 'combat') throw new Error('Expected combat terminal')
      expect(final.result.outcome.outcome).toBe('defeat')
      const count = c.results.length
      const plans = c.plans.length
      c.controller.playback({ kind: 'seek', tick: 21 })
      expect(execution(c.controller.getView()).replayOf).toBe('terminal')
      expect(c.controller.getView().frame.observation.outcome).toBeUndefined()
      c.controller.playback({ kind: 'skipToEnd' })
      expect(c.results.length).toBe(count)
      expect(c.plans.length).toBe(plans)
      expect(c.results.at(-1)!.nextState.missiles).toEqual([])
      checkPrefixes(c)
    })
  })

  it('both-dead drainage bypasses the AI entirely while a real previously launched missile resolves', () => {
    const c = setup(BOTH_DEAD_RULES)
    reproduce(c, () => {
      commit(c, launchNorth(0))
      c.controller.playback({ kind: 'skipToEnd' })
      c.controller.finishAssessment()
      commit(c, laser(1))
      expect(c.results[1].nextState).toMatchObject({ outcome: null, ships: { player: { alive: false }, patrol: { alive: false } } })
      expect(c.results[1].nextState.missiles.length).toBeGreaterThan(0)
      const planned = c.plans.length
      drain(c, aftermathWindowBound(c.rules, 0))
      expect(c.plans.length).toBe(planned)
      expect(c.results.slice(2).every((r) => r.locked.automatic && r.locked.orders.player === null && r.locked.orders.patrol === null)).toBe(true)
      const final = c.results.at(-1)!.nextState
      expect(final).toMatchObject({ missiles: [], outcome: { outcome: 'mutual-destruction' } })
      checkPrefixes(c)
    })
  })

  it('a full nine-turn real-AI mission restarts and reproduces every resolution under different playback choices', () => {
    const c = setup()
    reproduce(c, () => {
      const initial = c.controller.getView()
      const play = (mixed: boolean) => {
        const offset = c.results.length
        for (const [turnIndex, turn] of HIDE_AND_SEEK.entries()) {
          commit(c, { ...hold(turnIndex), movement: turn.destination ? { kind: 'destination', cell: turn.destination } : { kind: 'hold' },
            cloak: turn.cloak, weapon: turn.laser ? { kind: 'laser', contactAlias: 'contact-1' } : { kind: 'hold' } })
          if (mixed) {
            c.clock.advance(350)
            c.controller.playback({ kind: 'pause' })
            const paused = c.controller.getView()
            c.clock.advance(500)
            expect(c.controller.getView()).toBe(paused)
            c.controller.playback({ kind: 'seek', tick: turnIndex * 100 + 1 })
            c.controller.playback({ kind: 'speed', speed: 4 })
            c.controller.playback({ kind: 'play' })
            c.clock.advance(400)
          }
          c.controller.playback({ kind: 'skipToEnd' })
          if (turnIndex < HIDE_AND_SEEK.length - 1) c.controller.finishAssessment()
        }
        const end = c.controller.getView()
        if (end.phase !== 'terminal' || end.result.kind !== 'combat') throw new Error('Expected recorded mission ending')
        expect(end.result.outcome).toEqual(HIDE_AND_SEEK_ENDING)
        return c.results.slice(offset)
      }
      const original = play(false)
      c.controller.restart({ kind: 'same-seed' })
      const fresh = planning(c.controller.getView())
      const strip = (v: GameView) => ({ ...v, encounterId: null, revision: null })
      expect(strip(fresh)).toEqual(strip(initial))
      expect(fresh.encounterId).not.toBe(initial.encounterId)
      expect(c.clock.pending).toBe(0)
      const repeated = play(true)
      expect(JSON.stringify(repeated) === JSON.stringify(original), 'Complete real-AI resolutions differ after restart/playback changes').toBe(true)
      expect(c.plans).toHaveLength(18)
      expect(c.results).toHaveLength(18)
      expect(c.clock.pending).toBe(0)
      checkPrefixes(c)
    })
  })
})

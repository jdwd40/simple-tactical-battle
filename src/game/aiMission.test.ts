import { describe, expect, it, vi } from 'vitest'
import { planOpponent } from '../ai'
import type { GameView, PlanOpponent, TurnOrders } from '../contracts/public'
import { HIDE_AND_SEEK, HIDE_AND_SEEK_ENDING, MISSION_SEED } from '../../tests/scenes/mission'
import { createGameController, SIMULATION_ENGINE, type EngineApi } from './createGameController'
import { createManualClock } from './presentationClock'

// TSB-41: the main game's composition (real engine + the accepted observation-only patrol AI)
// played through to its outcome. The planner spy records only what the planner itself returns.
function mission({ noisyDrafts = false } = {}) {
  const policies: string[] = []
  const planner = vi.fn<PlanOpponent>((observation, memory, random) => {
    const planned = planOpponent(observation, memory, random)
    policies.push(planned.memory.policy)
    return planned
  })
  const resolveTurn = vi.fn<EngineApi['resolveTurn']>(SIMULATION_ENGINE.resolveTurn)
  const controller = createGameController({ seed: MISSION_SEED, newSeed: () => 99, clock: createManualClock(), engine: { ...SIMULATION_ENGINE, resolveTurn }, planOpponent: planner })
  for (const [index, turn] of HIDE_AND_SEEK.entries()) {
    const view = controller.getView()
    if (view.phase !== 'planning') throw new Error(`turn ${index + 1}: expected planning, got ${view.phase}`)
    const contact = view.frame.observation.contacts[0]
    const final: TurnOrders = {
      ...view.draft, cloak: turn.cloak,
      movement: turn.destination ? { kind: 'destination', cell: turn.destination } : { kind: 'hold' },
      weapon: turn.laser && contact ? { kind: 'laser', contactAlias: contact.alias } : { kind: 'hold' },
    }
    if (noisyDrafts) {
      // Indecisive planning: none of this may reach the patrol's plan.
      controller.setDraft({ ...view.draft, sensor: 'activePulse', cloak: !turn.cloak, movement: { kind: 'destination', cell: { column: 0, row: 0 } } })
      controller.setDraft({ ...view.draft, weapon: { kind: 'missile', aim: { column: 15, row: 3 } }, movement: { kind: 'hold' } })
      controller.setDraft({ ...view.draft, movement: { kind: 'destination', cell: { column: 19, row: 19 } } })
    }
    controller.setDraft(final)
    expect(controller.commit(view.draft.turnIndex).kind).toBe('accepted')
    controller.playback({ kind: 'skipToEnd' })
    if (controller.getView().phase === 'terminal') break
    controller.finishAssessment()
  }
  return { controller, planner, policies, resolveTurn }
}

/** The encounter as the player saw it, without per-session counters. */
const record = (view: GameView) => JSON.stringify({ ...view, revision: 0 })

describe('main mission against the real patrol AI', () => {
  it('reaches its recorded outcome with the frigate engaging, losing contact, investigating and searching', () => {
    const { controller, policies, resolveTurn, planner } = mission()
    const ending = controller.getView()
    if (ending.phase !== 'terminal' || ending.result.kind !== 'combat') throw new Error(`expected an ending, got ${ending.phase}`)
    expect(ending.result.outcome).toEqual(HIDE_AND_SEEK_ENDING)
    expect(resolveTurn).toHaveBeenCalledTimes(9)
    expect(planner).toHaveBeenCalledTimes(9)
    expect(policies.slice(0, 7)).toEqual(['PATROL', 'ENGAGE', 'ENGAGE', 'INVESTIGATE', 'INVESTIGATE', 'SEARCH', 'SEARCH'])
    const events = ending.replay?.events ?? []
    expect(events.filter((event) => event.kind === 'observed-shot').map((event) => event.tick)).toEqual([837])
    expect(events.some((event) => event.kind === 'own-destruction' && event.tick === 837)).toBe(true)
    // The frigate's patrol scan and both search phases were its own choices: one pulse each.
    expect(resolveTurn.mock.calls.filter(([, locked]) => locked.orders.patrol?.sensor === 'activePulse')).toHaveLength(2)
  })

  it('plans once per planning entry: draft edits never reroll the frigate, and the same seed replays exactly', () => {
    const clean = mission()
    const noisy = mission({ noisyDrafts: true })
    expect(noisy.planner).toHaveBeenCalledTimes(9)
    expect(noisy.resolveTurn.mock.calls.map(([, locked]) => locked.orders.patrol)).toEqual(clean.resolveTurn.mock.calls.map(([, locked]) => locked.orders.patrol))
    expect(record(noisy.controller.getView())).toBe(record(clean.controller.getView()))
    expect(record(mission().controller.getView())).toBe(record(clean.controller.getView()))
  })

  it('restarts the same seed cleanly after the outcome, with the planner starting over', () => {
    const { controller, planner } = mission()
    controller.restart({ kind: 'same-seed' })
    const fresh = controller.getView()
    expect(fresh).toMatchObject({ phase: 'planning', encounterId: 'encounter-2', frame: { tick: 0 } })
    expect(controller.seedOf('encounter-2')).toBe(MISSION_SEED)
    expect(controller.seedOf('encounter-1')).toBeNull()
    expect(planner.mock.calls.at(-1)?.[1].policy).toBe('PATROL')
    controller.restart({ kind: 'new-seed' })
    expect(controller.seedOf('encounter-3')).toBe(99)
  })
})

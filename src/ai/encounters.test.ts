import { describe, expect, it } from 'vitest'
import type { SimulationState } from '../contracts/private'
import type { ContactMemory, Outcome, Position, SideObservation, TurnOrders } from '../contracts'
import { aftermathWindowBound, DUEL_RULES } from '../contracts'
// Headless verification harness: the real engine stands in for the application controller.
import { DUEL_SCENARIO } from '../scenarios/private'
import { initialiseSession, observeSide, resolveTurn, validateOrders } from '../simulation'
import { planOpponent } from './index'

type Script = (view: SideObservation) => TurnOrders
const cellOf = (p: Position) => ({ column: Math.floor(p.x / 1000), row: Math.floor(p.y / 1000) })
const range = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y)
const holdOrders = (view: SideObservation): TurnOrders => ({ turnIndex: view.turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
const freshest = (contacts: readonly ContactMemory[]) => [...contacts].sort((a, b) => a.ageTicks - b.ageTicks)[0]

/** Observation-only player scripts (never read the patrol's state). */
const SCRIPTS: Record<'stalker' | 'hunter' | 'kiter', Script> = {
  // Cloaked loop through the middle; lasers a current contact within 6 cells.
  stalker: (view) => {
    const loop = [{ column: 8, row: 10 }, { column: 10, row: 7 }, { column: 12, row: 10 }, { column: 10, row: 14 }]
    const contact = view.contacts.find((candidate) => candidate.kind === 'current')
    const close = contact !== undefined && range(contact.measurement.position, view.ownShip.position) <= 6000
    return {
      turnIndex: view.turnIndex, movement: { kind: 'destination', cell: loop[view.turnIndex % loop.length] }, sensor: 'passive',
      cloak: !close && view.ownShip.energy.currentMilli >= 40_000,
      weapon: close && contact !== undefined ? { kind: 'laser', contactAlias: contact.alias } : { kind: 'hold' },
    }
  },
  // Uncloaked; chases the freshest contact, pulses every other idle turn, lasers or plots a missile at its cell.
  hunter: (view) => {
    const own = view.ownShip
    const contact = freshest(view.contacts)
    const target = contact === undefined ? { column: 13, row: 10 } : cellOf(contact.measurement.position)
    let weapon: TurnOrders['weapon'] = { kind: 'hold' }
    if (contact?.kind === 'current') {
      const distance = range(contact.measurement.position, own.position)
      const missileReady = own.ammunition.current > 0 && own.clocks.missileReadyTick <= view.tick + 1
      weapon = distance > 7000 && distance >= 3000 && missileReady ? { kind: 'missile', aim: target } : { kind: 'laser', contactAlias: contact.alias }
    }
    const sensor = contact === undefined && view.turnIndex % 2 === 0 && own.energy.currentMilli >= 40_000 ? 'activePulse' : 'passive'
    return { turnIndex: view.turnIndex, movement: { kind: 'destination', cell: target }, sensor, cloak: false, weapon }
  },
  // Uncloaked; holds about 8 cells west of the freshest contact on its row and plots missiles at it.
  kiter: (view) => {
    const own = view.ownShip
    const contact = freshest(view.contacts)
    const at = contact === undefined ? { column: 13, row: 10 } : cellOf(contact.measurement.position)
    const station = { column: Math.max(0, at.column - 8), row: at.row }
    const open = !view.map.asteroidCells.some((rock) => rock.column === station.column && rock.row === station.row)
    const missileReady = own.ammunition.current > 0 && own.clocks.missileReadyTick <= view.tick + 1
    const weapon: TurnOrders['weapon'] = contact?.kind === 'current' && missileReady ? { kind: 'missile', aim: at } : { kind: 'hold' }
    return { turnIndex: view.turnIndex, movement: open ? { kind: 'destination', cell: station } : { kind: 'hold' }, sensor: 'passive', cloak: false, weapon }
  },
}

interface Diagnostics {
  readonly result: Outcome | 'cutoff'; readonly normalTurns: number; readonly automaticWindows: number
  readonly policies: string; readonly patrolWeapons: string; readonly patrolPulses: number
  readonly invalidPlannerOrders: number; readonly scriptFallbacks: number; readonly finalState: SimulationState
}

/**
 * One bounded encounter. Like the application, it plans once per planning entry, writes the planner
 * memory and random state back before resolving, skips planners for destroyed ships and runs
 * automatic windows after the player's destruction. A cutoff is a diagnostic, never a draw.
 */
function encounter(seed: number, script: Script, maxTurns = 40): Diagnostics {
  let state = initialiseSession(DUEL_SCENARIO, DUEL_RULES, seed)
  let normalTurns = 0
  let automaticWindows = 0
  let bound: number | null = null
  let invalidPlannerOrders = 0
  let scriptFallbacks = 0
  let patrolPulses = 0
  const policies: string[] = []
  const patrolWeapons: string[] = []
  while (state.outcome === null) {
    const playerAlive = state.ships.player.alive
    if (playerAlive && normalTurns >= maxTurns) break
    if (!playerAlive) {
      bound ??= aftermathWindowBound(DUEL_RULES, state.ships.patrol.alive ? state.ships.patrol.ammunition : 0)
      if (automaticWindows >= bound) throw new Error(`Internal invariant: automatic windows exceeded ${bound}`)
    }
    let patrol: TurnOrders | null = null
    if (state.ships.patrol.alive) {
      const view = observeSide(state, 'patrol', DUEL_RULES, DUEL_SCENARIO)
      const planned = planOpponent(view, state.plannerMemory.patrol, state.random.planners.patrol)
      if (!validateOrders(planned.orders, view, DUEL_RULES).structurallyValid) invalidPlannerOrders += 1
      state = {
        ...state, plannerMemory: { ...state.plannerMemory, patrol: planned.memory },
        random: { ...state.random, planners: { ...state.random.planners, patrol: planned.plannerRandomState } },
      }
      patrol = planned.orders
      if (policies.at(-1) !== planned.memory.policy) policies.push(planned.memory.policy)
      if (patrol.weapon.kind !== 'hold') patrolWeapons.push(`${state.turnIndex}:${patrol.weapon.kind}`)
      if (patrol.sensor === 'activePulse') patrolPulses += 1
    }
    let player: TurnOrders | null = null
    if (playerAlive) {
      const view = observeSide(state, 'player', DUEL_RULES, DUEL_SCENARIO)
      player = script(view)
      if (!validateOrders(player, view, DUEL_RULES).structurallyValid) {
        scriptFallbacks += 1
        player = holdOrders(view)
      }
    }
    state = resolveTurn(state, { turnIndex: state.turnIndex, startTick: state.tick, automatic: !playerAlive, orders: { player, patrol } }, DUEL_RULES, DUEL_SCENARIO).nextState
    if (playerAlive) normalTurns += 1
    else automaticWindows += 1
  }
  return {
    result: state.outcome?.outcome ?? 'cutoff', normalTurns, automaticWindows, policies: policies.join('>'),
    patrolWeapons: patrolWeapons.join(' '), patrolPulses, invalidPlannerOrders, scriptFallbacks, finalState: state,
  }
}

describe('bounded headless encounters (3 scripts × seeds 1–3, ≤ 40 normal turns)', () => {
  const runs = (['stalker', 'hunter', 'kiter'] as const).flatMap((name) => [1, 2, 3].map((seed) => ({ name, seed, ...encounter(seed, SCRIPTS[name]) })))

  it('plans only structurally valid orders and stays within the automatic-window bound', () => {
    for (const run of runs) {
      expect(run.invalidPlannerOrders).toBe(0)
      expect(['victory', 'defeat', 'mutual-destruction', 'cutoff']).toContain(run.result)
      expect(run.normalTurns).toBeLessThanOrEqual(40)
    }
  })

  it('records reproducible outcomes and diagnostics (baseline hypotheses; balance belongs to TSB-51)', () => {
    const row = (name: string, seed: number, result: string, normalTurns: number, policies: string, patrolWeapons: string, patrolPulses: number) =>
      ({ name, seed, result, normalTurns, automaticWindows: 0, policies, patrolWeapons, patrolPulses, scriptFallbacks: 0 })
    const lasers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `${from + index}:laser`).join(' ')
    expect(runs.map(({ name, seed, result, normalTurns, automaticWindows, policies, patrolWeapons, patrolPulses, scriptFallbacks }) =>
      ({ name, seed, result, normalTurns, automaticWindows, policies, patrolWeapons, patrolPulses, scriptFallbacks }))).toEqual([
      row('stalker', 1, 'defeat', 12, 'PATROL>ENGAGE>INVESTIGATE>SEARCH', lasers(5, 11), 2),
      row('stalker', 2, 'defeat', 6, 'PATROL>INVESTIGATE>ENGAGE>INVESTIGATE', lasers(2, 5), 1),
      row('stalker', 3, 'defeat', 6, 'PATROL>INVESTIGATE>ENGAGE>INVESTIGATE', lasers(2, 5), 2),
      row('hunter', 1, 'defeat', 5, 'PATROL>ENGAGE', lasers(1, 4), 1),
      row('hunter', 2, 'defeat', 5, 'PATROL>ENGAGE', lasers(1, 4), 0),
      row('hunter', 3, 'defeat', 5, 'PATROL>ENGAGE', lasers(1, 4), 1),
      row('kiter', 1, 'defeat', 9, 'PATROL>ENGAGE>INVESTIGATE>ENGAGE', lasers(5, 8), 2),
      row('kiter', 2, 'defeat', 6, 'PATROL>ENGAGE>INVESTIGATE>ENGAGE', lasers(1, 5), 0),
      row('kiter', 3, 'defeat', 6, 'PATROL>ENGAGE>INVESTIGATE>ENGAGE', lasers(1, 5), 1),
    ])
  })

  it('replays an encounter identically from the same seed and scripts', () => {
    const again = encounter(2, SCRIPTS.hunter)
    const first = runs.find((run) => run.name === 'hunter' && run.seed === 2)
    expect(again.finalState).toEqual(first?.finalState)
  })
})

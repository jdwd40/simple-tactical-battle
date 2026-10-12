import { describe, expect, it } from 'vitest'
import type { Scenario, SimulationState, TurnResolution } from '../contracts/private'
import type { Side, SideObservation } from '../contracts/public'
import { DUEL_SCENARIO } from '../scenarios/private'
import { DUEL_RULES } from '../scenarios/public'
import { createRuleset, DUEL_CONFIG } from '../scenarios/rules'
import { initialiseSession, resolveTurn } from './index'
import { resolveTurnInOrder } from './resolve'
import { lock, orders } from './testSupport'

const PLAYER_EAST = { column: 16, row: 10 }
const PATROL_WEST = { column: 3, row: 10 }

function crossing(): { start: SimulationState; result: TurnResolution } {
  const start = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
  return { start, result: resolveTurn(start, lock(start, orders(0, PLAYER_EAST, true), orders(0, PATROL_WEST)), DUEL_RULES, DUEL_SCENARIO) }
}
const frameAt = (result: TurnResolution, side: Side, tick: number): SideObservation => {
  const frame = result.presentations[side].frames.find((candidate) => candidate.tick === tick)
  if (frame === undefined) throw new Error(`no frame at ${tick}`)
  return frame.observation
}

describe('session initialisation', () => {
  it('builds complete private state from scenario, rules and seed', () => {
    const state = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)
    expect(state.tick).toBe(0)
    expect(state.turnIndex).toBe(0)
    expect(state.ships.player).toMatchObject({ position: { x: 3500, y: 10_500 }, headingMilliDegrees: 90_000, energyMilli: 100_000, hull: 100, shields: 40, ammunition: 6, cloakRequested: true, cloakActive: true })
    expect(state.ships.patrol).toMatchObject({ position: { x: 16_500, y: 10_500 }, headingMilliDegrees: 270_000, shields: 60, ammunition: 4, cloakRequested: false, cloakActive: false })
    expect(state.knowledge.player.contacts).toEqual([])
    expect(state.knowledge.patrol.contacts).toEqual([])
    expect(new Set([state.random.simulation, state.random.planners.player, state.random.planners.patrol]).size).toBe(3)
    expect(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)).toEqual(state)
    expect(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 8).random).not.toEqual(state.random)
    expect(Object.isFrozen(state.ships.player.position)).toBe(true)
  })
  it('rejects invalid seeds and scenario/rules mismatches', () => {
    expect(() => initialiseSession(DUEL_SCENARIO, DUEL_RULES, -1)).toThrow('uint32')
    expect(() => initialiseSession(DUEL_SCENARIO, DUEL_RULES, 1.5)).toThrow('uint32')
    const blocked: Scenario = { ...DUEL_SCENARIO, spawns: { ...DUEL_SCENARIO.spawns, patrol: { ...DUEL_SCENARIO.spawns.patrol, cell: { column: 7, row: 4 } } } }
    expect(() => initialiseSession(blocked, DUEL_RULES, 1)).toThrow('free map cell')
  })
})

describe('fixed-tick movement turn', () => {
  it('resolves exactly the configured ticks and records starting plus every tick frame per side', () => {
    const { start, result } = crossing()
    expect(result.nextState.tick).toBe(100)
    expect(result.nextState.turnIndex).toBe(1)
    for (const side of ['player', 'patrol'] as const) {
      const presentation = result.presentations[side]
      expect(presentation).toMatchObject({ side, startTick: 0, endTick: 100, automatic: false })
      expect(presentation.frames.map((frame) => frame.tick)).toEqual(Array.from({ length: 101 }, (_, tick) => tick))
      for (const frame of presentation.frames) {
        expect(frame.observation.tick).toBe(frame.tick)
        expect(frame.observation.events).toEqual(frame.events)
        expect(frame.events.every((event) => event.tick === frame.tick)).toBe(true)
      }
    }
    expect(result.nextState.acceptedTurns).toEqual([result.locked])
    expect(start.tick).toBe(0)
  })
  it('moves both committed routes simultaneously; ships cross and overlap without blocking', () => {
    const { result } = crossing()
    expect(frameAt(result, 'player', 1).ownShip.position).toEqual({ x: 3600, y: 10_500 })
    expect(frameAt(result, 'patrol', 1).ownShip.position).toEqual({ x: 16_420, y: 10_500 })
    // Both centres pass x=10,000 region in the same ticks; nothing stops either ship.
    expect(result.nextState.ships.player.position).toEqual({ x: 13_500, y: 10_500 })
    expect(result.nextState.ships.patrol.position).toEqual({ x: 8500, y: 10_500 })
    expect(result.nextState.ships.player.headingMilliDegrees).toBe(90_000)
    expect(result.nextState.ships.patrol.headingMilliDegrees).toBe(270_000)
    const movement = result.internalEvents.filter((event) => event.kind === 'movement')
    expect(movement).toHaveLength(200)
  })
  it('charges regeneration → cloak → propulsion in integer milli-energy', () => {
    const { result } = crossing()
    // Tick 1: capped regen, -300 cloak, -100 propulsion; then net -200 per tick.
    expect(frameAt(result, 'player', 1).ownShip.energy.currentMilli).toBe(99_600)
    expect(result.nextState.ships.player.energyMilli).toBe(99_600 - 99 * 200)
    expect(result.presentations.player.assessment.deltas.energyMilli).toBe(79_800 - 100_000)
    // Frigate: regen refills to cap, propulsion -100 each tick.
    expect(result.nextState.ships.patrol.energyMilli).toBe(99_900)
    expect(frameAt(result, 'player', 50).ownShip.cloak).toEqual({ requested: true, actual: true, state: 'active' })
  })
  it('is reproducible and independent of side evaluation order', () => {
    const { start, result } = crossing()
    const turn = lock(start, orders(0, PLAYER_EAST, true), orders(0, PATROL_WEST))
    expect(JSON.stringify(resolveTurn(start, turn, DUEL_RULES, DUEL_SCENARIO))).toBe(JSON.stringify(result))
    expect(JSON.stringify(resolveTurnInOrder(start, turn, DUEL_RULES, DUEL_SCENARIO, ['patrol', 'player']))).toBe(JSON.stringify(result))
    const reversedKeys: SimulationState = { ...start, ships: { patrol: start.ships.patrol, player: start.ships.player } }
    expect(JSON.stringify(resolveTurn(reversedKeys, turn, DUEL_RULES, DUEL_SCENARIO))).toBe(JSON.stringify(result))
  })
  it('does not mutate input state, locked orders, rules or scenario', () => {
    const start = structuredClone(initialiseSession(DUEL_SCENARIO, DUEL_RULES, 7)) as SimulationState
    const turn = lock(start, orders(0, PLAYER_EAST, true), orders(0, PATROL_WEST))
    const before = JSON.stringify({ start, turn, DUEL_RULES, DUEL_SCENARIO })
    const result = resolveTurn(start, turn, DUEL_RULES, DUEL_SCENARIO)
    expect(JSON.stringify({ start, turn, DUEL_RULES, DUEL_SCENARIO })).toBe(before)
    expect(Object.isFrozen(start.ships.player)).toBe(false)
    expect(Object.isFrozen(turn.orders.player)).toBe(false)
    expect(Object.isFrozen(result.nextState.ships.player.route)).toBe(true)
    expect(Object.isFrozen(result.presentations.player.frames[3].observation.ownShip)).toBe(true)
  })
})

describe('routes and clocks across turn boundaries', () => {
  it('resumes identical destinations without resetting progress and keeps arrival', () => {
    const { result } = crossing()
    const s1 = result.nextState
    expect(s1.ships.player.destination).toEqual(PLAYER_EAST)
    expect(s1.ships.player.route.remainingDistanceUnits).toBe(3000)
    const second = resolveTurn(s1, lock(s1, orders(1, PLAYER_EAST, true), orders(1, PATROL_WEST)), DUEL_RULES, DUEL_SCENARIO)
    expect(frameAt(second, 'player', 101).ownShip.position).toEqual({ x: 13_600, y: 10_500 })
    expect(frameAt(second, 'player', 130).ownShip.position).toEqual({ x: 16_500, y: 10_500 })
    expect(frameAt(second, 'player', 130).ownShip.route.remainingDistanceUnits).toBe(0)
    expect(second.nextState.ships.patrol.position).toEqual({ x: 3500, y: 10_500 })
    expect(second.presentations.player.assessment).toMatchObject({ destination: PLAYER_EAST, destinationReached: true, startPosition: { x: 13_500, y: 10_500 }, endPosition: { x: 16_500, y: 10_500 } })
    // Arrived ships stop paying propulsion: regen +200 vs cloak -300 for the last 70 ticks.
    const atArrival = frameAt(second, 'player', 130).ownShip.energy.currentMilli
    expect(second.nextState.ships.player.energyMilli).toBe(atArrival - 70 * 100)
  })
  it('holds immediately, and a revised route first connects to the current free cell centre', () => {
    const rules = createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, turnMs: 2300 } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, 3)
    const s1 = resolveTurn(s0, lock(s0, orders(0, PLAYER_EAST), orders(0, null)), rules, DUEL_SCENARIO).nextState
    expect(s1.ships.player.position).toEqual({ x: 5800, y: 10_500 })
    const held = resolveTurn(s1, lock(s1, orders(1, null), orders(1, null)), rules, DUEL_SCENARIO)
    expect(held.nextState.ships.player.position).toEqual({ x: 5800, y: 10_500 })
    expect(held.nextState.ships.player.destination).toBeNull()
    expect(held.nextState.ships.player.route.waypoints).toEqual([])
    const s2 = held.nextState
    const revised = resolveTurn(s2, lock(s2, orders(2, { column: 5, row: 7 }), orders(2, null)), rules, DUEL_SCENARIO)
    const route = frameAt(revised, 'player', s2.tick).ownShip.route
    expect(route.waypoints.slice(0, 3)).toEqual([{ x: 5800, y: 10_500 }, { x: 5500, y: 10_500 }, { x: 5500, y: 9500 }])
    expect(frameAt(revised, 'player', s2.tick + 1).ownShip.headingMilliDegrees).toBe(270_000)
    expect(frameAt(revised, 'player', s2.tick + 4).ownShip.headingMilliDegrees).toBe(0)
    expect(revised.nextState.ships.player.position).toEqual({ x: 5500, y: 10_500 - 2000 })
  })
})

describe('movement funding', () => {
  it('pauses unfunded propulsion, reports interruptions once per transition and never goes negative', () => {
    const ship = DUEL_CONFIG.ships['shadow-dancer']
    const rules = createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, startingEnergyMilli: 1000, regenerationMilliPerSecond: 0 } } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, 1)
    const result = resolveTurn(s0, lock(s0, orders(0, PLAYER_EAST, true), orders(0, null)), rules, DUEL_SCENARIO)
    const player = result.presentations.player
    expect(player.assessment.interruptions).toEqual([{ tick: 3, reason: 'cloak-unfunded' }, { tick: 5, reason: 'propulsion-unfunded' }])
    expect(player.frames.flatMap((frame) => frame.events).map((event) => event.kind)).toEqual(['own-interruption', 'own-cloak', 'own-interruption'])
    expect(frameAt(result, 'player', 3).ownShip.cloak).toEqual({ requested: true, actual: false, state: 'latched-unfunded' })
    expect(result.nextState.ships.player.position).toEqual({ x: 3900, y: 10_500 })
    expect(result.nextState.ships.player.energyMilli).toBe(0)
    expect(player.frames.every((frame) => frame.observation.ownShip.energy.currentMilli >= 0)).toBe(true)
    expect(player.assessment).toMatchObject({ destinationReached: false, deltas: { energyMilli: -1000, hull: 0, shields: 0, ammunition: 0 } })
    expect(result.nextState.ships.player.route.remainingDistanceUnits).toBe(12_600)
  })
  it('keeps an unfunded cloak latched for the rest of the turn and retries only on a later explicit order', () => {
    const ship = DUEL_CONFIG.ships['shadow-dancer']
    const rules = createRuleset({ ...DUEL_CONFIG, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...ship, startingEnergyMilli: 0 } } })
    const s0 = initialiseSession(DUEL_SCENARIO, rules, 1)
    const first = resolveTurn(s0, lock(s0, orders(0, null, true), orders(0, null)), rules, DUEL_SCENARIO)
    const states = first.presentations.player.frames.slice(1).map((frame) => frame.observation.ownShip.cloak.state)
    expect(new Set(states)).toEqual(new Set(['latched-unfunded']))
    expect(first.nextState.ships.player.energyMilli).toBe(20_000)
    const s1 = first.nextState
    const second = resolveTurn(s1, lock(s1, orders(1, null, true), orders(1, null)), rules, DUEL_SCENARIO)
    expect(frameAt(second, 'player', 101).ownShip.cloak).toEqual({ requested: true, actual: true, state: 'active' })
  })
})

describe('locked input checks', () => {
  it('rejects mismatched turns, invalid envelopes and capabilities outside this increment', () => {
    const s0 = initialiseSession(DUEL_SCENARIO, DUEL_RULES, 1)
    expect(() => resolveTurn(s0, { ...lock(s0, orders(0, null), orders(0, null)), startTick: 5 }, DUEL_RULES, DUEL_SCENARIO)).toThrow('turn/tick')
    expect(() => resolveTurn(s0, lock(s0, orders(1, null), orders(0, null)), DUEL_RULES, DUEL_SCENARIO)).toThrow('turnIndex:invalid-turn')
    expect(() => resolveTurn(s0, lock(s0, orders(0, { column: 7, row: 4 }), orders(0, null)), DUEL_RULES, DUEL_SCENARIO)).toThrow('movement:obstacle')
    expect(() => resolveTurn(s0, lock(s0, null, orders(0, null)), DUEL_RULES, DUEL_SCENARIO)).toThrow('requires locked orders')
    expect(() => resolveTurn(s0, lock(s0, orders(0, null), orders(0, null, true)), DUEL_RULES, DUEL_SCENARIO)).toThrow('cloak:equipment-unavailable')
    const pulse = { ...orders(0, null), sensor: 'activePulse' as const }
    expect(() => resolveTurn(s0, lock(s0, pulse, orders(0, null)), DUEL_RULES, DUEL_SCENARIO)).toThrow('sensor:equipment-unavailable')
    const missile = { ...orders(0, null), weapon: { kind: 'missile' as const, aim: { column: 10, row: 10 } } }
    expect(() => resolveTurn(s0, lock(s0, orders(0, null), missile), DUEL_RULES, DUEL_SCENARIO)).toThrow('weapon:equipment-unavailable')
    const otherRules = createRuleset({ ...DUEL_CONFIG, version: 'other' })
    expect(() => resolveTurn(s0, lock(s0, orders(0, null), orders(0, null)), otherRules, DUEL_SCENARIO)).toThrow('do not match')
  })
})

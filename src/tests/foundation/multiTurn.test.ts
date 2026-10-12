import { describe, expect, it } from 'vitest'
import type { AcceptedTurn, SimulationState, TurnResolution } from '../../contracts/private'
import type { Ruleset, Side } from '../../contracts/public'
import { DUEL_SCENARIO } from '../../scenarios/private'
import { createRuleset, DUEL_CONFIG } from '../../scenarios/rules'
import { initialiseSession, observeSide, resolveTurn, validateOrders } from '../../simulation/index'
import { MOVEMENT_SEQUENCES, type MovementSequence } from './movementSequences'

const SIDES: readonly Side[] = ['player', 'patrol']
const cases = MOVEMENT_SEQUENCES.flatMap((sequence) => [100, 250, 500].map((tickMs) => ({ sequence, tickMs, id: sequence.id, seed: sequence.seed })))
const jsonCopy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Literal orders and clock inputs are generated from fixture index, not engine output. */
function run(sequence: MovementSequence, rules: Ruleset, initial: SimulationState, roundtrip = false): TurnResolution[] {
  if (sequence.turns.length > 8) throw new Error('Foundation fixtures are bounded to eight turns')
  let state = initial
  const results: TurnResolution[] = []
  for (const [turnIndex, policy] of sequence.turns.entries()) {
    const orders = {
      player: { ...policy.player, turnIndex, sensor: 'passive', weapon: { kind: 'hold' } },
      patrol: { ...policy.patrol, turnIndex, sensor: 'passive', weapon: { kind: 'hold' } },
    } as const
    const locked: AcceptedTurn = { turnIndex, startTick: turnIndex * rules.timing.turnTicks, automatic: false, orders }
    try {
      for (const side of SIDES) {
        expect(validateOrders(orders[side], observeSide(state, side, rules, DUEL_SCENARIO), rules).structurallyValid).toBe(true)
      }
      const result = resolveTurn(state, locked, rules, DUEL_SCENARIO)
      expect(result.locked).toEqual(locked)
      results.push(result)
      state = roundtrip ? jsonCopy(result.nextState) : result.nextState
    } catch (cause) {
      throw new Error(`Resolution reproduction: ${JSON.stringify({ seed: sequence.seed, rules, sequence, locked, state })}`, { cause })
    }
  }
  return results
}

/** Independent circle/rectangle clearance check; no engine sweep/pathfinding helper. */
function checkTerrain(x: number, y: number, rules: Ruleset): void {
  const units = rules.geometry.unitsPerCell
  const radius = rules.geometry.shipRadiusUnits
  expect(Number.isSafeInteger(x) && Number.isSafeInteger(y)).toBe(true)
  expect(x).toBeGreaterThanOrEqual(radius)
  expect(y).toBeGreaterThanOrEqual(radius)
  expect(x).toBeLessThanOrEqual(DUEL_SCENARIO.map.columns * units - radius)
  expect(y).toBeLessThanOrEqual(DUEL_SCENARIO.map.rows * units - radius)
  for (const cell of DUEL_SCENARIO.map.asteroidCells) {
    const dx = Math.max(cell.column * units - x, 0, x - (cell.column + 1) * units)
    const dy = Math.max(cell.row * units - y, 0, y - (cell.row + 1) * units)
    expect(dx * dx + dy * dy, `ship at (${x},${y}) overlaps asteroid (${cell.column},${cell.row})`).toBeGreaterThanOrEqual(radius * radius)
  }
}

function checkSequence(results: readonly TurnResolution[], sequence: MovementSequence, rules: Ruleset, initial: SimulationState): void {
  for (const [index, result] of results.entries()) {
    const prior = index === 0 ? initial : results[index - 1].nextState
    expect(result.nextState.tick).toBe((index + 1) * rules.timing.turnTicks)
    expect(result.nextState.turnIndex).toBe(index + 1)
    expect(result.nextState.acceptedTurns).toEqual(results.slice(0, index + 1).map((turn) => turn.locked))
    for (const side of SIDES) {
      const presentation = result.presentations[side]
      const frames = presentation.frames
      const policy = sequence.turns[index][side]
      const finalShip = result.nextState.ships[side]
      const finalOwn = frames.at(-1)!.observation.ownShip
      expect(presentation.startTick).toBe(index * rules.timing.turnTicks)
      expect(presentation.endTick).toBe((index + 1) * rules.timing.turnTicks)
      expect(frames.map((frame) => frame.tick)).toEqual(Array.from({ length: rules.timing.turnTicks + 1 }, (_, offset) => index * rules.timing.turnTicks + offset))
      expect(frames[0].events).toEqual([]) // Do not repeat the prior boundary's events.
      expect(frames[0].observation.ownShip.position).toEqual(prior.ships[side].position)
      if (index > 0 && policy.movement.kind === 'destination' && JSON.stringify(policy.movement.cell) === JSON.stringify(prior.ships[side].destination)) {
        expect(frames[0].observation.ownShip.route).toEqual(prior.ships[side].route)
      }
      if (policy.movement.kind === 'hold') {
        expect(finalShip.destination).toBeNull()
        expect(finalShip.route.waypoints).toEqual([])
        expect(frames.every((frame) => JSON.stringify(frame.observation.ownShip.position) === JSON.stringify(prior.ships[side].position))).toBe(true)
      } else {
        expect(finalShip.destination).toEqual(policy.movement.cell)
        if (JSON.stringify(policy.movement.cell) !== JSON.stringify(prior.ships[side].destination)) {
          expect(frames[0].observation.ownShip.route.waypoints.at(-1)).toEqual({ x: policy.movement.cell.column * rules.geometry.unitsPerCell + rules.geometry.unitsPerCell / 2, y: policy.movement.cell.row * rules.geometry.unitsPerCell + rules.geometry.unitsPerCell / 2 })
        }
      }
      expect(finalOwn.position).toEqual(finalShip.position)
      expect(finalOwn.destination).toEqual(finalShip.destination)
      expect(finalOwn.route).toEqual(finalShip.route)
      expect(finalOwn.headingMilliDegrees).toBe(finalShip.headingMilliDegrees)
      expect(finalOwn.energy.currentMilli).toBe(finalShip.energyMilli)
      expect(finalOwn.hull.current).toBe(finalShip.hull)
      expect(finalOwn.shields.current).toBe(finalShip.shields)
      expect(finalOwn.ammunition.current).toBe(finalShip.ammunition)
      expect(finalOwn.cloak.requested).toBe(policy.cloak)
      expect(finalOwn.cloak.actual).toBe(finalShip.cloakActive)
      expect(presentation.assessment).toMatchObject({
        startPosition: prior.ships[side].position, endPosition: finalShip.position, revealTick: presentation.endTick,
        deltas: { energyMilli: finalShip.energyMilli - prior.ships[side].energyMilli, hull: finalShip.hull - prior.ships[side].hull, shields: finalShip.shields - prior.ships[side].shields, ammunition: finalShip.ammunition - prior.ships[side].ammunition },
      })
      expect(presentation.assessment.events).toEqual(frames.flatMap((frame) => frame.events))
      for (const frame of frames) {
        expect(frame.observation.side).toBe(side)
        expect(frame.observation.tick).toBe(frame.tick)
        expect(frame.observation.events).toEqual(frame.events)
        expect(frame.events.every((event) => event.tick === frame.tick)).toBe(true)
        const own = frame.observation.ownShip
        checkTerrain(own.position.x, own.position.y, rules)
        expect(Number.isSafeInteger(own.energy.currentMilli)).toBe(true)
        expect(own.energy.currentMilli).toBeGreaterThanOrEqual(0)
        expect(own.energy.currentMilli).toBeLessThanOrEqual(rules.ships[own.shipClass].maxEnergyMilli)
        for (const gauge of [own.hull, own.shields, own.ammunition]) {
          expect(Number.isSafeInteger(gauge.current)).toBe(true)
          expect(gauge.current).toBeGreaterThanOrEqual(0)
          expect(gauge.current).toBeLessThanOrEqual(gauge.max)
        }
      }
    }
  }
  for (const side of SIDES) {
    const events = results.flatMap((turn) => turn.presentations[side].frames.flatMap((frame) => frame.events))
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
    expect(results.at(-1)!.nextState.ships[side].position).toEqual(sequence.finalPositions[side])
  }
  expect(results[0].nextState.ships.player.route.remainingDistanceUnits).toBeGreaterThan(0)
  if (sequence.id === 'cross-separate-reacquire') {
    const contacts = results.flatMap((turn) => turn.presentations.player.frames.map((frame) => frame.observation.contacts)).flat()
    const acquired = contacts.find((contact) => contact.kind === 'current')
    expect(acquired).toBeDefined()
    expect(contacts.some((contact) => contact.kind === 'stale' && contact.ageTicks > 0)).toBe(true)
    const reacquired = results[3].presentations.player.frames.flatMap((frame) => frame.observation.contacts).find((contact) => contact.kind === 'current')
    expect(reacquired?.alias).toBe(acquired?.alias)
    expect(results[1].nextState.knowledge.player.contacts[0].contact.kind).toBe('stale')
  }
}

describe.each(cases)('$id seed=$seed tickMs=$tickMs', ({ sequence, tickMs }) => {
  const rules = createRuleset({ ...DUEL_CONFIG, timing: { ...DUEL_CONFIG.timing, tickMs } })
  it('records coherent multi-turn output and reproduces complete results with and without state serialization', () => {
    const initial = initialiseSession(DUEL_SCENARIO, rules, sequence.seed)
    const results = run(sequence, rules, initial)
    try {
      checkSequence(results, sequence, rules, initial)
      expect(JSON.stringify(run(sequence, rules, initial))).toBe(JSON.stringify(results))
      expect(JSON.stringify(run(sequence, rules, initial, true))).toBe(JSON.stringify(results))
    } catch (cause) {
      throw new Error(`Sequence reproduction: ${JSON.stringify({ seed: sequence.seed, rules, sequence, actualFinalState: results.at(-1)!.nextState })}`, { cause })
    }
  })
  it('fresh same-seed initialization after dirty turns clears session history and repeats the original sequence', () => {
    const original = initialiseSession(DUEL_SCENARIO, rules, sequence.seed)
    const expected = run(sequence, rules, original)
    const dirty = run({ ...sequence, turns: sequence.turns.slice(0, 2) }, rules, original, true).at(-1)!.nextState
    expect(dirty.tick).toBeGreaterThan(0)
    expect(dirty.acceptedTurns).toHaveLength(2)
    expect(dirty.ships.player.orders).not.toBeNull()
    expect(dirty.ships.player.energyMilli).not.toBe(original.ships.player.energyMilli)
    if (sequence.id === 'cross-separate-reacquire') {
      expect(dirty.knowledge.player.contacts.length).toBeGreaterThan(0)
      expect(dirty.knowledge.player.nextContactAlias).toBeGreaterThan(1)
    }
    const dirtyJson = JSON.stringify(dirty)
    const fresh = initialiseSession(DUEL_SCENARIO, rules, sequence.seed)
    try {
      expect(fresh).toEqual(original)
      expect(fresh.tick).toBe(0)
      expect(fresh.turnIndex).toBe(0)
      expect(fresh.acceptedTurns).toEqual([])
      for (const side of SIDES) {
        expect(fresh.ships[side].orders).toBeNull()
        expect(fresh.ships[side].destination).toBeNull()
        expect(fresh.ships[side].route.waypoints).toEqual([])
        expect(fresh.knowledge[side]).toMatchObject({ contacts: [], ownMissiles: [], hostileMissiles: [], nextContactAlias: 1, nextMissileAlias: 1 })
      }
      expect(JSON.stringify(run(sequence, rules, fresh, true))).toBe(JSON.stringify(expected))
      expect(JSON.stringify(dirty)).toBe(dirtyJson)
    } catch (cause) {
      throw new Error(`Reinitialization reproduction: ${JSON.stringify({ seed: sequence.seed, rules, sequence, dirty, actualFreshState: fresh })}`, { cause })
    }
  })
})

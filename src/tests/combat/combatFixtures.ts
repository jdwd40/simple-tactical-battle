import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AcceptedTurn, Scenario, ShipState, SimulationState, TurnResolution } from '../../contracts/private'
import type { Cell, Ruleset, Side, TurnOrders } from '../../contracts/public'
import { createScenario, DUEL_SCENARIO } from '../../scenarios/private'
import { createRuleset, DUEL_CONFIG } from '../../scenarios/rules'
import { initialiseSession, resolveTurn } from '../../simulation'
import { orders, withShip } from '../../simulation/testSupport'

export const SEED = 32
export const hold = (turn: number): TurnOrders => orders(turn, null)
export const missile = (turn: number, column: number, row = 10): TurnOrders => ({ ...hold(turn), weapon: { kind: 'missile', aim: { column, row } } })
export const laser = (turn: number): TurnOrders => ({ ...hold(turn), weapon: { kind: 'laser', contactAlias: 'contact-1' } })

// Small, versioned timing/initial-resource variants: geometry, damage and sweeps keep the approved defaults.
export const BATCH_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-32-batch-v1', timing: {
  ...DUEL_CONFIG.timing, turnMs: 200, laserCooldownMs: 600, missileCooldownMs: 400, missileLifetimeMs: 1500,
} })
export const expiryRules = (lifetimeMs: number) => createRuleset({ ...DUEL_CONFIG, version: `tsb-32-expiry-${lifetimeMs}-v1`, timing: {
  ...DUEL_CONFIG.timing, turnMs: 1200, missileLifetimeMs: lifetimeMs,
} })
export const CROSS_TURN_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-32-energy-delay-v1', timing: {
  ...DUEL_CONFIG.timing, turnMs: 5000, missileCooldownMs: 6000,
}, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...DUEL_CONFIG.ships['shadow-dancer'], startingEnergyMilli: 0 } } })
export const PRIVACY_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-32-hidden-death-v1', timing: {
  // A tick-40 incoming launch's five-tick emission ends before the tick-50 hidden death.
  ...DUEL_CONFIG.timing, turnMs: 5000, exposureMs: 500,
}, ships: { ...DUEL_CONFIG.ships, 'patrol-frigate': { ...DUEL_CONFIG.ships['patrol-frigate'], startingEnergyMilli: 2000 } } })
export const TAIL_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-32-blind-tail-v1', timing: {
  ...DUEL_CONFIG.timing, turnMs: 5000, trackingMs: 6000, missileCooldownMs: 6000,
}, ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...DUEL_CONFIG.ships['shadow-dancer'], maxHull: 45, maxShields: 0 } } })

export function scenario(rules: Ruleset, player: Cell, patrol: Cell): Scenario {
  return createScenario({ ...DUEL_SCENARIO, id: 'tsb-32-combat', version: '1', spawns: {
    player: { ...DUEL_SCENARIO.spawns.player, cell: player, initialOrders: hold(0) },
    patrol: { ...DUEL_SCENARIO.spawns.patrol, cell: patrol, initialOrders: hold(0) },
  } }, rules)
}
export function envelope(state: SimulationState, player: TurnOrders | null, patrol: TurnOrders | null): AcceptedTurn {
  return { turnIndex: state.turnIndex, startTick: state.tick, automatic: !state.ships.player.alive, orders: { player, patrol } }
}

/** Private engine fixtures only. The optional damage is a bounded initial health condition,
 * not a fabricated projectile, contact, cooldown or outcome. All subsequent state is real engine output. */
export function fixture(rules: Ruleset, world: Scenario, initialPatrolDamage?: Pick<ShipState, 'hull' | 'shields'>) {
  const fresh = initialiseSession(world, rules, SEED)
  const initial = initialPatrolDamage ? withShip(fresh, 'patrol', initialPatrolDamage) : fresh
  const results: TurnResolution[] = []
  const attemptedTurns: AcceptedTurn[] = []
  return { rules, scenario: world, initial, results,
    attemptedTurns,
    run(state: SimulationState, player: TurnOrders | null, patrol: TurnOrders | null) {
      const locked = envelope(state, player, patrol)
      attemptedTurns.push(locked)
      const result = resolveTurn(state, locked, rules, world)
      results.push(result)
      return result
    },
  }
}
export type Fixture = ReturnType<typeof fixture>
export function reproduce(fixtures: readonly Fixture[], check: () => void) {
  try { check() } catch (cause) {
    const artifact = join(mkdtempSync(join(tmpdir(), 'tsb-32-combat-')), 'failure.json')
    writeFileSync(artifact, JSON.stringify(fixtures.map((f) => ({ seed: SEED, rules: f.rules, scenario: f.scenario,
      initial: f.initial, orders: f.attemptedTurns, observedOutcomes: f.results,
    })), null, 2))
    throw new Error(`Combat regression seed=${SEED}; reproduction ${artifact}`, { cause })
  }
}
export function at(result: TurnResolution, side: Side, tick: number) {
  const frame = result.presentations[side].frames.find((f) => f.tick === tick)
  if (!frame) throw new Error(`Missing ${side} frame at tick ${tick}`)
  return frame.observation
}
export const resolutions = (result: TurnResolution) => result.internalEvents.filter((event) => event.kind === 'missile-resolved')

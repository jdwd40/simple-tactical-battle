import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario, SimulationState, TurnResolution } from '../../contracts/private'
import type { GameView, PlanOpponent, Ruleset, TurnOrders } from '../../contracts'
import { DUEL_RULES } from '../../contracts'
import { createOpponentPlanner, planOpponent } from '../../ai'
import { createGameController, createManualClock, SIMULATION_ENGINE, type EngineApi } from '../../game'
import { createRuleset, DUEL_CONFIG } from '../../scenarios/rules'
import { createScenario, DUEL_SCENARIO } from '../../scenarios/private'

export const SEED = 17
export const hold = (turnIndex: number): TurnOrders => ({ turnIndex, movement: { kind: 'hold' }, sensor: 'passive', cloak: false, weapon: { kind: 'hold' } })
export const launchNorth = (turnIndex: number): TurnOrders => ({ ...hold(turnIndex), weapon: { kind: 'missile', aim: { column: 10, row: 0 } } })
export const laser = (turnIndex: number): TurnOrders => ({ ...hold(turnIndex), weapon: { kind: 'laser', contactAlias: 'contact-1' } })
export const DEAD_PLAYER_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-42-dead-player-v1', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 },
  ships: { ...DUEL_CONFIG.ships, 'shadow-dancer': { ...DUEL_CONFIG.ships['shadow-dancer'], maxHull: 30, maxShields: 0 } } })
export const DEAD_PATROL_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-42-dead-patrol-v1', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 },
  laser: { ...DUEL_CONFIG.laser, damage: 40 }, ships: { ...DUEL_CONFIG.ships, 'patrol-frigate': { ...DUEL_CONFIG.ships['patrol-frigate'], maxHull: 40, maxShields: 0 } } })
export const BOTH_DEAD_RULES = createRuleset({ ...DUEL_CONFIG, version: 'tsb-42-both-dead-v1', timing: { ...DUEL_CONFIG.timing, turnMs: 1000 },
  laser: { ...DUEL_CONFIG.laser, damage: 40 }, ships: {
    ...DUEL_CONFIG.ships, 'shadow-dancer': { ...DUEL_CONFIG.ships['shadow-dancer'], maxHull: 40, maxShields: 0 },
    'patrol-frigate': { ...DUEL_CONFIG.ships['patrol-frigate'], maxHull: 40, maxShields: 0 },
  } })
function closeScenario(rules: Ruleset): Scenario {
  return createScenario({ ...DUEL_SCENARIO, id: 'tsb-42-close-duel', version: '1', spawns: {
    player: { ...DUEL_SCENARIO.spawns.player, cell: { column: 10, row: 10 }, initialOrders: hold(0) },
    patrol: DUEL_SCENARIO.spawns.patrol,
  } }, rules)
}
/** The cooldown-only initial variant delays the AI's laser so its accepted missile policy is exercised.
 * No contact, projectile, accepted envelope or outcome is fabricated. */
export function setup(rules = DUEL_RULES, initialPatrolLaserReadyTick = 0) {
  const scenario = rules === DUEL_RULES ? DUEL_SCENARIO : closeScenario(rules)
  const initial: SimulationState[] = []
  const inputs: SimulationState[] = []
  const results: TurnResolution[] = []
  const plans: { input: Parameters<PlanOpponent>; output: ReturnType<PlanOpponent> }[] = []
  const views: GameView[] = []
  const clock = createManualClock()
  const actualPlanner = rules === DUEL_RULES ? planOpponent : createOpponentPlanner(rules)
  const engine: EngineApi = { ...SIMULATION_ENGINE,
    initialiseSession(...args) {
      const state = SIMULATION_ENGINE.initialiseSession(...args)
      const variant = initialPatrolLaserReadyTick === 0 ? state : { ...state, ships: { ...state.ships, patrol: { ...state.ships.patrol, laserReadyTick: initialPatrolLaserReadyTick } } }
      initial.push(variant)
      return variant
    },
    resolveTurn(...args) {
      inputs.push(args[0])
      const result = SIMULATION_ENGINE.resolveTurn(...args)
      results.push(result)
      return result
    },
  }
  const controller = createGameController({ seed: SEED, rules, scenario, engine, clock,
    newSeed: () => { throw new Error('Same-seed regression must not draw entropy') },
    planOpponent(...input) {
      const output = actualPlanner(...input)
      plans.push({ input, output })
      return output
    },
  })
  views.push(controller.getView())
  const unsubscribe = controller.subscribe(() => views.push(controller.getView()))
  return { controller, clock, rules, scenario, initialPatrolLaserReadyTick, initial, inputs, results, plans, views,
    dispose: () => { unsubscribe(); controller.dispose() } }
}
export type Context = ReturnType<typeof setup>
export function reproduce(context: Context, check: () => void) {
  try { check() } catch (cause) {
    const artifact = join(mkdtempSync(join(tmpdir(), 'tsb-42-reproduction-')), 'failure.json')
    writeFileSync(artifact, JSON.stringify({ seed: SEED, rules: context.rules, scenario: context.scenario,
      initialPatrolLaserReadyTick: context.initialPatrolLaserReadyTick, initial: context.initial, inputs: context.inputs,
      accepted: context.results.map((r) => r.locked), results: context.results, plans: context.plans, views: context.views }, null, 2))
    throw new Error(`Encounter seed=${SEED}; reproduction ${artifact}`, { cause })
  } finally { context.dispose() }
}

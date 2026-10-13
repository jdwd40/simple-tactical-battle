import type { Scenario, ShipState } from '../../contracts/private'
import type { Cell, TurnOrders } from '../../contracts/public'
import { createScenario, DUEL_SCENARIO } from '../../scenarios/private'
import { DUEL_RULES } from '../../scenarios/public'

export const SCAN_SEEDS = [22, 77] as const
export const HIDDEN_SCAN_ORDERS: TurnOrders = {
  turnIndex: 0, movement: { kind: 'destination', cell: { column: 3, row: 8 } },
  sensor: 'activePulse', cloak: true, weapon: { kind: 'hold' },
}

export interface HiddenVariant {
  readonly id: string
  readonly cell: Cell
  readonly sensor: 'passive' | 'activePulse'
  readonly ship: Partial<ShipState>
}
/** Stationary x>=16500 versus own x=3500: separation exceeds even the 12000-unit exposed threshold. */
export const HIDDEN_VARIANTS: readonly HiddenVariant[] = [
  { id: 'hidden-hold', cell: { column: 16, row: 10 }, sensor: 'passive', ship: { entityId: 'secret-patrol-hold', energyMilli: 100_000, hull: 100, shields: 60, ammunition: 4 } },
  { id: 'hidden-funded-pulse', cell: { column: 17, row: 11 }, sensor: 'activePulse', ship: { entityId: 'secret-patrol-funded', energyMilli: 37_477, hull: 31, shields: 12, ammunition: 1 } },
  { id: 'hidden-unfunded-pulse', cell: { column: 18, row: 10 }, sensor: 'activePulse', ship: { entityId: 'secret-patrol-unfunded', energyMilli: 0, hull: 65, shields: 7, ammunition: 2 } },
]

export function scenarioWithSpawns(player: Cell, patrol: Cell, playerCloak = true): Scenario {
  return createScenario({
    ...DUEL_SCENARIO,
    spawns: {
      player: { ...DUEL_SCENARIO.spawns.player, cell: player, initialOrders: { ...DUEL_SCENARIO.spawns.player.initialOrders, cloak: playerCloak } },
      patrol: { ...DUEL_SCENARIO.spawns.patrol, cell: patrol },
    },
  }, DUEL_RULES)
}

/** Nine cells apart on the asteroid-free row; target moves east while the pulse tracks it. */
export const MOVING_PULSE_SCENARIO = scenarioWithSpawns({ column: 6, row: 10 }, { column: 15, row: 10 })
export const MOVING_PULSE_ORDERS: TurnOrders = {
  turnIndex: 0, movement: { kind: 'hold' }, sensor: 'activePulse', cloak: true, weapon: { kind: 'hold' },
}
